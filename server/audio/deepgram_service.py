"""
Phase 2: Deepgram STT 서비스 구현.

Deepgram WebSocket 기반 실시간 STT 서비스
WhisperSTTService와 동일한 인터페이스 유지
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
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
        import time
        start_time = time.time()
        
        try:
            # 1. 입력 검증
            audio = np.asarray(audio_np, dtype=np.float32)
            if audio.ndim != 1:
                raise ValueError("audio_np는 1차원 배열이어야 합니다.")
            if audio.size == 0:
                raise ValueError("audio_np는 비어있을 수 없습니다.")
            
            # 2. 오디오 통계 계산
            audio_mean = float(np.mean(np.abs(audio)))
            audio_max = float(np.max(np.abs(audio)))
            
            # ✅ 개선: 너무 조용한 오디오는 API 호출 생략
            if audio_mean < 0.001:
                logger.info("[Deepgram] Audio too quiet (mean=%.4f), skipping API call", audio_mean)
                return ""
            
            # 3. float32 → int16 변환
            audio_int16 = (audio * 32768).astype(np.int16)
            
            # 4. WAV 형식으로 변환 (Deepgram이 더 잘 인식함)
            import io
            import wave
            
            wav_buffer = io.BytesIO()
            with wave.open(wav_buffer, 'wb') as wav_file:
                wav_file.setnchannels(1)  # 모노
                wav_file.setsampwidth(2)  # 16-bit (2 bytes)
                wav_file.setframerate(16000)  # 16kHz
                wav_file.writeframes(audio_int16.tobytes())
            
            audio_bytes = wav_buffer.getvalue()
            
            # 5. Deepgram API 호출 (SDK v5)
            # SDK v5 올바른 API: listen.v1.media.transcribe_file
            # WAV 형식으로 전송하면 encoding 파라미터 없이도 자동으로 감지됨
            response = await self.deepgram.listen.v1.media.transcribe_file(
                request=audio_bytes,  # WAV 형식 bytes 전달
                model=self.model,
                language=self.language,
                smart_format=False,
                punctuate=False,
                diarize=False,
            )
            
            # 5. 응답 파싱 (SDK v5)
            transcript = ""
            if response and response.results:
                channels = response.results.channels
                if channels and len(channels) > 0:
                    alternatives = channels[0].alternatives
                    if alternatives and len(alternatives) > 0:
                        transcript = alternatives[0].transcript.strip()
            
            # ✅ 개선: 레이턴시 측정 및 로깅
            elapsed_ms = (time.time() - start_time) * 1000
            logger.info("[Deepgram] Transcription: %.2fms | Text: '%s'", elapsed_ms, transcript[:50])
            
            # ⚠️ 레이턴시 목표 초과 경고
            if elapsed_ms > 2000:
                logger.warning("[Deepgram] ⚠️ Latency exceeds 2s: %.2fms", elapsed_ms)
            
            return transcript
        
        except ImportError as exc:
            elapsed_ms = (time.time() - start_time) * 1000
            logger.error("[Deepgram] SDK import error after %.2fms: %s", elapsed_ms, exc)
            raise DeepgramNotAvailableError("Deepgram SDK v5가 설치되지 않았습니다.") from exc
        
        except Exception as exc:
            elapsed_ms = (time.time() - start_time) * 1000
            logger.exception("[Deepgram] Transcription error after %.2fms", elapsed_ms)
            return ""

    def transcribe(self, audio_np: np.ndarray) -> str:
        """
        동기 버전 (WhisperSTTService 호환).
        
        이 메서드는 asyncio.to_thread()에서 호출되므로, 
        별도 스레드에서 실행되며 새 이벤트 루프를 생성할 수 있습니다.
        
        Args:
            audio_np: float32 numpy array, normalized to [-1.0, 1.0], 16kHz
        
        Returns:
            str: 변환된 텍스트 (빈 문자열 가능)
        """
        try:
            # asyncio.to_thread()에서 호출되므로 별도 스레드에서 실행됨
            # 새 스레드에서는 실행 중인 이벤트 루프가 없으므로 asyncio.run() 사용 가능
            try:
                # 이미 실행 중인 이벤트 루프가 있는지 확인
                loop = asyncio.get_running_loop()
                # 실행 중인 이벤트 루프가 있으면 에러 발생 (예상치 못한 상황)
                logger.error("[ERROR] Event loop is already running in transcribe() method. This should not happen in asyncio.to_thread().")
                return ""
            except RuntimeError:
                # 실행 중인 이벤트 루프가 없으면 새로 생성
                # asyncio.run()을 사용하면 이벤트 루프 관리가 자동으로 됨
                # 하지만 Deepgram 클라이언트가 이벤트 루프를 참조하므로 각 호출마다 새 클라이언트 생성
                return asyncio.run(self._transcribe_with_new_client(audio_np))
        except Exception as e:
            logger.error("[ERROR] Deepgram transcribe (sync) error: %s", e, exc_info=True)
            return ""
    
    async def _transcribe_with_new_client(self, audio_np: np.ndarray) -> str:
        """
        새 Deepgram 클라이언트를 생성하여 transcription 수행.
        이벤트 루프 문제를 피하기 위해 각 호출마다 새 클라이언트를 사용.
        """
        start_time = time.time()
        try:
            from deepgram import AsyncDeepgramClient
            print(f"[Deepgram] 새 클라이언트 생성 중...", flush=True)
            # 새 클라이언트 생성 (이벤트 루프 문제 방지)
            temp_client = AsyncDeepgramClient(api_key=self.api_key)
            print(f"[Deepgram] ✅ 클라이언트 생성 완료", flush=True)
            
            # 오디오 처리
            audio = np.asarray(audio_np, dtype=np.float32)
            audio_mean = float(np.mean(np.abs(audio)))
            
            print(f"[Deepgram] 오디오 통계: size={len(audio)}, mean_abs={audio_mean:.4f}", flush=True)
            
            if audio_mean < 0.001:
                print(f"[Deepgram] ⚠️ 오디오가 너무 조용함 (mean={audio_mean:.4f}), API 호출 건너뜀", flush=True)
                logger.info("[Deepgram] Audio too quiet (mean=%.4f), skipping API call", audio_mean)
                return ""
            
            audio_int16 = (audio * 32768).astype(np.int16)
            
            # WAV 형식으로 변환
            import io
            import wave
            
            wav_buffer = io.BytesIO()
            with wave.open(wav_buffer, 'wb') as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(16000)
                wav_file.writeframes(audio_int16.tobytes())
            
            audio_bytes = wav_buffer.getvalue()
            print(f"[Deepgram] WAV 변환 완료: {len(audio_bytes)} bytes", flush=True)
            
            # API 호출
            print(f"[Deepgram] 📤 Deepgram API 호출 중... (model={self.model}, language={self.language})", flush=True)
            api_start = time.time()
            response = await temp_client.listen.v1.media.transcribe_file(
                request=audio_bytes,
                model=self.model,
                language=self.language,
                smart_format=False,
                punctuate=False,
                diarize=False,
            )
            api_time = (time.time() - api_start) * 1000
            print(f"[Deepgram] ✅ API 응답 수신! (소요 시간: {api_time:.2f}ms)", flush=True)
            
            # 응답 파싱 (디버깅용 상세 로깅)
            transcript = ""
            if response:
                if hasattr(response, 'results') and response.results:
                    channels = response.results.channels
                    print(f"[Deepgram] 📊 응답 구조: results 있음, channels 개수: {len(channels) if channels else 0}", flush=True)
                    if channels and len(channels) > 0:
                        alternatives = channels[0].alternatives
                        print(f"[Deepgram] 📊 Channel[0] alternatives 개수: {len(alternatives) if alternatives else 0}", flush=True)
                        if alternatives and len(alternatives) > 0:
                            transcript = alternatives[0].transcript.strip() if hasattr(alternatives[0], 'transcript') else ""
                            confidence = alternatives[0].confidence if hasattr(alternatives[0], 'confidence') else None
                            print(f"[Deepgram] 📊 Transcript: '{transcript[:50]}', confidence: {confidence}", flush=True)
                    else:
                        print(f"[Deepgram] ⚠️ Channels가 비어있음", flush=True)
                else:
                    print(f"[Deepgram] ⚠️ Response.results가 없음. Response 타입: {type(response)}", flush=True)
                    if hasattr(response, '__dict__'):
                        print(f"[Deepgram] Response 속성: {list(response.__dict__.keys())[:10]}", flush=True)
            else:
                print(f"[Deepgram] ⚠️ Response가 None", flush=True)
            
            elapsed_ms = (time.time() - start_time) * 1000
            if transcript:
                print(f"[Deepgram] 📝 Transcription 완료 ({elapsed_ms:.2f}ms): '{transcript[:100]}'", flush=True)
            else:
                print(f"[Deepgram] ⚠️ Transcription 완료 ({elapsed_ms:.2f}ms) but no text", flush=True)
            logger.info("[Deepgram] Transcription: %.2fms | Text: '%s'", elapsed_ms, transcript[:50])
            
            return transcript
        except Exception as exc:
            elapsed_ms = (time.time() - start_time) * 1000
            print(f"[Deepgram] ❌ 오류 발생 ({elapsed_ms:.2f}ms): {exc}", flush=True)
            logger.exception("[Deepgram] _transcribe_with_new_client error")
            return ""

