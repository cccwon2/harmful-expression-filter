"""
Phase 2: Deepgram STT 서비스 구현.

Deepgram WebSocket 기반 실시간 STT 서비스
WhisperSTTService와 동일한 인터페이스 유지
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


class DeepgramNotAvailableError(ImportError):
    """Deepgram 패키지가 설치되지 않았거나 API 키가 없는 경우 발생하는 예외."""


class DeepgramSTTService:
    """
    Deepgram STT 서비스.
    
    Deepgram API를 사용하여 오디오를 텍스트로 변환합니다.
    WhisperSTTService와 동일한 인터페이스(`transcribe()` 메서드)를 제공합니다.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        language: str = "ko",
        model: str = "nova-2",
    ) -> None:
        """
        Args:
            api_key: Deepgram API 키 (None이면 환경변수에서 읽음)
            language: 음성 인식 대상 언어 코드 (기본값: "ko")
            model: Deepgram 모델 이름 (기본값: "nova-2", 다른 옵션: "general", "base")
        """
        self.api_key = api_key or os.getenv("DEEPGRAM_API_KEY")
        if not self.api_key:
            raise DeepgramNotAvailableError(
                "DEEPGRAM_API_KEY가 환경변수에 설정되지 않았습니다. "
                ".env 파일에 DEEPGRAM_API_KEY를 추가하거나 환경변수로 설정하세요."
            )
        
        self.language = language
        self.model = model
        
        try:
            from deepgram import AsyncDeepgramClient
            # Deepgram SDK v5 사용 (AsyncDeepgramClient)
            self.deepgram = AsyncDeepgramClient(api_key=self.api_key)
            logger.info("✅ DeepgramSTTService initialized (language: %s, model: %s)", language, model)
        except ImportError as exc:
            raise DeepgramNotAvailableError(
                "deepgram-sdk 패키지가 설치되어 있지 않습니다. "
                "`pip install deepgram-sdk>=5.3.0`를 실행한 뒤 다시 시도하세요."
            ) from exc
        except Exception as exc:
            raise DeepgramNotAvailableError(
                f"Deepgram 초기화 중 오류 발생: {exc}"
            ) from exc

    async def transcribe_stream(self, audio_np: np.ndarray) -> str:
        """
        오디오 청크를 Deepgram으로 전송하여 텍스트 변환 (비동기).
        
        Args:
            audio_np: float32 numpy array, normalized to [-1.0, 1.0], 16kHz
        
        Returns:
            str: 변환된 텍스트 (빈 문자열 가능)
        """
        try:
            # 입력 검증
            audio = np.asarray(audio_np, dtype=np.float32)
            if audio.ndim != 1:
                raise ValueError("audio_np는 1차원 배열이어야 합니다.")
            if audio.size == 0:
                raise ValueError("audio_np는 비어있을 수 없습니다.")
            
            # 오디오 통계 로깅
            audio_mean = float(np.mean(np.abs(audio)))
            audio_max = float(np.max(np.abs(audio)))
            logger.info("[INFO] Deepgram transcribe: audio_size=%d, mean_abs=%.4f, max_abs=%.4f", 
                       audio.size, audio_mean, audio_max)
            
            # 오디오가 너무 조용하면 로깅
            if audio_mean < 0.001:
                logger.warning("[WARN] Audio signal is very quiet (mean_abs=%.4f). STT may fail.", audio_mean)
            
            # float32 → int16 변환
            audio_int16 = (audio * 32768).astype(np.int16)
            
            # Deepgram SDK v5는 raw audio bytes를 잘 인식하지 못할 수 있으므로
            # WAV 파일 형식으로 변환하여 전송 (더 안정적)
            import io
            import wave
            
            # WAV 파일 형식으로 변환 (헤더 포함)
            wav_buffer = io.BytesIO()
            with wave.open(wav_buffer, 'wb') as wav_file:
                wav_file.setnchannels(1)  # 모노
                wav_file.setsampwidth(2)  # 16-bit (2 bytes)
                wav_file.setframerate(16000)  # 16kHz
                wav_file.writeframes(audio_int16.tobytes())
            
            audio_bytes = wav_buffer.getvalue()
            
            # Deepgram API 호출
            logger.info("[INFO] Calling Deepgram API with audio_bytes=%d bytes (WAV format), language=%s, model=%s", 
                       len(audio_bytes), self.language, self.model)
            
            response = None
            try:
                # Deepgram SDK v5 사용법: AsyncDeepgramClient 사용
                logger.info("[INFO] Starting Deepgram API call...")
                
                # API 키 확인 (디버깅용 - 처음 10자만 표시)
                api_key_preview = self.api_key[:10] + "..." if self.api_key and len(self.api_key) > 10 else self.api_key
                logger.info("[INFO] Using API key: %s (length: %d)", api_key_preview, len(self.api_key) if self.api_key else 0)
                
                # Deepgram SDK v5 API 호출
                # WAV 파일 형식으로 전송하면 encoding 파라미터 없이도 자동으로 감지됨
                response = await self.deepgram.listen.v1.media.transcribe_file(
                    request=audio_bytes,
                    model=self.model,
                    language=self.language,
                    punctuate=False,
                    diarize=False,
                    request_options={
                        "timeout_in_seconds": 30.0,
                    }
                )
                
                logger.info("[INFO] Deepgram API call completed successfully")
                
                # 응답 객체 타입 확인
                logger.info("[INFO] Deepgram response type: %s", type(response))
                logger.info("[INFO] Deepgram response is None: %s", response is None)
                
                # 응답이 None인 경우 처리
                if response is None:
                    logger.error("[ERROR] Deepgram API returned None response. Possible causes:")
                    logger.error("[ERROR] 1. API key is invalid or expired")
                    logger.error("[ERROR] 2. API usage limits exceeded")
                    logger.error("[ERROR] 3. Network connectivity issue")
                    logger.error("[ERROR] 4. Audio format not supported")
                    logger.error("[ERROR] Please check your DEEPGRAM_API_KEY and API usage limits.")
                    return ""
                
                # 응답 구조 확인 (v5 응답 객체는 속성 기반 접근)
                logger.info("[INFO] Deepgram response attributes: %s", dir(response) if hasattr(response, '__dict__') else 'N/A')
                
                # v5 응답 구조: response.results.channels[0].alternatives[0].transcript
                try:
                    # results 속성 확인
                    if not hasattr(response, 'results'):
                        logger.error("[ERROR] Deepgram response has no 'results' attribute")
                        logger.error("[ERROR] Response type: %s", type(response))
                        return ""
                    
                    results = response.results
                    if results is None:
                        logger.error("[ERROR] Deepgram results is None")
                        return ""
                    
                    # channels 확인
                    if not hasattr(results, 'channels'):
                        logger.error("[ERROR] Deepgram results has no 'channels' attribute")
                        return ""
                    
                    channels = results.channels
                    if not channels or len(channels) == 0:
                        logger.warning("[WARN] Deepgram response has no channels or empty channels list")
                        return ""
                    
                    channel = channels[0]
                    
                    # alternatives 확인
                    if not hasattr(channel, 'alternatives'):
                        logger.error("[ERROR] Deepgram channel has no 'alternatives' attribute")
                        return ""
                    
                    alternatives = channel.alternatives
                    if not alternatives or len(alternatives) == 0:
                        logger.warning("[WARN] Deepgram response has no alternatives or empty alternatives list")
                        # 오디오에 음성이 없을 수 있음 - 이것은 정상일 수 있음
                        return ""
                    
                    alternative = alternatives[0]
                    
                    # transcript 추출
                    if not hasattr(alternative, 'transcript'):
                        logger.error("[ERROR] Deepgram alternative has no 'transcript' attribute")
                        return ""
                    
                    transcript = alternative.transcript
                    text = transcript.strip() if transcript else ""
                    
                    # STT 결과 로깅
                    if text:
                        logger.info("[INFO] Deepgram transcription: '%s'", text)
                    else:
                        logger.warning("[WARN] Deepgram transcription returned empty text. Audio may not contain speech.")
                        # 빈 텍스트는 정상일 수 있음 (음성이 없는 경우)
                    
                    return text
                    
                except AttributeError as attr_err:
                    logger.error("[ERROR] Failed to extract transcript from Deepgram response: %s", attr_err)
                    logger.error("[ERROR] Response structure may have changed in SDK v5")
                    # 응답 구조를 로깅하여 디버깅
                    logger.error("[ERROR] Response type: %s", type(response))
                    if hasattr(response, '__dict__'):
                        logger.error("[ERROR] Response attributes: %s", list(response.__dict__.keys()))
                    return ""
                    
            except Exception as api_err:
                logger.error("[ERROR] Deepgram API call failed with exception: %s", api_err, exc_info=True)
                import traceback
                logger.error("[ERROR] Full traceback: %s", traceback.format_exc())
                return ""
        
        except Exception as e:
            logger.error("[ERROR] Deepgram transcription error: %s", e, exc_info=True)
            return ""

    def transcribe(self, audio_np: np.ndarray) -> str:
        """
        동기 버전 (WhisperSTTService 호환).
        
        이 메서드는 asyncio.to_thread()에서 호출되므로, 
        별도의 이벤트 루프를 생성하지 않고 동기적으로 처리합니다.
        
        Args:
            audio_np: float32 numpy array, normalized to [-1.0, 1.0], 16kHz
        
        Returns:
            str: 변환된 텍스트 (빈 문자열 가능)
        """
        try:
            # asyncio.to_thread()에서 호출되므로 별도 스레드에서 실행됨
            # 새 스레드에서는 실행 중인 이벤트 루프가 없으므로 asyncio.run() 사용 가능
            # 하지만 안전성을 위해 RuntimeError를 처리
            try:
                # 이미 실행 중인 이벤트 루프가 있는지 확인
                loop = asyncio.get_running_loop()
                # 실행 중인 이벤트 루프가 있으면 에러 발생 (예상치 못한 상황)
                logger.error("[ERROR] Event loop is already running in transcribe() method. This should not happen in asyncio.to_thread().")
                return ""
            except RuntimeError:
                # 실행 중인 이벤트 루프가 없으면 새로 생성
                return asyncio.run(self.transcribe_stream(audio_np))
        except Exception as e:
            logger.error("[ERROR] Deepgram transcribe (sync) error: %s", e, exc_info=True)
            return ""

