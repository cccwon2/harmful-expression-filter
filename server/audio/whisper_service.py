"""
Phase 2: Whisper STT 서비스 구현.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

import numpy as np


logger = logging.getLogger(__name__)

ModelLoader = Callable[[str], object]


class WhisperNotAvailableError(ImportError):
    """Whisper 패키지가 설치되지 않은 경우 발생하는 예외."""


class WhisperSTTService:
    """
    Whisper STT 모델 로더 및 추론 헬퍼.

    Whisper 모델은 CPU 환경에서 fp16 비활성화 상태로 사용되며,
    테스트에서는 model_loader를 주입해 가짜 모델로 대체할 수 있다.
    """

    def __init__(
        self,
        model_name: str = "base",
        *,
        language: str = "ko",
        use_fp16: bool = False,
        model_loader: Optional[ModelLoader] = None,
    ) -> None:
        """
        Args:
            model_name: Whisper 모델 이름 (tiny, base, small 등)
            language: 음성 인식 대상 언어 코드
            use_fp16: GPU 사용 등으로 fp16 활성화 여부
            model_loader: 주입 가능한 모델 로더(테스트용)
        """

        self.model_name = model_name
        self.language = language
        self.use_fp16 = use_fp16

        if model_loader is None:
            try:
                import whisper  # type: ignore
            except ImportError as exc:  # pragma: no cover - 실제 환경에서만 발생
                raise WhisperNotAvailableError(
                    "openai-whisper 패키지가 설치되어 있지 않습니다. "
                    "Python 3.12 미만 환경에서 `pip install openai-whisper` "
                    "및 torch/torchaudio 패키지를 설치한 뒤 다시 시도하세요."
                ) from exc

            model_loader = whisper.load_model

        logger.info("Loading Whisper model: %s", model_name)
        self.model = model_loader(model_name)
        logger.info("✅ Whisper model loaded: %s", model_name)

    def transcribe(self, audio_np: np.ndarray) -> str:
        """
        16kHz float32 오디오 배열을 Whisper 모델로 변환하여 텍스트를 반환한다.
        """

        if self.model is None:  # pragma: no cover - 방어 로직
            raise RuntimeError("Whisper 모델이 로드되지 않았습니다.")

        audio = np.asarray(audio_np, dtype=np.float32)
        if audio.ndim != 1:
            raise ValueError("audio_np는 1차원 배열이어야 합니다.")
        if audio.size == 0:
            raise ValueError("audio_np는 비어있을 수 없습니다.")

        result = self.model.transcribe(audio, language=self.language, fp16=self.use_fp16)
        text = (result.get("text") if isinstance(result, dict) else "") or ""

        return text.strip()


