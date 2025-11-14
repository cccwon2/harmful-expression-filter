# Server - FastAPI Backend

FastAPI 기반 백엔드 서버입니다.

## ⚠️ 중요: 가상환경 관리

**server 폴더의 모든 Python 라이브러리는 `venv311` 가상환경에서만 관리합니다.**

다른 가상환경(예: `venv`)을 사용하지 마세요. 모든 의존성은 `venv311`에만 설치합니다.

## 환경 설정

### 가상환경 활성화

```bash
# Windows
venv311\Scripts\activate

# Linux/Mac
source venv311/bin/activate
```

### 의존성 설치

```bash
# venv311 활성화 후
.\venv311\Scripts\python.exe -m pip install -r requirements.txt

# 또는 활성화된 상태에서
pip install -r requirements.txt
```

### 서버 실행

```bash
# venv311 활성화 후
uvicorn main:app --reload
```

## 환경 변수

`.env` 파일을 생성하여 다음 변수를 설정할 수 있습니다:

```env
# 서버 URL (Electron에서 사용)
SERVER_URL=http://127.0.0.1:8000

# PaddleOCR 설정
PADDLEOCR_LANG=korean
PADDLEOCR_USE_GPU=false  # true로 변경 시 GPU 가속 (NVIDIA GPU만 지원)
```

## 주요 기능

- 텍스트 유해성 분석 API (`/analyze`)
- OCR 서비스 (`/api/ocr`, `/api/ocr-and-analyze`)
- 음성 STT API (WebSocket: `/ws/audio`)

## API 문서

서버 실행 후 다음 URL에서 API 문서를 확인할 수 있습니다:
- Swagger UI: http://127.0.0.1:8000/docs
- ReDoc: http://127.0.0.1:8000/redoc

