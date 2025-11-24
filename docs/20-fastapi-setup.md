# 작업 20: FastAPI 기본 구조

## 상태
✅ 완료

## 개요
Electron 클라이언트와 연동할 백엔드 API 서버의 토대를 FastAPI로 구성합니다. 프로젝트의 서비스 로직이 확장될 수 있도록 공통 설정, 환경 관리, 라우팅 규칙을 정리하고 기본 헬스체크 엔드포인트를 제공합니다.

## 요구사항

### 프로젝트 구조
- [x] `server/` 디렉터리 생성 및 FastAPI 애플리케이션 초기화
- [x] `server/main.py`에 FastAPI 인스턴스, 기본 미들웨어, 베이스 라우터 정의
- [ ] `server/config.py` 또는 환경 변수 로딩 모듈 추가 (차후 작업)
- [x] `server/requirements.txt`에 FastAPI, Uvicorn 등 필수 패키지 명시

### 공통 미들웨어 및 설정
- [x] CORS 정책 정의(개발용은 `localhost` 허용, 배포용은 별도 설정)
- [ ] 로깅 포맷 및 레벨 기본값 지정
- [ ] 예외 처리 핸들러 템플릿 추가(HTTPException, ValidationError 등)

### 베이스 라우팅
- [x] `/health` 엔드포인트 구현
- [ ] 버전 관리 전략(`/api/v1`) 결정 및 베이스 라우터 작성
- [x] API 문서(스웨거/Redoc) 접근 경로 확인

## 의존성
- **Python 3.10+** (venv310 가상환경 사용 필수)
- FastAPI, Uvicorn
- pydantic, python-dotenv
- [PROJECT_SPEC.md](./PROJECT_SPEC.md)의 서버 아키텍처 섹션

## ⚠️ 중요: 가상환경 관리

**server 폴더의 모든 Python 라이브러리는 `venv310` 가상환경에서만 관리합니다.**

### 가상환경 활성화
```bash
cd server

# Windows
venv310\Scripts\activate

# Linux/Mac
source venv310/bin/activate
```

### 의존성 설치
```bash
# venv310 활성화 후
.\venv310\Scripts\python.exe -m pip install -r requirements.txt

# 또는 활성화된 상태에서
pip install -r requirements.txt
```

### 서버 실행
```bash
# venv310 활성화 후
uvicorn main:app --reload
```

### 환경 변수 설정

`server/.env` 파일을 생성하여 다음 환경 변수를 설정합니다:

```env
# Deepgram API Key (STT용)
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# [AI 모델 설정]

# 모델 타입 (koelectra, kanana 기본값)
# - koelectra: KoElectra 모델 사용 (빠른 추론, 경량)
# - kanana: Kanana Nano 모델 사용 (더 정확하지만 느림)
MODEL_TYPE=koelectra

# Base 모델 (Hugging Face 모델 이름)
# KoElectra 사용 시:
BASE_MODEL_NAME=monologg/koelectra-base-v3-discriminator
# Kanana 사용 시:
#BASE_MODEL_NAME=kakaocorp/kanana-nano-2.1b-instruct

# 학습된 LoRA 어댑터 경로 (server 폴더 기준 상대 경로)
# Base 모델만 사용하려면 비워두거나 주석 처리
#MODEL_PATH=models/kanana-lora-v1
MODEL_PATH=
```

**모델 선택 가이드**:
- **KoElectra**: 빠른 추론 속도, 경량 모델 (약 110M 파라미터) - **권장**
- **Kanana Base**: 더 정확하지만 느림 (약 2.1B 파라미터)
- **Kanana LoRA**: 가장 정확하지만 느림 (LoRA 어댑터 필요)

## 관련 파일
- `backend/app/main.py`
- `backend/app/config.py`
- `backend/requirements.txt` 또는 `pyproject.toml`
- `docs/21-text-analysis-api.md`

## 구현 계획

### 1. 초기 프로젝트 스캐폴딩
```bash
cd server

# venv310 가상환경 사용 (이미 생성되어 있음)
# Windows
venv310\Scripts\activate
# Linux/Mac
# source venv310/bin/activate

# 의존성 설치
.\venv310\Scripts\python.exe -m pip install -r requirements.txt
```

### 2. 기본 애플리케이션 작성
```python
# server/main.py
from fastapi import FastAPI

app = FastAPI(title="유해 표현 필터 API")

@app.get("/health")
def health_check():
    return {"status": "ok"}
```

### 3. 실행 및 검증
```bash
uvicorn main:app --reload
```

:::note
Windows 환경에서 `pydantic==2.5.0` 설치 시 Rust toolchain 의존성 때문에 빌드 오류가 발생해 `2.10.4`로 상향 고정했습니다.
:::

## 수락 기준
- ✅ FastAPI 앱이 `/health`에서 200 OK 응답
- ⚠️ 환경변수 기반 설정 모듈은 차후 도입 예정
- ✅ 기본 CORS 정책 적용
- ✅ 프로젝트 문서에 실행 방법 명시

## 테스트 방법
1. 로컬에서 `uvicorn` 실행 후 브라우저/HTTP 클라이언트로 `/health` 호출
2. 환경 변수 변경 시 앱이 적절히 반영하는지 확인
3. CORS 설정이 Electron 렌더러 도메인을 허용하는지 테스트

## 다음 작업
- [작업 21: 텍스트 분석 API](./21-text-analysis-api.md)
- 인증/인가 전략 논의
- 배포 스크립트(예: Docker, Railway 등) 기획

