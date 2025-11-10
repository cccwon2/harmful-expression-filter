from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
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


@app.on_event("startup")
async def startup_event() -> None:
    load_keywords()
    print("[INFO] FastAPI server startup complete")
    print("[INFO] Server URL: http://127.0.0.1:8000")
    print("[INFO] API docs: http://127.0.0.1:8000/docs")


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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        log_level="info",
        reload=True,
    )

