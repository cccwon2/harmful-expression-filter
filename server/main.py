from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import time
import json
import os

app = FastAPI(
    title="유해 표현 필터 API",
    version="1.0.0",
    description="텍스트 및 음성 기반 유해 표현 감지 시스템",
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


# ============== 전역 변수 ==============
BAD_WORDS: List[str] = []


def load_keywords() -> None:
    """키워드 파일 로드"""
    global BAD_WORDS
    keywords_path = os.path.join(os.path.dirname(__file__), "data", "bad_words.json")

    default_keywords = [
        "욕설",
        "비방",
        "혐오",
        "ㅅㅂ",
        "ㅂㅅ",
        "시발",
        "씨발",
        "개새",
        "ㄱㅅㄲ",
        "병신",
        "ㅄ",
        "fuck",
        "shit",
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_keywords()
    print("[INFO] FastAPI server startup complete")
    print("[INFO] Server URL: http://127.0.0.1:8000")
    print("[INFO] API docs: http://127.0.0.1:8000/docs")
    yield


app.router.lifespan_context = lifespan


def check_keywords(text: str) -> List[str]:
    """
    키워드 기반 필터링

    Args:
        text: 분석할 텍스트

    Returns:
        감지된 키워드 목록
    """

    text_lower = text.lower()
    matched: List[str] = []

    for bad_word in BAD_WORDS:
        if bad_word.lower() in text_lower:
            matched.append(bad_word)
            print(f"[ALERT] keyword detected: '{bad_word}' in '{text}'")

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
        stt_loaded=False,
        ai_model_loaded=False,
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
# Phase 1: WebSocket 엔드포인트 구축
@app.websocket("/ws/audio")
async def audio_stream(websocket: WebSocket) -> None:
    """
    오디오 바이너리 데이터를 수신하고 에코 형태로 응답을 반환하는 테스트용 WebSocket 엔드포인트.
    """

    # 1) 클라이언트 연결 수락
    await websocket.accept()
    await websocket.send_text("Connected")

    try:
        while True:
            # 2) 클라이언트로부터 메시지 수신 (바이너리/텍스트 모두 처리)
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                raise WebSocketDisconnect()

            audio_bytes = message.get("bytes")
            if audio_bytes is None:
                # 텍스트 메시지가 도착한 경우 에러 메시지 반환
                await websocket.send_json(
                    {
                        "status": "error",
                        "detail": "binary audio data required",
                        "received_type": "text",
                    }
                )
                continue

            # 3) 수신한 바이너리 데이터 크기 정보 반환 (에코 테스트)
            await websocket.send_json(
                {
                    "status": "received",
                    "size": len(audio_bytes),
                }
            )

    except WebSocketDisconnect:
        print("[INFO] WebSocket client disconnected: /ws/audio")
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[ERROR] audio_stream 처리 중 오류: {exc}")
        await websocket.close(code=1011, reason="audio_stream internal error")



if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        log_level="info",
        reload=True,
    )

