# 작업 21: 텍스트 분석 API

## 상태
🆕 미착수

## 개요
OCR 및 음성 인식 결과를 입력받아 잠재적 유해 표현을 감지하는 텍스트 분석 API를 FastAPI 기반으로 구현합니다. 핵심 규칙/모델 호출 로직을 분리하여 유지보수가 용이하도록 설계합니다.

## 요구사항

### 엔드포인트 정의
- [ ] `POST /api/v1/analyze/text` 엔드포인트 구현
- [ ] 요청 본문에 원문 텍스트, 메타데이터(언어, 출처 등) 포함
- [ ] 응답에 위험 점수, 핵심 탐지 토큰, 설명 메시지 제공

### 비즈니스 로직
- [ ] 핵심 분석 로직을 `services/text_analysis.py` 또는 유사 모듈로 분리
- [ ] 규칙 기반 필터와 모델 기반 분석을 동시에 지원할 수 있는 구조 설계
- [ ] 감지 결과에 대한 신뢰도 및 분류 태그를 함께 반환

### 검증 및 오류 처리
- [ ] 요청 스키마를 Pydantic 모델로 정의
- [ ] 입력 누락/형식 오류 시 422 응답
- [ ] 분석 실패 시 500 대신 커스텀 에러 코드 + 설명 반환

## 의존성
- `docs/20-fastapi-setup.md`에서 정의한 FastAPI 기본 구조
- 잠재적 모델 서버 또는 로컬 추론 모듈
- `PROJECT_SPEC.md`의 유해 표현 카테고리 정의

## 관련 파일
- `backend/app/api/v1/text_analysis.py`
- `backend/app/schemas/text_analysis.py`
- `backend/app/services/text_analysis.py`
- `docs/22-ipc-server-handlers.md`

## 구현 계획

### 1. 스키마 정의
```python
# backend/app/schemas/text_analysis.py
from pydantic import BaseModel
from typing import List

class TextAnalyzeRequest(BaseModel):
    text: str
    language: str | None = None
    source: str | None = None

class TextAnalyzeResponse(BaseModel):
    risk_score: float
    categories: List[str]
    highlights: List[str]
    explanation: str | None = None
```

### 2. 서비스 작성
```python
# backend/app/services/text_analysis.py
def analyze_text(payload: TextAnalyzeRequest) -> TextAnalyzeResponse:
    # TODO: 규칙 기반 및 모델 기반 분석 결합
    ...
```

### 3. 라우터 연결
```python
# backend/app/api/v1/text_analysis.py
from fastapi import APIRouter, Depends

router = APIRouter()

@router.post("/analyze/text", response_model=TextAnalyzeResponse)
async def analyze_text_endpoint(payload: TextAnalyzeRequest):
    return analyze_text(payload)
```

## 수락 기준
- ✅ FastAPI 서버에서 `/api/v1/analyze/text` 호출 시 정상 응답
- ✅ 요청/응답 스키마가 문서화되어 있고 자동 스웨거에 노출
- ✅ 서비스 레이어가 테스트 가능한 구조로 분리
- ✅ 오류 상황에 대한 적절한 응답 코드와 메시지 제공

## 테스트 방법
1. `pytest` 또는 `httpx` 기반 유닛 테스트로 정상/오류 케이스 검증
2. 로컬 서버에서 Postman/HTTPie로 엔드포인트 호출
3. 경계 케이스(빈 문자열, 과도한 길이 등) 테스트

## 다음 작업
- [작업 22: IPC 서버 핸들러](./22-ipc-server-handlers.md)
- 모델/규칙 데이터 업데이트 전략 수립
- 결과 캐싱/레이트 리밋 도입 검토

