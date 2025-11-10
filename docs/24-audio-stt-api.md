# 작업 24: 음성 STT API

## 상태
🆕 미착수

## 개요
실시간 또는 배치 음성 입력을 텍스트로 변환하는 Speech-to-Text(STT) API를 FastAPI 서버에 도입합니다. 텍스트 분석 파이프라인과 연계될 수 있도록 공통 스키마와 응답 구조를 정의합니다.

## 요구사항

### 엔드포인트 설계
- [ ] `POST /api/v1/analyze/audio` 엔드포인트 구현
- [ ] multipart/form-data 기반 오디오 업로드 혹은 WebSocket/스트리밍 선택
- [ ] 언어, 샘플레이트 등의 메타데이터 포함

### STT 처리 방식
- [ ] 외부 클라우드 서비스(API) 또는 로컬 엔진 선택
- [ ] 비동기 처리(큐 등) 필요 시 상태 폴링/웹훅 전략 정의
- [ ] 긴 오디오를 chunk 단위로 처리하는 로직 설계

### 출력 및 연계
- [ ] 변환된 텍스트를 텍스트 분석 API에 바로 연동하기 위한 데이터 구조 정의
- [ ] 신뢰도 점수 및 타임스탬프 정보 포함 가능성 검토
- [ ] 오류 발생 시 원인(지원하지 않는 포맷 등) 명시

## 의존성
- `docs/20-fastapi-setup.md`
- `docs/21-text-analysis-api.md`
- 음성 인식 서비스 SDK (예: OpenAI Whisper, Google Speech-to-Text, Vosk 등)

## 관련 파일
- `backend/app/api/v1/audio_analysis.py`
- `backend/app/services/audio_stt.py`
- `backend/app/schemas/audio_analysis.py`
- `docs/25-audio-electron.md`

## 구현 계획

### 1. 스키마 정의
```python
# backend/app/schemas/audio_analysis.py
from pydantic import BaseModel

class AudioAnalyzeResponse(BaseModel):
    text: str
    confidence: float | None = None
    segments: list[dict] | None = None
```

### 2. STT 서비스 어댑터
```python
# backend/app/services/audio_stt.py
def transcribe_audio(file_path: str, language: str | None = None) -> AudioAnalyzeResponse:
    # TODO: 선택한 STT 엔진 호출
    ...
```

### 3. 라우터 구현
```python
# backend/app/api/v1/audio_analysis.py
from fastapi import APIRouter, UploadFile, File

@router.post("/analyze/audio", response_model=AudioAnalyzeResponse)
async def analyze_audio(file: UploadFile = File(...)):
    # TODO: 파일 저장 -> STT 호출 -> 응답 반환
    ...
```

## 수락 기준
- ✅ 오디오 업로드가 성공하고 텍스트 변환 결과 반환
- ✅ STT 오류 시 명확한 에러 코드/메시지 제공
- ✅ 텍스트 분석 API와 연계 가능한 데이터 구조 유지
- ✅ 문서에 STT 엔진/비용/제한사항 정리

## 테스트 방법
1. 샘플 오디오 파일로 API 호출 후 응답 검증
2. 지원하지 않는 포맷/언어 입력 시 오류 처리 확인
3. 긴 오디오를 chunk 처리할 경우 순차 호출 테스트
4. 성능/응답 시간 측정 및 캐싱 전략 검토

## 다음 작업
- [작업 25: 음성 Electron 연동](./25-audio-electron.md)
- STT 엔진 교체/다중 엔진 지원 전략 마련
- 실시간 스트리밍 필요 시 WebSocket 확장 검토

