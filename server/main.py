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
# 주의: websockets 14.0+ 버전에서도 호환성을 위해 legacy 모듈 사용
# requirements.txt에 버전을 명시하는 것이 좋습니다.
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
inference_executor: Optional[ThreadPoolExecutor] = None


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
    Task 35: 실시간 스트리밍 및 중간 결과 처리 지원
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
                # 재연결은 상위(audio_stream)에서 처리하도록 함
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

        # 로그 출력 (중간 결과는 클라이언트로 전송 안 함 [Task 35])
        if not is_final: return
        
        # ✅ STT 지연 시간 측정 개선
        # Deepgram WebSocket 스트리밍은 연속적으로 오디오를 전송하므로,
        # 실제 STT 지연은 마지막 오디오 전송부터 결과 수신까지의 시간
        result_time = time.time()
        stt_latency = 0.0
        
        if self.last_audio_time > 0:
            # 마지막 오디오 전송부터 결과 수신까지의 시간
            stt_latency = result_time - self.last_audio_time
            # 오디오 전송 시간 초기화 (다음 측정을 위해)
            self.last_audio_time = 0.0
        elif len(self.audio_chunk_times) > 0:
            # 마지막 오디오 청크 시간 사용 (더 정확한 측정)
            oldest_chunk_time = self.audio_chunk_times[0]
            stt_latency = result_time - oldest_chunk_time
            # 사용한 타임스탬프 제거
            self.audio_chunk_times = []
        
        # ✅ 성능 개선: STT 결과를 즉시 전송하고, AI 판별은 백그라운드에서 처리
        # 모든 STT 결과를 명확하게 표시 (유해/비유해 구분 없이)
        # 참고: 실제 체감 지연은 Deepgram이 문장을 완성할 때까지의 버퍼링 시간이 포함될 수 있음
        if stt_latency > 0:
            print(f"[STT] [확정] {transcript} (서버 측정 STT 지연: {stt_latency:.3f}초)", flush=True)
        else:
            print(f"[STT] [확정] {transcript}", flush=True)
        
        # 1. STT 결과를 즉시 클라이언트로 전송 (AI 판별 대기 없음)
        initial_response = {
            "status": "ok",
            "text": transcript,
            "is_harmful": 0,  # 초기값, AI 판별 후 업데이트
            "confidence": confidence,
            "matched_keywords": [],
            "ai_detection": None,  # 아직 처리 중
            "is_final": is_final,
            "timestamp": time.time(),
            "ai_checked": False,  # 아직 처리 중
        }
        self.result_queue.put_nowait(initial_response)
        
        # 2. AI 판별을 백그라운드 태스크로 실행 (블로킹 없음)
        if self.classifier:
            # 전역 inference_executor 사용
            global inference_executor
            if inference_executor:
                print(f"[AI] AI 판별 시작: '{transcript[:50]}...'", flush=True)
                asyncio.create_task(self._check_harmful_async(transcript, confidence))
            else:
                # classifier는 있지만 executor가 없는 경우, AI 판별 없이 완료 처리
                print(f"[AI] ⚠️ Executor가 없어 AI 판별을 건너뜁니다.", flush=True)
                no_ai_response = {
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
                self.result_queue.put_nowait(no_ai_response)
        else:
            # classifier가 없는 경우, AI 판별 없이 완료 처리
            print(f"[AI] ⚠️ Classifier가 없어 AI 판별을 건너뜁니다.", flush=True)
            no_ai_response = {
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
            self.result_queue.put_nowait(no_ai_response)
    
    async def _check_harmful_async(self, transcript: str, stt_confidence: float):
        """백그라운드에서 유해 표현 판별 수행"""
        try:
            start_time = time.time()
            loop = asyncio.get_event_loop()
            global inference_executor
            print(f"[AI] Executor로 AI 판별 실행 중...", flush=True)
            result = await loop.run_in_executor(
                inference_executor,
                self.classifier.predict,
                transcript
            )
            inference_time = time.time() - start_time
            
            is_harmful_ai = result.is_harmful
            ai_confidence = result.confidence
            model_name = self._get_classifier_model_name()
            
            # AI 판별 결과 항상 로그 출력 (디버깅용)
            status = "🚨 유해" if is_harmful_ai else "✅ 정상"
            print(f"[AI] {status} ({model_name}): '{transcript[:50]}...' (신뢰도: {ai_confidence:.3f}, 추론 시간: {inference_time:.3f}초)", flush=True)
            
            # AI 판별 결과를 별도로 클라이언트에 전송
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
            print(f"[AI] AI 판별 결과 전송: is_harmful={int(is_harmful_ai)}, confidence={ai_confidence:.3f}", flush=True)
            self.result_queue.put_nowait(ai_response)
        except Exception as e:
            LOGGER.error("[AI] 분류 에러: %s", e, exc_info=True)
            print(f"[AI] ❌ 분류 에러 발생: {e}", flush=True)
            # 에러 발생 시에도 클라이언트에 응답 전송 (is_harmful=0)
            error_response = {
                "status": "ok",
                "text": transcript,
                "is_harmful": 0,
                "confidence": stt_confidence,
                "matched_keywords": [],
                "ai_detection": None,
                "is_final": True,
                "timestamp": time.time(),
                "ai_checked": True,
            }
            self.result_queue.put_nowait(error_response)

    def _get_classifier_model_name(self) -> str:
        if not self.classifier:
            return "AI"
        base_name = getattr(self.classifier, "base_model_name", "")
        base_lower = base_name.lower()
        if "koelectra" in base_lower:
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
    # 데모용으로 4개면 충분. 메인 이벤트 루프 간섭 최소화.
    inference_executor = ThreadPoolExecutor(max_workers=4)
    LOGGER.info("[Init] ✅ 모델 추론용 ThreadPoolExecutor 시작 (Workers: 4)")
    
    # 🔇 키워드 로드 주석처리 (AI 모델만 사용)
    # load_keywords()
    
    # ✅ 모델 로드 로직 (Kanana 또는 KoElectra 선택 가능)
    try:
        model_type_env = os.getenv("MODEL_TYPE", "kanana").lower()
        model_path_env = os.getenv("MODEL_PATH", "")
        base_model_env = os.getenv("BASE_MODEL_NAME", "")
        # 양자화 옵션 (기본값: true, GPU 사용 시 성능 개선)
        use_quantization = os.getenv("USE_QUANTIZATION", "true").lower() == "true"
        
        if model_type_env == "koelectra":
            # KoElectra 모델 사용
            if not base_model_env:
                base_model_env = "monologg/koelectra-base-v3-discriminator"
            
            LOGGER.info("[Init] 🚀 KoElectra 모델 로딩 시작...")
            LOGGER.info(f" - Model: {base_model_env}")
            LOGGER.info(f" - Quantization: {use_quantization}")
            
            classifier = HarmfulTextClassifier(
                model_path="",
                base_model_name=base_model_env,
                use_quantization=use_quantization
            )
            LOGGER.info("[Init] ✅ KoElectra 모델 로드 완료!")
            model_type = "KoElectra"
        else:
            # Kanana 모델 사용
            if not base_model_env:
                base_model_env = "kakaocorp/kanana-nano-2.1b-instruct"
            
            use_base_only = not model_path_env or model_path_env.strip() == ""
            
            if use_base_only:
                LOGGER.info("[Init] 🚀 Kanana Base 모델 로딩 시작...")
                LOGGER.info(f" - Base Model: {base_model_env}")
                LOGGER.info(f" - Quantization: {use_quantization}")
                
                classifier = HarmfulTextClassifier(
                    model_path="",
                    base_model_name=base_model_env,
                    use_quantization=use_quantization
                )
                LOGGER.info("[Init] ✅ Kanana-Nano Base 모델 로드 완료!")
                model_type = "Kanana-Base"
            else:
                base_dir = os.path.dirname(__file__)
                full_model_path = os.path.join(base_dir, model_path_env)

                if os.path.exists(full_model_path):
                    LOGGER.info("[Init] 🚀 Kanana LoRA 모델 로딩 시작...")
                    LOGGER.info(f" - Adapter Path: {full_model_path}")
                    LOGGER.info(f" - Quantization: {use_quantization}")
                    
                    classifier = HarmfulTextClassifier(
                        model_path=model_path_env,
                        base_model_name=base_model_env,
                        use_quantization=use_quantization
                    )
                    LOGGER.info("[Init] ✅ Kanana-Nano LoRA 모델 로드 완료!")
                    model_type = "Kanana-LoRA"
                else:
                    LOGGER.warning(f"[Init] ⚠️ 모델 경로를 찾을 수 없음: {full_model_path}")
                    LOGGER.warning("[Init] Base 모델만 사용합니다.")
                    classifier = HarmfulTextClassifier(
                        model_path="",
                        base_model_name=base_model_env,
                        use_quantization=use_quantization
                    )
                    model_type = "Kanana-Base"

    except Exception as e:
        LOGGER.error("[Init] ❌ AI 모델 로드 실패: %s", e, exc_info=True)
        classifier = None
        model_type = "None"

    LOGGER.info(f"[INFO] 🚀 서버 시작 완료 (Deepgram Streaming + {model_type})")
    yield
    
    # ✅ ThreadPoolExecutor 종료
    if inference_executor:
        inference_executor.shutdown(wait=True)
        LOGGER.info("[Init] 🛑 ThreadPoolExecutor 종료")
    
    LOGGER.info("[INFO] 👋 서버 종료")


app = FastAPI(title="OnVoice Filter API", lifespan=lifespan)

# ✅ CORS 설정: Task 37 배포 시 프로덕션 도메인으로 제한 필요
# 현재는 개발 편의를 위해 모든 오리진 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # 프로덕션 예: ["https://app.your-domain.com", "http://localhost:3000"]
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
                    LOGGER.warning("[WS] Deepgram 연결 끊김 감지. 1초 후 재연결 시도...")
                    # ✅ [Backoff] 무한 루프 및 로그 폭주 방지를 위한 대기
                    await asyncio.sleep(1)

                    success = await dg_manager.start()
                    if not success:
                        LOGGER.error("[WS] Deepgram 재연결 실패")
                        await websocket.send_json({
                            "status": "error",
                            "detail": "Deepgram Reconnection Failed"
                        })
                        # 재연결 실패 시 루프 탈출
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
        "keywords_count": 0,  # 🔇 키워드 기능 비활성화 상태
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
    # ✅ AI (Kanana LoRA)만 사용 (비동기 처리)
    is_harmful_ai = False
    ai_confidence = 0.0
    matched = []
    
    if classifier and inference_executor:
        try:
            # ThreadPoolExecutor를 사용하여 블로킹 모델 추론을 비동기로 처리
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                inference_executor,
                classifier.predict,
                request.text
            )
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