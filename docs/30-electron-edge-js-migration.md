# electron-edge-js + C# COM Bridge 마이그레이션 가이드

## 개요

winax 기반의 OnVoice COM bridge를 electron-edge-js + C# wrapper로 마이그레이션한 내용을 설명합니다.

## 아키텍처

```
Renderer (React)
    ↓ IPC
Main Process (Electron)
    ↓ electron-edge-js
C# Bridge (OnVoiceComBridge.dll)
    ↓ COM Interop
OnVoiceAudioBridge.OnVoiceCapture (COM)
```

## 파일 구조

### C# 프로젝트
- `dotnet/OnVoiceComBridge/OnVoiceComBridge.csproj` - .NET 6 프로젝트 파일
- `dotnet/OnVoiceComBridge/Startup.cs` - electron-edge-js 엔트리포인트 + COM 래퍼

### Electron Main Process
- `electron/main/onvoiceBridge.ts` - electron-edge-js로 C# DLL 호출
- `electron/main/ipc/onvoiceIpc.ts` - IPC 핸들러 (Renderer ↔ Main)

### 어댑터
- `electron/audio/onvoiceBridgeAdapter.ts` - 기존 인터페이스 호환 어댑터

## 빌드 방법

### 전체 빌드
```bash
npm run build:all
```

이는 다음을 순차적으로 실행합니다:
1. `npm run build:dotnet` - C# DLL 빌드
2. `npm run copy:dll` - DLL을 `dist-electron/dotnet/`로 복사
3. `npm run build:main` - TypeScript 컴파일

### 개별 빌드
```bash
# C# DLL만 빌드
npm run build:dotnet

# DLL 복사
npm run copy:dll

# TypeScript 컴파일
npm run build:main
```

## 사용 방법

### 기본 사용 (새로운 Bridge 직접 사용)

```typescript
import { onVoiceBridge } from './main/onvoiceBridge';

// 초기화 (한 번만)
await onVoiceBridge.init((pcm: Buffer) => {
  console.log('Audio data received:', pcm.length, 'bytes');
  // 오디오 데이터 처리
});

// 오디오 이벤트 리스너 (선택적)
onVoiceBridge.events.on('audio', (pcm: Buffer) => {
  console.log('Audio event:', pcm.length, 'bytes');
});

// 캡처 시작 (PID 직접 지정)
await onVoiceBridge.startCapture(12345);

// 캡처 중지
await onVoiceBridge.stopCapture();
```

### 어댑터 사용 (기존 인터페이스 호환)

```typescript
import { createOnVoiceCapture } from './audio/onvoiceBridgeAdapter';

const handle = createOnVoiceCapture({
  findPid: 12345, // PID 직접 지정 (프로세스 자동 검색은 TODO)
  onData: (buf: Buffer) => {
    console.log('Audio data:', buf.length, 'bytes');
    // 오디오 데이터 처리
  },
  onError: (err: Error) => {
    console.error('Error:', err);
  }
});

// 캡처 시작
handle.start();

// 캡처 중지
handle.stop();

// 리소스 정리
handle.dispose();
```

### IPC를 통한 사용 (Renderer ↔ Main)

**Main Process (electron/main.ts)**:
```typescript
import { registerOnVoiceIpc } from './ipc/onvoiceIpc';

// IPC 핸들러 등록
registerOnVoiceIpc(() => overlayWindow); // overlayWindow 반환 함수
```

**Renderer Process**:
```typescript
import { ipcRenderer } from 'electron';

// 오디오 데이터 수신
ipcRenderer.on('onvoice:audio', (event, buf: Buffer) => {
  console.log('Audio data received:', buf.length, 'bytes');
});

// 캡처 시작
await ipcRenderer.invoke('onvoice:start-capture', 12345);

// 캡처 중지
await ipcRenderer.invoke('onvoice:stop-capture');
```

## 기존 코드 마이그레이션

### 기존 (winax 기반)

```typescript
import { createOnVoiceCapture } from './audio/onvoiceCaptureBridge';

const handle = createOnVoiceCapture({
  findPid: 'chrome',
  onData: (buf) => { /* ... */ }
});
```

### 새로운 Bridge 사용

#### 옵션 1: 어댑터 사용 (기존 인터페이스 유지)

```typescript
import { createOnVoiceCapture } from './audio/onvoiceBridgeAdapter';

const handle = createOnVoiceCapture({
  findPid: 12345, // PID 직접 지정 (필수)
  onData: (buf) => { /* ... */ }
});
```

#### 옵션 2: 새로운 Bridge 직접 사용 (권장)

```typescript
import { onVoiceBridge } from './main/onvoiceBridge';

await onVoiceBridge.init((buf) => { /* ... */ });
await onVoiceBridge.startCapture(12345);
```

## TODO / 미완성 부분

### 1. COM 이벤트 구독 구현 (C#)

`dotnet/OnVoiceComBridge/Startup.cs`의 `SubscribeComEvents()` 메서드를 실제 COM 인터페이스에 맞게 구현해야 합니다:

```csharp
private static void SubscribeComEvents()
{
    if (_capture == null) return;

    // TODO: 실제 COM 인터페이스에 맞게 구현
    // 예시:
    // ((IOnVoiceCapture)_capture).OnAudioData += OnAudioData;
}
```

### 2. 프로세스 자동 검색

현재는 PID를 직접 지정해야 합니다. 프로세스 자동 검색 기능을 추가하려면:

**옵션 A**: JavaScript에서 프로세스 검색 (node-process-list 등)
**옵션 B**: C#에서 COM 메서드 호출 (FindEdgeProcess 등)

### 3. 에러 처리 개선

- C# → Node 에러 전달 개선
- COM 초기화 실패 시 재시도 로직
- 타임아웃 처리

## 문제 해결

### DLL을 찾을 수 없음

DLL이 `dist-electron/dotnet/OnVoiceComBridge.dll`에 있는지 확인:
```bash
npm run copy:dll
```

### COM 객체 생성 실패

1. COM 객체가 등록되어 있는지 확인:
   ```cmd
   reg query "HKEY_CLASSES_ROOT\OnVoiceAudioBridge.OnVoiceCapture"
   ```

2. ProgID 확인:
   - `dotnet/OnVoiceComBridge/Startup.cs`의 `progId` 값 확인

### electron-edge-js 로드 실패

1. electron-edge-js 설치 확인:
   ```bash
   npm install electron-edge-js
   ```

2. Electron 버전 호환성 확인 (Electron 37 + Node.js 22)

## 참고 자료

- [electron-edge-js 문서](https://github.com/agracio/electron-edge-js)
- [.NET COM Interop](https://learn.microsoft.com/dotnet/standard/native-interop/cominterop)
- [OnVoice COM Bridge 통합 문서](./29-onvoice-com-bridge-integration.md)

