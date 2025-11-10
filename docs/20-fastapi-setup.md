# 작업 20: FastAPI 기본 구조

## 상태
🆕 미착수

## 개요
Electron 클라이언트와 연동할 백엔드 API 서버의 토대를 FastAPI로 구성합니다. 프로젝트의 서비스 로직이 확장될 수 있도록 공통 설정, 환경 관리, 라우팅 규칙을 정리하고 기본 헬스체크 엔드포인트를 제공합니다.

## 요구사항

### 프로젝트 구조
- [ ] `backend/` 디렉터리 생성 및 FastAPI 애플리케이션 초기화
- [ ] `app/main.py`에 FastAPI 인스턴스, 라우터 등록, 기본 설정 정의
- [ ] `app/config.py`에 환경 변수 로딩(`pydantic-settings` 또는 `dotenv`) 추가
- [ ] `requirements.txt` 또는 `pyproject.toml`에 FastAPI, Uvicorn 등 필수 패키지 명시

### 공통 미들웨어 및 설정
- [ ] CORS 정책 정의(개발용은 `localhost` 허용, 배포용은 별도 설정)
- [ ] 로깅 포맷 및 레벨 기본값 지정
- [ ] 예외 처리 핸들러 템플릿 추가(HTTPException, ValidationError 등)

### 베이스 라우팅
- [ ] `/health` 또는 `/status` 엔드포인트 구현
- [ ] 버전 관리 전략(`/api/v1`) 결정 및 베이스 라우터 작성
- [ ] API 문서(스웨거/Redoc) 접근 경로 및 설명 설정

## 의존성
- Python 3.10+
- FastAPI, Uvicorn
- pydantic, python-dotenv (선택)
- [PROJECT_SPEC.md](../PROJECT_SPEC.md)의 서버 아키텍처 섹션

## 관련 파일
- `backend/app/main.py`
- `backend/app/config.py`
- `backend/requirements.txt` 또는 `pyproject.toml`
- `docs/21-text-analysis-api.md`

## 구현 계획

### 1. 초기 프로젝트 스캐폴딩
```bash
mkdir -p backend/app
python -m venv .venv
pip install fastapi uvicorn[standard]
```

### 2. 기본 애플리케이션 작성
```python
# backend/app/main.py
from fastapi import FastAPI

app = FastAPI(title="Harmful Expression Filter API")

@app.get("/health")
def health_check():
    return {"status": "ok"}
```

### 3. 실행 및 검증
```bash
uvicorn app.main:app --reload
```

## 수락 기준
- ✅ FastAPI 앱이 `/health`에서 200 OK 응답
- ✅ 환경변수 기반 설정 모듈 존재
- ✅ 기본 CORS 정책 및 로깅 설정 적용
- ✅ 프로젝트 문서에 실행 방법이 명시됨

## 테스트 방법
1. 로컬에서 `uvicorn` 실행 후 브라우저/HTTP 클라이언트로 `/health` 호출
2. 환경 변수 변경 시 앱이 적절히 반영하는지 확인
3. CORS 설정이 Electron 렌더러 도메인을 허용하는지 테스트

## 다음 작업
- [작업 21: 텍스트 분석 API](./21-text-analysis-api.md)
- 인증/인가 전략 논의
- 배포 스크립트(예: Docker, Railway 등) 기획

