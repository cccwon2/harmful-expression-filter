from contextlib import asynccontextmanager
from typing import List, Optional
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path
import io

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from PIL import Image

# Deepgram SDK V3+ (실시간 스트리밍용)
from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
)

# OCR 서비스 (기존 유지)
from services.paddle_ocr_service import get_ocr_service

# 로깅 설정
LOGGER = logging.getLogger("harmful-filter")
logging.basicConfig(level=logging.INFO)

# .env 파일 위치 확인 및 로드
server_env_path = Path(__file__).parent / '.env'
parent_env_path = Path(__file__).parent.parent / '.env'

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

# ============== 유틸리티 함수 ==============
def load_keywords() -> None:
    """키워드 파일 로드"""
    global BAD_WORDS
    keywords_path = os.path.join(os.path.dirname(__file__), "data", "bad_words.json")
    
    default_keywords = ["새끼", "시발", "씨발", "병신", "존나", "미친", "니미", "좆", "도 아니고"]

    if os.path.exists(keywords_path):
        try:
            with open(keywords_path, "r", encoding="utf-8") as file:
                data = json.load(file)
                BAD_WORDS = data.get("keywords", default_keywords)
                LOGGER.info(f"[Keywords] ✅ {len(BAD_WORDS)}개 키워드 로드 완료")
        except Exception:
            BAD_WORDS = default_keywords
    else:
        BAD_WORDS = default_keywords
        # 기본 파일 생성 로직 생략 (간소화)

def check_keywords(text: str) -> List[str]:
    """단순 키워드 매칭"""
    if not text or not BAD_WORDS:
        return []
    return [word for word in BAD_WORDS if word in text]

# ============== Deepgram WebSocket 핸들러 클래스 ==============
class DeepgramWebSocketManager:
    """
    FastAPI WebSocket(Electron)과 Deepgram WebSocket 사이를 중계하는 클래스
    """
    def __init__(self, websocket: WebSocket, api_key: str, keywords: List[str]):
        self.websocket = websocket
        self.api_key = api_key
        self.keywords = keywords
        self.dg_client = DeepgramClient(api_key)
        self.dg_connection = None
        self.result_queue = asyncio.Queue() # Deepgram(Sync) -> FastAPI(Async) 브릿지용 큐
        self.is_running = False

    async def start(self):
        """Deepgram 연결 시작"""
        try:
            self.dg_connection = self.dg_client.listen.live.v("1")
            
            # 이벤트 핸들러 등록
            self.dg_connection.on(LiveTranscriptionEvents.Transcript, self._on_message)
            self.dg_connection.on(LiveTranscriptionEvents.Error, self._on_error)

            # 옵션 설정 (Electron 오디오 설정과 일치해야 함: 16kHz, Mono, Int16)
            options = LiveOptions(
                model="nova-2",
                language="ko",
                smart_format=True,
                encoding="linear16",
                channels=1,
                sample_rate=16000,
                interim_results=True, # ✨ 속도의 핵심: 중간 결과 받기
            )

            if self.dg_connection.start(options) is False:
                LOGGER.error("❌ Deepgram 연결 실패")
                return False

            self.is_running = True
            LOGGER.info("✅ Deepgram 실시간 스트리밍 연결 성공")
            
            # 결과 전송 루프를 백그라운드 태스크로 실행
            asyncio.create_task(self._send_results_to_client())
            return True
        except Exception as e:
            LOGGER.error(f"Deepgram 시작 오류: {e}")
            return False

    async def stop(self):
        """연결 종료"""
        self.is_running = False
        if self.dg_connection:
            self.dg_connection.finish()
            LOGGER.info("Deepgram 연결 종료")

    async def process_audio(self, audio_bytes: bytes):
        """오디오 데이터를 Deepgram으로 전송"""
        if self.is_running and self.dg_connection:
            self.dg_connection.send(audio_bytes)

    def _on_message(self, result, **kwargs):
        """Deepgram에서 텍스트가 오면 호출됨 (동기 함수)"""
        try:
            alternatives = result.channel.alternatives
            if not alternatives: return
            
            transcript = alternatives[0].transcript
            if len(transcript.strip()) == 0: return

            # 유해성 검사
            matched = check_keywords(transcript)
            is_harmful = len(matched) > 0
            confidence = alternatives[0].confidence
            is_final = result.is_final

            # 결과 데이터 구성
            response_data = {
                "status": "ok",
                "text": transcript,
                "is_harmful": int(is_harmful),
                "confidence": float(confidence),
                "matched_keywords": matched,
                "is_final": is_final,
                "timestamp": time.time()
            }

            # 로그 출력 (디버깅)
            status_tag = "[확정]" if is_final else "[진행]"
            print(f"[STT] {status_tag} {transcript}", flush=True)
            if is_harmful:
                print(f"🚨 유해 표현 감지: {matched}", flush=True)

            # 비동기 큐에 넣기 (put_nowait은 이벤트 루프를 블로킹하지 않음)
            # run_coroutine_threadsafe를 쓰지 않고 Queue를 쓰는 것이 더 안전함
            self.result_queue.put_nowait(response_data)

        except Exception as e:
            LOGGER.error(f"메시지 처리 오류: {e}")

    def _on_error(self, error, **kwargs):
        LOGGER.error(f"Deepgram 오류: {error}")

    async def _send_results_to_client(self):
        """큐에 쌓인 결과를 Electron으로 전송하는 비동기 루프"""
        while self.is_running:
            try:
                # 큐에서 결과 대기
                result = await self.result_queue.get()
                
                # WebSocket으로 전송
                await self.websocket.send_json(result)
            except Exception as e:
                LOGGER.error(f"결과 전송 오류: {e}")
                break

# ============== FastAPI 앱 설정 ==============

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. 시작 시
    load_keywords()
    
    # OCR 지연 초기화 준비
    try:
        get_ocr_service()
        LOGGER.info("[INFO] ✅ OCR 서비스 준비 완료")
    except Exception as e:
        LOGGER.warning(f"[WARN] OCR 서비스 초기화 오류: {e}")

    LOGGER.info("[INFO] 🚀 서버 시작 완료 (Deepgram Streaming Mode)")
    yield
    # 2. 종료 시
    LOGGER.info("[INFO] 👋 서버 종료")

app = FastAPI(title="OnVoice Filter API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============== 엔드포인트 ==============

@app.websocket("/ws/audio")
async def audio_stream(websocket: WebSocket):
    """
    실시간 오디오 스트리밍 엔드포인트
    Electron -> FastAPI -> Deepgram -> FastAPI -> Electron
    """
    await websocket.accept()
    print("[WS] Electron 연결됨", flush=True)
    
    if not DEEPGRAM_API_KEY:
        await websocket.close(code=1008, reason="API Key missing")
        return

    # Deepgram 매니저 생성 및 시작
    dg_manager = DeepgramWebSocketManager(websocket, DEEPGRAM_API_KEY, BAD_WORDS)
    success = await dg_manager.start()
    
    if not success:
        await websocket.send_json({"status": "error", "detail": "Deepgram Connection Failed"})
        await websocket.close()
        return

    # 연결 성공 메시지
    await websocket.send_json({
        "status": "connected", 
        "message": "Deepgram Streaming Ready",
        "mode": "Real-time (Nova-2)"
    })

    try:
        while True:
            # Electron에서 오디오 데이터 수신
            message = await websocket.receive()
            
            if message["type"] == "websocket.disconnect":
                break
            
            if "bytes" in message and message["bytes"]:
                # 받은 오디오를 즉시 Deepgram으로 전송
                await dg_manager.process_audio(message["bytes"])
                
    except WebSocketDisconnect:
        print("[WS] Electron 연결 종료됨", flush=True)
    except Exception as e:
        LOGGER.error(f"[WS] 오류 발생: {e}")
    finally:
        await dg_manager.stop()

# --- 기존 HTTP 엔드포인트 유지 ---

@app.get("/health")
async def health_check():
    return {
        "status": "ok", 
        "keywords": len(BAD_WORDS),
        "service": "Deepgram Streaming"
    }

@app.get("/keywords")
async def get_keywords():
    return {"keywords": BAD_WORDS}

class AnalyzeRequest(BaseModel):
    text: str

@app.post("/analyze")
async def analyze_text(request: AnalyzeRequest):
    matched = check_keywords(request.text)
    return {
        "has_violation": len(matched) > 0,
        "matched_keywords": matched
    }

@app.post("/api/ocr")
async def ocr_endpoint(file: UploadFile = File(...)):
    try:
        image_data = await file.read()
        image = Image.open(io.BytesIO(image_data))
        ocr = get_ocr_service()
        texts, time_taken = ocr.extract_text(image)
        return {"texts": texts, "processing_time": time_taken}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)