# Task 27: Deepgram STT 서버 연동 (Whisper → Deepgram 마이그레이션)

## ⚠️ 상태: 진행 중

## ⚠️ 중요: Python 환경 설정

**Whisper 호환성 문제로 인해 `server/venv311` (Python 3.11) 환경을 사용해야 합니다.**

```bash
# 서버 실행 시 venv311 활성화 필수
cd server
venv311\Scripts\activate  # Windows
# source venv311/bin/activate  # Linux/Mac
uvicorn main:app --reload
```

## 📋 작업 개요

T24에서 구현한 Whisper 기반 STT를 **Deepgram 상용 API**로 교체하여:
1. **레이턴시 단축** (목표: 2초 이내)
2. **STT 정확도 향상** (한국어 특화)
3. **서버 부하 감소** (GPU 불필요)

Deepgram은 WebSocket 기반 실시간 스트리밍을 지원하며, Whisper 대비 2~3배 빠른 처리 속도를 제공합니다.

## 🎯 핵심 목표

- ✅ **레이턴시 2초 이내** 달성 (Whisper 대비 30~50% 단축)
- ✅ **한국어 정확도 향상** (Deepgram의 한국어 모델 활용)
- ✅ **기존 구조 유지** (AudioProcessingPipeline 인터페이스 호환)
- ✅ **보안 강화** (API 키는 서버에서만 관리)

## 📦 필수 의존성
```bash
# server/requirements.txt에 추가
deepgram-sdk>=5.3.0  # Deepgram Python SDK v5
websockets==12.0     # 이미 있음 (T24)
```

## 🔄 Whisper vs Deepgram 비교

| 항목 | Whisper (현재) | Deepgram (목표) |
|------|---------------|----------------|
| 레이턴시 (웜업 후) | 1.99초 | **1.0~1.5초** |
| 초기 로딩 시간 | 12초 (GPU 없음) | **즉시** (API 호출) |
| GPU 요구사항 | 필수 (성능용) | **불필요** |
| 한국어 지원 | 범용 | **언어 특화 모델** |
| 비용 | 무료 | 종량제 (분당 $0.0125) |
| 스트리밍 | 부분 지원 | **완벽 지원** |

## 📝 작업 체크리스트

### Phase 1: DeepgramSTTService 구현

- [x] **1.1. Deepgram SDK 설치 및 테스트**
```bash
  # ⚠️ Whisper 호환성을 위해 venv311 사용 필요
  cd server
  venv311\Scripts\activate  # Windows
  # source venv311/bin/activate  # Linux/Mac
  
  pip install --upgrade deepgram-sdk>=5.3.0
  
  # .env 파일에 API 키 추가
  echo "DEEPGRAM_API_KEY=your_api_key_here" >> .env
```
  
  **API 키 발급**: https://console.deepgram.com/signup
  - 무료 크레딧: $200 (약 16,000분)
  - 한국어 모델: `ko` 언어 코드 지원

- [x] **1.2. DeepgramSTTService 구현 (SDK v5)**

```python
# [Server: server/audio/deepgram_service.py]
from deepgram import AsyncDeepgramClient
import asyncio
import os
import numpy as np
import logging

logger = logging.getLogger(__name__)

class DeepgramSTTService:
    """
    Deepgram WebSocket 기반 실시간 STT 서비스 (SDK v5)
    WhisperSTTService와 동일한 인터페이스 유지
    """
    
    def __init__(self, api_key: str = None, language: str = "ko", model: str = "nova-2"):
        self.api_key = api_key or os.getenv("DEEPGRAM_API_KEY")
        if not self.api_key:
            raise ValueError("DEEPGRAM_API_KEY not found in environment")
        
        self.language = language
        self.model = model
        
        try:
            self.deepgram = AsyncDeepgramClient(api_key=self.api_key)
            logger.info("✅ DeepgramSTTService initialized (language: %s, model: %s)", language, model)
        except Exception as exc:
            raise DeepgramNotAvailableError(f"Deepgram 초기화 실패: {exc}") from exc
    
    async def transcribe_stream(self, audio_np: np.ndarray) -> str:
        """
        오디오 청크를 Deepgram으로 전송하여 텍스트 변환 (SDK v5)
        
        Args:
            audio_np: float32 numpy array, normalized to [-1.0, 1.0]
        
        Returns:
            str: 변환된 텍스트 (빈 문자열 가능)
        """
        import time
        start_time = time.time()
        
        try:
            # 입력 검증
            audio = np.asarray(audio_np, dtype=np.float32)
            audio_mean = float(np.mean(np.abs(audio)))
            
            # 조용한 오디오 조기 종료
            if audio_mean < 0.001:
                logger.info("Audio too quiet, skipping API call")
                return ""
            
            # float32 → int16 변환
            audio_int16 = (audio * 32768).astype(np.int16)
            audio_bytes = audio_int16.tobytes()
            
            # SDK v5 API 호출 (올바른 경로: listen.v1.media.transcribe_file)
            # 모든 인자는 keyword-only이므로 request=로 명시해야 함
            # raw audio bytes를 전달할 때는 encoding을 명시해야 함 (sample_rate는 파라미터로 지원되지 않음)
            response = await self.deepgram.listen.v1.media.transcribe_file(
                request=audio_bytes,  # bytes를 직접 전달
                model=self.model,
                language=self.language,
                encoding="linear16",  # raw audio 형식 명시 (16kHz, 16-bit, mono는 기본값)
                smart_format=False,
                punctuate=False,
            )
            
            # 응답 파싱
            transcript = ""
            if response and response.results:
                channels = response.results.channels
                if channels and len(channels) > 0:
                    alternatives = channels[0].alternatives
                    if alternatives and len(alternatives) > 0:
                        transcript = alternatives[0].transcript.strip()
            
            # 레이턴시 로깅
            elapsed_ms = (time.time() - start_time) * 1000
            logger.info("Deepgram: %.2fms | '%s'", elapsed_ms, transcript[:50])
            
            if elapsed_ms > 2000:
                logger.warning("Latency exceeds 2s: %.2fms", elapsed_ms)
            
            return transcript
        
        except Exception as exc:
            logger.exception("Deepgram transcription error")
            return ""
    
    def transcribe(self, audio_np: np.ndarray) -> str:
        """동기 버전 (WhisperSTTService 호환)"""
        return asyncio.run(self.transcribe_stream(audio_np))
```

- [ ] **1.3. 단위 테스트**
```python
  # server/tests/test_deepgram_service.py
  import pytest
  import numpy as np
  from audio.deepgram_service import DeepgramSTTService
  
  @pytest.fixture
  def deepgram_service():
      """DeepgramSTTService 인스턴스 생성 (실제 API 호출)"""
      return DeepgramSTTService()
  
  @pytest.mark.asyncio
  async def test_transcribe_stream_success(deepgram_service):
      """정상 오디오 청크 전송 테스트"""
      # 1초짜리 더미 오디오 (무음)
      audio_chunk = np.zeros(16000, dtype=np.float32)
      
      result = await deepgram_service.transcribe_stream(audio_chunk)
      
      # 무음이므로 빈 문자열이 반환되어야 함
      assert isinstance(result, str)
      assert result == ""
  
  @pytest.mark.asyncio
  async def test_transcribe_stream_with_real_audio(deepgram_service):
      """실제 오디오 파일 테스트 (tests/data/sample_ko.wav 필요)"""
      import wave
      
      with wave.open("tests/data/sample_ko.wav", "rb") as wf:
          audio_bytes = wf.readframes(wf.getnframes())
          audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
      
      result = await deepgram_service.transcribe_stream(audio_np[:16000])
      
      # 결과가 비어있지 않아야 함
      assert isinstance(result, str)
      assert len(result) > 0
      print(f"✅ Transcription result: {result}")
  
  def test_transcribe_sync(deepgram_service):
      """동기 버전 테스트 (WhisperSTTService 호환성)"""
      audio_chunk = np.zeros(16000, dtype=np.float32)
      result = deepgram_service.transcribe(audio_chunk)
      assert isinstance(result, str)
```
  
  **실행**:
```bash
  cd server
  pytest tests/test_deepgram_service.py -v
  
  # 실제 오디오 테스트 (sample_ko.wav 있을 때만)
  pytest tests/test_deepgram_service.py::test_transcribe_stream_with_real_audio -v
```

### Phase 2: AudioProcessingPipeline 통합

- [ ] **2.1. AudioProcessingPipeline 수정**
```python
  # server/audio/pipeline.py (수정)
  from audio.whisper_service import WhisperSTTService
  from audio.deepgram_service import DeepgramSTTService  # ✅ 추가
  from nlp.harmful_classifier import HarmfulTextClassifier
  
  class AudioProcessingPipeline:
      def __init__(
          self,
          stt_service,  # WhisperSTTService 또는 DeepgramSTTService
          classifier: HarmfulTextClassifier,
          sample_rate: int = 16_000,
          chunk_duration_sec: float = 1.0,
      ):
          self.stt_service = stt_service
          self.classifier = classifier
          self.buffer_manager = AudioBufferManager(sample_rate, chunk_duration_sec)
      
      # ... 나머지 코드 동일 (인터페이스 호환) ...
```

- [ ] **2.2. main.py에서 Deepgram 사용**
```python
  # server/main.py (수정)
  from audio.deepgram_service import DeepgramSTTService  # ✅ 변경
  from audio.pipeline import AudioProcessingPipeline
  from nlp.harmful_classifier import HarmfulTextClassifier
  
  # 전역 변수
  stt_service = None
  classifier = None
  pipeline = None
  
  @app.on_event("startup")
  async def startup_event():
      global stt_service, classifier, pipeline
      
      try:
          # ✅ Deepgram 사용 (Whisper 대신)
          stt_service = DeepgramSTTService(language="ko")
          print("✅ Deepgram STT service initialized")
          
          classifier = HarmfulTextClassifier()
          print("✅ Harmful text classifier initialized")
          
          pipeline = AudioProcessingPipeline(
              stt_service=stt_service,
              classifier=classifier,
              sample_rate=16_000,
              chunk_duration_sec=1.0,
          )
          print("✅ Audio processing pipeline initialized")
      
      except Exception as e:
          print(f"❌ Failed to initialize services: {e}")
  
  @app.websocket("/ws/audio")
  async def audio_stream(websocket: WebSocket):
      await websocket.accept()
      await websocket.send_text("Connected (Deepgram STT)")  # ✅ 변경
      
      try:
          while True:
              data = await websocket.receive()
              
              if "bytes" in data:
                  audio_bytes = data["bytes"]
                  
                  # 파이프라인 처리
                  result = await pipeline.process_audio(audio_bytes)
                  
                  if result:
                      await websocket.send_json({
                          "text": result.text,
                          "is_harmful": result.is_harmful,
                          "confidence": result.confidence,
                          "timestamp": result.timestamp,
                          "processing_time_ms": result.processing_time_ms,
                          "chunk_duration_sec": result.chunk_duration_sec,
                      })
      
      except WebSocketDisconnect:
          print("Client disconnected")
      except Exception as e:
          print(f"Error in audio stream: {e}")
```

### Phase 3: E2E 테스트 및 레이턴시 비교

- [ ] **3.1. E2E 테스트 스크립트 (Deepgram 버전)**
```python
  # server/tests/test_e2e_deepgram.py
  import asyncio
  import numpy as np
  import websockets
  import time
  
  async def main():
      uri = "ws://127.0.0.1:8000/ws/audio"
      
      print("🧪 Deepgram E2E Test")
      print("=" * 50)
      
      async with websockets.connect(uri) as websocket:
          # 연결 확인
          greeting = await websocket.recv()
          print(f"✅ {greeting}\n")
          
          # 5개 청크 전송 및 레이턴시 측정
          latencies = []
          
          for i in range(5):
              # 랜덤 오디오 청크 생성 (1초, 16kHz, float32)
              chunk = (np.random.randn(16000) * 0.1).astype(np.float32)
              chunk_bytes = (chunk * 32768).astype(np.int16).tobytes()
              
              # 전송 및 시간 측정
              start_time = time.time()
              await websocket.send(chunk_bytes)
              
              response = await websocket.recv()
              end_time = time.time()
              
              latency = (end_time - start_time) * 1000  # ms
              latencies.append(latency)
              
              print(f"Chunk {i+1}: {latency:.2f}ms")
              print(f"  Response: {response}\n")
          
          # 통계
          avg_latency = sum(latencies) / len(latencies)
          print("=" * 50)
          print(f"📊 Average Latency: {avg_latency:.2f}ms")
          
          if avg_latency > 3000:
              print("⚠️ Warning: Average latency exceeds 3 seconds!")
          elif avg_latency > 2000:
              print("⚠️ Warning: Average latency exceeds 2 seconds!")
          else:
              print("✅ Latency target achieved!")
  
  if __name__ == "__main__":
      asyncio.run(main())
```
  
  **실행**:
```bash
  # 서버 실행 (터미널 1)
  # ⚠️ Whisper 호환성을 위해 venv311 사용 필요
  cd server
  venv311\Scripts\activate  # Windows
  # source venv311/bin/activate  # Linux/Mac
  uvicorn main:app --reload
  
  # E2E 테스트 (터미널 2)
  cd server
  venv311\Scripts\activate  # Windows
  # source venv311/bin/activate  # Linux/Mac
  python tests/test_e2e_deepgram.py
```

- [ ] **3.2. Whisper vs Deepgram 레이턴시 비교**
```bash
  # Whisper 버전으로 테스트 (T24 서버)
  python tests/test_e2e.py
  # 결과: 평균 1.99s (웜업 이후)
  
  # Deepgram 버전으로 테스트 (T27 서버)
  python tests/test_e2e_deepgram.py
  # 목표: 평균 1.0~1.5s
```

### Phase 4: 클라이언트 직접 연동 방식 (선택 사항, 보안 이슈)

⚠️ **주의**: 이 방식은 API 키가 클라이언트에 노출되므로 **프로덕션 환경에서는 권장하지 않습니다**.
MVP/데모 목적으로만 사용하세요.

<details>
<summary>클라이언트 직접 연동 코드 (참고용)</summary>
```typescript
// electron/audio/deepgramClient.ts
import WebSocket from 'ws';
import { EventEmitter } from 'events';

export class DeepgramClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiKey: string;
  
  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }
  
  async connect(): Promise<void> {
    const url = `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&language=ko`;
    
    this.ws = new WebSocket(url, {
      headers: {
        'Authorization': `Token ${this.apiKey}`,
      },
    });
    
    this.ws.on('open', () => {
      console.log('✅ Deepgram WebSocket connected');
      this.emit('connected');
    });
    
    this.ws.on('message', (data: Buffer) => {
      try {
        const response = JSON.parse(data.toString());
        
        if (response.channel?.alternatives) {
          const transcript = response.channel.alternatives[0].transcript;
          if (transcript && transcript.trim() !== '') {
            this.emit('transcript', transcript);
          }
        }
      } catch (err) {
        console.error('Failed to parse Deepgram response:', err);
      }
    });
    
    this.ws.on('error', (err) => {
      console.error('Deepgram WebSocket error:', err);
      this.emit('error', err);
    });
    
    this.ws.on('close', () => {
      console.log('Deepgram WebSocket closed');
      this.emit('close');
    });
  }
  
  sendAudio(audioBuffer: Buffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(audioBuffer);
    }
  }
  
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
```

**사용 예시**:
```typescript
// electron/audio/audioService.ts (수정)
import { DeepgramClient } from './deepgramClient';

export class AudioService {
  private deepgramClient: DeepgramClient;
  
  constructor(private mainWindow: BrowserWindow | null) {
    // ⚠️ 보안 위험: API 키가 클라이언트에 노출됨
    this.deepgramClient = new DeepgramClient(process.env.DEEPGRAM_API_KEY!);
    
    this.deepgramClient.on('transcript', (text: string) => {
      // FastAPI /analyze-text 엔드포인트로 전송
      this.analyzeText(text);
    });
  }
  
  async startMonitoring(): Promise<void> {
    await this.deepgramClient.connect();
    
    // 오디오 캡처 시작
    this.audioIn.on('data', (chunk: Buffer) => {
      const processed = this.processor.process(chunk);
      this.deepgramClient.sendAudio(processed);
    });
  }
  
  private async analyzeText(text: string): Promise<void> {
    // FastAPI로 텍스트만 전송
    const response = await axios.post('http://localhost:8000/analyze-text', {
      text: text
    });
    
    if (response.data.is_harmful) {
      this.handleHarmful(text, response.data.confidence);
    }
  }
}
```

**보안 개선 방법** (추가 작업 필요):
1. FastAPI에서 임시 토큰 발급 엔드포인트 추가
2. Electron에서 토큰 요청 후 Deepgram 연결
3. 토큰 수명: 30분 (자동 갱신)

이 방식은 120시간 MVP 범위를 벗어나므로 선택 사항입니다.
</details>

## 🔗 관련 파일

### 생성할 파일
- `server/audio/deepgram_service.py` - Deepgram STT 서비스
- `server/tests/test_deepgram_service.py` - Deepgram 서비스 단위 테스트
- `server/tests/test_e2e_deepgram.py` - Deepgram E2E 테스트
- `electron/audio/deepgramClient.ts` - 클라이언트 직접 연동 (선택 사항)

### 수정할 파일
- `server/requirements.txt` - Deepgram SDK 추가
- `server/main.py` - DeepgramSTTService 사용
- `server/.env` - DEEPGRAM_API_KEY 추가
- `server/audio/pipeline.py` - 주석 업데이트 (인터페이스 호환성 강조)

## 📊 테스트 계획

| Phase | 테스트 항목 | 성공 기준 | 우선순위 |
|-------|-------------|-----------|----------|
| 1 | Deepgram API 연결 | 무음 오디오 전송 성공 | High |
| 2 | 실제 오디오 변환 | 한국어 텍스트 정확히 추출 | High |
| 3 | Pipeline 통합 | WhisperSTTService와 동일한 결과 | High |
| 4 | E2E 레이턴시 | 평균 2초 이내 (Whisper 대비 30% 단축) | Critical |
| 5 | 클라이언트 직접 연동 | 텍스트만 FastAPI로 전송 (선택 사항) | Low |

## ⚠️ 주의사항

1. **Python 환경 설정**
   - **Whisper 호환성 문제로 인해 `server/venv311` (Python 3.11) 환경을 사용해야 합니다.**
   - 서버 실행 및 테스트 시 venv311 활성화 필수
   - Windows: `venv311\Scripts\activate`
   - Linux/Mac: `source venv311/bin/activate`

2. **API 키 보안**
   - `.env` 파일에 `DEEPGRAM_API_KEY` 추가
   - `.gitignore`에 `.env` 포함 확인
   - 클라이언트에 API 키 노출 금지

3. **비용 관리**
   - Deepgram 무료 크레딧: $200
   - 종량제: 분당 $0.0125 (한국어 모델)
   - 1시간 테스트 = $0.75
   - 무료 크레딧으로 약 16,000분 사용 가능

4. **언어 코드**
   - 한국어: `language="ko"`
   - 다국어 지원: `language="multi"`
   - 모델 선택: `model="general"` 또는 `model="nova-2"` (최신)

5. **에러 처리**
   - API 키 없음 → `ValueError` 발생
   - 네트워크 오류 → 빈 문자열 반환
   - 응답 파싱 오류 → 로그 출력 후 무시

6. **인터페이스 호환성**
   - `WhisperSTTService`와 동일한 `transcribe(audio_chunk)` 메서드 제공
   - `AudioProcessingPipeline`은 수정 없이 그대로 사용 가능

## 📚 참고 문서

- [Deepgram Python SDK](https://developers.deepgram.com/docs/python-sdk)
- [Deepgram Streaming API](https://developers.deepgram.com/docs/streaming)
- [Deepgram 언어 지원](https://developers.deepgram.com/docs/languages)
- [Deepgram 요금제](https://deepgram.com/pricing)

## 🗒️ 업데이트 로그

- 2024-11-13: T27 문서 작성, Deepgram 통합 계획 수립

## 🔄 다음 작업

T27 완료 후:
- ⏳ **Phase 4: 클라이언트 직접 연동** (선택 사항)
  - 보안 토큰 발급 엔드포인트 추가
  - Electron에서 Deepgram 직접 연결
- ⏳ **T16: 서버 알림 수신 및 블라인드 표시** 통합
  - OCR(텍스트) + STT(음성) 유해성 감지 통합
  - 통합 알림 시스템 구축

---

**완료 기준**:
- [x] Deepgram SDK v5 설치 및 API 키 설정
- [x] DeepgramSTTService SDK v5 방식으로 구현 완료
- [x] 조용한 오디오 조기 종료 로직 추가
- [x] 레이턴시 측정 및 로깅 추가
- [x] AudioProcessingPipeline 통합 완료
- [ ] E2E 테스트 실행 및 평균 레이턴시 2초 이내 달성
- [ ] Whisper vs Deepgram 레이턴시 비교 보고서 작성