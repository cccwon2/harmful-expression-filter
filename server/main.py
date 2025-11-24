from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional
import asyncio
import json
import logging
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ✅ websockets: legacy asyncio API 사용
from websockets.legacy.client import connect as ws_connect

# NLP Classifier
from nlp.harmful_classifier import HarmfulTextClassifier

# 로깅 설정
LOGGER = logging.getLogger("harmful-filter")
logging.basicConfig(level=logging.INFO)

# .env 파일 위치 확인 및 로드
server_env_path = Path(__file__).parent / ".env"
parent_env_path = Path(__file__).parent.parent / ".env"

if server_env_path.exists():
    load_dotenv(dotenv_path=server_env_path)
    LOGGER.info("[ENV] ✅ .env file loaded from: %s", server_env_path)
elif parent_env_path.exists():
    load_dotenv(dotenv_path=parent_env_path)
    LOGGER.info("[ENV] ✅ .env file loaded from: %s", parent_env_path)
else:
    load_dotenv()
    LOGGER.warning("[ENV] ⚠️ .env file not found. Using environment variables.")

# Deepgram API Key 확인
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
if not DEEPGRAM_API_KEY:
    LOGGER.error("❌ DEEPGRAM_API_KEY가 설정되지 않았습니다! .env 파일을 확인하세요.")

# ============== 전역 변수 ==============
BAD_WORDS: List[str] = []
classifier: Optional[HarmfulTextClassifier] = None
inference_executor: Optional[ThreadPoolExecutor] = None


# ... (중간 유틸리티 함수 및 DeepgramWebSocketManager 클래스는 기존과 동일하므로 생략) ...
# ... (기존 DeepgramWebSocketManager 코드 그대로 유지) ...


# ============== FastAPI 앱 설정 ==============

@asynccontextmanager
async def lifespan(app: FastAPI):
    global classifier, inference_executor
    
    # ✅ ThreadPoolExecutor 생성 (모델 추론용)
    inference_executor = ThreadPoolExecutor(max_workers=4)
    LOGGER.info("[Init] ✅ 모델 추론용 ThreadPoolExecutor 시작 (Workers: 4)")
    
    # ✅ 모델 로드 로직 (Kanana 또는 KoElectra 선택)
    try:
        model_type_env = os.getenv("MODEL_TYPE", "kanana").lower()
        model_path_env = os.getenv("MODEL_PATH", "").strip()
        base_model_env = os.getenv("BASE_MODEL_NAME", "").strip()
        use_quantization = os.getenv("USE_QUANTIZATION", "true").lower() == "true"
        
        target_model_path = ""
        target_base_model = ""

        # 1. 모델 타입에 따른 설정 분기
        if model_type_env == "koelectra":
            # KoElectra 기본값 강제 설정 (User 설정보다 우선하거나, 없으면 채움)
            if not base_model_env or "kanana" in base_model_env.lower():
                target_base_model = "monologg/koelectra-base-v3-discriminator"
            else:
                target_base_model = base_model_env
            
            LOGGER.info("[Init] 🚀 KoElectra 모델 선택됨")
            
        else:
            # Kanana (Default)
            if not base_model_env or "koelectra" in base_model_env.lower():
                target_base_model = "kakaocorp/kanana-nano-2.1b-instruct"
            else:
                target_base_model = base_model_env
            
            # LoRA 경로 확인 (절대 경로 변환)
            if model_path_env:
                base_dir = os.path.dirname(os.path.abspath(__file__))
                full_model_path = os.path.join(base_dir, model_path_env)
                
                if os.path.exists(full_model_path):
                    target_model_path = full_model_path
                    LOGGER.info(f"[Init] 📂 LoRA 어댑터 경로 확인됨: {target_model_path}")
                else:
                    LOGGER.warning(f"[Init] ⚠️ 설정된 LoRA 경로를 찾을 수 없음: {full_model_path}")
                    LOGGER.warning("[Init] Base 모델만 사용합니다.")
                    target_model_path = ""
            
            LOGGER.info("[Init] 🚀 Kanana 모델 선택됨")

        # 2. Classifier 초기화 (공통 로직)
        LOGGER.info(f" - Base Model: {target_base_model}")
        LOGGER.info(f" - Adapter Path: {target_model_path if target_model_path else 'None (Base Only)'}")
        LOGGER.info(f" - Quantization: {use_quantization}")

        classifier = HarmfulTextClassifier(
            model_path=target_model_path,     # ✅ 절대 경로 또는 빈 문자열 전달
            base_model_name=target_base_model,
            use_quantization=use_quantization
        )
        
        # 모델 타입 표시용 문자열 저장
        app.state.model_type_display = "KoElectra" if model_type_env == "koelectra" else ("Kanana-LoRA" if target_model_path else "Kanana-Base")
        LOGGER.info(f"[Init] ✅ {app.state.model_type_display} 모델 로드 완료!")

    except Exception as e:
        LOGGER.error("[Init] ❌ AI 모델 로드 실패: %s", e, exc_info=True)
        classifier = None
        app.state.model_type_display = "Error"

    LOGGER.info(f"[INFO] 🚀 서버 시작 완료")
    yield
    
    if inference_executor:
        inference_executor.shutdown(wait=True)
        LOGGER.info("[Init] 🛑 ThreadPoolExecutor 종료")
    
    LOGGER.info("[INFO] 👋 서버 종료")


app = FastAPI(title="OnVoice Filter API", lifespan=lifespan)

# CORS 및 엔드포인트는 기존 코드와 동일...
# 단, health check 등에서 classifier 상태 확인 시 app.state.model_type_display 활용 가능
# ...

# (하단 실행 코드는 동일)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)