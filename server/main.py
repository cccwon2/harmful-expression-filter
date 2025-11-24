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

# NLP Classifier
from nlp.harmful_classifier import HarmfulTextClassifier

# OCR 서비스 (현재는 사용하지 않음 - Windows SDK OCR을 Electron에서 직접 사용)
# from services.paddle_ocr_service import get_ocr_service

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

    def __init__(self, websocket: WebSocket, api_key: str, keywords: List[str], classifier_instance: Optional[HarmfulTextClassifier]):
        self.websocket = websocket
        self.api_key = api_key
        self.keywords = keywords
        self.classifier = classifier_instance

        self.dg_ws = None  # websockets.legacy.client.WebSocketClientProtocol
        self.receive_task: Optional[asyncio.Task] = None

        self.result_queue: asyncio.Queue = asyncio.Queue()
        self.is_running: bool = False

        # ✅ STT 중복 필터용 상태
        self.last_transcript: str = ""
        self.last_is_final: bool = False

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

        # ✅ 1단계: 중복/노이즈 필터링
        if transcript == self.last_transcript and is_final == self.last_is_final:
            return

        if not is_final and len(transcript) <= len(self.last_transcript):
            return

        # 상태 갱신
        self.last_transcript = transcript
        self.last_is_final = is_final

        # 1차: 키워드 검사
        matched = check_keywords(transcript)
        is_harmful_keyword = len(matched) > 0

        # 2차: AI 모델 검사 (확정된 문장이고, 키워드 감지가 안 되었을 때만 수행)
        # (옵션: 키워드 감지 되어도 AI 돌릴 수 있지만, 성능상 키워드 우선)
        is_harmful_ai = False
        ai_confidence = 0.0
        
        if is_final and self.classifier:
            # 키워드로 이미 잡혔으면 굳이 AI 안 돌려도 되지만, 
            # "Hybrid" 로직(OR)이므로 둘 중 하나라도 유해하면 유해함.
            # 여기서는 키워드가 안 잡혔을 때 AI로 2차 검증하는 흐름이 자연스러움.
            # 하지만 분석 정보 제공을 위해 항상 돌릴 수도 있음. 
            # 일단 성능 고려하여 키워드 없을 때만 돌리거나, 
            # 사용자 요청대로 "2차로 판단" 하려면 항상 돌리는게 맞을 수도 있음.
            # 여기서는 "키워드 OR AI" 논리이므로, 키워드가 없으면 AI를 돌려본다.
            if not is_harmful_keyword:
                try:
                    result = self.classifier.predict(transcript)
                    if result.is_harmful:
                        is_harmful_ai = True
                        ai_confidence = result.confidence
                        # AI가 감지했다면 matched에 가상의 키워드 추가 (클라이언트 알림용)
                        matched.append(f"[AI] {transcript[:10]}...") 
                except Exception as e:
                    LOGGER.error("[AI] 분류 에러: %s", e)

        is_harmful = is_harmful_keyword or is_harmful_ai

        response_data = {
            "status": "ok",
            "text": transcript,
            "is_harmful": int(is_harmful),
            "confidence": max(confidence, ai_confidence) if is_harmful_ai else confidence,
            "matched_keywords": matched,
            "is_final": is_final,
            "timestamp": time.time(),
            "ai_checked": is_final and (self.classifier is not None),
        }

        status_tag = "[확정]" if is_final else "[진행]"
        print(f"[STT] {status_tag} {transcript}", flush=True)
        if is_harmful:
            source = "키워드" if is_harmful_keyword else "AI"
            print(f"🚨 유해 표현 감지({source}): {matched}", flush=True)

        # ✅ 2단계: 진행 중 결과는 로그만 찍고, 클라이언트로는 확정만 보냄
        if not is_final:
            return

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
    global classifier
    
    load_keywords()
    
    # KoELECTRA 모델 로드
    try:
        # 환경 변수에서 모델 경로 확인 (로컬 모델 우선)
        model_path = os.getenv("MODEL_PATH")
        if model_path:
            # 로컬 경로인 경우 절대 경로로 변환
            if not os.path.isabs(model_path):
                model_path = os.path.join(os.path.dirname(__file__), model_path)
            LOGGER.info("[Init] 로컬 모델 경로 사용: %s", model_path)
            classifier = HarmfulTextClassifier(model_name=model_path)
        else:
            # 기본값: Hugging Face Hub에서 다운로드
            LOGGER.info("[Init] KoELECTRA 모델 로딩 시작 (Hugging Face Hub)...")
            classifier = HarmfulTextClassifier()
        LOGGER.info("[Init] ✅ KoELECTRA 모델 로드 완료")
    except Exception as e:
        LOGGER.error("[Init] ❌ KoELECTRA 모델 로드 실패: %s", e)
        classifier = None

    LOGGER.info("[INFO] 🚀 서버 시작 완료 (Deepgram Streaming Mode + KoELECTRA)")
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

    # classifier 전역 변수 전달
    dg_manager = DeepgramWebSocketManager(websocket, DEEPGRAM_API_KEY, BAD_WORDS, classifier)
    success = await dg_manager.start()

    if not success:
        await websocket.send_json({"status": "error", "detail": "Deepgram Connection Failed"})
        await websocket.close()
        return

    await websocket.send_json(
        {
            "status": "connected",
            "message": "Deepgram Streaming Ready",
            "mode": "Real-time (nova-2, ko) + AI Filter",
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
        "ai_model": "KoELECTRA" if classifier else "Not Loaded",
    }


@app.get("/keywords")
async def get_keywords():
    return {"keywords": BAD_WORDS}


class AnalyzeRequest(BaseModel):
    text: str


@app.post("/analyze")
async def analyze_text(request: AnalyzeRequest):
    # 1차: 키워드
    matched = check_keywords(request.text)
    is_harmful_keyword = len(matched) > 0
    
    # 2차: AI
    is_harmful_ai = False
    ai_confidence = 0.0
    
    if classifier:
        try:
            result = classifier.predict(request.text)
            if result.is_harmful:
                is_harmful_ai = True
                ai_confidence = result.confidence
                if not is_harmful_keyword:
                    matched.append("[AI Detected]")
        except Exception as e:
            LOGGER.error("AI Analysis failed: %s", e)

    return {
        "has_violation": is_harmful_keyword or is_harmful_ai,
        "matched_keywords": matched,
        "ai_analysis": {
            "is_harmful": is_harmful_ai,
            "confidence": ai_confidence
        } if classifier else None
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
