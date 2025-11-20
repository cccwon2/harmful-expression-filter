# Task 29: OnVoice COM Bridge 통합

## ✅ 상태: 완료

## 📋 작업 개요

Windows에서 **프로세스별 오디오 캡처**를 위해 C++ COM DLL(`OnVoiceAudioBridge.OnVoiceCapture`)과 Node.js/Electron을 연결하는 브리지 모듈을 구현했습니다.

기존 `naudiodon2` 기반 시스템 전체 오디오 캡처와 달리, **Edge/Chrome 등 특정 프로세스의 오디오만 선택적으로 캡처**할 수 있습니다.

## 🎯 핵심 목표

- ✅ **재사용 가능한 COM 브리지 모듈** 생성
- ✅ **Deepgram WebSocket 직접 연동** 테스트 스크립트 작성
- ✅ **FastAPI 서버 연동 헬퍼** 작성 (유해 표현 분석)
- ✅ **Electron Main Process 통합** (IPC 핸들러)
- ✅ **기존 오디오 시스템과 독립적** 동작

## 📦 생성된 파일

### 1. COM 브리지 모듈
**파일**: `electron/audio/onvoiceCaptureBridge.ts`

```typescript
export function createOnVoiceCapture(options: CreateOnVoiceCaptureOptions): OnVoiceCaptureHandle {
  // COM 객체 생성
  // 이벤트 구독 (advise)
  // 메시지 펌프 시작
  // PID 찾기 및 캡처 시작/중지
}
```

**주요 기능**:
- `winax`를 사용한 COM 객체 생성 및 이벤트 구독
- `OnAudioData` 이벤트를 Buffer로 정규화
- 자동 리소스 정리 (`dispose()`)

### 2. Deepgram 테스트 스크립트
**파일**: `examples/deepgram_onvoice_client.js`

독립 실행 가능한 테스트 스크립트로, OnVoice COM 브리지와 Deepgram WebSocket을 직접 연동합니다.

**사용법**:
```bash
DEEPGRAM_API_KEY=your_api_key node examples/deepgram_onvoice_client.js
```

### 3. 유해 표현 분석 클라이언트
**파일**: `electron/utils/harmfulAnalysisClient.ts`

FastAPI 서버의 `/analyze` 엔드포인트를 호출하여 텍스트의 유해성을 분석합니다.

```typescript
export async function sendTextForAnalysis(
  text: string,
  useAI: boolean = false
): Promise<AnalysisResult | AnalysisError>
```

### 4. OnVoice 서비스
**파일**: `electron/audio/onvoiceService.ts`

Electron Main Process에서 OnVoice 캡처를 관리하는 서비스 클래스입니다.

**주요 기능**:
- Deepgram 또는 서버 WebSocket 선택 지원
- STT 결과 자동 유해 표현 분석
- IPC를 통한 상태 브로드캐스트

### 5. IPC 핸들러
**파일**: `electron/ipc/onvoiceHandlers.ts`

렌더러 프로세스에서 OnVoice 캡처를 제어할 수 있는 IPC 핸들러입니다.

**IPC 채널** (`electron/ipc/channels.ts`):
```typescript
export const ONVOICE_CHANNELS = {
  START_CAPTURE: 'onvoice:startCapture',
  STOP_CAPTURE: 'onvoice:stopCapture',
  GET_STATUS: 'onvoice:get-status',
} as const;
```

### 6. 타입 정의
**파일**: `electron/types/winax.d.ts`

`winax` 라이브러리의 TypeScript 타입 정의입니다.

## 🔧 기술 스택

- **COM 라이브러리**: `winax` (v3.6.2)
- **WebSocket**: `ws` (v8.14.2)
- **STT**: Deepgram WebSocket 또는 서버 WebSocket
- **분석**: FastAPI `/analyze` 엔드포인트

## 📝 사용 방법

### Electron에서 사용

```typescript
// Renderer 프로세스
const result = await window.electronAPI.invoke('onvoice:startCapture', {
  target: 'edge' // 또는 'chrome' 또는 PID 번호
});
```

### 직접 브리지 사용

```typescript
import { createOnVoiceCapture } from './audio/onvoiceCaptureBridge';

const handle = createOnVoiceCapture({
  findPid: 'edge',
  onData: (buf: Buffer) => {
    // PCM 데이터 처리 (16kHz, mono, linear16)
    console.log('Received audio:', buf.length, 'bytes');
  },
  onError: (err) => {
    console.error('Capture error:', err);
  },
});

handle.start();
// ... 나중에
handle.dispose();
```

## 🔄 기존 시스템과의 관계

### AudioService (naudiodon2) vs OnVoiceService

| 항목 | AudioService | OnVoiceService |
|------|-------------|----------------|
| 캡처 대상 | 시스템 전체 오디오 | 특정 프로세스 (Edge/Chrome 등) |
| 라이브러리 | naudiodon2 | winax + COM DLL |
| 오디오 형식 | 디바이스 샘플 레이트 | 16kHz, mono, linear16 |
| STT | 서버 WebSocket | Deepgram 또는 서버 WebSocket |
| IPC 채널 | `AUDIO_CHANNELS` | `ONVOICE_CHANNELS` |

**두 시스템은 독립적으로 동작**하며, 필요에 따라 선택하여 사용할 수 있습니다.

## 🎯 오디오 데이터 형식

- **샘플 레이트**: 16kHz
- **채널**: Mono (1채널)
- **인코딩**: Linear PCM (16-bit)
- **청크 크기**: 약 960 bytes (60ms @ 16kHz)

Deepgram WebSocket 설정:
```
encoding=linear16&sample_rate=16000&language=ko
```

## 🔐 환경 변수

- `DEEPGRAM_API_KEY`: Deepgram API 키 (선택)
- `SERVER_URL`: FastAPI 서버 URL (기본값: `http://127.0.0.1:8000`)
- `SERVER_WS_URL`: 서버 WebSocket URL (기본값: `ws://127.0.0.1:8000/ws/audio`)

## ⚠️ 주의사항

1. **COM DLL 등록 필요**
   - `OnVoiceAudioBridge.OnVoiceCapture` COM 객체가 레지스트리에 등록되어 있어야 합니다.
   - C++ DLL이 `regsvr32`로 등록되어 있어야 합니다.

2. **Windows 전용**
   - `winax`는 Windows 전용 라이브러리입니다.
   - 다른 OS에서는 동작하지 않습니다.

3. **메시지 펌프**
   - COM 이벤트를 받기 위해 50ms 간격으로 `winax.peekAndDispatchMessages()`를 호출해야 합니다.
   - 브리지 모듈에서 자동으로 처리합니다.

4. **프로세스 찾기**
   - 현재는 `FindEdgeProcess()`만 지원됩니다.
   - Chrome 프로세스 찾기는 추후 구현 예정입니다.

## 📊 테스트

### Deepgram 테스트
```bash
# 환경변수 설정
$env:DEEPGRAM_API_KEY="your_api_key"  # PowerShell
# 또는
export DEEPGRAM_API_KEY="your_api_key"  # Bash

# 스크립트 실행
node examples/deepgram_onvoice_client.js
```

### Electron 통합 테스트
1. FastAPI 서버 실행 (`server` 폴더)
2. Electron 앱 실행 (`npm run dev`)
3. Renderer에서 IPC 호출:
   ```typescript
   await window.electronAPI.invoke('onvoice:startCapture', { target: 'edge' });
   ```

## 🔗 관련 작업

- **Task 24**: 음성 STT API (서버 WebSocket 기반)
- **Task 25**: 음성 Electron 연동
- **Task 27**: Deepgram STT 통합

## 📝 다음 단계

- [ ] Chrome 프로세스 찾기 구현
- [ ] Preload API에 OnVoice 메서드 추가
- [ ] Renderer UI 컴포넌트 추가 (선택적)
- [ ] 에러 처리 및 재연결 로직 개선
- [ ] 성능 최적화 (메시지 펌프 간격 조정)

## 업데이트 히스토리

- 2025-01-XX: Task 29 완료 - OnVoice COM Bridge 통합, 프로세스별 오디오 캡처 및 STT 연동

