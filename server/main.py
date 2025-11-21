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

from audio.pipeline import AudioProcessingPipeline, PipelineOutput, STTServiceProtocol
from audio.whisper_service import WhisperSTTService, WhisperNotAvailableError
from audio.deepgram_service import DeepgramSTTService, DeepgramNotAvailableError
from nlp.harmful_classifier import HarmfulTextClassifier, TransformersNotAvailableError
from services.paddle_ocr_service import get_ocr_service

# .env 파일 로드 (server 디렉토리 또는 상위 디렉토리에서 찾기)
LOGGER = logging.getLogger("harmful-filter")
logging.basicConfig(level=logging.INFO)

# .env 파일 위치 확인 및 로드
server_env_path = Path(__file__).parent / '.env'
parent_env_path = Path(__file__).parent.parent / '.env'

LOGGER.info("[ENV] 서버 .env 경로 확인 중: %s", server_env_path)
LOGGER.info("[ENV] 부모 .env 경로 확인 중: %s", parent_env_path)
LOGGER.info("[ENV] 서버 .env 존재 여부: %s", server_env_path.exists())
LOGGER.info("[ENV] 부모 .env 존재 여부: %s", parent_env_path.exists())

if server_env_path.exists():
    result = load_dotenv(dotenv_path=server_env_path)
    LOGGER.info("[ENV] ✅ .env file loaded from: %s", server_env_path)
    LOGGER.info("[ENV] load_dotenv 결과: %s", result)
    if result:
        LOGGER.info("[ENV] 로드된 환경 변수 확인:")
        LOGGER.info("[ENV]   - DEEPGRAM_API_KEY: %s", "설정됨" if os.getenv("DEEPGRAM_API_KEY") else "없음")
        LOGGER.info("[ENV]   - PADDLEOCR_LANG: %s", os.getenv("PADDLEOCR_LANG", "없음"))
        LOGGER.info("[ENV]   - PADDLEOCR_USE_GPU: %s", os.getenv("PADDLEOCR_USE_GPU", "없음"))
        LOGGER.info("[ENV]   - SERVER_URL: %s", os.getenv("SERVER_URL", "없음"))
elif parent_env_path.exists():
    result = load_dotenv(dotenv_path=parent_env_path)
    LOGGER.info("[ENV] ✅ .env file loaded from: %s", parent_env_path)
    LOGGER.info("[ENV] load_dotenv 결과: %s", result)
else:
    # 환경변수에서 직접 읽기 시도
    result = load_dotenv()
    LOGGER.warning("[ENV] ⚠️ .env file not found in server/ or parent directory.")
    LOGGER.warning("[ENV] ⚠️ Looking for .env in: %s or %s", server_env_path, parent_env_path)
    LOGGER.warning("[ENV] ⚠️ Using environment variables or system defaults.")
    LOGGER.warning("[ENV] load_dotenv() 결과: %s", result)

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

    # PaddleOCR 서비스는 지연 초기화로 변경됨 (서버 시작 시 블로킹 방지)
    # 첫 OCR 요청 시 자동으로 초기화됩니다.
    try:
        # 서비스 객체만 생성 (실제 모델 로드는 첫 요청 시 수행)
        ocr_service = get_ocr_service()
        LOGGER.info("[INFO] ✅ PaddleOCR Service 객체 생성 완료 (지연 초기화)")
        LOGGER.info("[INFO] ℹ️  첫 OCR 요청 시 모델이 로드됩니다 (약간의 지연 발생 가능)")
    except Exception as ocr_exc:  # pylint: disable=broad-except
        LOGGER.error("[ERROR] PaddleOCR 서비스 객체 생성 실패: %s", ocr_exc, exc_info=True)
        LOGGER.warning("[WARN] OCR 엔드포인트가 동작하지 않을 수 있습니다.")

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

# 요청 로깅 미들웨어 (모든 HTTP 요청 캡처)
# 주의: FastAPI에서 middleware는 역순으로 실행되므로, 이것이 마지막에 실행됨
@app.middleware("http")
async def log_requests(request, call_next):
    """모든 HTTP 요청을 로깅"""
    start_time = time.time()
    
    # 즉시 로그 출력 (요청 도달 확인) - stdout에도 직접 출력
    import sys
    print("=" * 80, file=sys.stderr)
    print("[Request] ========== HTTP 요청 수신 ==========", file=sys.stderr)
    print(f"[Request] 시간: {time.strftime('%Y-%m-%d %H:%M:%S')}", file=sys.stderr)
    print(f"[Request] Method: {request.method}", file=sys.stderr)
    print(f"[Request] URL: {request.url}", file=sys.stderr)
    print(f"[Request] Path: {request.url.path}", file=sys.stderr)
    print(f"[Request] Query: {request.url.query}", file=sys.stderr)
    
    # 로거로도 출력
    LOGGER.info("=" * 80)
    LOGGER.info("[Request] ========== HTTP 요청 수신 ==========")
    LOGGER.info(f"[Request] 시간: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    LOGGER.info(f"[Request] Method: {request.method}")
    LOGGER.info(f"[Request] URL: {request.url}")
    LOGGER.info(f"[Request] Path: {request.url.path}")
    LOGGER.info(f"[Request] Query: {request.url.query}")
    
    # 헤더 일부만 출력 (전체는 너무 길 수 있음)
    headers_dict = dict(request.headers)
    content_type = headers_dict.get('content-type', 'N/A')
    content_length = headers_dict.get('content-length', 'N/A')
    host = headers_dict.get('host', 'N/A')
    user_agent = headers_dict.get('user-agent', 'N/A')[:50]
    
    print(f"[Request] Content-Type: {content_type}", file=sys.stderr)
    print(f"[Request] Content-Length: {content_length}", file=sys.stderr)
    print(f"[Request] Host: {host}", file=sys.stderr)
    print(f"[Request] User-Agent: {user_agent}...", file=sys.stderr)
    
    LOGGER.info(f"[Request] Content-Type: {content_type}")
    LOGGER.info(f"[Request] Content-Length: {content_length}")
    LOGGER.info(f"[Request] Host: {host}")
    LOGGER.info(f"[Request] User-Agent: {user_agent}...")
    
    try:
        response = await call_next(request)
        process_time = time.time() - start_time
        status_code = response.status_code
        
        print(f"[Request] ✅ 응답 완료: HTTP {status_code}, 소요 시간: {process_time:.3f}초", file=sys.stderr)
        print("[Request] =====================================", file=sys.stderr)
        print("=" * 80, file=sys.stderr)
        
        LOGGER.info(f"[Request] ✅ 응답 완료: HTTP {status_code}, 소요 시간: {process_time:.3f}초")
        LOGGER.info("[Request] =====================================")
        LOGGER.info("=" * 80)
        return response
    except Exception as e:
        process_time = time.time() - start_time
        error_type = type(e).__name__
        error_msg = str(e)
        
        print(f"[Request] ❌ 요청 처리 중 오류 발생", file=sys.stderr)
        print(f"[Request] 오류 타입: {error_type}", file=sys.stderr)
        print(f"[Request] 오류 메시지: {error_msg}", file=sys.stderr)
        print(f"[Request] 소요 시간: {process_time:.3f}초", file=sys.stderr)
        print("[Request] =====================================", file=sys.stderr)
        print("=" * 80, file=sys.stderr)
        
        LOGGER.error(f"[Request] ❌ 요청 처리 중 오류 발생", exc_info=True)
        LOGGER.error(f"[Request] 오류 타입: {error_type}")
        LOGGER.error(f"[Request] 오류 메시지: {error_msg}")
        LOGGER.error(f"[Request] 소요 시간: {process_time:.3f}초")
        LOGGER.info("[Request] =====================================")
        LOGGER.info("=" * 80)
        raise


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

    LOGGER.info(f"[Keywords] 키워드 파일 경로: {keywords_path}")
    LOGGER.info(f"[Keywords] 파일 존재 여부: {os.path.exists(keywords_path)}")
    
    if os.path.exists(keywords_path):
        try:
            with open(keywords_path, "r", encoding="utf-8") as file:
                data = json.load(file)
                BAD_WORDS = data.get("keywords", default_keywords)
                LOGGER.info(f"[Keywords] ✅ {len(BAD_WORDS)}개 키워드 로드 완료")
                LOGGER.info(f"[Keywords] 키워드 목록: {BAD_WORDS[:10]}..." if len(BAD_WORDS) > 10 else f"[Keywords] 키워드 목록: {BAD_WORDS}")
                
                # 키워드가 비어있는지 확인
                if not BAD_WORDS or len(BAD_WORDS) == 0:
                    LOGGER.error("[Keywords] ❌ 키워드가 비어있습니다! 기본 키워드를 사용합니다.")
                    BAD_WORDS = default_keywords
        except Exception as exc:  # pylint: disable=broad-except
            LOGGER.error(f"[Keywords] ❌ 키워드 파일 로드 실패: {exc}", exc_info=True)
            LOGGER.warning("[Keywords] 기본 키워드를 사용합니다.")
            BAD_WORDS = default_keywords
    else:
        LOGGER.warning("[Keywords] ⚠️ bad_words.json 파일이 없습니다. 기본 키워드를 사용합니다.")
        BAD_WORDS = default_keywords

        # 폴더 생성 및 기본 파일 저장
        os.makedirs(os.path.dirname(keywords_path), exist_ok=True)
        try:
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
            LOGGER.info(f"[Keywords] ✅ 기본 bad_words.json 파일 생성 완료: {keywords_path}")
        except Exception as exc:  # pylint: disable=broad-except
            LOGGER.error(f"[Keywords] ❌ 키워드 파일 생성 실패: {exc}", exc_info=True)
    
    # 최종 확인
    if not BAD_WORDS or len(BAD_WORDS) == 0:
        LOGGER.error("[Keywords] ❌ CRITICAL: BAD_WORDS가 비어있습니다! 유해 표현 감지가 작동하지 않습니다!")
    else:
        LOGGER.info(f"[Keywords] ✅ 최종 확인: {len(BAD_WORDS)}개 키워드 준비 완료")




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
        LOGGER.debug("[Keywords] 텍스트가 비어있어 키워드 체크를 건너뜁니다.")
        return []

    # BAD_WORDS가 비어있는지 확인
    if not BAD_WORDS or len(BAD_WORDS) == 0:
        LOGGER.error("[Keywords] ❌ BAD_WORDS가 비어있습니다! 키워드 체크를 수행할 수 없습니다.")
        return []

    text_lower = text.lower()
    matched: List[str] = []
    
    LOGGER.debug(f"[Keywords] 키워드 체크 시작: 텍스트='{text[:50]}...', 키워드 수={len(BAD_WORDS)}")

    for bad_word in BAD_WORDS:
        bad_word_lower = bad_word.lower().strip()
        if not bad_word_lower:
            continue
        
        # 1. 간단한 포함 체크 (가장 기본적인 방법)
        if bad_word_lower in text_lower:
            # 단어 단위 매칭을 위해 정규식 사용
            # 공백이나 특수문자, 문자열 시작/끝으로 구분된 키워드만 매칭
            # 한글의 경우 단어 경계가 제대로 작동하지 않을 수 있으므로
            # 공백이나 특수문자, 문자열 시작/끝으로 구분된 키워드만 매칭
            # \W는 단어 문자가 아닌 문자 (공백, 특수문자 등)
            word_boundary_pattern = r'(^|[\s\W])' + re.escape(bad_word_lower) + r'([\s\W]|$)'
            
            if re.search(word_boundary_pattern, text_lower):
                if bad_word not in matched:
                    matched.append(bad_word)
                    LOGGER.warning("[ALERT] 🚨 키워드 감지: '%s' in '%s'", bad_word, text)
            # 키워드가 전체 텍스트와 정확히 일치하는 경우
            elif bad_word_lower == text_lower.strip():
                if bad_word not in matched:
                    matched.append(bad_word)
                    LOGGER.warning("[ALERT] 🚨 키워드 감지 (정확 일치): '%s' in '%s'", bad_word, text)
            # 공백이 있는 키워드의 경우 공백 무시하고 매칭
            elif bad_word_lower.replace(" ", "") in text_lower.replace(" ", ""):
                if bad_word not in matched:
                    matched.append(bad_word)
                    LOGGER.warning("[ALERT] 🚨 키워드 감지 (공백 무시): '%s' in '%s'", bad_word, text)

    if matched:
        LOGGER.warning("[Keywords] ⚠️ 총 {matched_count}개 키워드 매칭: {matched}".format(matched_count=len(matched), matched=matched))
    else:
        LOGGER.debug("[Keywords] ✅ 유해 표현 없음")

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


@app.post("/api/ocr")
async def ocr_endpoint(file: UploadFile = File(...)):
    """
    이미지 OCR 엔드포인트
    
    Request:
        - file: 이미지 파일 (multipart/form-data)
        
    Response:
        {
            "texts": ["추출된", "텍스트", "리스트"],
            "processing_time": 0.123,
            "text_count": 3
        }
    """
    try:
        # 파일 유효성 검사
        LOGGER.info(f"[OCR] OCR 요청 수신: 파일명={file.filename}, Content-Type={file.content_type}")
        if not file.content_type or not file.content_type.startswith("image/"):
            LOGGER.error(f"[OCR] 잘못된 파일 형식: {file.content_type}")
            raise HTTPException(status_code=400, detail="이미지 파일만 업로드 가능합니다")
        
        # 이미지 로드
        image_data = await file.read()
        LOGGER.info(f"[OCR] 이미지 데이터 수신 완료: {len(image_data)} bytes")
        try:
            image = Image.open(io.BytesIO(image_data))
            LOGGER.info(f"[OCR] 이미지 로드 완료: 크기={image.size}, 모드={image.mode}")
        except Exception as img_error:
            LOGGER.error(f"[OCR] 이미지 로드 실패: {img_error}", exc_info=True)
            raise HTTPException(status_code=400, detail=f"이미지 로드 실패: {img_error}")
        
        # OCR 실행
        LOGGER.info("[OCR] OCR 서비스 호출 시작...")
        try:
            ocr_service = get_ocr_service()
            texts, processing_time = ocr_service.extract_text(image)
            LOGGER.info(f"[OCR] OCR 처리 완료: {len(texts)}개 텍스트 추출, 소요 시간={processing_time:.3f}초")
        except Exception as ocr_error:
            LOGGER.error(f"[OCR] OCR 처리 실패: {ocr_error}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"OCR 처리 실패: {ocr_error}")
        
        # 결과 반환
        return JSONResponse(content={
            "texts": texts,
            "processing_time": round(processing_time, 3),
            "text_count": len(texts)
        })
        
    except HTTPException:
        # HTTPException은 그대로 전달
        raise
    except Exception as e:
        LOGGER.error(f"[OCR] OCR API 오류: {e}", exc_info=True)
        LOGGER.error(f"[OCR] 오류 타입: {type(e).__name__}")
        raise HTTPException(status_code=500, detail=f"서버 오류: {str(e)}")


@app.post("/api/ocr-and-analyze")
async def ocr_and_analyze_endpoint(file: UploadFile = File(...)):
    """
    이미지 OCR + 유해성 분석 통합 엔드포인트
    
    Request:
        - file: 이미지 파일
        
    Response:
        {
            "texts": ["추출된", "텍스트"],
            "is_harmful": true,
            "harmful_words": ["유해어1"],
            "processing_time": {
                "ocr": 0.123,
                "analysis": 0.045,
                "total": 0.168
            }
        }
    """
    import time
    import sys
    start_total = time.time()
    
    # 즉시 stdout/stderr에도 출력 (로거 문제 확인용)
    print("=" * 60, file=sys.stderr)
    print("[OCR] ========== OCR+분석 요청 시작 ==========", file=sys.stderr)
    print(f"[OCR] 요청 시간: {time.strftime('%Y-%m-%d %H:%M:%S')}", file=sys.stderr)
    print(f"[OCR] 요청 파일명: {file.filename}", file=sys.stderr)
    print(f"[OCR] 요청 Content-Type: {file.content_type}", file=sys.stderr)
    
    LOGGER.info("=" * 60)
    LOGGER.info("[OCR] ========== OCR+분석 요청 시작 ==========")
    LOGGER.info(f"[OCR] 요청 시간: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    LOGGER.info(f"[OCR] 요청 파일명: {file.filename}")
    LOGGER.info(f"[OCR] 요청 Content-Type: {file.content_type}")
    
    try:
        
        # 이미지 로드
        LOGGER.info(f"[OCR] OCR+분석 요청 수신: 파일명={file.filename}, Content-Type={file.content_type}")
        if not file.content_type or not file.content_type.startswith("image/"):
            LOGGER.error(f"[OCR] 잘못된 파일 형식: {file.content_type}")
            raise HTTPException(status_code=400, detail="이미지 파일만 업로드 가능합니다")
        
        image_data = await file.read()
        LOGGER.info(f"[OCR] 이미지 데이터 수신 완료: {len(image_data)} bytes")
        
        try:
            image = Image.open(io.BytesIO(image_data))
            LOGGER.info(f"[OCR] 이미지 로드 완료: 크기={image.size}, 모드={image.mode}")
        except Exception as img_error:
            LOGGER.error(f"[OCR] 이미지 로드 실패: {img_error}", exc_info=True)
            raise HTTPException(status_code=400, detail=f"이미지 로드 실패: {img_error}")
        
        # OCR 실행
        import sys
        ocr_start = time.time()
        
        LOGGER.info("[OCR] OCR 서비스 호출 시작...")
        print("[OCR] OCR 서비스 호출 시작...", file=sys.stderr)
        
        try:
            LOGGER.info("[OCR] get_ocr_service() 호출 중...")
            print("[OCR] get_ocr_service() 호출 중...", file=sys.stderr)
            ocr_service = get_ocr_service()
            LOGGER.info("[OCR] get_ocr_service() 완료")
            print("[OCR] get_ocr_service() 완료", file=sys.stderr)
            
            LOGGER.info("[OCR] ocr_service.extract_text() 호출 중...")
            print("[OCR] ocr_service.extract_text() 호출 중...", file=sys.stderr)
            extract_start = time.time()
            texts, ocr_time = ocr_service.extract_text(image)
            extract_end = time.time()
            
            LOGGER.info(f"[OCR] OCR 처리 완료: {len(texts)}개 텍스트 추출, 소요 시간={ocr_time:.3f}초 (실제: {extract_end - extract_start:.3f}초)")
            print(f"[OCR] OCR 처리 완료: {len(texts)}개 텍스트", file=sys.stderr)
        except Exception as ocr_error:
            ocr_error_time = time.time() - ocr_start
            error_msg = f"OCR 처리 실패 (소요 시간: {ocr_error_time:.3f}초): {ocr_error}"
            LOGGER.error(error_msg, exc_info=True)
            print(f"[OCR] OCR 처리 실패: {error_msg}", file=sys.stderr)
            raise HTTPException(status_code=500, detail=f"OCR 처리 실패: {ocr_error}")
        
        # 텍스트 결합 및 유해성 분석
        combined_text = " ".join(texts) if texts else ""
        LOGGER.info(f"[OCR] 분석할 텍스트: '{combined_text[:100]}{'...' if len(combined_text) > 100 else ''}' (총 {len(combined_text)}자)")
        LOGGER.info(f"[OCR] 현재 BAD_WORDS 상태: {len(BAD_WORDS)}개 키워드 로드됨")
        if not BAD_WORDS or len(BAD_WORDS) == 0:
            LOGGER.error("[OCR] ⚠️ WARNING: BAD_WORDS가 비어있습니다! 유해 표현 감지가 작동하지 않습니다!")
        
        start_analysis = time.time()
        
        # 기존 analyze_text 함수 로직 사용
        matched_keywords = check_keywords(combined_text)
        has_violation = len(matched_keywords) > 0
        analysis_time = time.time() - start_analysis
        
        LOGGER.info(f"[OCR] 키워드 매칭 결과: {len(matched_keywords)}개 키워드 매칭됨")
        if matched_keywords:
            LOGGER.warning(f"[OCR] 🚨 유해 표현 감지됨: {matched_keywords}")
        else:
            LOGGER.info(f"[OCR] ✅ 유해 표현 없음")
        
        total_time = time.time() - start_total
        
        LOGGER.info(f"[OCR] 분석 완료: 유해 표현={'감지됨' if has_violation else '없음'}, 매칭 키워드={matched_keywords}, 총 처리 시간={total_time:.3f}초")
        
        response_data = {
            "texts": texts,
            "is_harmful": has_violation,
            "harmful_words": matched_keywords,
            "processing_time": {
                "ocr": round(ocr_time, 3),
                "analysis": round(analysis_time, 3),
                "total": round(total_time, 3)
            }
        }
        
        LOGGER.info("[OCR] 응답 데이터 준비 완료, JSONResponse 반환 시작...")
        LOGGER.info(f"[OCR] 응답 데이터 크기: {len(str(response_data))} bytes")
        
        response = JSONResponse(content=response_data)
        
        LOGGER.info("[OCR] ========== OCR+분석 요청 완료 ==========")
        LOGGER.info("=" * 60)
        
        return response
        
    except HTTPException as http_exc:
        # HTTPException은 그대로 전달
        LOGGER.error(f"[OCR] HTTPException 발생: {http_exc.status_code} - {http_exc.detail}")
        LOGGER.info("=" * 60)
        raise
    except Exception as e:
        LOGGER.error(f"[OCR] ❌ OCR+분석 API 오류 발생", exc_info=True)
        LOGGER.error(f"[OCR] 오류 타입: {type(e).__name__}")
        LOGGER.error(f"[OCR] 오류 메시지: {str(e)}")
        LOGGER.error(f"[OCR] 오류 전체 정보: {e}")
        LOGGER.info("=" * 60)
        raise HTTPException(status_code=500, detail=f"서버 오류: {str(e)}")


# [Server: server/main.py]
# Phase 1 & 4: WebSocket 엔드포인트 (파이프라인 통합)
@app.websocket("/ws/audio")
async def audio_stream(websocket: WebSocket) -> None:
    """
    오디오 바이너리 데이터를 수신하여 버퍼링/STT/유해성 분류 결과를 반환하는 WebSocket 엔드포인트.
    """

    await websocket.accept()
    # 연결 확인 메시지를 JSON 형식으로 전송
    print("[INFO] connection open", flush=True)
    LOGGER.info("[INFO] connection open")
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

    # 파이프라인 생성 (빠르게 완료되어야 함 - 블로킹 최소화)
    # ✅ 청크 크기 조정: 1초 → 3초로 늘려서 STT 인식률 향상
    # 1초는 너무 짧아서 Deepgram이 텍스트를 반환하지 않는 경우가 많음
    # 3초(48,000 샘플)는 충분한 문맥을 제공하여 인식률이 급상승함
    # 필요시 5초(80,000 샘플)로 더 늘릴 수 있음
    pipeline = AudioProcessingPipeline(
        stt_service=STT_SERVICE,
        classifier=CLASSIFIER,
        sample_rate=16_000,
        chunk_duration_sec=3.0,  # 1.0 → 3.0 (1초 → 3초로 증가)
        keywords=BAD_WORDS,  # 전역 키워드 목록 전달
    )
    
    print("[INFO] Pipeline created, entering receive loop", flush=True)
    LOGGER.info("[INFO] Pipeline created, entering receive loop")

    try:
        print("[INFO] Starting receive loop, waiting for audio data...", flush=True)
        LOGGER.info("[INFO] Starting receive loop, waiting for audio data...")
        while True:
            try:
                # ⚠️ 여기서 블로킹될 수 있습니다 - 데이터가 들어오면 즉시 반환되어야 함
                # receive()는 비동기이므로 블로킹되지 않지만, 데이터가 없으면 대기합니다
                message = await websocket.receive()
            except Exception as receive_err:
                # 연결이 끊어진 경우
                print(f"[INFO] WebSocket receive error (connection closed): {receive_err}", flush=True)
                LOGGER.info("[INFO] WebSocket receive error (connection closed): %s", receive_err)
                break

            if message["type"] == "websocket.disconnect":
                print("[INFO] WebSocket client disconnected: /ws/audio", flush=True)
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
                    print(f"[WARN] Failed to send error message (connection may be closed): {send_err}", flush=True)
                    LOGGER.warning("[WARN] Failed to send error message (connection may be closed): %s", send_err)
                    break
                continue

            # ✅ 오디오 데이터 수신 로그 (INFO 레벨로 변경, print로 즉시 출력)
            # 처음 몇 개만 상세 로그 출력 (너무 많이 출력되지 않도록)
            static_data_count = getattr(audio_stream, '_data_count', 0)
            audio_stream._data_count = static_data_count + 1
            should_log_detail = static_data_count < 5 or static_data_count % 100 == 0
            
            if should_log_detail:
                print(f"[INFO] 데이터 받음! 크기: {len(audio_bytes)} bytes (총 {static_data_count + 1}개)", flush=True)
            LOGGER.info("[INFO] 데이터 받음! 크기: %d bytes", len(audio_bytes))

            try:
                if should_log_detail:
                    print(f"[INFO] 파이프라인 처리 시작... (총 {static_data_count + 1}개 패킷)", flush=True)
                
                result = await pipeline.process_audio(audio_bytes)
                
                if result is None:
                    # 버퍼링 중 - 아직 충분한 데이터가 없음
                    if should_log_detail:
                        print(f"[INFO] 버퍼링 중... (아직 충분한 데이터 없음, 총 {static_data_count + 1}개 패킷)", flush=True)
                    LOGGER.debug("[WebSocket] Buffering audio data: %d bytes (waiting for more data)", len(audio_bytes))
                    try:
                        await websocket.send_json({"status": "buffering", "size": len(audio_bytes)})
                    except Exception as send_err:
                        LOGGER.warning("[WARN] Failed to send buffering status (connection may be closed): %s", send_err)
                        break
                    continue
                
                # 결과가 나왔을 때
                if should_log_detail:
                    print(f"[INFO] ✅ 파이프라인 처리 완료! 텍스트: '{result.text[:50] if result.text else '(empty)'}'", flush=True)

                # 메시지 전송 전 연결 상태 확인
                try:
                    LOGGER.info("[WebSocket] Sending STT result to client: text='%s', is_harmful=%s", 
                               result.text[:50] if result.text else "(empty)", 
                               result.classification.is_harmful)
                    await websocket.send_json(_serialize_pipeline_output(result))
                    LOGGER.info("[WebSocket] ✅ STT result sent successfully")
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
        access_log=True,  # 요청 로그 활성화
    )

