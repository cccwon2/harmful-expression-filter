# 작업 21: 텍스트 분석 API

## 상태
✅ 완료

## 개요
OCR 및 음성 인식 결과를 입력받아 잠재적 유해 표현을 감지하는 텍스트 분석 API를 FastAPI 기반으로 구현합니다. 핵심 규칙/모델 호출 로직을 분리하여 유지보수가 용이하도록 설계합니다.

## 요구사항

### 엔드포인트 정의
- [x] `POST /analyze` 엔드포인트 구현 (차후 `/api/v1/` 네임스페이스 도입 예정)
- [x] 요청 본문에 원문 텍스트, AI 사용 여부 플래그 포함
- [x] 응답에 감지 여부, 신뢰도, 매칭 키워드, 처리 시간(ms) 제공

### 비즈니스 로직
- [x] 키워드 기반 필터링 로직을 `check_keywords` 함수로 분리
- [ ] 모델 기반 분석 확장 포인트(`use_ai` 플래그) 추후 구현
- [x] 감지 결과에 대한 신뢰도 및 사용된 방법을 함께 반환

### 검증 및 오류 처리
- [x] 요청/응답 모델을 Pydantic으로 정의
- [x] 빈 문자열 처리 및 400/500 오류 메시지 제공
- [ ] 예외 처리 템플릿 고도화(커스텀 에러 코드) 추후 진행

## 의존성
- `docs/20-fastapi-setup.md`에서 정의한 FastAPI 기본 구조
- `server/data/bad_words.json` 키워드 목록
- `docs/PROJECT_SPEC.md`의 유해 표현 카테고리 정의

## 관련 파일
- `server/main.py`
- `server/tests/call_api.py` (수동 검증 스크립트)
- `docs/22-ipc-server-handlers.md`

## 구현 계획

### 1. 데이터 모델 및 로직 추가
```python
# server/main.py (발췌)
class AnalyzeRequest(BaseModel):
    text: str
    use_ai: bool = False

class AnalyzeResponse(BaseModel):
    has_violation: bool
    confidence: float
    matched_keywords: List[str]
    method: str
    processing_time: float

def check_keywords(text: str) -> List[str]:
    matched = []
    for bad_word in BAD_WORDS:
        if bad_word.lower() in text.lower():
            matched.append(bad_word)
    return matched

@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_text(request: AnalyzeRequest) -> AnalyzeResponse:
    ...
```

### 2. 개발 편의용 테스트 엔드포인트
```python
@app.get("/test")
async def test_text_simple(text: str):
    matched = check_keywords(text)
    return {"text": text, "has_violation": len(matched) > 0, "matched_keywords": matched}
```

### 3. CLI 검증 스크립트
```python
# server/tests/call_api.py
call("/analyze", {"text": "안녕하세요 반갑습니다", "use_ai": False})
call("/analyze", {"text": "욕설 비방 혐오", "use_ai": False})
```

## 수락 기준
- ✅ `/analyze` 호출 시 감지 여부와 매칭 키워드가 올바르게 반환
- ✅ Swagger UI에 요청/응답 모델 노출
- ✅ 빈 문자열 및 잘못된 입력 처리
- ✅ 간단한 GET `/test` 엔드포인트로 육안 검증 가능

## 테스트 방법
1. `server/tests/call_api.py` 실행으로 샘플 요청 검증
2. `curl` 또는 Swagger UI에서 정상/위반 텍스트 테스트
3. 빈 문자열, 다중 키워드, 영문 욕설 등 경계 케이스 호출

## 다음 작업
- [작업 22: IPC 서버 핸들러](./22-ipc-server-handlers.md)
- 모델/규칙 데이터 업데이트 전략 수립 (`use_ai` 활성화)
- 결과 캐싱/레이트 리밋 도입 검토

