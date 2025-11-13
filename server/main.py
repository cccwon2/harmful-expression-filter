from contextlib import asynccontextmanager
from typing import List, Optional
import asyncio
import json
import logging
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from audio.pipeline import AudioProcessingPipeline, PipelineOutput, STTServiceProtocol
from audio.whisper_service import WhisperSTTService, WhisperNotAvailableError
from audio.deepgram_service import DeepgramSTTService, DeepgramNotAvailableError
from nlp.harmful_classifier import HarmfulTextClassifier, TransformersNotAvailableError

# .env 파일 로드 (server 디렉토리 또는 상위 디렉토리에서 찾기)
LOGGER = logging.getLogger("harmful-filter")
logging.basicConfig(level=logging.INFO)

# .env 파일 위치 확인 및 로드
server_env_path = Path(__file__).parent / '.env'
parent_env_path = Path(__file__).parent.parent / '.env'

if server_env_path.exists():
    load_dotenv(dotenv_path=server_env_path)
    LOGGER.info("[INFO] ✅ .env file loaded from: %s", server_env_path)
elif parent_env_path.exists():
    load_dotenv(dotenv_path=parent_env_path)
    LOGGER.info("[INFO] ✅ .env file loaded from: %s", parent_env_path)
else:
    # 환경변수에서 직접 읽기 시도
    load_dotenv()
    LOGGER.warning("[WARN] ⚠️ .env file not found in server/ or parent directory.")
    LOGGER.warning("[WARN] ⚠️ Looking for .env in: %s or %s", server_env_path, parent_env_path)
    LOGGER.warning("[WARN] ⚠️ Using environment variables or system defaults.")

# ============== 전역 변수 ==============
BAD_WORDS: List[str] = []
STT_SERVICE: Optional[STTServiceProtocol] = None  # DeepgramSTTService 또는 WhisperSTTService
CLASSIFIER: Optional[HarmfulTextClassifier] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global STT_SERVICE, CLASSIFIER  # pylint: disable=global-statement

    load_keywords()

    try:
        # Deepgram STT 서비스 초기화
        STT_SERVICE = DeepgramSTTService(language="ko", model="nova-2")
        LOGGER.info("[INFO] ✅ Deepgram STT Service initialized successfully")
    except DeepgramNotAvailableError as exc:
        LOGGER.warning("[WARN] Deepgram STT 초기화 실패: %s", exc)
        LOGGER.warning("[WARN] Whisper STT로 대체 시도...")
        try:
            STT_SERVICE = WhisperSTTService(model_name="base")
            LOGGER.info("[INFO] ✅ Whisper STT Service initialized successfully (fallback)")
        except WhisperNotAvailableError as whisper_exc:
            LOGGER.warning("[WARN] Whisper STT 초기화 실패: %s", whisper_exc)
            STT_SERVICE = None
        except Exception as whisper_exc:  # pylint: disable=broad-except
            LOGGER.error("[ERROR] Whisper STT 초기화 중 예상치 못한 오류: %s", whisper_exc, exc_info=True)
            STT_SERVICE = None
    except Exception as exc:  # pylint: disable=broad-except
        LOGGER.error("[ERROR] Deepgram STT 초기화 중 예상치 못한 오류: %s", exc, exc_info=True)
        STT_SERVICE = None

    try:
        CLASSIFIER = HarmfulTextClassifier()
        LOGGER.info("[INFO] ✅ Harmful Text Classifier initialized successfully")
    except TransformersNotAvailableError as exc:
        LOGGER.warning("[WARN] KoELECTRA 분류기 초기화 실패: %s", exc)
        CLASSIFIER = None
    except Exception as exc:  # pylint: disable=broad-except
        LOGGER.error("[ERROR] Classifier 초기화 중 예상치 못한 오류: %s", exc, exc_info=True)
        CLASSIFIER = None

    LOGGER.info("[INFO] FastAPI server startup complete")
    LOGGER.info("[INFO] Server URL: http://127.0.0.1:8000")
    LOGGER.info("[INFO] API docs: http://127.0.0.1:8000/docs")
    LOGGER.info("[INFO] STT Service: %s", "✅ Loaded" if STT_SERVICE is not None else "❌ Not loaded")
    LOGGER.info("[INFO] Classifier: %s", "✅ Loaded" if CLASSIFIER is not None else "❌ Not loaded")
    yield


app = FastAPI(
    title="유해 표현 필터 API",
    version="1.0.0",
    description="텍스트 및 음성 기반 유해 표현 감지 시스템",
    lifespan=lifespan,
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============== 데이터 모델 ==============
class HealthResponse(BaseModel):
    status: str
    keywords_loaded: int
    stt_loaded: bool = False
    ai_model_loaded: bool = False


class AnalyzeRequest(BaseModel):
    text: str
    use_ai: bool = False  # 확장용 플래그


class AnalyzeResponse(BaseModel):
    has_violation: bool
    confidence: float
    matched_keywords: List[str]
    method: str
    processing_time: float

def load_keywords() -> None:
    """키워드 파일 로드"""
    global BAD_WORDS
    keywords_path = os.path.join(os.path.dirname(__file__), "data", "bad_words.json")

    default_keywords = [
        "ㅅㅂ",
        "ㅂㅅ",
        "시발",
        "씨발",
        "시 발",
        "씨 발",
        "개새",
        "개 새",
        "ㄱㅅㄲ",
        "병신",
        "병 신",
        "ㅄ",
        "새끼",
        "새 끼",
        "간나",
        "간 나",
        "개놈",
        "개 놈",
        "미친",
        "미 친",
        "미친놈",
        "미친 놈",
        "미 친 놈",
    ]

    if os.path.exists(keywords_path):
        try:
            with open(keywords_path, "r", encoding="utf-8") as file:
                data = json.load(file)
                BAD_WORDS = data.get("keywords", default_keywords)
                print(f"[INFO] {len(BAD_WORDS)} keywords loaded")
        except Exception as exc:  # pylint: disable=broad-except
            print(f"[WARN] failed to load keywords file: {exc}")
            BAD_WORDS = default_keywords
    else:
        print("[WARN] bad_words.json missing. Using default keywords.")
        BAD_WORDS = default_keywords

        # 폴더 생성 및 기본 파일 저장
        os.makedirs(os.path.dirname(keywords_path), exist_ok=True)
        with open(keywords_path, "w", encoding="utf-8") as file:
            json.dump(
                {
                    "keywords": default_keywords,
                    "version": "1.0",
                    "updated_at": "2024-11-11",
                },
                file,
                ensure_ascii=False,
                indent=2,
            )
        print("[INFO] default bad_words.json created")




def check_keywords(text: str) -> List[str]:
    """
    키워드 기반 필터링 (단어 단위 매칭)

    Args:
        text: 분석할 텍스트

    Returns:
        감지된 키워드 목록
    """
    import re
    
    if not text or not text.strip():
        return []

    text_lower = text.lower()
    matched: List[str] = []

    for bad_word in BAD_WORDS:
        bad_word_lower = bad_word.lower().strip()
        if not bad_word_lower:
            continue
        
        # 단어 단위 매칭을 위해 정규식 사용
        # 공백이나 특수문자, 문자열 시작/끝으로 구분된 키워드만 매칭
        # 한글의 경우 단어 경계가 제대로 작동하지 않을 수 있으므로
        # 공백이나 특수문자, 문자열 시작/끝으로 구분된 키워드만 매칭
        # \W는 단어 문자가 아닌 문자 (공백, 특수문자 등)
        word_boundary_pattern = r'(^|[\s\W])' + re.escape(bad_word_lower) + r'([\s\W]|$)'
        
        if re.search(word_boundary_pattern, text_lower):
            matched.append(bad_word)
            LOGGER.warning("[ALERT] Keyword detected: '%s' in '%s'", bad_word, text)
        # 키워드가 전체 텍스트와 정확히 일치하는 경우
        elif bad_word_lower == text_lower.strip():
            matched.append(bad_word)
            LOGGER.warning("[ALERT] Keyword detected (exact match): '%s' in '%s'", bad_word, text)

    return matched


# ============== API 엔드포인트 ==============
@app.get("/")
async def root():
    return {
        "message": "유해 표현 필터 API",
        "status": "running",
        "version": "1.0.0",
        "endpoints": {
            "health": "GET /health",
            "docs": "GET /docs",
            "keywords": "GET /keywords",
        },
    }


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(
        status="ok",
        keywords_loaded=len(BAD_WORDS),
        stt_loaded=STT_SERVICE is not None,
        ai_model_loaded=CLASSIFIER is not None,
    )


@app.get("/keywords")
async def get_keywords():
    return {
        "total": len(BAD_WORDS),
        "keywords": BAD_WORDS,
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_text(request: AnalyzeRequest) -> AnalyzeResponse:
    """
    텍스트를 분석하여 유해 표현 감지
    """

    start_time = time.perf_counter()

    try:
        text = request.text.strip()
    except AttributeError as exc:
        raise HTTPException(status_code=400, detail="text 필드는 문자열이어야 합니다.") from exc

    if not text:
        return AnalyzeResponse(
            has_violation=False,
            confidence=0.0,
            matched_keywords=[],
            method="no_text",
            processing_time=0.0,
        )

    matched_keywords = check_keywords(text)
    has_violation = len(matched_keywords) > 0
    
    # 상세한 디버깅 로그 추가
    if has_violation:
        LOGGER.warning("[ALERT] ⚠️ HARMFUL DETECTED - Text: '%s', Matched keywords: %s", 
                      text, matched_keywords)
    else:
        LOGGER.info("[INFO] ✅ No harmful content - Text: '%s', Matched keywords: %s", 
                   text, matched_keywords)

    processing_time_ms = (time.perf_counter() - start_time) * 1000

    return AnalyzeResponse(
        has_violation=has_violation,
        confidence=1.0 if has_violation else 0.0,
        matched_keywords=matched_keywords,
        method="keyword",
        processing_time=processing_time_ms,
    )


@app.get("/test")
async def test_text_simple(text: str):
    """
    GET으로 간단히 테스트하는 엔드포인트
    """

    matched = check_keywords(text)
    return {
        "text": text,
        "has_violation": len(matched) > 0,
        "matched_keywords": matched,
    }


# [Server: server/main.py]
# Phase 1 & 4: WebSocket 엔드포인트 (파이프라인 통합)
@app.websocket("/ws/audio")
async def audio_stream(websocket: WebSocket) -> None:
    """
    오디오 바이너리 데이터를 수신하여 버퍼링/STT/유해성 분류 결과를 반환하는 WebSocket 엔드포인트.
    """

    await websocket.accept()
    # 연결 확인 메시지를 JSON 형식으로 전송
    await websocket.send_json({
        "status": "connected",
        "message": "Connected (Deepgram STT)",
        "stt_service": "Deepgram" if STT_SERVICE else "None"
    })

    # STT 서비스가 없으면 에러 반환
    if STT_SERVICE is None:
        await websocket.send_json(
            {
                "status": "error",
                "detail": "STT 서비스가 초기화되지 않았습니다. 서버 로그를 확인하세요.",
            }
        )
        await websocket.close(code=1011)
        return
    
    # Classifier가 없으면 키워드 기반 분류만 사용
    if CLASSIFIER is None:
        LOGGER.warning("[WARN] Classifier가 없어 키워드 기반 분류만 사용합니다.")
    
    # 키워드 목록 확인 및 로그
    LOGGER.info("[INFO] Creating pipeline with %d keywords", len(BAD_WORDS))
    if not BAD_WORDS:
        LOGGER.error("[ERROR] BAD_WORDS is empty! Keywords will not be checked.")

    pipeline = AudioProcessingPipeline(
        stt_service=STT_SERVICE,
        classifier=CLASSIFIER,
        sample_rate=16_000,
        chunk_duration_sec=1.0,
        keywords=BAD_WORDS,  # 전역 키워드 목록 전달
    )

    try:
        while True:
            try:
                message = await websocket.receive()
            except Exception as receive_err:
                # 연결이 끊어진 경우
                LOGGER.info("[INFO] WebSocket receive error (connection closed): %s", receive_err)
                break

            if message["type"] == "websocket.disconnect":
                LOGGER.info("[INFO] WebSocket client disconnected: /ws/audio")
                break

            audio_bytes = message.get("bytes")
            if audio_bytes is None:
                try:
                    await websocket.send_json(
                        {
                            "status": "error",
                            "detail": "binary audio data required",
                            "received_type": "text",
                        }
                    )
                except Exception as send_err:
                    LOGGER.warning("[WARN] Failed to send error message (connection may be closed): %s", send_err)
                    break
                continue

            try:
                result = await pipeline.process_audio(audio_bytes)
                if result is None:
                    try:
                        await websocket.send_json({"status": "buffering", "size": len(audio_bytes)})
                    except Exception as send_err:
                        LOGGER.warning("[WARN] Failed to send buffering status (connection may be closed): %s", send_err)
                        break
                    continue

                # 메시지 전송 전 연결 상태 확인
                try:
                    await websocket.send_json(_serialize_pipeline_output(result))
                except Exception as send_err:
                    # 연결이 끊어진 경우 - 정상적인 종료로 처리
                    LOGGER.info("[INFO] WebSocket connection closed while sending result: %s", send_err)
                    break
            except Exception as process_err:
                LOGGER.error("[ERROR] Error processing audio: %s", process_err, exc_info=True)
                try:
                    await websocket.send_json(
                        {
                            "status": "error",
                            "detail": f"Audio processing error: {str(process_err)}",
                        }
                    )
                except Exception:
                    # 연결이 끊어진 경우 - 더 이상 메시지를 보낼 수 없음
                    LOGGER.info("[INFO] WebSocket connection closed, cannot send error message")
                    break

    except WebSocketDisconnect:
        LOGGER.info("[INFO] WebSocket client disconnected: /ws/audio")
    except Exception as exc:  # pylint: disable=broad-except
        # 예상치 못한 오류
        LOGGER.error("[ERROR] audio_stream 처리 중 오류: %s", exc, exc_info=True)
        try:
            await websocket.close(code=1011, reason="audio_stream internal error")
        except Exception:
            # 이미 연결이 끊어진 경우 무시
            pass


def _serialize_pipeline_output(result: PipelineOutput) -> dict:
    """
    파이프라인 처리 결과를 WebSocket 응답용 딕셔너리로 변환.
    """

    classification = result.classification
    
    # 디버깅: 직렬화 전 결과 확인
    LOGGER.info(
        "[DEBUG] Serializing result: text='%s', is_harmful=%s, confidence=%.2f",
        result.text[:50] if result.text else "(empty)",
        classification.is_harmful,
        classification.confidence
    )
    
    response = {
        "status": "ok",
        "text": result.text or "",  # None이면 빈 문자열
        "is_harmful": int(classification.is_harmful),
        "confidence": float(classification.confidence),
        "raw_text": classification.text or "",  # None이면 빈 문자열
        "audio_duration_sec": float(result.audio_duration_sec),
        "processing_time_ms": float(result.processing_time_ms),
        "timestamp": time.time(),
    }
    
    return response


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        log_level="info",
        reload=True,
    )

