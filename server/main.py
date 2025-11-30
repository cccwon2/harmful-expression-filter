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
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

# ✅ websockets: legacy asyncio API 사용
from websockets.legacy.client import connect as ws_connect

# NLP Classifier
from nlp.harmful_classifier import HarmfulTextClassifier

# Database
from db.supabase_client import save_detection_log, get_app_setting, supabase

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
        
        # 중간 결과(is_final=False)의 경우, 텍스트가 충분히 길어졌을 때만 분석
        # (너무 짧은 단어 단위로 분석하는 것을 방지)
        if not is_final:
            # 이전 텍스트보다 최소 3자 이상 길어졌을 때만 분석
            if len(transcript) <= len(self.last_transcript) + 2:
                return
            # 최소 5자 이상일 때만 분석 (너무 짧은 텍스트는 무시)
            if len(transcript) < 5:
                return

        self.last_transcript = transcript
        self.last_is_final = is_final
        
        # ✅ STT 지연 시간 측정 개선
        result_time = time.time()
        stt_latency = 0.0
        
        if self.last_audio_time > 0:
            stt_latency = result_time - self.last_audio_time
            if is_final:
                self.last_audio_time = 0.0
        elif len(self.audio_chunk_times) > 0:
            oldest_chunk_time = self.audio_chunk_times[0]
            stt_latency = result_time - oldest_chunk_time
            if is_final:
                self.audio_chunk_times = []
        
        # 로그 출력 (중간 결과와 최종 결과 구분)
        if is_final:
            if stt_latency > 0:
                print(f"[STT] [확정] {transcript} (서버 측정 STT 지연: {stt_latency:.3f}초)", flush=True)
            else:
                print(f"[STT] [확정] {transcript}", flush=True)
        else:
            print(f"[STT] [중간] {transcript}", flush=True)
        
        # 1. STT 결과를 즉시 클라이언트로 전송 (중간 결과도 전송)
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
        
        # 2. AI 판별 (백그라운드) - 중간 결과도 분석
        if self.classifier:
            global inference_executor
            if inference_executor:
                result_type = "중간" if not is_final else "확정"
                print(f"[AI] AI 판별 시작 ({result_type}): '{transcript[:50]}...'", flush=True)
                asyncio.create_task(self._check_harmful_async(transcript, confidence, is_final))
            else:
                print(f"[AI] ⚠️ Executor가 없어 AI 판별을 건너뜁니다.", flush=True)
                self._send_no_ai_complete(transcript, confidence, is_final)
        else:
            print(f"[AI] ⚠️ Classifier가 없어 AI 판별을 건너뜁니다.", flush=True)
            self._send_no_ai_complete(transcript, confidence, is_final)
    
    def _send_no_ai_complete(self, transcript, confidence, is_final: bool = True):
        response = {
            "status": "ok",
            "text": transcript,
            "is_harmful": 0,
            "confidence": confidence,
            "matched_keywords": [],
            "ai_detection": None,
            "is_final": is_final,
            "timestamp": time.time(),
            "ai_checked": True,
        }
        self.result_queue.put_nowait(response)

    async def _check_harmful_async(self, transcript: str, stt_confidence: float, is_final: bool = True):
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
                "is_final": is_final,
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
                target_base_model = "skplanet/dialog-koelectra-small-discriminator"
            else:
                target_base_model = base_model_env
            LOGGER.info("[Init] 🚀 KoElectra 모델 선택됨")
            
            # 🔥 KoElectra 로컬 모델 경로 처리
            if model_path_env and model_path_env.strip():
                base_dir = os.path.dirname(os.path.abspath(__file__))
                full_model_path = os.path.join(base_dir, model_path_env)
                
                if os.path.exists(full_model_path):
                    target_model_path = full_model_path
                    LOGGER.info(f"[Init] 📂 KoElectra 로컬 모델 경로 확인됨: {target_model_path}")
                else:
                    LOGGER.warning(f"[Init] ⚠️ 로컬 모델 경로를 찾을 수 없음: {full_model_path}")
                    LOGGER.info("[Init] 💡 Hugging Face에서 Base 모델 다운로드")
                    target_model_path = ""  # Hugging Face에서 다운로드
            else:
                target_model_path = ""  # Hugging Face에서 다운로드
                LOGGER.info("[Init] 💡 MODEL_PATH가 설정되지 않음. Hugging Face에서 Base 모델 다운로드")
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

        # 2. Threshold 설정 (환경 변수 우선, 없으면 DB, 없으면 모델별 기본값)
        threshold_env = os.getenv("CLASSIFIER_THRESHOLD", "").strip()
        if threshold_env:
            try:
                target_threshold = float(threshold_env)
                if target_threshold < 0.0 or target_threshold > 1.0:
                    raise ValueError("Threshold must be between 0.0 and 1.0")
                LOGGER.info(f"[Init] 🔧 환경 변수에서 Threshold 설정: {target_threshold}")
            except ValueError as e:
                LOGGER.warning(f"[Init] ⚠️ 잘못된 CLASSIFIER_THRESHOLD 값: {threshold_env}. DB 또는 기본값 사용. ({e})")
                threshold_env = ""  # 잘못된 값이므로 DB에서 가져오도록 함
        
        # [Task 46] 환경 변수가 없으면 Supabase에서 Threshold 설정 로드
        if not threshold_env and supabase:
            LOGGER.info("[Init] 🔄 Fetching settings from Supabase...")
            db_threshold = None
            
            if model_type_env == "koelectra":
                db_threshold = get_app_setting("threshold_koelectra")
            else:
                db_threshold = get_app_setting("threshold_kanana")
                
            if db_threshold:
                try:
                    target_threshold = float(db_threshold)
                    LOGGER.info(f"[Init] 🔧 Threshold updated from DB: {target_threshold}")
                except ValueError:
                    LOGGER.warning(f"[Init] ⚠️ Invalid threshold value in DB: {db_threshold}")
                    # 모델별 기본값으로 폴백
                    if model_type_env == "koelectra":
                        target_threshold = 0.5
                    else:
                        target_threshold = 0.22
            else:
                # DB에서 가져올 수 없으면 모델별 기본값 사용
                if model_type_env == "koelectra":
                    target_threshold = 0.5  # KoElectra threshold
                else:
                    target_threshold = 0.22  # Kanana threshold
                LOGGER.info(f"[Init] 💡 Threshold 기본값 사용 (모델 타입: {model_type_env})")
        elif not threshold_env:
            # Supabase가 없거나 환경 변수가 없으면 모델별 기본값 사용
            if model_type_env == "koelectra":
                target_threshold = 0.5  # KoElectra threshold
            else:
                target_threshold = 0.22  # Kanana threshold
            LOGGER.info(f"[Init] 💡 Threshold 기본값 사용 (모델 타입: {model_type_env})")

        # 3. Classifier 초기화
        LOGGER.info(f" - Base Model: {target_base_model}")
        LOGGER.info(f" - Adapter Path: {target_model_path if target_model_path else 'None (Base Only)'}")
        LOGGER.info(f" - Quantization: {use_quantization}")
        LOGGER.info(f" - Threshold: {target_threshold}")

        classifier = HarmfulTextClassifier(
            model_path=target_model_path,     # ✅ 절대 경로 또는 빈 문자열
            base_model_name=target_base_model,
            use_quantization=use_quantization,
            threshold=target_threshold  # 🔥 모델별 threshold 적용
        )
        
        app.state.model_type_display = "KoElectra" if model_type_env == "koelectra" else ("Kanana-LoRA" if target_model_path else "Kanana-Base")
        app.state.threshold = target_threshold  # Threshold 값을 app.state에 저장
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

# [Task 46] Admin Router 등록
from routers import admin
app.include_router(admin.router)


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
    
    # Classifier 인스턴스에서 실제 threshold 값 가져오기 (가장 정확함)
    threshold_value = None
    threshold_source = "unknown"
    
    if classifier is not None:
        if hasattr(classifier, 'threshold'):
            threshold_value = classifier.threshold
            threshold_source = "classifier_instance"
            LOGGER.debug(f"[Health] ✅ Classifier 인스턴스에서 threshold 가져옴: {threshold_value}")
        else:
            LOGGER.warning("[Health] ⚠️ Classifier 인스턴스에 threshold 속성이 없습니다.")
    else:
        LOGGER.warning("[Health] ⚠️ Classifier가 초기화되지 않았습니다. app.state에서 threshold 확인")
    
    # Classifier가 없거나 threshold를 가져올 수 없는 경우 app.state에서 가져오기
    if threshold_value is None:
        threshold_value = getattr(app.state, "threshold", None)
        if threshold_value is not None:
            threshold_source = "app_state"
            LOGGER.debug(f"[Health] ✅ app.state에서 threshold 가져옴: {threshold_value}")
    
    response = {
        "status": "ok",
        "stt_service": "Deepgram (nova-2)",
        "ai_model": model_display,
        "mode": "Integrated Filter"
    }
    
    # Threshold 정보 추가
    if threshold_value is not None:
        response["threshold"] = threshold_value
        response["threshold_source"] = threshold_source  # 디버깅용
        LOGGER.info(f"[Health] 📊 Threshold 값 반환: {threshold_value} (출처: {threshold_source})")
    else:
        LOGGER.warning("[Health] ⚠️ Threshold 값을 가져올 수 없습니다.")
    
    return response


@app.get("/keywords")
async def get_keywords():
    # 🔇 키워드 기반 감지 제거됨 - AI 모델만 사용
    return {"keywords": []}


class AnalyzeRequest(BaseModel):
    text: str


class ThresholdUpdateRequest(BaseModel):
    threshold: float


@app.post("/settings/threshold")
async def update_threshold(request: ThresholdUpdateRequest):
    """
    실시간으로 Threshold 값을 변경합니다.
    """
    target_threshold = request.threshold
    
    if target_threshold < 0.0 or target_threshold > 1.0:
        LOGGER.warning(f"[Settings] ⚠️ 잘못된 Threshold 값: {target_threshold}")
        return {"status": "error", "message": "Threshold must be between 0.0 and 1.0"}
    
    # 1. app.state 업데이트
    app.state.threshold = target_threshold
    
    # 2. Classifier 인스턴스 업데이트
    if classifier:
        classifier.threshold = target_threshold
        LOGGER.info(f"[Settings] 🔧 Threshold 업데이트 완료: {target_threshold}")
    else:
        LOGGER.warning("[Settings] ⚠️ Classifier가 초기화되지 않아 app.state만 업데이트했습니다.")
    
    return {
        "status": "ok", 
        "threshold": target_threshold,
        "message": "Threshold updated successfully"
    }


@app.post("/analyze")
async def analyze_text(
    request: AnalyzeRequest,
    background_tasks: BackgroundTasks,  # [Task 46] BackgroundTasks 주입
    threshold: Optional[float] = Query(None, description="Optional threshold override (0.0-1.0). If not provided, uses server's default threshold.")
):
    # 요청 로그
    text_preview = request.text[:50] + "..." if len(request.text) > 50 else request.text
    threshold_log = f", threshold={threshold}" if threshold is not None else ""
    LOGGER.info("[Analyze] 📥 분석 요청 수신: 텍스트 길이=%d, 미리보기=\"%s\"%s", len(request.text), text_preview, threshold_log)
    
    is_harmful_ai = False
    ai_confidence = 0.0
    used_threshold = threshold  # 사용된 threshold 추적
    
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
            ai_confidence = result.confidence
            
            # Threshold 적용 (쿼리 파라미터가 있으면 사용, 없으면 서버 기본값)
            if threshold is not None:
                if threshold < 0.0 or threshold > 1.0:
                    LOGGER.warning("[Analyze] ⚠️ 잘못된 threshold 값: %.2f (0.0-1.0 범위). 서버 기본값 사용.", threshold)
                    threshold = None
            
            if threshold is not None:
                # API에서 제공된 threshold로 재판단
                is_harmful_ai = ai_confidence >= threshold
                used_threshold = threshold
                LOGGER.info("[Analyze] 🔧 API threshold 적용: %.4f >= %.4f = %s", ai_confidence, threshold, is_harmful_ai)
            else:
                # 서버 기본 threshold 사용 (이미 classifier.predict()에서 적용됨)
                is_harmful_ai = result.is_harmful
                used_threshold = classifier.threshold if classifier else None
            
            LOGGER.info(
                "[Analyze] ✅ 분석 완료 (%.3f초): is_harmful=%s, confidence=%.4f (%.1f%%), threshold=%.4f",
                elapsed_time,
                is_harmful_ai,
                ai_confidence,
                ai_confidence * 100,
                used_threshold if used_threshold is not None else 0.0
            )
        except Exception as e:
            LOGGER.error("[Analyze] ❌ AI 분석 실패: %s", e, exc_info=True)

    response = {
        "has_violation": is_harmful_ai,
        "ai_analysis": {
            "is_harmful": is_harmful_ai,
            "confidence": ai_confidence,
            "threshold_used": used_threshold
        } if classifier else None
    }
    
    LOGGER.info(
        "[Analyze] 📤 응답 반환: has_violation=%s, ai_analysis=%s",
        response["has_violation"],
        "있음" if response["ai_analysis"] else "없음"
    )
    
    # [Task 46] 유해 표현 감지 시 또는 모든 요청에 대해 로그 저장
    # 정책: 유해한 경우만 저장하여 DB 용량 절약 (필요시 변경 가능)
    # 주의: classifier가 있을 때만 로그 저장 (정상/유해 모두 저장하려면 조건 제거)
    if classifier:
        model_display = getattr(app.state, "model_type_display", "Unknown")
        # 실제 판단 결과를 저장 (is_harmful_ai 값 사용)
        background_tasks.add_task(
            save_detection_log,
            text=request.text,
            confidence=ai_confidence,
            threshold=used_threshold if used_threshold is not None else (classifier.threshold if classifier else 0.0),
            model=model_display,
            is_harmful=is_harmful_ai,  # 🔥 실제 판단 결과 사용 (하드코딩 제거)
            user_id=None  # 추후 Auth 연동 시 추가
        )
    
    return response


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)