from contextlib import asynccontextmanager
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

# NLP Classifier (수정된 harmful_classifier.py 사용 전제)
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


# ============== 유틸리티 함수 ==============
def load_keywords() -> None:
    """키워드 파일 로드"""
    global BAD_WORDS
    keywords_path = os.path.join(os.path.dirname(__file__), "data", "bad_words.json")
    default_keywords = ["새끼", "시발", "씨발", "병신", "존나", "미친", "니미", "좆"]

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
        self.dg_ws = None
        self.receive_task: Optional[asyncio.Task] = None
        self.result_queue: asyncio.Queue = asyncio.Queue()
        self.is_running: bool = False
        self.last_transcript: str = ""
        self.last_is_final: bool = False

    async def start(self) -> bool:
        if not self.api_key:
            LOGGER.error("[Deepgram] ❌ API Key 없음")
            return False

        # 기존 연결이 있으면 정리
        if self.dg_ws is not None:
            try:
                if not self.dg_ws.closed:
                    await self.dg_ws.close()
            except Exception:
                pass
            self.dg_ws = None
        
        # 기존 receive_task가 있으면 취소
        if self.receive_task is not None:
            self.receive_task.cancel()
            try:
                await self.receive_task
            except asyncio.CancelledError:
                pass
            self.receive_task = None

        url = (
            "wss://api.deepgram.com/v1/listen"
            "?model=nova-2&language=ko&smart_format=true"
            "&encoding=linear16&channels=1&sample_rate=16000&interim_results=true"
        )

        try:
            LOGGER.info("[Deepgram] 🌐 WebSocket 연결 시도: %s", url)
            self.dg_ws = await ws_connect(
                url,
                extra_headers={"Authorization": f"Token {self.api_key}"},
            )
            LOGGER.info("[Deepgram] ✅ WebSocket 연결 성공 (nova-2, ko)")
            self.is_running = True
            self.last_transcript = ""  # 재연결 시 상태 초기화
            self.last_is_final = False
            asyncio.create_task(self._send_results_to_client())
            self.receive_task = asyncio.create_task(self._receive_loop())
            return True
        except Exception as e:
            LOGGER.error("[Deepgram] ❌ WebSocket 연결 실패: %s", e, exc_info=True)
            self.is_running = False
            return False

    async def stop(self):
        self.is_running = False
        if self.dg_ws is not None:
            try:
                await self.dg_ws.close()
            except Exception:
                pass
        if self.receive_task is not None:
            self.receive_task.cancel()
            try:
                await self.receive_task
            except asyncio.CancelledError:
                pass

    async def process_audio(self, audio_bytes: bytes):
        if not self.is_running or self.dg_ws is None:
            return
        
        # 빈 데이터는 전송하지 않음
        if not audio_bytes or len(audio_bytes) == 0:
            return
        
        try:
            # WebSocket이 닫혀있는지 확인
            if self.dg_ws.closed:
                LOGGER.warning("[Deepgram] WebSocket이 닫혀있음. 재연결 시도...")
                self.is_running = False
                # 재연결은 상위에서 처리하도록 함
                return
            
            await self.dg_ws.send(audio_bytes)
        except Exception as e:
            error_msg = str(e)
            LOGGER.error("[Deepgram] 오디오 전송 오류: %s", e)
            
            # 연결 오류인 경우 재연결 필요
            if "1011" in error_msg or "closed" in error_msg.lower() or "timeout" in error_msg.lower():
                LOGGER.warning("[Deepgram] 연결 오류 감지. 재연결 필요")
                self.is_running = False
                # WebSocket 닫기
                try:
                    if self.dg_ws and not self.dg_ws.closed:
                        await self.dg_ws.close()
                except:
                    pass
                self.dg_ws = None

    async def _receive_loop(self):
        if self.dg_ws is None: return
        try:
            async for message in self.dg_ws:
                if isinstance(message, bytes): continue
                try:
                    payload = json.loads(message)
                    self._handle_result_payload(payload)
                except json.JSONDecodeError:
                    continue
        except asyncio.CancelledError:
            pass
        except Exception as e:
            error_msg = str(e)
            LOGGER.error("[Deepgram] 수신 루프 오류: %s", e)
            # 타임아웃이나 연결 오류인 경우
            if "1011" in error_msg or "timeout" in error_msg.lower() or "closed" in error_msg.lower():
                LOGGER.warning("[Deepgram] WebSocket 연결이 끊어짐")
        finally:
            self.is_running = False

    def _handle_result_payload(self, payload: dict):
        channel = payload.get("channel")
        if not isinstance(channel, dict): return
        alternatives = channel.get("alternatives")
        if not alternatives: return
        alt0 = alternatives[0]
        transcript = str(alt0.get("transcript", "")).strip()
        if not transcript: return

        confidence = float(alt0.get("confidence", 0.0))
        is_final = bool(payload.get("is_final", False))

        # 중복 필터
        if transcript == self.last_transcript and is_final == self.last_is_final: return
        if not is_final and len(transcript) <= len(self.last_transcript): return

        self.last_transcript = transcript
        self.last_is_final = is_final

        # 🔇 키워드 체크 주석처리 (kanana-lora-v1 모델만 사용)
        # # 1차: 키워드
        # matched = check_keywords(transcript)
        # is_harmful_keyword = len(matched) > 0

        # ✅ AI (Kanana LoRA)만 사용 - 모든 텍스트에 대해 AI 판별 수행
        is_harmful_ai = False
        ai_confidence = 0.0
        # 🔇 matched_keywords는 하위 호환성을 위해 유지하지만 빈 배열로 설정
        matched_keywords = []
        
        if is_final and self.classifier:
            try:
                result = self.classifier.predict(transcript)
                if result.is_harmful:
                    is_harmful_ai = True
                    ai_confidence = result.confidence
                    # AI 감지 정보는 별도 필드로 전달 (키워드가 아님)
            except Exception as e:
                LOGGER.error("[AI] 분류 에러: %s", e)

        is_harmful = is_harmful_ai
        
        response_data = {
            "status": "ok",
            "text": transcript,
            "is_harmful": int(is_harmful),
            "confidence": max(confidence, ai_confidence) if is_harmful_ai else confidence,
            "matched_keywords": matched_keywords,  # 🔇 빈 배열 (하위 호환성)
            "ai_detection": {
                "detected": is_harmful_ai,
                "confidence": ai_confidence,
                "model": "Kanana-Base" if (self.classifier and not getattr(self.classifier, 'use_lora', True)) else "Kanana-LoRA"
            } if is_final and self.classifier else None,
            "is_final": is_final,
            "timestamp": time.time(),
            "ai_checked": is_final and (self.classifier is not None),
        }

        # 로그 출력
        if not is_final: return # 진행 중인 결과는 클라이언트에 안 보냄
        
        print(f"[STT] [확정] {transcript}", flush=True)
        if is_harmful:
            print(f"🚨 유해 표현 감지(Kanana-AI): {matched_keywords or ['[전체 문장]']}", flush=True)

        self.result_queue.put_nowait(response_data)

    async def _send_results_to_client(self):
        while self.is_running:
            try:
                result = await self.result_queue.get()
                await self.websocket.send_json(result)
            except Exception:
                break


# ============== FastAPI 앱 설정 ==============

@asynccontextmanager
async def lifespan(app: FastAPI):
    global classifier
    
    # 🔇 키워드 로드 주석처리 (kanana-lora-v1 모델만 사용)
    # load_keywords()
    
    # ✅ Kanana-Nano 모델 로드 로직 (Base 모델만 사용하도록 설정)
    try:
        # .env에서 경로 가져오기 (없으면 빈 문자열로 설정하여 base 모델만 사용)
        model_path_env = os.getenv("MODEL_PATH", "")  # 빈 문자열 = base 모델만 사용
        base_model_env = os.getenv("BASE_MODEL_NAME", "kakaocorp/kanana-nano-2.1b-instruct")

        # Base 모델만 사용할지 확인
        use_base_only = not model_path_env or model_path_env.strip() == ""
        
        if use_base_only:
            LOGGER.info("[Init] 🚀 Kanana Base 모델 로딩 시작...")
            LOGGER.info(f" - Base Model: {base_model_env}")
            LOGGER.info(f" - LoRA Adapter: 사용 안 함 (Base 모델만 사용)")
            
            # HarmfulTextClassifier 초기화 (model_path를 빈 문자열로 전달하여 base만 사용)
            classifier = HarmfulTextClassifier(
                model_path="",  # 빈 문자열 = base 모델만 사용
                base_model_name=base_model_env
            )
            LOGGER.info("[Init] ✅ Kanana-Nano Base 모델 로드 완료!")
        else:
            # 절대 경로 변환
            base_dir = os.path.dirname(__file__)
            full_model_path = os.path.join(base_dir, model_path_env)

            if os.path.exists(full_model_path):
                LOGGER.info("[Init] 🚀 Kanana LoRA 모델 로딩 시작...")
                LOGGER.info(f" - Adapter Path: {full_model_path}")
                LOGGER.info(f" - Base Model: {base_model_env}")
                
                # HarmfulTextClassifier 초기화 (새로운 파라미터 적용)
                classifier = HarmfulTextClassifier(
                    model_path=model_path_env, # harmful_classifier 내부에서 상대경로 처리함
                    base_model_name=base_model_env
                )
                LOGGER.info("[Init] ✅ Kanana-Nano LoRA 모델 로드 완료!")
            else:
                LOGGER.warning(f"[Init] ⚠️ 모델 경로를 찾을 수 없음: {full_model_path}")
                LOGGER.warning("[Init] Base 모델만 사용합니다.")
                classifier = HarmfulTextClassifier(
                    model_path="",  # 빈 문자열 = base 모델만 사용
                    base_model_name=base_model_env
                )

    except Exception as e:
        LOGGER.error("[Init] ❌ AI 모델 로드 실패: %s", e, exc_info=True)
        classifier = None

    model_type = "Base" if (not model_path_env or model_path_env.strip() == "") else "LoRA"
    LOGGER.info(f"[INFO] 🚀 서버 시작 완료 (Deepgram Streaming + Kanana {model_type})")
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
    
    if not DEEPGRAM_API_KEY:
        await websocket.close(code=1008, reason="API Key missing")
        return

    dg_manager = DeepgramWebSocketManager(websocket, DEEPGRAM_API_KEY, BAD_WORDS, classifier)
    success = await dg_manager.start()

    if not success:
        await websocket.send_json({"status": "error", "detail": "Deepgram Connection Failed"})
        await websocket.close()
        return

    if classifier:
        model_status = "Kanana-Base" if not getattr(classifier, 'use_lora', True) else "Kanana-LoRA"
    else:
        model_status = "Not Available"
    await websocket.send_json({
        "status": "connected",
        "message": "Deepgram Streaming Ready",
        "mode": f"Real-time (nova-2) + {model_status}",
    })

    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect": break
            if "bytes" in message and message["bytes"]:
                await dg_manager.process_audio(message["bytes"])
                
                # Deepgram 연결이 끊어진 경우 재연결 시도
                if not dg_manager.is_running:
                    LOGGER.info("[WS] Deepgram 재연결 시도...")
                    success = await dg_manager.start()
                    if not success:
                        LOGGER.error("[WS] Deepgram 재연결 실패")
                        await websocket.send_json({
                            "status": "error",
                            "detail": "Deepgram Reconnection Failed"
                        })
                        break
                    else:
                        LOGGER.info("[WS] Deepgram 재연결 성공")
                        await websocket.send_json({
                            "status": "connected",
                            "message": "Deepgram Reconnected",
                        })
    except WebSocketDisconnect:
        pass
    except Exception as e:
        LOGGER.error("[WS] 오류: %s", e)
    finally:
        await dg_manager.stop()


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "keywords_count": 0,  # 🔇 키워드 기능 비활성화
        "stt_service": "Deepgram (nova-2)",
        "ai_model": (
            "Kanana-Nano-2.1b (Base)" if (classifier and not getattr(classifier, 'use_lora', True))
            else "Kanana-Nano-2.1b (LoRA)" if classifier
            else "Not Loaded"
        ),
        "model_path": os.getenv("MODEL_PATH", ""),
        "mode": (
            "AI-only (Kanana-Base)" if (classifier and not getattr(classifier, 'use_lora', True))
            else "AI-only (Kanana-LoRA)" if classifier
            else "Not Available"
        )
    }


@app.get("/keywords")
async def get_keywords():
    return {"keywords": BAD_WORDS}


class AnalyzeRequest(BaseModel):
    text: str


@app.post("/analyze")
async def analyze_text(request: AnalyzeRequest):
    # 🔇 키워드 체크 주석처리 (kanana-lora-v1 모델만 사용)
    # # 1차: 키워드
    # matched = check_keywords(request.text)
    # is_harmful_keyword = len(matched) > 0
    
    # ✅ AI (Kanana LoRA)만 사용
    is_harmful_ai = False
    ai_confidence = 0.0
    matched = []
    
    if classifier:
        try:
            result = classifier.predict(request.text)
            if result.is_harmful:
                is_harmful_ai = True
                ai_confidence = result.confidence
                matched.append("[Kanana-AI Detected]")
        except Exception as e:
            LOGGER.error("AI Analysis failed: %s", e)

    return {
        "has_violation": is_harmful_ai,
        "matched_keywords": matched,
        "ai_analysis": {
            "model": "Kanana-LoRA",
            "is_harmful": is_harmful_ai,
            "confidence": ai_confidence
        } if classifier else None
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)