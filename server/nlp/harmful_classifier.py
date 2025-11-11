"""
Phase 3: KoELECTRA 기반 유해성 분류기 구현.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)


TokenizerLoader = Callable[[str], Any]
ModelLoader = Callable[[str], Any]


class TransformersNotAvailableError(ImportError):
    """Transformers 또는 Torch 패키지가 설치되지 않은 경우 발생하는 예외."""


@dataclass
class ClassificationResult:
    """유해성 판별 결과 데이터 구조."""

    is_harmful: bool
    confidence: float
    text: str


class HarmfulTextClassifier:
    """
    KoELECTRA 분류기를 활용해 텍스트의 유해성을 판별하는 서비스.

    기본적으로 Hugging Face의 `AutoTokenizer`, `AutoModelForSequenceClassification`을 사용한다.
    테스트 용도로 tokenizer/model/torch 모듈을 주입할 수 있다.
    """

    def __init__(
        self,
        model_name: str = "monologg/koelectra-base-v3-discriminator",
        *,
        num_labels: int = 2,
        max_length: int = 256,
        tokenizer_loader: Optional[TokenizerLoader] = None,
        model_loader: Optional[ModelLoader] = None,
        torch_module: Optional[Any] = None,
    ) -> None:
        """
        Args:
            model_name: Hugging Face에 등록된 모델 이름
            num_labels: 분류 라벨 수 (0: 정상, 1: 유해)
            max_length: 토큰 최대 길이
            tokenizer_loader: 토크나이저 로더 (테스트용 주입 가능)
            model_loader: 모델 로더 (테스트용 주입 가능)
            torch_module: torch 대체 모듈 (테스트용 주입 가능)
        """

        self.model_name = model_name
        self.max_length = max_length

        if torch_module is None:
            try:
                import torch  # type: ignore
            except ImportError as exc:  # pragma: no cover - 실제 환경에서만 발생
                raise TransformersNotAvailableError(
                    "PyTorch가 설치되어 있지 않습니다. "
                    "Python 3.11 환경에서 `pip install torch torchaudio` 후 다시 시도하세요."
                ) from exc
            self._torch = torch
        else:
            self._torch = torch_module

        if tokenizer_loader is None or model_loader is None:
            try:
                from transformers import (  # type: ignore
                    AutoModelForSequenceClassification,
                    AutoTokenizer,
                )
            except ImportError as exc:  # pragma: no cover - 실제 환경에서만 발생
                raise TransformersNotAvailableError(
                    "transformers 패키지가 설치되어 있지 않습니다. "
                    "Python 3.11 환경에서 `pip install transformers` 후 다시 시도하세요."
                ) from exc

            tokenizer_loader = tokenizer_loader or AutoTokenizer.from_pretrained
            model_loader = model_loader or (
                lambda name: AutoModelForSequenceClassification.from_pretrained(
                    name,
                    num_labels=num_labels,
                )
            )

        logger.info("Loading KoELECTRA tokenizer: %s", model_name)
        self.tokenizer = tokenizer_loader(model_name)

        logger.info("Loading KoELECTRA model: %s", model_name)
        self.model = model_loader(model_name)

        self.device = "cpu"
        try:
            if hasattr(self._torch, "cuda") and callable(
                getattr(self._torch.cuda, "is_available", None)
            ):
                self.device = "cuda" if self._torch.cuda.is_available() else "cpu"
        except Exception as exc:  # pragma: no cover - 방어용
            logger.warning("CUDA 가용성 확인에 실패했습니다: %s", exc)

        if hasattr(self.model, "to"):
            self.model = self.model.to(self.device)

        if hasattr(self.model, "eval"):
            self.model.eval()

        logger.info("✅ KoELECTRA model ready on device: %s", self.device)

    def predict(self, text: str) -> ClassificationResult:
        """
        텍스트가 유해한지 판별한다.
        """

        if not text or not text.strip():
            return ClassificationResult(is_harmful=False, confidence=0.0, text="")

        if not hasattr(self.tokenizer, "__call__"):
            raise RuntimeError("Tokenizer가 호출 가능 객체가 아닙니다.")

        encoded = self.tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=self.max_length,
        )

        # torch 텐서 변환 (스텁 토치 지원)
        if hasattr(self._torch, "tensor"):
            encoded = {
                key: value
                if hasattr(value, "shape")
                else self._torch.tensor(value)
                for key, value in encoded.items()
            }

        with self._torch.no_grad():
            outputs = self.model(**encoded)

        logits = getattr(outputs, "logits", None)
        if logits is None:
            raise RuntimeError("모델 출력에 logits가 없습니다.")

        probs = self._torch.nn.functional.softmax(logits, dim=-1)
        predicted_index = int(self._torch.argmax(probs, dim=-1).item())
        confidence = float(probs[0][predicted_index].item())

        is_harmful = bool(predicted_index)

        return ClassificationResult(
            is_harmful=is_harmful,
            confidence=confidence,
            text=text,
        )


