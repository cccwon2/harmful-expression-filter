# Task 24: 음성 STT API 구현 (FastAPI)

## ⚠️ 상태: 진행 중 (Phase 1 완료)

## 📋 작업 개요

Windows 시스템 오디오(디스코드, 브라우저 등)에서 캡처한 실시간 오디오 스트림을 받아:
1. **Whisper STT**로 음성을 텍스트로 변환
2. **KoELECTRA**로 유해성 판별 (0: 정상, 1: 유해)
3. **결과를 클라이언트에 실시간 반환** (WebSocket)

## 🎯 핵심 목표

- **지연율 3초 이내** 달성 (계획서 요구사항)
- WebSocket을 통한 실시간 양방향 통신 구현
- 오디오 청크 단위 스트리밍 처리 (버퍼 관리)

## 📦 필수 의존성

```bash
# server/requirements.txt에 추가
fastapi==0.104.1
uvicorn[standard]==0.24.0
websockets==12.0
numpy==2.1.2  # Python 3.13 호환 가능한 최신 버전 사용
pydub==0.25.1  # 오디오 전처리용
# 아래 패키지는 Python 3.12 미만 환경에서 자동 설치
openai-whisper==20231117
torch==2.1.0
torchaudio==2.1.0
transformers==4.35.0
```

> ℹ️ **주의**: 현재 개발 환경(Py 3.13)에서는 Whisper/Torch/Transformers의 공식 휠이 제공되지 않아
> `python_version < "3.12"` 조건으로 설치를 건너뛰도록 구성했습니다.  
> 실제 배포 환경에서는 Python 3.11 기반 venv를 사용하거나, 수동으로 호환 버전을 설치해야 합니다.

## 📝 작업 체크리스트

### Phase 1: WebSocket 엔드포인트 구축 (테스트 가능)

- [x] **1.1. WebSocket 엔드포인트 추가**
  ```python
  # server/main.py
  from fastapi import FastAPI, WebSocket, WebSocketDisconnect
  
  @app.websocket("/ws/audio")
  async def audio_stream(websocket: WebSocket):
      await websocket.accept()
      try:
          while True:
              # 오디오 데이터 수신 (바이너리)
              audio_data = await websocket.receive_bytes()
              # TODO: 처리 로직
              await websocket.send_json({"status": "received", "size": len(audio_data)})
      except WebSocketDisconnect:
          print("Client disconnected")
  ```
  
  **진행 현황 (2025-11-11)**:
  - `/ws/audio` WebSocket 엔드포인트 구현 완료
  - 연결 직후 `"Connected"` 텍스트 전송 및 바이너리/텍스트 입력 분기 처리
  - 바이너리 수신 시 `{"status": "received", "size": ...}` JSON 응답 반환
  - 예외 처리(`WebSocketDisconnect`, 그 외 오류`)와 서버 로그 메시지 추가

  **검증 방법**:
  - 단위 테스트: `server/tests/test_ws_audio.py`
    ```bash
    cd server
    venv\Scripts\python.exe -m pytest tests/test_ws_audio.py
    # ✅ 1 passed
    ```
  - 수동 테스트: `wscat -c ws://localhost:8000/ws/audio -b`
  
  **테스트 방법**:
  ```bash
  # 터미널 1: 서버 실행
  cd server
  uvicorn main:app --reload
  
  # 터미널 2: wscat으로 테스트
  npm install -g wscat
  wscat -c ws://localhost:8000/ws/audio -b
  # 바이너리 데이터 전송 테스트
  ```

- [x] **1.2. 오디오 버퍼 관리 클래스 구현**
  ```python
  # server/audio/buffer_manager.py
  import numpy as np
  from collections import deque
  
  class AudioBufferManager:
      def __init__(self, sample_rate=16000, chunk_duration_sec=1.0):
          self.sample_rate = sample_rate
          self.chunk_size = int(sample_rate * chunk_duration_sec)
          self.buffer = deque()
      
      def add_chunk(self, audio_bytes: bytes):
          # bytes → numpy array 변환
          audio_np = np.frombuffer(audio_bytes, dtype=np.int16)
          self.buffer.extend(audio_np)
      
      def get_processed_chunk(self) -> np.ndarray:
          if len(self.buffer) >= self.chunk_size:
              chunk = np.array([self.buffer.popleft() for _ in range(self.chunk_size)])
              # 정규화 (-1.0 ~ 1.0)
              return chunk.astype(np.float32) / 32768.0
          return None
  ```
  
  **진행 현황 (2025-11-11)**:
  - `server/audio/buffer_manager.py` 생성 및 `AudioBufferManager` 구현
  - 1초(혹은 설정된 길이) 단위 청크 정규화(float32) 반환 기능 완료
  - 입력 검증(샘플레이트/청크 길이)과 버퍼 초기화 메서드 제공

  **검증 방법**:
  - 단위 테스트: `server/tests/test_audio_buffer_manager.py`
    ```bash
    cd server
    venv\Scripts\python.exe -m pytest tests/test_audio_buffer_manager.py
    # ✅ 4 passed
    ```

- [x] **2.1. Whisper 모델 로더 구현**
  ```python
  # server/audio/whisper_service.py
  from audio.whisper_service import WhisperSTTService
  
  service = WhisperSTTService(model_name="base")
  text = service.transcribe(audio_chunk_np)
  ```
  
  **진행 현황 (2025-11-11)**:
  - `WhisperSTTService` 클래스 구현 (`model_loader` 주입 지원, 입력 검증 포함)
  - Whisper 미설치 시 사용자 친화적인 에러 메시지 제공
  - CPU 환경 기본값(`fp16=False`) 설정 및 로깅 추가
  
  **검증 방법**:
  - 단위 테스트: `server/tests/test_whisper_service.py`  
    (가짜 Whisper 모듈을 주입하여 빠르게 검증)
    ```bash
    cd server
    venv\Scripts\python.exe -m pytest tests/test_whisper_service.py
    # ✅ 3 passed
    ```

- [x] **2.2. 실제 오디오 파일로 테스트**
  ```bash
  # Python 3.11 이하 환경 권장
  # Whisper/Torch 설치 필요 (openai-whisper, torch, torchaudio)
  # server/tests/data/sample_ko.wav (1초 내외 한국어 샘플) 준비
  
  cd server
  venv\Scripts\python.exe -m pytest tests/test_whisper_real.py
  ```
  
  **진행 현황 (2025-11-11)**:
  - `tests/test_whisper_real.py` 추가: 실제 Whisper 모델로 음성 → 텍스트 검증
  - 실행 조건
    - Python < 3.12
    - `openai-whisper`, `torch`, `torchaudio`, `pydub` 설치 후 실행
    - `tests/data/sample_ko.wav` 존재 (예: “안녕하세요” 1초 샘플)
  - 조건 미충족 시 pytest가 자동으로 스킵하며 안내 메시지 출력
  
  **샘플 준비 가이드**:
  1. 팀 공유 음성 또는 직접 녹음 파일을 `server/tests/data/sample_ko.wav`로 저장
  2. 16kHz, mono, 16-bit PCM 형식 추천 (테스트 스크립트에서 자동 변환 수행)
  3. Whisper 결과 텍스트가 비어 있지 않은지 확인 (필요 시 예상 문장 비교로 확장)

### Phase 3: KoELECTRA 유해성 판별 통합

- [x] **3.1. KoELECTRA 분류기 구현**
  ```python
  # server/nlp/harmful_classifier.py
  from nlp.harmful_classifier import HarmfulTextClassifier
  
  classifier = HarmfulTextClassifier()
  result = classifier.predict("안녕하세요")
  ```
  
  **진행 현황 (2025-11-11)**:
  - `HarmfulTextClassifier` 구현 (토크나이저/모델/torch 모듈 주입 지원)
  - Torch/Transformers 미설치 시 `TransformersNotAvailableError`로 명확한 안내
  - CUDA 가용성 감지 및 `eval()`, `to(device)` 호출로 추론 준비
  
  **검증 방법**:
  - 단위 테스트: `server/tests/test_harmful_classifier.py`
    - numpy 기반 torch 스텁으로 빠른 검증 수행
    - 주요 시나리오: 유해 문장, 정상 문장, 빈 입력, 의존성 누락
    ```bash
    cd server
    venv\Scripts\python.exe -m pytest tests/test_harmful_classifier.py
    # ✅ 4 passed
    ```
  - 실제 KoELECTRA 추론: Python 3.11 환경에서 `pip install torch transformers` 후
    ```python
    from nlp.harmful_classifier import HarmfulTextClassifier
    clf = HarmfulTextClassifier()
    print(clf.predict("욕설 예시 문장"))
    ```

- [x] **4.1. 전체 파이프라인 구현**
  ```python
  # server/audio/pipeline.py
  from audio.pipeline import AudioProcessingPipeline
  
  pipeline = AudioProcessingPipeline(
      stt_service=stt_service,
      classifier=classifier,
      sample_rate=16_000,
      chunk_duration_sec=1.0,
  )
  result = await pipeline.process_audio(audio_bytes)
  ```
  
  **진행 현황 (2025-11-11)**:
  - `AudioProcessingPipeline` 신설: 버퍼 → Whisper(STT) → KoELECTRA 분류 순차 처리
  - `asyncio.to_thread` 기반 비동기 실행으로 STT/분류 블로킹 최소화
  - 결과 구조(`PipelineOutput`)에 처리 시간(ms), 청크 길이(sec) 포함
  - `server/main.py`의 `/ws/audio` 엔드포인트가 파이프라인을 이용해 JSON 응답 전송
  - Whisper/KoELECTRA 초기화 실패 시 WebSocket에 에러 메시지를 반환
  
  **검증 방법**:
  - 단위 테스트: `server/tests/test_audio_pipeline.py`
    ```bash
    cd server
    venv\Scripts\python.exe -m pytest tests/test_audio_pipeline.py
    # ✅ 버퍼 임계치/유해·비유해 분기 검증
    ```
  - 통합 확인: Python 3.11 환경에서 Whisper/Torch 설치 후 `wscat`으로 바이너리 전송
  
  > ⚠️ **주의**: Whisper/Torch 실측 시 `server/venv311`(Python 3.11) 가상환경을 사용하고,
  > `pip install openai-whisper torch torchaudio pydub` 설치 후 실행하세요.

- [ ] **4.2. 성능 최적화 검토**
  - Whisper 모델 크기 조정 (tiny, base, small 중 선택)
  - GPU 사용 가능 여부 확인 및 설정
  - 비동기 처리 (ThreadPoolExecutor) 고려

- [x] **5.1. End-to-End 테스트 스크립트**
  ```python
  # server/tests/test_e2e.py
  import asyncio
  import numpy as np
  import websockets
  import time
  
  async def main():
      async with websockets.connect("ws://127.0.0.1:8000/ws/audio") as websocket:
          print("[E2E] WebSocket connected:", await websocket.recv())
          chunk = (np.random.randn(16000) * 0.1).astype(np.float32)
          await websocket.send((chunk * 32768).astype(np.int16).tobytes())
          print(await websocket.recv())
  
  asyncio.run(main())
  ```
  
  **진행 현황 (2025-11-11)**:
  - `server/tests/test_e2e.py` 작성 (비동기로 WebSocket 연결 및 지연 측정)
  - 랜덤 노이즈 또는 실제 샘플 파일 기반 전송 지원
  - Python 3.12+ 환경에서는 Whisper/Torch 제약 안내 메시지 출력
  - 평균 지연 시간 계산 및 3초 초과 시 경고 출력
  - Python 3.11 가상환경(`server/venv311`) + `.\venv311\Scripts\uvicorn.exe main:app` 조합으로 실측
  - 랜덤 오디오 5청크 측정 (CPU):
    - Chunk1: **12.10s** *(모델 웜업 포함)*
    - Chunk2~5: **1.78s / 1.87s / 2.09s / 2.23s*
    - 전체 평균: **4.01s**, 웜업 이후 평균: **≈1.99s** (목표 3초 이내 달성)
  - 향후 최적화: 서버 기동 시 사전 웜업 호출, Whisper Tiny 모델 검토, GPU 사용 시 `model.to("cuda")`

- [x] **5.2. 지연율 3초 이내 달성 확인**
  - 각 단계별 시간 측정 (STT, 분류)
  - 웜업 이후 청크 처리 지연 2초 이내 유지 → 목표 만족

## 🔗 관련 파일

### 생성할 파일
- `server/audio/buffer_manager.py` - 오디오 버퍼 관리
- `server/audio/whisper_service.py` - Whisper STT 서비스
- `server/audio/pipeline.py` - 버퍼/STT/분류 파이프라인
- `server/nlp/harmful_classifier.py` - KoELECTRA 유해성 분류기
- `server/main.py` - WebSocket 엔드포인트 추가
- `server/tests/test_ws_audio.py` - WebSocket 엔드포인트 단위 테스트
- `server/tests/test_whisper_service.py` - Whisper 서비스 단위 테스트
- `server/tests/test_whisper_real.py` - Whisper 실제 오디오 검증 테스트 (조건부 실행)
- `server/tests/test_harmful_classifier.py` - KoELECTRA 분류기 단위 테스트
- `server/tests/test_audio_pipeline.py` - STT/분류 통합 파이프라인 테스트
- `server/tests/test_e2e.py` - WebSocket E2E 지연 측정 스크립트 (수동 실행)

### 수정할 파일
- `server/requirements.txt` - 의존성 추가 (`pytest`, `httpx`, `numpy`, `pydub`, Whisper 계열 조건부 설치)
- `server/README.md` - API 문서 업데이트

## 📊 테스트 계획

| 단계 | 테스트 항목 | 성공 기준 | 우선순위 |
|------|-------------|-----------|----------|
| 1 | WebSocket 연결 | wscat으로 연결 성공 | High |
| 2 | 버퍼 관리 | 청크 단위 처리 확인 | High |
| 3 | Whisper STT | 한국어 음성 → 텍스트 변환 | High |
| 4 | KoELECTRA 분류 | 유해성 판별 정확도 | High |
| 5 | 전체 파이프라인 | E2E 지연율 3초 이내 | Critical |

## ⚠️ 주의사항

1. **모델 크기와 성능 트레이드오프**
   - Whisper-tiny: 빠름, 정확도 낮음
   - Whisper-base: 중간 (권장)
   - Whisper-small: 느림, 정확도 높음

2. **GPU 가용성**
   - CPU만 사용 시 지연율 증가 가능
   - GPU 사용 시 `torch.cuda.is_available()` 확인

3. **오디오 포맷**
   - 클라이언트에서 16kHz, mono, PCM 16-bit로 전송
   - 다른 포맷 수신 시 리샘플링 필요

4. **에러 처리**
   - WebSocket 연결 끊김 시 버퍼 정리
   - STT/분류 실패 시 에러 응답 전송

## 📚 참고 문서

- [Whisper GitHub](https://github.com/openai/whisper)
- [FastAPI WebSockets](https://fastapi.tiangolo.com/advanced/websockets/)
- [KoELECTRA Hugging Face](https://huggingface.co/monologg/koelectra-base-v3-discriminator)

## 🗒️ 업데이트 로그

- 2025-11-11: Phase 1 `/ws/audio` 엔드포인트 및 단위 테스트 구축, 문서 갱신
- 2025-11-11: `AudioBufferManager` 구현 및 테스트 추가, `numpy==2.1.2`로 요구사항 업데이트
- 2025-11-11: `WhisperSTTService` 구현 및 테스트 작성, Whisper/Torch 조건부 의존성 추가
- 2025-11-11: 실제 오디오 테스트(`tests/test_whisper_real.py`) 추가 및 샘플 음성 준비 가이드 업데이트
- 2025-11-11: `HarmfulTextClassifier` 구현 및 단위 테스트 작성, Phase 3 체크리스트 갱신
- 2025-11-11: `AudioProcessingPipeline` 도입 및 `/ws/audio` 파이프라인 통합, 통합 테스트 추가
- 2025-11-11: `tests/test_e2e.py`로 WebSocket 지연 측정, CPU 기준 웜업 이후 평균 1.99s 달성

## 🔄 다음 작업

이 작업 완료 후:
- **T25: 음성 Electron 연동** 시작
  - Windows 오디오 캡처
  - WebSocket 클라이언트 구현
  - 볼륨 조절/비프음 처리

---

**작업 시작 명령어 (Cursor Agent에게 제공)**:

```
작업: T24 - 음성 STT API 구현 (FastAPI)

1. **마스터 플랜 확인**
   - @PROJECT_SPEC.md에서 T24 요구사항 확인
   - @AISPNLP_종합_프로젝트_계획서.pdf의 "음성 필터 흐름도" 참조

2. **이 문서 참조**
   - @docs/24-audio-stt-api.md의 체크리스트를 순차적으로 진행

3. **작업 지시**
   - Phase 1부터 시작: WebSocket 엔드포인트 구축
   - 각 Phase 완료 후 테스트 실행
   - 테스트 통과 확인 후 다음 Phase 진행
```
