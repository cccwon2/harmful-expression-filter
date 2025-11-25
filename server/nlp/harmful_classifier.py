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

        # 6) 프로젝트 루트 기준 경로 계산
        #    /opt/harmful-expression-filter/server/nlp/harmful_classifier.py
        #    -> project_root = /opt/harmful-expression-filter/server
        project_root = Path(__file__).resolve().parent.parent

        resolved_adapter_path: Optional[Path] = None
        if not self.is_koelectra:
            # (1) .env 기준
            env_path = os.getenv("KANANA_LORA_DIR", "").strip()
            candidate: Optional[Path] = None

            if env_path:
                candidate = Path(env_path)
            elif model_path:
                # 인자로 들어온 상대경로/절대경로 모두 허용
                candidate = Path(model_path)
            else:
                # 기본값: project_root/models/kanana-lora-v1
                candidate = project_root / "models" / "kanana-lora-v1"

            # 상대경로라면 무조건 project_root 기준으로 resolve
            if not candidate.is_absolute():
                candidate = (project_root / candidate).resolve()
            else:
                candidate = candidate.resolve()

            resolved_adapter_path = candidate
            logger.info("🔍 Resolved LoRA/adapter path: %s", resolved_adapter_path)

        self.model_path: Optional[Path] = resolved_adapter_path

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

        # safetensors 우선
        load_kwargs["use_safetensors"] = True

        # 9) Base 모델 로드
        logger.info("Loading Base Model: %s", self.base_model_name)

        if self.is_koelectra:
            # KoElectra: LoRA 없이 바로 분류 모델
            try:
                self.model = self._AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name,
                    num_labels=num_labels,
                    **load_kwargs,
                )
            except Exception:
                # safetensors 이슈 등 대비
                load_kwargs.pop("use_safetensors", None)
                self.model = self._AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name,
                    num_labels=num_labels,
                    **load_kwargs,
                )
        else:
            # Kanana + (선택적) LoRA
            load_kwargs["num_labels"] = num_labels

            try:
                self.base_model = self._AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name,
                    **load_kwargs,
                )
            except Exception:
                load_kwargs.pop("use_safetensors", None)
                self.base_model = self._AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name,
                    **load_kwargs,
                )

            # 10) LoRA 어댑터 로드 시도
            self.model = self.base_model
            if self.model_path is not None:
                adapter_config_path = self.model_path / "adapter_config.json"
                if not adapter_config_path.exists():
                    logger.warning(
                        "LoRA adapter_config.json이 %s 에 없습니다. Base 모델만 사용합니다.",
                        adapter_config_path,
                    )
                elif not self._peft_available:
                    logger.error(
                        "peft 패키지가 설치되어 있지 않습니다. `pip install peft` 후 다시 시도하세요. "
                        "지금은 Base 모델만 사용합니다."
                    )
                else:
                    try:
                        logger.info("🔗 Loading LoRA adapter from: %s", self.model_path)
                        self.model = self._PeftModel.from_pretrained(
                            self.base_model,
                            str(self.model_path),
                        )
                        self.use_lora = True
                        logger.info("✅ LoRA Adapter loaded successfully (use_lora=True)")
                    except Exception as exc:
                        logger.error(
                            "LoRA 어댑터 로드 중 오류 발생(%s). Base 모델로 계속 진행합니다.",
                            exc,
                        )
                        self.model = self.base_model

        self.model.eval()

    # ---------------------------------------------------------
    # 예측 함수
    # ---------------------------------------------------------
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

        probs = self._torch.nn.functional.softmax(outputs.logits, dim=-1)

        # [0: 정상, 1: 유해] 가정
        harmful_prob = float(probs[0][1].item())
        predicted_index = int(self._torch.argmax(probs, dim=-1).item())

        return ClassificationResult(
            is_harmful=(predicted_index == 1),
            confidence=float(probs[0][predicted_index].item()),
            text=text,
        )
