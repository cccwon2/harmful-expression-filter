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
# 🔇 키워드 기반 감지 제거됨 - AI 모델만 사용
classifier: Optional[HarmfulTextClassifier] = None
inference_executor: Optional[ThreadPoolExecutor] = None


# ============== Deepgram WebSocket 핸들러 클래스 ==============
class DeepgramWebSocketManager:
    """
    FastAPI WebSocket(Electron)과 Deepgram STT WebSocket(v1 / nova-2, ko)을 중계하는 클래스
    Task 35: 실시간 스트리밍 및 중간 결과 처리 지원
    """
    def __init__(self, websocket: WebSocket, api_key: str, classifier_instance: Optional[HarmfulTextClassifier]):
        self.websocket = websocket
        self.api_key = api_key
        # 🔇 키워드 기반 감지 제거됨 - AI 모델만 사용
        self.classifier = classifier_instance
        self.dg_ws = None
        self.receive_task: Optional[asyncio.Task] = None
        self.result_queue: asyncio.Queue = asyncio.Queue()
        self.is_running: bool = False
        self.last_transcript: str = ""
        self.last_is_final: bool = False
        self.last_audio_time: float = 0.0  # 마지막 오디오 전송 시간 추적용
        self.audio_chunk_times: List[float] = []  # 오디오 청크별 타임스탬프 (최근 N개만 유지)

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

        # Task 35: interim_results=true 설정 (중간 결과 수신)
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
                return
            
            # 오디오 전송 시간 기록 (STT 지연 측정용)
            self.last_audio_time = time.time()
            await self.dg_ws.send(audio_bytes)
        except Exception as e:
            error_msg = str(e)
            LOGGER.error("[Deepgram] 오디오 전송 오류: %s", e)
            
            # 연결 오류인 경우 재연결 필요
            if "1011" in error_msg or "closed" in error_msg.lower() or "timeout" in error_msg.lower():
                LOGGER.warning("[Deepgram] 연결 오류 감지. 재연결 필요")
                self.is_running = False
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
                    await self._handle_result_payload(payload)
                except json.JSONDecodeError:
                    continue
        except asyncio.CancelledError:
            pass
        except Exception as e:
            error_msg = str(e)
            LOGGER.error("[Deepgram] 수신 루프 오류: %s", e)
            if "1011" in error_msg or "timeout" in error_msg.lower() or "closed" in error_msg.lower():
                LOGGER.warning("[Deepgram] WebSocket 연결이 끊어짐")
        finally:
            self.is_running = False

    async def _handle_result_payload(self, payload: dict):
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

        # 중간 결과는 클라이언트로 전송 안 함 (Task 35)
        if not is_final: return
        
        # ✅ STT 지연 시간 측정 개선
        result_time = time.time()
        stt_latency = 0.0
        
        if self.last_audio_time > 0:
            stt_latency = result_time - self.last_audio_time
            self.last_audio_time = 0.0
        elif len(self.audio_chunk_times) > 0:
            oldest_chunk_time = self.audio_chunk_times[0]
            stt_latency = result_time - oldest_chunk_time
            self.audio_chunk_times = []
        
        if stt_latency > 0:
            print(f"[STT] [확정] {transcript} (서버 측정 STT 지연: {stt_latency:.3f}초)", flush=True)
        else:
            print(f"[STT] [확정] {transcript}", flush=True)
        
        # 1. STT 결과를 즉시 클라이언트로 전송
        initial_response = {
            "status": "ok",
            "text": transcript,
            "is_harmful": 0,  # 초기값
            "confidence": confidence,
            "matched_keywords": [],
            "ai_detection": None,
            "is_final": is_final,
            "timestamp": time.time(),
            "ai_checked": False,
        }
        self.result_queue.put_nowait(initial_response)
        
        # 2. AI 판별 (백그라운드)
        if self.classifier:
            global inference_executor
            if inference_executor:
                print(f"[AI] AI 판별 시작: '{transcript[:50]}...'", flush=True)
                asyncio.create_task(self._check_harmful_async(transcript, confidence))
            else:
                print(f"[AI] ⚠️ Executor가 없어 AI 판별을 건너뜁니다.", flush=True)
                self._send_no_ai_complete(transcript, confidence)
        else:
            print(f"[AI] ⚠️ Classifier가 없어 AI 판별을 건너뜁니다.", flush=True)
            self._send_no_ai_complete(transcript, confidence)
    
    def _send_no_ai_complete(self, transcript, confidence):
        response = {
            "status": "ok",
            "text": transcript,
            "is_harmful": 0,
            "confidence": confidence,
            "matched_keywords": [],
            "ai_detection": None,
            "is_final": True,
            "timestamp": time.time(),
            "ai_checked": True,
        }
        self.result_queue.put_nowait(response)

    async def _check_harmful_async(self, transcript: str, stt_confidence: float):
        """백그라운드에서 유해 표현 판별 수행"""
        try:
            start_time = time.time()
            loop = asyncio.get_event_loop()
            global inference_executor
            
            result = await loop.run_in_executor(
                inference_executor,
                self.classifier.predict,
                transcript
            )
            inference_time = time.time() - start_time
            
            is_harmful_ai = result.is_harmful
            ai_confidence = result.confidence
            model_name = self._get_classifier_model_name()
            
            status = "🚨 유해" if is_harmful_ai else "✅ 정상"
            print(f"[AI] {status} ({model_name}): '{transcript[:50]}...' (신뢰도: {ai_confidence:.3f}, 추론 시간: {inference_time:.3f}초)", flush=True)
            
            if model_name == "Kanana-Base":
                print(f"[AI] ⚠️ 경고: Base 모델은 학습되지 않아 성능이 낮을 수 있습니다.", flush=True)
            
            ai_response = {
                "status": "ok",
                "text": transcript,
                "is_harmful": int(is_harmful_ai),
                "confidence": max(stt_confidence, ai_confidence) if is_harmful_ai else stt_confidence,
                "matched_keywords": [],
                "ai_detection": {
                    "detected": is_harmful_ai,
                    "confidence": ai_confidence,
                    "model": model_name,
                    "inference_time": inference_time
                },
                "is_final": True,
                "timestamp": time.time(),
                "ai_checked": True,
            }
            self.result_queue.put_nowait(ai_response)
        except Exception as e:
            LOGGER.error("[AI] 분류 에러: %s", e, exc_info=True)
            self._send_no_ai_complete(transcript, stt_confidence)

    def _get_classifier_model_name(self) -> str:
        if not self.classifier:
            return "AI"
        base_name = getattr(self.classifier, "base_model_name", "")
        if "koelectra" in base_name.lower():
            return "KoElectra"
        if not getattr(self.classifier, "use_lora", True):
            return "Kanana-Base"
        return "Kanana-LoRA"

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
            # KoElectra 기본값 강제 설정
            if not base_model_env or "kanana" in base_model_env.lower():
                target_base_model = "monologg/koelectra-base-v3-discriminator"
            else:
                target_base_model = base_model_env
            LOGGER.info("[Init] 🚀 KoElectra 모델 선택됨")
            # KoElectra는 LoRA를 사용하지 않으므로 model_path는 빈 문자열
            target_model_path = ""
        else:
            # Kanana (Default)
            if not base_model_env or "koelectra" in base_model_env.lower():
                target_base_model = "kakaocorp/kanana-nano-2.1b-instruct"
            else:
                target_base_model = base_model_env
            
            # 🔹 LoRA 경로 처리: MODEL_PATH가 명시적으로 설정된 경우에만 절대 경로로 변환
            # MODEL_PATH가 비어있으면 빈 문자열을 전달하여 HarmfulTextClassifier 내부 로직 사용
            # (KANANA_LORA_DIR 환경 변수 또는 기본값 models/kanana-lora-v1 사용)
            if model_path_env and model_path_env.strip():
                base_dir = os.path.dirname(os.path.abspath(__file__))
                full_model_path = os.path.join(base_dir, model_path_env)
                
                # 잘못된 경로(nlp 폴더 등) 체크
                if os.path.basename(full_model_path) == "nlp":
                    LOGGER.warning(f"[Init] ⚠️ 잘못된 경로 감지 (nlp 폴더). MODEL_PATH를 무시하고 내부 로직 사용")
                    target_model_path = ""
                elif os.path.exists(full_model_path):
                    target_model_path = full_model_path
                    LOGGER.info(f"[Init] 📂 LoRA 어댑터 경로 확인됨: {target_model_path}")
                else:
                    LOGGER.warning(f"[Init] ⚠️ 설정된 LoRA 경로를 찾을 수 없음: {full_model_path}")
                    LOGGER.info("[Init] 💡 MODEL_PATH를 무시하고 내부 로직 사용 (KANANA_LORA_DIR 또는 기본값)")
                    target_model_path = ""
            else:
                # MODEL_PATH가 비어있으면 빈 문자열 전달 → HarmfulTextClassifier 내부 로직 사용
                target_model_path = ""
                LOGGER.info("[Init] 💡 MODEL_PATH가 설정되지 않음. HarmfulTextClassifier 내부 로직 사용")
            
            LOGGER.info("[Init] 🚀 Kanana 모델 선택됨")

        # 2. Classifier 초기화
        LOGGER.info(f" - Base Model: {target_base_model}")
        LOGGER.info(f" - Adapter Path: {target_model_path if target_model_path else 'None (Base Only)'}")
        LOGGER.info(f" - Quantization: {use_quantization}")

        classifier = HarmfulTextClassifier(
            model_path=target_model_path,     # ✅ 절대 경로 또는 빈 문자열
            base_model_name=target_base_model,
            use_quantization=use_quantization
        )
        
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

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============== 엔드포인트 복원 ==============

@app.websocket("/ws/audio")
async def audio_stream(websocket: WebSocket):
    await websocket.accept()
    
    if not DEEPGRAM_API_KEY:
        LOGGER.error("[WS] API Key missing")
        await websocket.close(code=1008, reason="API Key missing")
        return

    # 🔇 키워드 기반 감지 제거됨 - AI 모델만 사용
    dg_manager = DeepgramWebSocketManager(websocket, DEEPGRAM_API_KEY, classifier)
    success = await dg_manager.start()

    if not success:
        await websocket.send_json({"status": "error", "detail": "Deepgram Connection Failed"})
        await websocket.close()
        return

    model_display = getattr(app.state, "model_type_display", "Unknown")
        
    await websocket.send_json({
        "status": "connected",
        "message": "Deepgram Streaming Ready",
        "mode": f"Real-time (nova-2) + {model_display}",
    })

    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect": break
            
            if "bytes" in message and message["bytes"]:
                await dg_manager.process_audio(message["bytes"])
                
                # Deepgram 재연결 로직
                if not dg_manager.is_running:
                    LOGGER.warning("[WS] Deepgram 재연결 시도...")
                    await asyncio.sleep(1)
                    success = await dg_manager.start()
                    if not success:
                        LOGGER.error("[WS] Deepgram 재연결 실패")
                        await websocket.send_json({"status": "error", "detail": "Reconnection Failed"})
                        break
                    else:
                        LOGGER.info("[WS] Deepgram 재연결 성공")
                        await websocket.send_json({"status": "connected", "message": "Reconnected"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        LOGGER.error("[WS] 오류: %s", e)
    finally:
        await dg_manager.stop()


@app.get("/health")
async def health_check():
    # app.state에 저장된 모델 정보 활용
    model_display = getattr(app.state, "model_type_display", "Not Loaded")
    
    return {
        "status": "ok",
        "stt_service": "Deepgram (nova-2)",
        "ai_model": model_display,
        "mode": "Integrated Filter"
    }


@app.get("/keywords")
async def get_keywords():
    # 🔇 키워드 기반 감지 제거됨 - AI 모델만 사용
    return {"keywords": []}


class AnalyzeRequest(BaseModel):
    text: str


@app.post("/analyze")
async def analyze_text(request: AnalyzeRequest):
    # 요청 로그
    text_preview = request.text[:50] + "..." if len(request.text) > 50 else request.text
    LOGGER.info("[Analyze] 📥 분석 요청 수신: 텍스트 길이=%d, 미리보기=\"%s\"", len(request.text), text_preview)
    
    is_harmful_ai = False
    ai_confidence = 0.0
    
    if not classifier:
        LOGGER.warning("[Analyze] ⚠️ Classifier가 초기화되지 않았습니다. 분석을 건너뜁니다.")
    elif not inference_executor:
        LOGGER.warning("[Analyze] ⚠️ Inference executor가 초기화되지 않았습니다. 분석을 건너뜁니다.")
    else:
        try:
            LOGGER.info("[Analyze] 🔍 AI 모델 분석 시작...")
            start_time = time.time()
            
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                inference_executor,
                classifier.predict,
                request.text
            )
            
            elapsed_time = time.time() - start_time
            is_harmful_ai = result.is_harmful
            ai_confidence = result.confidence
            
            LOGGER.info(
                "[Analyze] ✅ 분석 완료 (%.3f초): is_harmful=%s, confidence=%.4f (%.1f%%)",
                elapsed_time,
                is_harmful_ai,
                ai_confidence,
                ai_confidence * 100
            )
        except Exception as e:
            LOGGER.error("[Analyze] ❌ AI 분석 실패: %s", e, exc_info=True)

    response = {
        "has_violation": is_harmful_ai,
        "ai_analysis": {
            "is_harmful": is_harmful_ai,
            "confidence": ai_confidence
        } if classifier else None
    }
    
    LOGGER.info(
        "[Analyze] 📤 응답 반환: has_violation=%s, ai_analysis=%s",
        response["has_violation"],
        "있음" if response["ai_analysis"] else "없음"
    )
    
    return response


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)