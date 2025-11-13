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
            from deepgram import Deepgram
            self.deepgram = Deepgram(self.api_key)
            logger.info("✅ DeepgramSTTService initialized (language: %s, model: %s)", language, model)
        except ImportError as exc:
            raise DeepgramNotAvailableError(
                "deepgram-sdk 패키지가 설치되어 있지 않습니다. "
                "`pip install deepgram-sdk==3.5.0`를 실행한 뒤 다시 시도하세요."
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
            audio_bytes = audio_int16.tobytes()
            
            # Deepgram API 호출
            response = await self.deepgram.transcription.prerecorded(
                {
                    "buffer": audio_bytes,
                    "mimetype": "audio/raw; encoding=linear16; sample_rate=16000; channels=1",
                },
                {
                    "language": self.language,
                    "model": self.model,
                    "punctuate": False,
                    "diarize": False,
                }
            )
            
            # 응답에서 텍스트 추출
            if response and "results" in response:
                channels = response["results"].get("channels", [])
                if channels and len(channels) > 0:
                    alternatives = channels[0].get("alternatives", [])
                    if alternatives and len(alternatives) > 0:
                        transcript = alternatives[0].get("transcript", "")
                        text = transcript.strip()
                        
                        # STT 결과 로깅
                        if text:
                            logger.info("[INFO] Deepgram transcription: '%s'", text)
                        else:
                            logger.warning("[WARN] Deepgram transcription returned empty text. Audio may not contain speech.")
                        
                        return text
            
            logger.warning("[WARN] Deepgram response has no transcript")
            return ""
        
        except Exception as e:
            logger.error("[ERROR] Deepgram transcription error: %s", e, exc_info=True)
            return ""

    def transcribe(self, audio_np: np.ndarray) -> str:
        """
        동기 버전 (WhisperSTTService 호환).
        
        Args:
            audio_np: float32 numpy array, normalized to [-1.0, 1.0], 16kHz
        
        Returns:
            str: 변환된 텍스트 (빈 문자열 가능)
        """
        try:
            # 이벤트 루프가 실행 중인지 확인
            try:
                loop = asyncio.get_running_loop()
                # 이미 실행 중인 이벤트 루프가 있으면 새 스레드에서 실행
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(asyncio.run, self.transcribe_stream(audio_np))
                    return future.result()
            except RuntimeError:
                # 이벤트 루프가 없으면 새로 생성
                return asyncio.run(self.transcribe_stream(audio_np))
        except Exception as e:
            logger.error("[ERROR] Deepgram transcribe (sync) error: %s", e, exc_info=True)
            return ""

