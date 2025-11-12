# 서버 STT 서비스 초기화 문제 해결 요약

## 수정 사항

### 1. FastAPI lifespan 설정 수정
- `app.router.lifespan_context = lifespan` 방식에서 `lifespan=lifespan` 파라미터로 변경
- FastAPI 최신 버전에 맞게 수정

### 2. 에러 처리 개선
- Whisper STT 초기화 실패 시 상세한 에러 로그 출력
- Classifier 초기화 실패도 상세 로그 출력

### 3. Pipeline 수정
- `classifier` 파라미터를 `Optional[HarmfulTextClassifier]`로 변경
- Classifier가 None이면 키워드 기반 분류 사용

### 4. WebSocket 엔드포인트 수정
- STT 서비스만 필수로 체크
- Classifier가 없어도 작동 가능하도록 수정

## 수정된 파일

1. `server/main.py`
   - lifespan 함수를 FastAPI 생성자에 전달
   - 전역 변수 정의 순서 수정
   - WebSocket 엔드포인트에서 Classifier 체크 제거

2. `server/audio/pipeline.py`
   - classifier를 Optional로 변경
   - Classifier가 None이면 키워드 기반 분류 사용

## 다음 단계

서버를 재시작하면:
1. STT 서비스 초기화 로그 확인
2. Classifier 초기화 로그 확인
3. WebSocket 연결 테스트

서버 재시작 명령어:
```bash
cd server
python -m uvicorn main:app --reload
```

또는 기존 서버를 중지하고 다시 시작하세요.

