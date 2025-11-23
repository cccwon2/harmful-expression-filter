# Task 36: 로컬 Whisper 폴백(Fallback) 시스템 구현

## ⚠️ 상태: 완료

## 📋 작업 개요

Deepgram 서버 연결 실패 시 Electron 내부에서 로컬 Whisper 모델을 사용하여 STT를 수행하는 폴백 시스템을 구현합니다.

**목표**:
1. **서버 연결 실패 시 자동 폴백**: Deepgram WebSocket 연결 실패 시 로컬 Whisper로 자동 전환
2. **로컬 STT 처리**: `@huggingface/transformers`를 사용하여 로컬에서 음성 인식 수행
3. **유해성 분석 연동**: 로컬 STT 결과를 기존 로컬 분석 로직과 연동

**배경**:
- Task 35에서 Deepgram 실시간 스트리밍 방식으로 전환하여 레이턴시를 ~0.5초로 단축
- 하지만 서버 연결 실패 시 STT 기능이 완전히 중단되는 문제 발생
- 오프라인 환경이나 네트워크 문제 시에도 STT 기능을 유지하기 위해 로컬 폴백 필요

**관련 작업**:
- Task 35 (Deepgram 실시간 스트리밍) ✅ - 기본 STT 방식
- Task 34 (Windows OCR 최적화) ✅ - 로컬 분석 로직 참고

## 🏗️ 아키텍처

### 기존 구조 (Task 35)

```
Electron (AudioManager)
    ↓ WebSocket (오디오 패킷 즉시 전송)
FastAPI Server (DeepgramWebSocketManager)
    ↓ WebSocket (오디오 패킷 즉시 전송)
Deepgram API (Live WebSocket)
    ↓ 실시간 결과 스트리밍
FastAPI Server
    ↓ WebSocket (결과 즉시 전송)
Electron (AudioManager)
    ↓ 로컬 유해성 분석 (analyzeTextLocally)
유해 표현 감지
```

**문제점**:
- Deepgram 서버 연결 실패 시 STT 기능 완전 중단
- 네트워크 문제 시 사용 불가

### 폴백 구조 (Task 36)

```
Electron (AudioManager)
    ├─ [정상 모드] WebSocket → FastAPI → Deepgram
    └─ [폴백 모드] LocalSttService → Whisper (로컬)
         ↓
    로컬 유해성 분석 (analyzeTextLocally)
         ↓
    유해 표현 감지
```

**장점**:
- 서버 연결 실패 시에도 STT 기능 유지
- 오프라인 환경에서도 동작 가능
- 자동 모드 전환으로 사용자 경험 향상

## 🔧 구현 세부사항

### 1. LocalSttService 구현

**파일**: `electron/audio/LocalSttService.ts`

**요구사항**:
- Singleton 패턴으로 구현
- 모델: `Xenova/whisper-tiny` (quantized: true)
- 오디오 처리: PCM(Int16) → Float32 변환, 3초 버퍼링
- 상태 관리: `loading`, `ready`, `processing`, `error`

**핵심 코드**:

```typescript
import { pipeline, AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

export class LocalSttService {
  private static instance: LocalSttService | null = null;
  private transcriber: AutomaticSpeechRecognitionPipeline | null = null;
  private state: 'loading' | 'ready' | 'processing' | 'error' = 'loading';
  private audioBuffer: Int16Array[] = [];
  private readonly CHUNK_SIZE_SEC = 3.0;
  private readonly SAMPLE_RATE = 16000;
  private readonly CHUNK_SIZE_SAMPLES = Math.floor(this.CHUNK_SIZE_SEC * this.SAMPLE_RATE);

  public static getInstance(): LocalSttService {
    if (!LocalSttService.instance) {
      LocalSttService.instance = new LocalSttService();
    }
    return LocalSttService.instance;
  }

  public async init(): Promise<void> {
    if (this.state === 'ready' || this.state === 'loading') {
      return;
    }
    
    this.state = 'loading';
    try {
      this.transcriber = await pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-tiny',
        { quantized: true }
      );
      this.state = 'ready';
      console.log('[LocalSttService] ✅ 모델 로딩 완료');
    } catch (error) {
      this.state = 'error';
      console.error('[LocalSttService] 모델 로딩 실패:', error);
      throw error;
    }
  }

  public async processAudio(pcmInt16: Buffer): Promise<string | null> {
    if (this.state !== 'ready' || !this.transcriber) {
      return null;
    }

    // Int16 → Float32 변환 및 버퍼에 추가
    const float32Array = this.convertInt16ToFloat32(pcmInt16);
    this.audioBuffer.push(float32Array);

    // 3초 분량이 쌓였는지 확인
    const totalSamples = this.audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
    if (totalSamples < this.CHUNK_SIZE_SAMPLES) {
      return null; // 아직 충분한 데이터가 없음
    }

    // 버퍼 합치기
    const combinedBuffer = new Float32Array(totalSamples);
    let offset = 0;
    for (const arr of this.audioBuffer) {
      combinedBuffer.set(arr, offset);
      offset += arr.length;
    }

    // 버퍼 초기화
    this.audioBuffer = [];

    // STT 처리
    this.state = 'processing';
    try {
      const result = await this.transcriber(combinedBuffer, {
        return_timestamps: false,
        language: 'ko',
      });
      
      this.state = 'ready';
      const text = result?.text?.trim() || '';
      return text || null;
    } catch (error) {
      this.state = 'ready';
      console.error('[LocalSttService] STT 처리 실패:', error);
      return null;
    }
  }

  private convertInt16ToFloat32(buffer: Buffer): Float32Array {
    const int16Array = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0; // -1.0 ~ 1.0 범위로 정규화
    }
    return float32Array;
  }

  public getState(): 'loading' | 'ready' | 'processing' | 'error' {
    return this.state;
  }
}
```

**특징**:
- **모델 로딩**: 첫 호출 시 `Xenova/whisper-tiny` 모델을 자동으로 다운로드 및 로딩
- **버퍼링**: 3초 분량의 오디오가 쌓일 때까지 대기 후 처리
- **오디오 변환**: PCM Int16 형식을 Float32(-1.0 ~ 1.0)로 변환
- **에러 처리**: 모델 로딩 실패나 STT 처리 실패 시 상태 관리

### 2. AudioManager 폴백 로직 추가

**파일**: `electron/main/AudioManager.ts`

**요구사항**:
- WebSocket 연결 실패 감지
- 3회 이상 실패 시 폴백 모드로 전환
- 폴백 모드에서 로컬 STT 사용
- 로컬 STT 결과를 로컬 유해성 분석과 연동

**핵심 수정사항**:

```typescript
import { LocalSttService } from '../audio/LocalSttService';
import { analyzeTextLocally } from './onVoiceBridge';

class AudioManager {
  private localSttService: LocalSttService;
  private isFallbackMode: boolean = false;
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;

  public async init(): Promise<void> {
    // ... 기존 코드 ...
    
    // LocalSttService 초기화 (폴백용)
    this.localSttService = LocalSttService.getInstance();
    // 모델은 나중에 필요할 때 로딩 (지연 로딩)
  }

  private handleAudioData(pcm: Buffer): void {
    if (!this.isStreaming) {
      return;
    }

    // 폴백 모드: 로컬 STT 사용
    if (this.isFallbackMode) {
      this.localSttService.processAudio(pcm).then((text) => {
        if (text && text.trim()) {
          console.log(`[AudioManager] [로컬 STT] ${text}`);
          
          // 로컬 유해성 분석
          const analysis = analyzeTextLocally(text);
          if (analysis.isHarmful) {
            console.warn(
              `[AudioManager] 🚨 유해 표현 감지! "${text}" (키워드: ${analysis.matched.join(', ')})`
            );
            this.handleHarmfulExpressionDetected();
          }
        }
      }).catch((error) => {
        console.error('[AudioManager] 로컬 STT 처리 실패:', error);
      });
      return;
    }

    // 정상 모드: WebSocket 전송
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(pcm);
      } catch (error) {
        console.error('[AudioManager] 오디오 데이터 전송 실패:', error);
        this.reconnectWebSocket().catch(console.error);
      }
    }
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      // ... 기존 연결 코드 ...

      this.ws.on('error', (error) => {
        console.error('[AudioManager] WebSocket 오류:', error);
        this.reconnectAttempts++;
        
        // 3회 이상 실패 시 폴백 모드로 전환
        if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
          this.switchToFallbackMode();
        }
        
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[AudioManager] WebSocket 연결 종료`);
        const wasStreaming = this.isStreaming;
        this.ws = null;
        
        if (wasStreaming && !this.isReconnecting) {
          this.reconnectAttempts++;
          
          // 3회 이상 실패 시 폴백 모드로 전환
          if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
            this.switchToFallbackMode();
          } else {
            // 재연결 시도
            this.reconnectTimer = setTimeout(() => {
              this.reconnectWebSocket().catch(console.error);
            }, 2000);
          }
        }
      });
    });
  }

  private async switchToFallbackMode(): Promise<void> {
    if (this.isFallbackMode) {
      return; // 이미 폴백 모드
    }

    console.warn('[AudioManager] 🚨 서버 응답 없음. 로컬 Whisper 모드로 전환합니다.');
    this.isFallbackMode = true;

    // WebSocket 연결 종료
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // LocalSttService 초기화 (모델 로딩)
    try {
      await this.localSttService.init();
      console.log('[AudioManager] ✅ 로컬 Whisper 모델 로딩 완료');
    } catch (error) {
      console.error('[AudioManager] 로컬 Whisper 모델 로딩 실패:', error);
      // 모델 로딩 실패 시에도 폴백 모드 유지 (재시도 가능)
    }
  }

  public getStatus(): AudioManagerStatus {
    return {
      isStreaming: this.isStreaming,
      target: this.currentTarget || undefined,
      pid: this.currentPid || undefined,
      wsConnected: this.ws !== null && this.ws.readyState === WebSocket.OPEN,
      isFallbackMode: this.isFallbackMode, // 추가
    };
  }
}
```

**핵심 포인트**:
- **연결 실패 감지**: WebSocket `error` 및 `close` 이벤트에서 재연결 시도 횟수 추적
- **자동 전환**: 3회 이상 실패 시 `switchToFallbackMode()` 자동 호출
- **지연 로딩**: LocalSttService 모델은 폴백 모드로 전환될 때만 로딩 (메모리 절약)
- **상태 관리**: `isFallbackMode` 플래그로 모드 구분

### 3. 유해성 분석 연동

**참조**: `electron/main/onVoiceBridge.ts`

로컬 STT 결과는 Task 34에서 구현한 `analyzeTextLocally` 함수를 사용하여 분석합니다.

```typescript
// onVoiceBridge.ts에서 export된 함수 사용
import { analyzeTextLocally } from './onVoiceBridge';

// LocalSttService에서 반환된 텍스트 분석
const analysis = analyzeTextLocally(text);
if (analysis.isHarmful) {
  // 유해 표현 감지 처리
  this.handleHarmfulExpressionDetected();
}
```

**장점**:
- 기존 로컬 분석 로직 재사용
- 서버 의존성 없이 즉시 분석 가능
- OCR과 동일한 유해어 리스트 사용

## 📊 성능 및 특징

### 로컬 Whisper 모델

| 항목 | 값 |
|------|-----|
| **모델** | `Xenova/whisper-tiny` |
| **크기** | ~75MB (quantized) |
| **언어** | 한국어 지원 |
| **처리 시간** | 약 1-2초 (3초 오디오 기준) |
| **메모리 사용량** | ~200-300MB (모델 로딩 후) |

### 폴백 모드 vs 정상 모드

| 항목 | 정상 모드 (Deepgram) | 폴백 모드 (Whisper) |
|------|---------------------|---------------------|
| **레이턴시** | ~0.5초 | ~1-2초 (3초 버퍼링 후) |
| **정확도** | 높음 (Nova-2 모델) | 중간 (Tiny 모델) |
| **인터넷 필요** | ✅ 필요 | ❌ 불필요 |
| **서버 필요** | ✅ 필요 | ❌ 불필요 |
| **중간 결과** | ✅ 지원 | ❌ 미지원 (3초 버퍼링) |

**참고**: 폴백 모드는 정상 모드보다 느리지만, 서버 연결 실패 시에도 STT 기능을 유지할 수 있습니다.

## 🔄 모드 전환 흐름

```
[정상 모드]
  ↓ WebSocket 연결 시도
  ↓ 실패 (1회)
  ↓ 재연결 시도
  ↓ 실패 (2회)
  ↓ 재연결 시도
  ↓ 실패 (3회)
  ↓ switchToFallbackMode() 호출
[폴백 모드]
  ↓ LocalSttService.init() (모델 로딩)
  ↓ 로컬 STT 처리 시작
  ↓ 3초 버퍼링 후 텍스트 반환
  ↓ 로컬 유해성 분석
  ↓ 유해 표현 감지
```

## 📝 로그 예시

### 정상 모드

```
[AudioManager] WebSocket 연결 시도: ws://127.0.0.1:8000/ws/audio
[AudioManager] ✅ WebSocket 연결 성공
[AudioManager] [STT] 안녕하세요
```

### 폴백 모드 전환

```
[AudioManager] WebSocket 연결 시도: ws://127.0.0.1:8000/ws/audio
[AudioManager] WebSocket 오류: Error: connect ECONNREFUSED
[AudioManager] WebSocket 연결 종료
[AudioManager] WebSocket 재연결 시도...
[AudioManager] WebSocket 오류: Error: connect ECONNREFUSED
[AudioManager] WebSocket 연결 종료
[AudioManager] WebSocket 재연결 시도...
[AudioManager] WebSocket 오류: Error: connect ECONNREFUSED
[AudioManager] 🚨 서버 응답 없음. 로컬 Whisper 모드로 전환합니다.
[LocalSttService] 모델 로딩 중...
[LocalSttService] ✅ 모델 로딩 완료
[AudioManager] ✅ 로컬 Whisper 모델 로딩 완료
[AudioManager] [로컬 STT] 안녕하세요
```

### 유해 표현 감지 (폴백 모드)

```
[AudioManager] [로컬 STT] 시발 이 새끼야
[AudioManager] 🚨 유해 표현 감지! "시발 이 새끼야" (키워드: 시발, 새끼)
[AudioManager] 🔊 유해 표현 감지! 볼륨 조절: 0.5 (50%)
```

## ✅ 체크리스트

- [x] **LocalSttService 구현**
  - Singleton 패턴 구현
  - 모델 로딩 (`Xenova/whisper-tiny`)
  - PCM → Float32 변환
  - 3초 버퍼링 로직
  - 상태 관리

- [x] **AudioManager 폴백 로직 추가**
  - 연결 실패 감지
  - 재연결 시도 횟수 추적
  - 폴백 모드 전환
  - 로컬 STT 연동

- [x] **유해성 분석 연동**
  - `analyzeTextLocally` 함수 사용
  - 유해 표현 감지 처리

- [x] **의존성 추가**
  - `@huggingface/transformers` 패키지 추가

- [x] **문서화**
  - Task 36 문서 작성
  - README.md 업데이트
  - 00-overview.md 업데이트

## ⚠️ 주의사항

1. **모델 다운로드**
   - 첫 실행 시 `Xenova/whisper-tiny` 모델을 자동으로 다운로드 (~75MB)
   - 인터넷 연결이 필요하며, 다운로드 시간이 소요될 수 있음
   - 모델은 캐시되어 이후 실행 시에는 빠르게 로딩됨

2. **메모리 사용량**
   - Whisper 모델 로딩 시 약 200-300MB 메모리 사용
   - 폴백 모드로 전환될 때만 로딩하므로 정상 모드에서는 메모리 사용 없음

3. **처리 지연**
   - 폴백 모드는 3초 버퍼링 후 처리하므로 정상 모드보다 느림
   - 정상 모드 복구 시 자동으로 전환되도록 구현 가능 (향후 개선)

4. **정확도 차이**
   - `whisper-tiny`는 경량 모델로 정확도가 Deepgram Nova-2보다 낮을 수 있음
   - 폴백 목적이므로 정확도보다 안정성에 중점

## 🔮 향후 개선 사항

1. **자동 복구**
   - 폴백 모드에서 서버 연결이 복구되면 자동으로 정상 모드로 전환
   - 주기적으로 서버 연결 상태 확인

2. **더 큰 모델 지원**
   - 사용자가 선택할 수 있도록 `whisper-base` 또는 `whisper-small` 옵션 제공
   - 정확도와 성능의 트레이드오프

3. **버퍼링 최적화**
   - 3초 버퍼링을 동적으로 조절 (예: 1-5초 범위)
   - 실시간성과 정확도의 균형

4. **모델 캐싱**
   - 모델을 미리 다운로드하여 첫 실행 시 지연 최소화
   - 설치 시 모델 포함 옵션

## 📚 관련 문서

- [Task 35: Deepgram 실시간 스트리밍 방식](./35-deepgram-realtime-streaming.md) - 기본 STT 방식
- [Task 34: Windows OCR 성능 최적화](./34-windows-ocr-optimization.md) - 로컬 분석 로직 참고
- [Task 27: Deepgram STT 통합](./27-deepgram-stt-integration.md) - 초기 STT 구현

## 🗒️ 업데이트 로그

- 2025-11-22: T36 문서 작성
  - LocalSttService 구현 가이드
  - AudioManager 폴백 로직 추가
  - 유해성 분석 연동
  - 성능 및 특징 정리

---

**완료 기준:**
- [x] LocalSttService 구현 완료
- [x] AudioManager 폴백 로직 추가 완료
- [x] 유해성 분석 연동 완료
- [x] 의존성 추가 완료
- [x] 문서화 완료

