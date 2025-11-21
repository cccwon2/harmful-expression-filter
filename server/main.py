from contextlib import asynccontextmanager
from typing import List, Optional
import asyncio
import json
import logging
import os
import time
from pathlib import Path
import io

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from PIL import Image

# ✅ websockets: legacy asyncio API 사용 (extra_headers 지원)
from websockets.legacy.client import connect as ws_connect

# OCR 서비스
from services.paddle_ocr_service import get_ocr_service

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
                LOGGER.info("[Keywords] ✅ %d개 키워드 로드 완료", len(BAD_WORDS))
        except Exception:
            BAD_WORDS = default_keywords
    else:
        BAD_WORDS = default_keywords


def check_keywords(text: str) -> List[str]:
    """단순 키워드 매칭"""
    if not text or not BAD_WORDS:
        return []
    return [word for word in BAD_WORDS if word in text]


# ============== Deepgram WebSocket 핸들러 클래스 ==============
class DeepgramWebSocketManager:
    """
    FastAPI WebSocket(Electron)과 Deepgram STT WebSocket(v1 / nova-2, ko)을 중계하는 클래스
    """

    def __init__(self, websocket: WebSocket, api_key: str, keywords: List[str]):
        self.websocket = websocket
        self.api_key = api_key
        self.keywords = keywords

        self.dg_ws = None  # websockets.legacy.client.WebSocketClientProtocol
        self.receive_task: Optional[asyncio.Task] = None

        self.result_queue: asyncio.Queue = asyncio.Queue()
        self.is_running: bool = False

    async def start(self) -> bool:
        """Deepgram WebSocket 연결 시작"""
        if not self.api_key:
            LOGGER.error("[Deepgram] ❌ API Key 없음")
            return False

        # 한국어 인식을 위한 nova-2 모델 (16kHz mono PCM)
        url = (
            "wss://api.deepgram.com/v1/listen"
            "?model=nova-2"
            "&language=ko"
            "&smart_format=true"
            "&encoding=linear16"
            "&channels=1"
            "&sample_rate=16000"
            "&interim_results=true"
        )

        try:
            LOGGER.info("[Deepgram] 🌐 WebSocket 연결 시도(legacy): %s", url)
            # ✅ legacy asyncio API: extra_headers 사용
            self.dg_ws = await ws_connect(
                url,
                extra_headers={"Authorization": f"Token {self.api_key}"},
            )
            LOGGER.info("[Deepgram] ✅ WebSocket 연결 성공 (nova-2, ko)")
            self.is_running = True

            # Deepgram → Electron 전송 루프
            asyncio.create_task(self._send_results_to_client())
            # Deepgram 수신 루프
            self.receive_task = asyncio.create_task(self._receive_loop())

            return True
        except Exception as e:
            LOGGER.error("[Deepgram] ❌ WebSocket 연결 실패: %s", e, exc_info=True)
            self.is_running = False
            return False

    async def stop(self):
        """연결 종료"""
        self.is_running = False

        # Deepgram WS 종료
        if self.dg_ws is not None:
            try:
                await self.dg_ws.close()
                LOGGER.info("[Deepgram] 🔌 WebSocket 연결 종료")
            except Exception as e:
                LOGGER.warning("[Deepgram] WebSocket 종료 중 오류: %s", e)

        # 수신 태스크 정리
        if self.receive_task is not None:
            self.receive_task.cancel()
            try:
                await self.receive_task
            except asyncio.CancelledError:
                pass

    async def process_audio(self, audio_bytes: bytes):
        """Electron에서 들어온 오디오 데이터를 Deepgram으로 전송"""
        if not self.is_running or self.dg_ws is None:
            return
        try:
            await self.dg_ws.send(audio_bytes)
        except Exception as e:
            LOGGER.error("[Deepgram] 오디오 전송 오류: %s", e)

    async def _receive_loop(self):
        """Deepgram → 서버 수신 루프"""
        if self.dg_ws is None:
            return

        try:
            async for message in self.dg_ws:
                # Deepgram은 text frame(JSON)로 결과를 보냄
                if isinstance(message, bytes):
                    # 혹시 모를 바이너리는 무시
                    continue
                try:
                    payload = json.loads(message)
                except json.JSONDecodeError:
                    LOGGER.warning("[Deepgram] JSON 파싱 실패: %r", message[:200])
                    continue

                self._handle_result_payload(payload)
        except asyncio.CancelledError:
            # 정상 종료
            pass
        except Exception as e:
            LOGGER.error("[Deepgram] 수신 루프 오류: %s", e, exc_info=True)
        finally:
            self.is_running = False
            LOGGER.info("[Deepgram] 수신 루프 종료")

    def _handle_result_payload(self, payload: dict):
        """
        Deepgram STT 응답(JSON)을 파싱해서 result_queue에 넣기
        docs 기준 형태:
        {
          "is_final": bool,
          "channel": {
            "alternatives": [
              {
                "transcript": "...",
                "confidence": 0.98,
                ...
              }
            ]
          },
          ...
        }
        """
        channel = payload.get("channel")
        if not isinstance(channel, dict):
            return

        alternatives = channel.get("alternatives")
        if not alternatives:
            return

        alt0 = alternatives[0]
        if not isinstance(alt0, dict):
            return

        transcript = str(alt0.get("transcript", "")).strip()
        if not transcript:
            return

        confidence_raw = alt0.get("confidence", 0.0)
        try:
            confidence = float(confidence_raw)
        except (TypeError, ValueError):
            confidence = 0.0

        is_final = bool(payload.get("is_final", False))

        matched = check_keywords(transcript)
        is_harmful = len(matched) > 0

        response_data = {
            "status": "ok",
            "text": transcript,
            "is_harmful": int(is_harmful),
            "confidence": confidence,
            "matched_keywords": matched,
            "is_final": is_final,
            "timestamp": time.time(),
        }

        status_tag = "[확정]" if is_final else "[진행]"
        print(f"[STT] {status_tag} {transcript}", flush=True)
        if is_harmful:
            print(f"🚨 유해 표현 감지: {matched}", flush=True)

        self.result_queue.put_nowait(response_data)

    async def _send_results_to_client(self):
        """큐에 쌓인 Deepgram 결과를 Electron WebSocket으로 전송"""
        while self.is_running:
            try:
                result = await self.result_queue.get()
                await self.websocket.send_json(result)
            except Exception as e:
                LOGGER.error("[WS] 결과 전송 오류: %s", e)
                break


# ============== FastAPI 앱 설정 ==============

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_keywords()
    try:
        get_ocr_service()
        LOGGER.info("[INFO] ✅ OCR 서비스 준비 완료")
    except Exception as e:
        LOGGER.warning("[WARN] OCR 서비스 초기화 오류: %s", e)

    LOGGER.info("[INFO] 🚀 서버 시작 완료 (Deepgram Streaming Mode)")
    yield
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
    await websocket.accept()
    print("[WS] Electron 연결됨", flush=True)

    if not DEEPGRAM_API_KEY:
        await websocket.close(code=1008, reason="API Key missing")
        return

    dg_manager = DeepgramWebSocketManager(websocket, DEEPGRAM_API_KEY, BAD_WORDS)
    success = await dg_manager.start()

    if not success:
        await websocket.send_json({"status": "error", "detail": "Deepgram Connection Failed"})
        await websocket.close()
        return

    await websocket.send_json(
        {
            "status": "connected",
            "message": "Deepgram Streaming Ready",
            "mode": "Real-time (nova-2, ko)",
        }
    )

    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break

            if "bytes" in message and message["bytes"]:
                await dg_manager.process_audio(message["bytes"])

    except WebSocketDisconnect:
        print("[WS] Electron 연결 종료됨", flush=True)
    except Exception as e:
        LOGGER.error("[WS] 오류 발생: %s", e)
    finally:
        await dg_manager.stop()


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "keywords": len(BAD_WORDS),
        "service": "Deepgram Streaming (nova-2, ko)",
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
        "matched_keywords": matched,
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
