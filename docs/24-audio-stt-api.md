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

- [ ] **2.2. 실제 오디오 파일로 테스트**
  ```bash
  # 한국어 음성 샘플 다운로드 (예: YouTube 또는 녹음)
  # test_audio.wav 파일을 server/ 디렉토리에 준비
  
  # test_whisper_real.py
  import whisper
  import numpy as np
  from pydub import AudioSegment
  
  audio = AudioSegment.from_file("test_audio.wav")
  audio = audio.set_frame_rate(16000).set_channels(1)
  audio_np = np.array(audio.get_array_of_samples(), dtype=np.float32) / 32768.0
  
  model = whisper.load_model("base")
  result = model.transcribe(audio_np, language="ko")
  print(f"✅ Transcribed: {result['text']}")
  ```

### Phase 3: KoELECTRA 유해성 판별 통합

- [ ] **3.1. KoELECTRA 분류기 구현**
  ```python
  # server/nlp/harmful_classifier.py
  from transformers import AutoTokenizer, AutoModelForSequenceClassification
  import torch
  
  class HarmfulTextClassifier:
      def __init__(self, model_name="monologg/koelectra-base-v3-discriminator"):
          print(f"Loading KoELECTRA model: {model_name}...")
          self.tokenizer = AutoTokenizer.from_pretrained(model_name)
          self.model = AutoModelForSequenceClassification.from_pretrained(
              model_name,
              num_labels=2  # 0: 정상, 1: 유해
          )
          # TODO: Fine-tuned 모델로 교체 (팀원 손찬우, 신동석)
          print("✅ KoELECTRA model loaded!")
      
      def predict(self, text: str) -> dict:
          """
          Returns:
              {
                  "is_harmful": bool (0 or 1),
                  "confidence": float (0.0 ~ 1.0),
                  "text": str
              }
          """
          if not text.strip():
              return {"is_harmful": False, "confidence": 0.0, "text": ""}
          
          inputs = self.tokenizer(text, return_tensors="pt", truncation=True, max_length=512)
          with torch.no_grad():
              outputs = self.model(**inputs)
              probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
              predicted_class = torch.argmax(probs, dim=-1).item()
              confidence = probs[0][predicted_class].item()
          
          return {
              "is_harmful": bool(predicted_class),
              "confidence": confidence,
              "text": text
          }
  ```
  
  **테스트 방법**:
  ```python
  # server/test_classifier.py
  from nlp.harmful_classifier import HarmfulTextClassifier
  
  classifier = HarmfulTextClassifier()
  
  # 테스트 케이스
  test_cases = [
      "안녕하세요, 좋은 하루 되세요!",
      "욕설 테스트 문장",  # 실제 욕설로 교체
      "너 정말 바보 같아",
  ]
  
  for text in test_cases:
      result = classifier.predict(text)
      print(f"Text: {text}")
      print(f"Result: {result}")
      print("-" * 50)
  
  print("✅ Classifier test passed!")
  ```

### Phase 4: 전체 파이프라인 통합 (WebSocket)

- [ ] **4.1. 전체 파이프라인 구현**
  ```python
  # server/main.py (업데이트)
  from audio.buffer_manager import AudioBufferManager
  from audio.whisper_service import WhisperSTTService
  from nlp.harmful_classifier import HarmfulTextClassifier
  
  # 전역 인스턴스 (앱 시작 시 초기화)
  stt_service = WhisperSTTService(model_name="base")
  classifier = HarmfulTextClassifier()
  
  @app.websocket("/ws/audio")
  async def audio_stream(websocket: WebSocket):
      await websocket.accept()
      buffer_manager = AudioBufferManager(sample_rate=16000, chunk_duration_sec=1.0)
      
      try:
          while True:
              # 1. 오디오 청크 수신
              audio_bytes = await websocket.receive_bytes()
              buffer_manager.add_chunk(audio_bytes)
              
              # 2. 버퍼가 충분히 쌓이면 처리
              audio_chunk = buffer_manager.get_processed_chunk()
              if audio_chunk is not None:
                  # 3. STT 변환
                  text = stt_service.transcribe(audio_chunk)
                  
                  # 4. 유해성 판별
                  result = classifier.predict(text)
                  
                  # 5. 결과 전송
                  await websocket.send_json({
                      "text": text,
                      "is_harmful": result["is_harmful"],
                      "confidence": result["confidence"],
                      "timestamp": time.time()
                  })
      
      except WebSocketDisconnect:
          print("Client disconnected")
      except Exception as e:
          print(f"Error in audio_stream: {e}")
          await websocket.close(code=1011, reason=str(e))
  ```

- [ ] **4.2. 성능 최적화 검토**
  - [ ] Whisper 모델 크기 조정 (tiny, base, small 중 선택)
  - [ ] GPU 사용 가능 여부 확인 및 설정
  - [ ] 비동기 처리 (ThreadPoolExecutor) 고려
  
  ```python
  # GPU 설정 예시
  import torch
  device = "cuda" if torch.cuda.is_available() else "cpu"
  self.model.to(device)
  ```

### Phase 5: 통합 테스트 및 지연율 측정

- [ ] **5.1. End-to-End 테스트 스크립트**
  ```python
  # server/test_e2e.py
  import asyncio
  import websockets
  import numpy as np
  import time
  
  async def test_audio_pipeline():
      uri = "ws://localhost:8000/ws/audio"
      async with websockets.connect(uri) as websocket:
          print("✅ WebSocket connected")
          
          # 더미 오디오 스트림 생성 (16kHz, 1초씩 전송)
          for i in range(5):
              # 1초 분량 오디오 생성
              audio_chunk = (np.random.randn(16000) * 0.1).astype(np.float32)
              audio_bytes = (audio_chunk * 32768).astype(np.int16).tobytes()
              
              start_time = time.time()
              await websocket.send(audio_bytes)
              
              # 응답 대기
              response = await websocket.recv()
              latency = time.time() - start_time
              
              print(f"Chunk {i+1}: {response}")
              print(f"Latency: {latency:.2f}s")
              
              if latency > 3.0:
                  print("⚠️ WARNING: Latency exceeds 3 seconds!")
          
          print("✅ E2E test completed!")
  
  asyncio.run(test_audio_pipeline())
  ```

- [ ] **5.2. 지연율 3초 이내 달성 확인**
  - 각 단계별 시간 측정 (STT, 분류)
  - 병목 지점 파악 및 최적화

## 🔗 관련 파일

### 생성할 파일
- `server/audio/buffer_manager.py` - 오디오 버퍼 관리
- `server/audio/whisper_service.py` - Whisper STT 서비스
- `server/nlp/harmful_classifier.py` - KoELECTRA 유해성 분류기
- `server/main.py` - WebSocket 엔드포인트 추가
- `server/tests/test_ws_audio.py` - WebSocket 엔드포인트 단위 테스트
- `server/tests/test_whisper_service.py` - Whisper 서비스 단위 테스트

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
