from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

# 타입 힌트 정의
TokenizerLoader = Callable[[str], Any]
ModelLoader = Callable[[str], Any]


class TransformersNotAvailableError(ImportError):
    """Transformers, Torch 또는 Peft 패키지가 설치되지 않은 경우 발생하는 예외."""


@dataclass
class ClassificationResult:
    """유해성 판별 결과 데이터 구조."""

    is_harmful: bool
    confidence: float
    text: str


class HarmfulTextClassifier:
    """
    Kanana Nano 2.1b (LoRA Fine-tuned) 모델을 활용해 텍스트의 유해성을 판별하는 서비스.

    Hugging Face의 `AutoTokenizer`, `AutoModelForSequenceClassification` 및 `PeftModel`을 사용한다.
    """

    def __init__(
        self,
        # 기본값은 제거하고 main.py에서 주입받는 구조로 변경 권장하지만, 
        # 테스트 편의를 위해 기본값 유지 (단, main.py에서는 항상 값을 넘겨주도록 설정됨)
        model_path: str = "models/kanana-lora-v1", 
        base_model_name: str = "kakaocorp/kanana-nano-2.1b-instruct",
        *,
        num_labels: int = 2,
        max_length: int = 128, # 학습 시 설정했던 길이 (분석 결과 반영)
        torch_module: Optional[Any] = None,
    ) -> None:
        """
        Args:
            model_path: 학습된 LoRA 어댑터가 저장된 로컬 폴더 경로
            base_model_name: Hugging Face Base 모델 이름
            num_labels: 분류 라벨 수 (0: 정상, 1: 유해)
            max_length: 토큰 최대 길이
            torch_module: torch 대체 모듈 (테스트용 주입 가능)
        """

        # ✅ 수정: 입력받은 경로를 가공하지 않고 그대로 사용 (main.py에서 절대 경로 처리됨)
        self.model_path = model_path
        
        self.base_model_name = base_model_name
        self.max_length = max_length

        # 1. PyTorch 로드
        if torch_module is None:
            try:
                import torch  # type: ignore
            except ImportError as exc:
                raise TransformersNotAvailableError(
                    "PyTorch가 설치되어 있지 않습니다. `pip install torch`"
                ) from exc
            self._torch = torch
        else:
            self._torch = torch_module

        # 2. Transformers & Peft 로드
        try:
            from transformers import (  # type: ignore
                AutoModelForSequenceClassification,
                AutoTokenizer,
            )
            from peft import PeftModel  # type: ignore
        except ImportError as exc:
            raise TransformersNotAvailableError(
                "transformers 또는 peft 패키지가 설치되어 있지 않습니다. "
                "`pip install transformers peft` 후 다시 시도하세요."
            ) from exc

        # 3. 디바이스 설정 (CUDA > MPS > CPU)
        self.device = "cpu"
        if hasattr(self._torch, "cuda") and self._torch.cuda.is_available():
            self.device = "cuda"
        elif hasattr(self._torch.backends, "mps") and self._torch.backends.mps.is_available():
            self.device = "mps" # Mac 사용자를 위한 처리
        
        logger.info("🚀 Device selected: %s", self.device)

        # 4. 토크나이저 로드 (로컬 어댑터 경로 우선)
        logger.info("Loading Tokenizer from: %s", self.model_path)
        try:
            self.tokenizer = AutoTokenizer.from_pretrained(self.model_path)
        except Exception:
            logger.warning("로컬 토크나이저 로드 실패. Base 모델에서 다운로드합니다.")
            self.tokenizer = AutoTokenizer.from_pretrained(self.base_model_name)

        # 패딩 토큰 설정 (Llama 계열 모델은 기본 패딩 토큰이 없을 수 있음)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        # 5. 모델 로드 (Base Model -> LoRA Adapter 결합 또는 Base Model만)
        logger.info("Loading Base Model: %s", self.base_model_name)
        
        # 메모리 효율을 위해 float16 사용 (CPU일 경우 float32 자동 전환 고려 필요)
        torch_dtype = self._torch.float16 if self.device != "cpu" else self._torch.float32

        self.base_model = AutoModelForSequenceClassification.from_pretrained(
            self.base_model_name,
            num_labels=num_labels,
            torch_dtype=torch_dtype,
            device_map=self.device 
        )

        # Base 모델만 사용할지 확인 (model_path가 None이거나 빈 문자열이거나 존재하지 않으면 base만 사용)
        use_base_only = not self.model_path or self.model_path.strip() == "" or not os.path.exists(self.model_path)
        self.use_lora = not use_base_only  # LoRA 사용 여부 저장
        
        if use_base_only:
            logger.info("Using Base Model only (LoRA adapter disabled)")
            self.model = self.base_model
            logger.info("✅ Kanana-Nano Base model ready")
        else:
            logger.info("Loading LoRA Adapter from: %s", self.model_path)
            self.model = PeftModel.from_pretrained(
                self.base_model, 
                self.model_path
            )
            logger.info("✅ Kanana-Nano LoRA model ready")
        
        self.model.eval()

    def predict(self, text: str) -> ClassificationResult:
        """
        텍스트가 유해한지 판별한다.
        """
        if not text or not text.strip():
            return ClassificationResult(is_harmful=False, confidence=0.0, text="")

        # 토크나이징
        encoded = self.tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            padding=True,
            max_length=self.max_length,
        )

        # 입력을 디바이스로 이동
        encoded = {k: v.to(self.device) for k, v in encoded.items()}

        # 추론
        with self._torch.no_grad():
            outputs = self.model(**encoded)

        # 결과 처리
        logits = outputs.logits
        probs = self._torch.nn.functional.softmax(logits, dim=-1)
        predicted_index = int(self._torch.argmax(probs, dim=-1).item())
        confidence = float(probs[0][predicted_index].item())

        # 0: 정상, 1: 유해 (모델 학습 라벨링에 따라 조정 필요)
        is_harmful = bool(predicted_index == 1)

        return ClassificationResult(
            is_harmful=is_harmful,
            confidence=confidence,
            text=text,
        )