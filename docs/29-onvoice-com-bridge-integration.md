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

### 1. OnVoice Bridge 모듈
**파일**: `electron/main/onVoiceBridge.ts`

`electron-edge-js`를 사용하여 C# COM DLL과 통신하는 브리지 모듈입니다.

```typescript
export const onVoiceBridge: OnVoiceBridge = {
  events: EventEmitter,
  init(onAudioData: (pcm: Buffer) => void): Promise<void>,
  findProcess(target: "chrome" | "edge" | "discord"): Promise<number>,
  startCapture(pid: number): Promise<void>,
  stopCapture(): Promise<void>,
}
```

**주요 기능**:
- C# DLL (`OnVoiceComBridge.dll`) 로드 및 호출
- 오디오 데이터 콜백 및 이벤트 방식 지원
- 프로세스 찾기 (Chrome, Edge, Discord)
- 오디오 캡처 시작/중지

### 2. OnVoice Bridge Adapter
**파일**: `electron/audio/onVoiceBridgeAdapter.ts`

OnVoice Bridge를 사용하는 어댑터로, 기존 코드와의 호환성을 유지합니다.

```typescript
export function createOnVoiceCapture(options: CreateOnVoiceCaptureOptions): OnVoiceCaptureHandle {
  // onVoiceBridge.init() 호출
  // 오디오 이벤트 리스너 등록
  // 프로세스 찾기 및 캡처 시작/중지
}
```

**주요 기능**:
- `onVoiceBridge.findProcess()`를 통한 프로세스 자동 검색
- 오디오 데이터 콜백 처리
- 자동 리소스 정리 (`dispose()`)

### 3. AudioManager (트레이 기반 스트리밍)
**파일**: `electron/main/AudioManager.ts`

시스템 트레이에서 직접 사용하는 오디오 스트리밍 관리자입니다. Singleton 패턴으로 구현되었으며, Python FastAPI 서버로 WebSocket을 통해 오디오를 스트리밍합니다.

**주요 기능**:
- OnVoice Bridge를 통한 오디오 캡처
- Python FastAPI 서버로 WebSocket 스트리밍 (`ws://localhost:8000/ws/audio`)
- 자동 재연결 로직 (중복 방지, 타이머 관리)
- 트레이 메뉴 통합

**사용 예시**:
```typescript
const audioManager = AudioManager.getInstance();
await audioManager.init();
await audioManager.startStream('chrome'); // 또는 'edge', 'discord'
await audioManager.stopStream();
```

### 4. 유해 표현 분석 클라이언트
**파일**: `electron/utils/harmfulAnalysisClient.ts`

FastAPI 서버의 `/analyze` 엔드포인트를 호출하여 텍스트의 유해성을 분석합니다.

```typescript
export async function sendTextForAnalysis(
  text: string,
  useAI: boolean = false
): Promise<AnalysisResult | AnalysisError>
```

### 5. OnVoice 서비스
**파일**: `electron/audio/onVoiceService.ts`

Electron Main Process에서 OnVoice 캡처를 관리하는 서비스 클래스입니다. IPC를 통한 렌더러 프로세스 연동을 지원합니다.

**주요 기능**:
- Deepgram 또는 서버 WebSocket 선택 지원
- STT 결과 자동 유해 표현 분석
- IPC를 통한 상태 브로드캐스트

### 6. IPC 핸들러
**파일**: `electron/ipc/onVoiceHandlers.ts`

렌더러 프로세스에서 OnVoice 캡처를 제어할 수 있는 IPC 핸들러입니다.

**IPC 채널** (`electron/ipc/channels.ts`):
```typescript
export const ONVOICE_CHANNELS = {
  START_CAPTURE: 'onvoice:startCapture',
  STOP_CAPTURE: 'onvoice:stopCapture',
  GET_STATUS: 'onvoice:get-status',
} as const;
```

## 🔧 기술 스택

- **C# COM Bridge**: `electron-edge-js` (v28.0.0)
- **C# DLL**: `OnVoiceComBridge.dll` (C# .NET 6.0)
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

### AudioManager 사용 (트레이 메뉴)

```typescript
import AudioManager from './main/AudioManager';

const audioManager = AudioManager.getInstance();
await audioManager.init();
await audioManager.startStream('chrome'); // 또는 'edge', 'discord'
// ... 나중에
await audioManager.stopStream();
```

### 직접 브리지 사용

```typescript
import { createOnVoiceCapture } from './audio/onVoiceBridgeAdapter';

const handle = createOnVoiceCapture({
  findPid: 'edge', // 또는 'chrome', 'discord', 또는 PID 번호
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

### AudioService (naudiodon2) vs OnVoiceService vs AudioManager

| 항목 | AudioService | OnVoiceService | AudioManager |
|------|-------------|----------------|--------------|
| 캡처 대상 | 시스템 전체 오디오 | 특정 프로세스 (Edge/Chrome 등) | 특정 프로세스 (Edge/Chrome/Discord) |
| 라이브러리 | naudiodon2 | electron-edge-js + C# DLL | electron-edge-js + C# DLL |
| 오디오 형식 | 디바이스 샘플 레이트 | 16kHz, mono, linear16 | 16kHz, mono, linear16 |
| STT | 서버 WebSocket | Deepgram 또는 서버 WebSocket | 서버 WebSocket만 (보안) |
| 사용 방식 | IPC (렌더러) | IPC (렌더러) | 트레이 메뉴 (직접) |
| IPC 채널 | `AUDIO_CHANNELS` | `ONVOICE_CHANNELS` | 없음 (직접 호출) |

**세 시스템은 독립적으로 동작**하며, 필요에 따라 선택하여 사용할 수 있습니다.

**AudioManager의 특징**:
- 보안 강화: Deepgram API 키를 Electron에 저장하지 않음 (서버에서만 관리)
- 단순화된 구조: 트레이 메뉴에서 직접 사용 가능
- 향상된 재연결 로직: 중복 방지, 타이머 관리

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

1. **C# DLL 필요**
   - `OnVoiceComBridge.dll`이 프로젝트에 포함되어 있어야 합니다.
   - 개발 모드: `dist-electron/dotnet/OnVoiceComBridge.dll`
   - 프로덕션 모드: `resources/dotnet/OnVoiceComBridge.dll`

2. **Windows 전용**
   - `electron-edge-js`는 Windows 전용 라이브러리입니다.
   - 다른 OS에서는 동작하지 않습니다.

3. **프로세스 찾기**
   - `findProcess()` 메서드로 Chrome, Edge, Discord 프로세스를 자동으로 찾을 수 있습니다.
   - PID를 직접 지정할 수도 있습니다.

4. **파일명 규칙**
   - 모든 OnVoice 관련 파일은 `onVoice` (대문자 V) 네이밍 규칙을 따릅니다.
   - `onVoiceBridge.ts`, `onVoiceService.ts`, `onVoiceBridgeAdapter.ts` 등

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

- [x] Chrome, Edge, Discord 프로세스 찾기 구현
- [x] AudioManager 추가 (트레이 메뉴 통합)
- [x] 파일명 네이밍 규칙 통일 (onVoice)
- [ ] Preload API에 OnVoice 메서드 추가
- [ ] Renderer UI 컴포넌트 추가 (선택적)
- [x] 에러 처리 및 재연결 로직 개선 (AudioManager)
- [x] 보안 강화 (Deepgram API 키를 서버에서만 관리)

## 업데이트 히스토리

- 2025-01-XX: AudioManager 추가 - 트레이 메뉴 기반 오디오 스트리밍, 보안 강화
- 2025-01-XX: 파일명 네이밍 규칙 통일 - `onvoice*` → `onVoice*`
- 2025-01-XX: Task 29 완료 - OnVoice COM Bridge 통합, 프로세스별 오디오 캡처 및 STT 연동

