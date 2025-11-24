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
    텍스트의 유해성을 판별하는 서비스.
    
    지원 모델:
    - Kanana Nano 2.1b (LoRA Fine-tuned)
    - KoElectra (monologg/koelectra-base-v3-discriminator)
    
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
        use_quantization: bool = True,  # 8-bit 양자화 사용 여부 (성능 개선)
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
        self.use_quantization = use_quantization

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

        # 4. KoElectra 모델인지 확인
        is_koelectra = "koelectra" in self.base_model_name.lower()
        self.use_lora = False  # 기본값
        
        # 5. 토크나이저 로드
        if is_koelectra:
            # KoElectra는 바로 base 모델에서 로드
            logger.info("Loading KoElectra Tokenizer from: %s", self.base_model_name)
            self.tokenizer = AutoTokenizer.from_pretrained(self.base_model_name)
        else:
            # Kanana 모델: 로컬 어댑터 경로 우선
            logger.info("Loading Tokenizer from: %s", self.model_path)
            try:
                self.tokenizer = AutoTokenizer.from_pretrained(self.model_path)
            except Exception:
                logger.warning("로컬 토크나이저 로드 실패. Base 모델에서 다운로드합니다.")
                self.tokenizer = AutoTokenizer.from_pretrained(self.base_model_name)

        # 패딩 토큰 설정 (Llama 계열 모델은 기본 패딩 토큰이 없을 수 있음)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        # 6. 모델 로드
        logger.info("Loading Model: %s", self.base_model_name)
        
        # 8-bit 양자화 설정 (bitsandbytes 사용)
        load_kwargs = {}
        if self.use_quantization and self.device == "cuda":
            try:
                from transformers import BitsAndBytesConfig
                quantization_config = BitsAndBytesConfig(
                    load_in_8bit=True,
                    llm_int8_threshold=6.0,
                )
                load_kwargs["quantization_config"] = quantization_config
                load_kwargs["device_map"] = "auto"  # 양자화 시 자동 디바이스 매핑
                logger.info("✅ 8-bit 양자화 활성화 (성능 개선: 메모리 사용량 감소, 추론 속도 향상)")
            except ImportError:
                logger.warning("⚠️ bitsandbytes가 설치되지 않아 양자화를 건너뜁니다. `pip install bitsandbytes` 설치 권장")
                self.use_quantization = False
                torch_dtype = self._torch.float16 if self.device != "cpu" else self._torch.float32
                load_kwargs["dtype"] = torch_dtype
                load_kwargs["device_map"] = self.device
        else:
            # CPU나 양자화 비활성화 시 float16/float32 사용
            torch_dtype = self._torch.float16 if self.device != "cpu" else self._torch.float32
            load_kwargs["dtype"] = torch_dtype
            load_kwargs["device_map"] = self.device

        if is_koelectra:
            # KoElectra는 이미 sequence classification으로 학습된 모델
            logger.info("Loading KoElectra model (no LoRA needed)")
            # safetensors 사용하여 torch 버전 제한 우회 (지원하지 않으면 자동으로 fallback)
            try:
                load_kwargs["use_safetensors"] = True
                self.model = AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name,
                    **load_kwargs
                )
            except Exception as e:
                # safetensors가 지원되지 않는 경우 일반 형식으로 시도
                logger.warning(f"Failed to load with safetensors, trying without: {e}")
                load_kwargs.pop("use_safetensors", None)
                self.model = AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name,
                    **load_kwargs
                )
            logger.info("✅ KoElectra model ready")
        else:
            # Kanana 모델 로드
            load_kwargs["num_labels"] = num_labels
            # safetensors 사용하여 torch 버전 제한 우회 (지원하지 않으면 자동으로 fallback)
            try:
                load_kwargs["use_safetensors"] = True
                self.base_model = AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name,
                    **load_kwargs
                )
            except Exception as e:
                # safetensors가 지원되지 않는 경우 일반 형식으로 시도
                logger.warning(f"Failed to load with safetensors, trying without: {e}")
                load_kwargs.pop("use_safetensors", None)
                self.base_model = AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name,
                    **load_kwargs
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
                # LoRA는 양자화된 모델과 호환 가능
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

        # 토크나이징 (캐싱은 제외 - 텍스트가 매번 다르므로)
        encoded = self.tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            padding=True,
            max_length=self.max_length,
        )

        # 입력을 디바이스로 이동
        encoded = {k: v.to(self.device) for k, v in encoded.items()}

        # 추론 (최적화: no_grad + inference_mode)
        with self._torch.no_grad():
            if hasattr(self._torch, "inference_mode"):
                with self._torch.inference_mode():
                    outputs = self.model(**encoded)
            else:
                outputs = self.model(**encoded)

        # 결과 처리
        logits = outputs.logits
        probs = self._torch.nn.functional.softmax(logits, dim=-1)
        predicted_index = int(self._torch.argmax(probs, dim=-1).item())
        confidence = float(probs[0][predicted_index].item())
        
        # 각 클래스의 확률 (디버깅용)
        prob_normal = float(probs[0][0].item())  # 정상 (0)
        prob_harmful = float(probs[0][1].item())  # 유해 (1)
        
        # 디버깅: 예측 상세 정보 출력
        print(f"[Classifier] 예측 결과: index={predicted_index}, 정상={prob_normal:.3f}, 유해={prob_harmful:.3f}, 최종={confidence:.3f}", flush=True)

        # 0: 정상, 1: 유해 (모델 학습 라벨링에 따라 조정 필요)
        is_harmful = bool(predicted_index == 1)

        return ClassificationResult(
            is_harmful=is_harmful,
            confidence=confidence,
            text=text,
        )