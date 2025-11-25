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
        """
        - KoElectra: base_model_name 에 'koelectra' 포함되면 LoRA 없이 일반 분류 모델로 사용
        - Kanana + LoRA:
            - 우선순위: KANANA_LORA_DIR(.env) > model_path 인자 > 기본값(project_root/models/kanana-lora-v1)
        """
        self.base_model_name = base_model_name
        self.max_length = max_length

        # 1) Torch 준비
        if torch_module is None:
            try:
                import torch
            except ImportError as exc:
                raise TransformersNotAvailableError("PyTorch not installed") from exc
            self._torch = torch
        else:
            self._torch = torch_module

        # 2) 디바이스 선택
        self.device = "cpu"
        if hasattr(self._torch, "cuda") and self._torch.cuda.is_available():
            self.device = "cuda"
        elif hasattr(self._torch.backends, "mps") and self._torch.backends.mps.is_available():
            self.device = "mps"

        logger.info("🚀 Device selected: %s", self.device)

        # 3) 양자화 플래그 정리 (CUDA 에서만 의미 있음)
        self.use_quantization = bool(use_quantization and self.device == "cuda")
        if self.device != "cuda" and use_quantization:
            logger.warning("⚠️ CPU/MPS 환경에서는 8-bit 양자화를 사용할 수 없습니다. 양자화 비활성화.")
            self.use_quantization = False

        # 4) transformers / peft 가져오기
        try:
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
        except ImportError as exc:
            raise TransformersNotAvailableError(
                "transformers 패키지가 설치되지 않았습니다. `pip install transformers`"
            ) from exc

        try:
            from peft import PeftModel
            self._peft_available = True
        except ImportError:
            PeftModel = None  # type: ignore[assignment]
            self._peft_available = False

        self._AutoModelForSequenceClassification = AutoModelForSequenceClassification
        self._AutoTokenizer = AutoTokenizer
        self._PeftModel = PeftModel

        # 5) 모델 타입 플래그
        self.is_koelectra = "koelectra" in self.base_model_name.lower()
        self.use_lora = False
        self.model_path: Optional[Path] = None

        # 6) 프로젝트 루트 및 LoRA 경로 계산 (Robust Logic)
        #    /opt/.../server/nlp/harmful_classifier.py -> project_root = /opt/.../server
        project_root = Path(__file__).resolve().parent.parent
        
        if not self.is_koelectra:
            # (1) 경로 후보 선정
            env_path = os.getenv("KANANA_LORA_DIR", "").strip()
            candidate: Optional[Path] = None

            if env_path:
                candidate = Path(env_path)
                logger.info("Setting LoRA path from ENV: %s", candidate)
            elif model_path and model_path.strip():
                candidate = Path(model_path)
                logger.info("Setting LoRA path from ARG: %s", candidate)
            else:
                candidate = project_root / "models" / "kanana-lora-v1"
                logger.info("Setting LoRA path from DEFAULT: %s", candidate)

            # (2) 절대 경로 변환
            if candidate:
                if not candidate.is_absolute():
                    candidate = (project_root / candidate).resolve()
                
                # (3) 파일 존재 여부 '엄격' 검사 (adapter_config.json)
                adapter_config = candidate / "adapter_config.json"
                if candidate.exists() and adapter_config.exists():
                    self.model_path = candidate
                    logger.info("✅ Valid LoRA adapter found at: %s", self.model_path)
                else:
                    logger.warning(
                        "⚠️ LoRA path defined (%s) but 'adapter_config.json' not found inside.", candidate
                    )
                    logger.warning("➡️ Falling back to Base Model ONLY (No LoRA).")
                    self.model_path = None

        # 7) 토크나이저는 항상 base 모델 기준으로만 로드
        logger.info("Loading Tokenizer from base model: %s", self.base_model_name)
        self.tokenizer = self._AutoTokenizer.from_pretrained(self.base_model_name)
        if self.tokenizer.pad_token is None and getattr(self.tokenizer, "eos_token", None) is not None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        # 8) 모델 로드 옵션 구성
        load_kwargs: dict[str, Any] = {}

        if self.device == "cuda":
            if self.use_quantization:
                try:
                    from transformers import BitsAndBytesConfig

                    load_kwargs["quantization_config"] = BitsAndBytesConfig(
                        load_in_8bit=True,
                        llm_int8_threshold=6.0,
                    )
                    load_kwargs["device_map"] = "auto"
                    logger.info("✅ 8-bit Quantization Enabled (CUDA)")
                except Exception:
                    logger.warning("⚠️ bitsandbytes 설정 실패. fp16으로 폴백합니다.")
                    load_kwargs["dtype"] = self._torch.float16
                    load_kwargs["device_map"] = self.device
            else:
                load_kwargs["dtype"] = self._torch.float16
                load_kwargs["device_map"] = self.device
        else:
            load_kwargs["device_map"] = self.device
            load_kwargs["dtype"] = self._torch.float32

        load_kwargs["use_safetensors"] = True

        # 9) Base 모델 로드
        logger.info("Loading Base Model: %s", self.base_model_name)

        # 공통 로드 함수
        def load_base_model():
            try:
                return self._AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name,
                    num_labels=num_labels,
                    **load_kwargs,
                )
            except Exception:
                # safetensors 이슈 등 대비 재시도
                if "use_safetensors" in load_kwargs:
                    load_kwargs.pop("use_safetensors")
                return self._AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name,
                    num_labels=num_labels,
                    **load_kwargs,
                )

        if self.is_koelectra:
            self.model = load_base_model()
        else:
            # Kanana
            self.base_model = load_base_model()
            self.model = self.base_model

            # 10) LoRA 어댑터 로드 (유효성 검사를 통과한 경우에만 시도)
            if self.model_path is not None:
                if not self._peft_available:
                    logger.error("❌ 'peft' not installed. Using Base Model only.")
                else:
                    try:
                        logger.info("🔗 Loading LoRA adapter...")
                        self.model = self._PeftModel.from_pretrained(
                            self.base_model,
                            str(self.model_path),
                        )
                        self.use_lora = True
                        logger.info("✅ LoRA Adapter loaded successfully!")
                    except Exception as exc:
                        logger.error(
                            "❌ Error loading LoRA adapter: %s. Continuing with Base Model.", exc
                        )
                        self.model = self.base_model

        self.model.eval()

    def predict(self, text: str) -> ClassificationResult:
        if not text or not text.strip():
            return ClassificationResult(False, 0.0, "")

        inputs = self.tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            padding=True,
            max_length=self.max_length,
        ).to(self.device)

        with self._torch.no_grad():
            outputs = self.model(**inputs)

        probs = self._torch.nn.functional.softmax(outputs.logits, dim=-1)

        harmful_prob = float(probs[0][1].item())
        predicted_index = int(self._torch.argmax(probs, dim=-1).item())

        return ClassificationResult(
            is_harmful=(predicted_index == 1),
            confidence=float(probs[0][predicted_index].item()),
            text=text,
        )