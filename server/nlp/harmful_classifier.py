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
        threshold: float = 0.22,  # 🔥 [NEW] 임계값 추가
        torch_module: Optional[Any] = None,
        use_quantization: bool = True,
    ) -> None:
        self.base_model_name = base_model_name
        self.max_length = max_length
        self.threshold = threshold

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

        # 3) 양자화 설정
        self.use_quantization = bool(use_quantization and self.device == "cuda")
        if self.device != "cuda" and use_quantization:
            logger.warning("⚠️ CPU/MPS에서는 8-bit 양자화 불가. 비활성화.")
            self.use_quantization = False

        # 4) 라이브러리 임포트
        try:
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
        except ImportError as exc:
            raise TransformersNotAvailableError("transformers 패키지 필요") from exc

        try:
            from peft import PeftModel
            self._peft_available = True
        except ImportError:
            PeftModel = None
            self._peft_available = False

        self._AutoModelForSequenceClassification = AutoModelForSequenceClassification
        self._AutoTokenizer = AutoTokenizer
        self._PeftModel = PeftModel

        self.is_koelectra = "koelectra" in self.base_model_name.lower()
        self.use_lora = False
        self.model_path: Optional[Path] = None

        # 5) 모델 경로 계산 및 검증
        project_root = Path(__file__).resolve().parent.parent  # .../server
        
        if self.is_koelectra:
            # 🔥 KoElectra 로컬 모델 경로 처리
            if model_path and model_path.strip():
                candidate = Path(model_path)
                if not candidate.is_absolute():
                    candidate = (project_root / candidate).resolve()
                
                # 모델 파일 존재 여부 확인
                config_file = candidate / "config.json"
                model_file = candidate / "model.safetensors"
                
                if candidate.exists() and config_file.exists() and model_file.exists():
                    self.model_path = candidate
                    logger.info("✅ Valid KoElectra local model found: %s", self.model_path)
                else:
                    logger.warning("⚠️ KoElectra 로컬 모델 경로(%s)에 필수 파일이 없습니다.", candidate)
                    logger.warning("➡️ Hugging Face에서 Base 모델 다운로드")
                    self.model_path = None
            else:
                self.model_path = None
        else:
            # Kanana LoRA 경로 계산 및 검증
            # 우선순위: 환경변수 > 인자 > 기본값
            env_path = os.getenv("KANANA_LORA_DIR", "").strip()
            
            candidate: Optional[Path] = None
            if env_path:
                candidate = Path(env_path)
            elif model_path and model_path.strip():
                candidate = Path(model_path)
            else:
                candidate = project_root / "models" / "kanana-lora-v1"

            # 절대 경로 변환
            if candidate:
                if not candidate.is_absolute():
                    candidate = (project_root / candidate).resolve()
                
                # [중요] 실제 adapter_config.json 파일 존재 여부 확인
                config_file = candidate / "adapter_config.json"
                if candidate.exists() and config_file.exists():
                    self.model_path = candidate
                    logger.info("✅ Valid LoRA adapter found: %s", self.model_path)
                else:
                    logger.warning("⚠️ LoRA 경로(%s)에 'adapter_config.json'이 없습니다.", candidate)
                    logger.warning("➡️ LoRA 로딩을 건너뛰고 Base Model만 사용합니다.")
                    self.model_path = None

        # 6) 토크나이저 로드
        if self.is_koelectra and self.model_path:
            # 🔥 KoElectra 로컬 모델의 토크나이저 로드 시도
            try:
                self.tokenizer = self._AutoTokenizer.from_pretrained(str(self.model_path))
                logger.info("✅ 로컬 KoElectra 토크나이저 로드 완료")
            except Exception as e:
                logger.warning("⚠️ 로컬 토크나이저 로드 실패 (%s). Base 모델의 토크나이저 사용", e)
                self.tokenizer = self._AutoTokenizer.from_pretrained(self.base_model_name)
        else:
            self.tokenizer = self._AutoTokenizer.from_pretrained(self.base_model_name)
        
        if self.tokenizer.pad_token is None and getattr(self.tokenizer, "eos_token", None) is not None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        # 7) 모델 로드 옵션
        load_kwargs: dict[str, Any] = {"device_map": self.device}
        if self.device == "cuda":
            if self.use_quantization:
                try:
                    from transformers import BitsAndBytesConfig
                    load_kwargs["quantization_config"] = BitsAndBytesConfig(
                        load_in_8bit=True, llm_int8_threshold=6.0
                    )
                    load_kwargs["device_map"] = "auto"
                except Exception:
                    load_kwargs["dtype"] = self._torch.float16
            else:
                load_kwargs["dtype"] = self._torch.float16
        else:
            load_kwargs["dtype"] = self._torch.float32

        load_kwargs["use_safetensors"] = True

        # 8) Base 모델 로드
        logger.info("Loading Base Model: %s", self.base_model_name)
        
        def load_base():
            try:
                return self._AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name, num_labels=num_labels, **load_kwargs
                )
            except Exception:
                if "use_safetensors" in load_kwargs:
                    load_kwargs.pop("use_safetensors")
                return self._AutoModelForSequenceClassification.from_pretrained(
                    self.base_model_name, num_labels=num_labels, **load_kwargs
                )

        if self.is_koelectra:
            # 🔥 KoElectra 로컬 모델 로드 또는 Base 모델 다운로드
            if self.model_path:
                try:
                    logger.info("📂 로컬 KoElectra 모델 로드: %s", self.model_path)
                    self.model = self._AutoModelForSequenceClassification.from_pretrained(
                        str(self.model_path),
                        num_labels=num_labels,
                        **load_kwargs
                    )
                    logger.info("✅ 로컬 KoElectra 모델 로드 완료")
                except Exception as e:
                    logger.error("❌ 로컬 KoElectra 모델 로드 실패 (%s). Base 모델로 폴백", e)
                    self.model = load_base()
            else:
                self.model = load_base()
        else:
            self.base_model = load_base()
            self.model = self.base_model

            # 9) LoRA 어댑터 로드 (검증된 경로일 때만 실행)
            if self.model_path is not None and self._peft_available:
                try:
                    logger.info("🔗 Loading LoRA adapter...")
                    self.model = self._PeftModel.from_pretrained(
                        self.base_model, str(self.model_path)
                    )
                    self.use_lora = True
                    logger.info("✅ LoRA Adapter loaded successfully!")
                except Exception as e:
                    logger.error("❌ LoRA 로드 실패 (%s). Base 모델로 진행합니다.", e)
                    self.model = self.base_model

        self.model.eval()

    # ----------------------------------------------------------
    # 🔥 predict(): threshold 기반 예측 로직 적용
    # ----------------------------------------------------------
    def predict(self, text: str) -> ClassificationResult:
        if not text or not text.strip():
            return ClassificationResult(is_harmful=False, confidence=0.0, text="")

        inputs = self.tokenizer(
            text, 
            return_tensors="pt", 
            truncation=True, 
            padding=True, 
            max_length=self.max_length
        ).to(self.device)

        with self._torch.no_grad():
            outputs = self.model(**inputs)

        logits = outputs.logits  # shape: [1, 2]
        probs = self._torch.nn.functional.softmax(logits, dim=-1)[0]

        # 🔥 id2label 기반으로 label=1 (유해) 확률 추출
        # KoElectra와 Kanana 모두 일반적으로 0:정상, 1:유해로 학습됨
        idx_for_harm = 1
        prob_harm = float(probs[idx_for_harm].item())

        # 🔥 threshold 적용
        is_harmful = prob_harm >= self.threshold

        return ClassificationResult(
            is_harmful=is_harmful,
            confidence=prob_harm,
            text=text,
        )