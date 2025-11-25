from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


class TransformersNotAvailableError(ImportError):
    """Transformers 패키지 미설치 에러"""


@dataclass
class ClassificationResult:
    is_harmful: bool
    confidence: float
    text: str


class HarmfulTextClassifier:
    def __init__(
        self,
        model_path: str = "",
        base_model_name: str = "kakaocorp/kanana-nano-2.1b-instruct",
        *,
        num_labels: int = 2,
        max_length: int = 128,
        torch_module: Optional[Any] = None,
        use_quantization: bool = True,
    ) -> None:

        self.base_model_name = base_model_name
        self.max_length = max_length

        # 0. LoRA / 모델 경로 결정
        # 우선순위: 인자 model_path > ENV KANANA_LORA_DIR > 기본값(models/kanana-lora-v1)
        raw_model_path = None
        if model_path:
            raw_model_path = model_path
        else:
            env_path = os.getenv("KANANA_LORA_DIR", "")
            if env_path:
                raw_model_path = env_path
            else:
                raw_model_path = "models/kanana-lora-v1"

        self.model_path: Path = Path(raw_model_path).expanduser().resolve()
        logger.info("🎯 Resolved model/LoRA path: %s", self.model_path)

        # 1. PyTorch & Device 설정
        if torch_module is None:
            try:
                import torch
            except ImportError as exc:
                raise TransformersNotAvailableError("PyTorch not installed") from exc
            self._torch = torch
        else:
            self._torch = torch_module

        # 디바이스 우선순위: CUDA > MPS > CPU
        self.device = "cpu"
        if hasattr(self._torch, "cuda") and self._torch.cuda.is_available():
            self.device = "cuda"
        elif hasattr(self._torch.backends, "mps") and self._torch.backends.mps.is_available():
            self.device = "mps"

        logger.info("🚀 Device selected: %s", self.device)

        # ⚠️ CPU 환경 강제 양자화 해제 (CPU는 bitsandbytes 지원 불가)
        if self.device == "cpu" and use_quantization:
            logger.warning(
                "⚠️ CPU 환경에서는 8-bit 양자화(bitsandbytes)를 사용할 수 없습니다. 양자화를 비활성화합니다."
            )
            self.use_quantization = False
        else:
            self.use_quantization = use_quantization

        # 2. 라이브러리 로드 (transformers는 필수, peft는 선택)
        try:
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
        except ImportError as exc:
            raise TransformersNotAvailableError(
                "transformers 패키지가 설치되지 않았습니다. `pip install transformers`"
            ) from exc

        # Peft는 선택적 로드 (LoRA 어댑터 사용 시에만 필요)
        try:
            from peft import PeftModel
            self._peft_available = True
            self._PeftModel = PeftModel
        except ImportError:
            self._peft_available = False
            self._PeftModel = None  # 타입 힌트/방어용

        # 3. 모델 타입 감지
        self.is_koelectra = "koelectra" in self.base_model_name.lower()
        self.use_lora = False

        # 4. 토크나이저 로드
        # KoElectra인 경우 base_model_name 사용,
        # Kanana인 경우 model_path(LoRA 디렉토리)에 토크나이저가 있으면 우선 사용
        tokenizer_path: str
        if not self.is_koelectra and self.model_path.exists():
            tokenizer_path = str(self.model_path)
        else:
            tokenizer_path = self.base_model_name

        logger.info("Loading Tokenizer from: %s", tokenizer_path)

        try:
            self.tokenizer = AutoTokenizer.from_pretrained(tokenizer_path)
        except Exception:
            logger.warning("로컬 토크나이저 로드 실패, Base 모델 토크나이저 재시도")
            self.tokenizer = AutoTokenizer.from_pretrained(self.base_model_name)

        if self.tokenizer.pad_token is None:
            # Kanana 계열은 eos_token 사용
            self.tokenizer.pad_token = self.tokenizer.eos_token

        # 5. 모델 로드 설정
        load_kwargs: dict[str, Any] = {}

        # 양자화 설정 (CUDA Only)
        if self.use_quantization and self.device == "cuda":
            try:
                from transformers import BitsAndBytesConfig

                load_kwargs["quantization_config"] = BitsAndBytesConfig(
                    load_in_8bit=True,
                    llm_int8_threshold=6.0,
                )
                load_kwargs["device_map"] = "auto"
                logger.info("✅ 8-bit Quantization Enabled (CUDA)")
            except ImportError:
                logger.warning("⚠️ bitsandbytes not installed. Fallback to fp16/32.")
                load_kwargs["dtype"] = self._torch.float16
                load_kwargs["device_map"] = self.device
        else:
            # CPU 등 일반 모드
            load_kwargs["device_map"] = self.device
            # CPU에서는 float32 권장 (호환성)
            load_kwargs["dtype"] = (
                self._torch.float32 if self.device == "cpu" else self._torch.float16
            )

        # Safetensors 시도
        load_kwargs["use_safetensors"] = True

        # 6. 모델 로드 실행
        logger.info("Loading Base Model: %s", self.base_model_name)

        if self.is_koelectra:
            # KoElectra (일반 HuggingFace 모델)
            try:
                self.model = AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name, **load_kwargs
                )
            except Exception:
                # Safetensors 없는 구형 모델 대응
                load_kwargs.pop("use_safetensors", None)
                self.model = AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name, **load_kwargs
                )
        else:
            # Kanana 계열
            load_kwargs["num_labels"] = num_labels
            try:
                self.base_model = AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name, **load_kwargs
                )
            except Exception:
                load_kwargs.pop("use_safetensors", None)
                self.base_model = AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name, **load_kwargs
                )

            # LoRA 적용 여부 확인
            if self.model_path.exists():
                if not self._peft_available or self._PeftModel is None:
                    raise ImportError(
                        "LoRA 모델을 로드하려면 'peft' 패키지가 필요합니다. "
                        "`pip install peft`를 실행하거나, Base 모델만 사용하세요."
                    )

                logger.info("Loading LoRA Adapter from: %s", self.model_path)
                try:
                    self.model = self._PeftModel.from_pretrained(
                        self.base_model,
                        str(self.model_path),
                    )
                    self.use_lora = True
                    logger.info("✅ LoRA Adapter loaded successfully")
                except Exception as e:
                    # adapter_config.json 문제 등으로 터져도 서버 전체가 죽지 않도록 폴백
                    logger.error(
                        "❌ LoRA 어댑터 로딩 실패 (%s). Base 모델만 사용합니다. 오류: %s",
                        self.model_path,
                        e,
                    )
                    self.model = self.base_model
                    self.use_lora = False
            else:
                logger.info("Using Base Model (No LoRA). Path not found: %s", self.model_path)
                self.model = self.base_model

        self.model.eval()

    def predict(self, text: str) -> ClassificationResult:
        if not text or not text.strip():
            return ClassificationResult(False, 0.0, "")

        # 토크나이징
        inputs = self.tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            padding=True,
            max_length=self.max_length,
        ).to(self.device)

        # 추론
        with self._torch.no_grad():
            outputs = self.model(**inputs)

        # 결과 계산
        probs = self._torch.nn.functional.softmax(outputs.logits, dim=-1)
        # KoElectra/Kanana 모두 [0: 정상, 1: 유해] 가정
        harmful_prob = float(probs[0][1].item())
        predicted_index = int(self._torch.argmax(probs, dim=-1).item())

        return ClassificationResult(
            is_harmful=(predicted_index == 1),
            confidence=float(probs[0][predicted_index].item()),
            text=text,
        )
