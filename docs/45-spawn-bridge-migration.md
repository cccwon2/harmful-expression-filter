# Task 45: Spawn 방식 Bridge 마이그레이션

## ✅ 상태: 완료

## 📋 작업 개요

`electron-edge-js` 기반의 C# COM Bridge를 Node.js의 `child_process.spawn` 방식으로 마이그레이션하여 더 안정적이고 독립적인 프로세스 통신 구조를 구현했습니다.

## 🎯 마이그레이션 배경

### 기존 방식 (electron-edge-js)의 문제점

1. **Electron 버전 종속성**: Electron 버전이 변경될 때마다 재빌드 필요
2. **네이티브 모듈 복잡성**: `.node` 파일 관리 및 빌드 복잡도
3. **패키징 이슈**: electron-builder 패키징 시 모듈 재빌드 문제
4. **디버깅 어려움**: 프로세스 내에서 실행되어 디버깅이 어려움
5. **크래시 영향**: C# 코드 오류가 Electron 메인 프로세스를 함께 종료시킬 수 있음

### 새로운 방식 (Spawn)의 장점

1. **프로세스 분리**: C# Bridge가 별도 프로세스로 실행되어 안정성 향상
2. **빌드 단순화**: `.exe` 파일만 필요, 네이티브 모듈 불필요
3. **디버깅 용이**: 독립 프로세스로 실행되어 디버깅 및 로깅이 쉬움
4. **패키징 단순화**: `extraResources`에 `.exe`만 포함하면 됨
5. **오류 격리**: C# 프로세스 크래시가 Electron 프로세스에 영향을 주지 않음
6. **표준 통신**: JSON over stdio를 통한 표준 프로세스 간 통신

## 🏗️ 아키텍처 변경

### 기존 아키텍처 (electron-edge-js)

```
Renderer (React)
    ↓ IPC
Main Process (Electron)
    ↓ electron-edge-js (네이티브 모듈)
C# DLL (OnVoiceComBridge.dll)
    ↓ COM Interop
OnVoiceAudioBridge.OnVoiceCapture (COM)
```

### 새로운 아키텍처 (Spawn)

```
Renderer (React)
    ↓ IPC
Main Process (Electron)
    ↓ child_process.spawn
    ↓ JSON over stdio (stdin/stdout)
C# Process (OnVoiceComBridge.exe)
    ↓ COM Interop
OnVoiceAudioBridge.OnVoiceCapture (COM)
```

## 📦 변경된 파일

### 1. C# 프로젝트 변경

#### `dotnet/OnVoiceComBridge/Program.cs` (신규)

**변경 사항**: `electron-edge-js` 엔트리포인트 제거, 독립 실행형 콘솔 애플리케이션으로 변경

```csharp
class Program
{
    static async Task Main(string[] args)
    {
        // Stdio 통신을 위해 UTF-8 인코딩 설정
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;

        var startup = new Startup();
        
        // 오디오 데이터 이벤트 구독
        Startup.OnAudioDataReceived += (data) => SendMessage(data);

        // 초기화 메시지 전송
        SendMessage(new { type = "status", message = "OnVoiceComBridge Started" });

        // JSON 명령어를 stdin에서 읽어 처리
        while (true)
        {
            string? line = await Console.In.ReadLineAsync();
            if (line == null) break;

            // JSON 파싱 및 Startup.Invoke 호출
            var command = JsonSerializer.Deserialize<JsonElement>(line);
            // ...
        }
    }
}
```

**주요 특징**:
- 표준 입력(stdin)에서 JSON 명령어 수신
- 표준 출력(stdout)으로 JSON 응답 전송
- 비동기 처리로 여러 요청 동시 처리 지원
- 오디오 데이터는 이벤트 방식으로 푸시

#### `dotnet/OnVoiceComBridge/Startup.cs`

**변경 사항**: `electron-edge-js` 엔트리포인트 제거, JSON over stdio 통신 지원

```csharp
public class Startup
{
    // JSON 명령어 처리 메서드
    public async Task<object> Invoke(dynamic input)
    {
        string command = input.command;
        // 명령어에 따라 처리
        return await HandleCommand(command, input);
    }

    // 오디오 데이터 이벤트 (전역)
    public static event Action<byte[]> OnAudioDataReceived;
}
```

### 2. Electron Bridge 변경

#### `electron/main/onVoiceBridge.ts` (전면 재작성)

**변경 사항**: `electron-edge-js` 제거, `child_process.spawn` 사용

```typescript
import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";

let bridgeProcess: ChildProcess | null = null;
let bridgeReadline: readline.Interface | null = null;
const pendingRequests = new Map<string, { resolve: any; reject: any; timer: NodeJS.Timeout }>();

function spawnBridge() {
  if (bridgeProcess) return;

  const exePath = getBridgePath();
  bridgeProcess = spawn(exePath, [], {
    stdio: ['pipe', 'pipe', 'inherit'], // stdin, stdout, stderr
    windowsHide: true
  });

  // Readline으로 stdout에서 JSON 라인 단위로 읽기
  bridgeReadline = readline.createInterface({
    input: bridgeProcess.stdout,
    terminal: false
  });

  bridgeReadline.on('line', (line) => {
    const msg = JSON.parse(line);
    handleBridgeMessage(msg);
  });
}

function callBridge(command: string, payload: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = uuidv4();
    const request = { ...payload, command, id };

    pendingRequests.set(id, { resolve, reject, timer: setTimeout(...) });

    // JSON 명령어를 stdin에 쓰기
    const json = JSON.stringify(request) + '\n';
    bridgeProcess.stdin.write(json);
  });
}
```

**주요 특징**:
- `spawn()`으로 C# 프로세스 실행
- `readline`을 통한 라인 단위 JSON 파싱
- UUID 기반 요청-응답 매칭
- 타임아웃 처리
- 프로세스 종료 시 자동 정리

### 3. 빌드 시스템 변경

#### `package.json`

**변경 사항**: `electron-edge-js` 의존성 제거, 빌드 스크립트 단순화

```json
{
  "scripts": {
    "build:dotnet": "cd dotnet/OnVoiceComBridge && dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o bin/Release/net6.0/win-x64/publish"
  },
  "build": {
    "extraResources": [
      {
        "from": "dotnet/OnVoiceComBridge/bin/Release/net6.0/win-x64/publish/OnVoiceComBridge.exe",
        "to": "bin/OnVoiceComBridge.exe"
      }
    ]
  }
}
```

**제거된 스크립트**:
- `scripts/protect-edge-module.js`
- `scripts/restore-edge-module.js`
- `scripts/fix-packaged-edge-module.js`
- `scripts/fix-deps-json.js`

## 🔧 통신 프로토콜

### 요청 형식 (Electron → C#)

```json
{
  "command": "init",
  "id": "unique-request-id",
  "payload": { ... }
}
```

### 응답 형식 (C# → Electron)

```json
{
  "type": "response",
  "id": "unique-request-id",
  "result": { ... }
}
```

### 오류 응답 형식

```json
{
  "type": "error",
  "id": "unique-request-id",
  "error": "Error message"
}
```

### 오디오 데이터 푸시 (C# → Electron)

```json
{
  "type": "audio",
  "data": "base64-encoded-pcm-data",
  "timestamp": 1234567890
}
```

### 상태 메시지

```json
{
  "type": "status",
  "message": "OnVoiceComBridge Started"
}
```

## 📝 사용 방법

### Bridge 초기화

```typescript
import { onVoiceBridge } from "./main/onVoiceBridge";

await onVoiceBridge.init((pcm: Buffer, timestamp?: number) => {
  console.log('Audio data received:', pcm.length, 'bytes');
  // 오디오 데이터 처리
});
```

### 프로세스 찾기

```typescript
const pid = await onVoiceBridge.findProcess('chrome');
// 또는
const pid = await onVoiceBridge.findProcess('edge');
// 또는
const pid = await onVoiceBridge.findProcess('discord');
```

### 캡처 시작/중지

```typescript
await onVoiceBridge.startCapture(pid);
// ...
await onVoiceBridge.stopCapture();
```

### OCR 수행

```typescript
const result = await onVoiceBridge.performOCRAndAnalyze(imageBuffer, roi);
if (result.ok) {
  console.log('OCR text:', result.text);
  console.log('Is harmful:', result.isHarmful);
}
```

## 🚀 빌드 및 배포

### 개발 환경

```bash
# C# 프로젝트 빌드 (self-contained .exe)
npm run build:dotnet

# TypeScript 컴파일
npm run build:main

# 개발 서버 실행
npm run dev
```

**경로**: `dotnet/OnVoiceComBridge/bin/Release/net6.0/win-x64/publish/OnVoiceComBridge.exe`

### 프로덕션 환경

```bash
# 전체 빌드
npm run build

# 배포 패키지 생성
npm run build:electron
```

**경로**: `dist/win-unpacked/resources/bin/OnVoiceComBridge.exe`

## 🔍 디버깅

### C# 프로세스 디버깅

1. Visual Studio에서 `dotnet/OnVoiceComBridge/Program.cs`를 직접 실행
2. 콘솔에 JSON 명령어를 입력하여 테스트
3. `stderr`는 Electron 프로세스에 상속되어 로그 확인 가능

### Electron 프로세스 디버깅

```typescript
// onVoiceBridge.ts에 로깅 추가
console.log('[OnVoiceBridge] 🚀 Spawning Bridge Process:', exePath);
console.log('[OnVoiceBridge] 📨 Sending command:', command);
console.log('[OnVoiceBridge] 📥 Received response:', msg);
```

### 통신 로그 확인

```bash
# C# 프로세스의 stdout/stderr는 Electron 콘솔에 출력됨
# stderr는 'inherit'로 설정되어 있음
```

## ⚠️ 주의사항

### 1. 프로세스 경로

**개발 모드**:
```typescript
path.join(__dirname, "../../dotnet/OnVoiceComBridge/bin/Release/net6.0/win-x64/publish/OnVoiceComBridge.exe")
```

**배포 모드**:
```typescript
path.join(process.resourcesPath, "bin", "OnVoiceComBridge.exe")
```

### 2. 인코딩

C# 프로세스에서 UTF-8 인코딩을 명시적으로 설정:
```csharp
Console.InputEncoding = Encoding.UTF8;
Console.OutputEncoding = Encoding.UTF8;
```

### 3. JSON 직렬화

- `System.Text.Json` 사용 (C#)
- `JSON.stringify/parse` 사용 (TypeScript)
- Base64 인코딩은 바이너리 데이터 전송 시 사용

### 4. 프로세스 종료 처리

Bridge 프로세스가 예기치 않게 종료되면:
- 모든 대기 중인 요청이 거부됨
- `onAudioDataCallback`은 더 이상 호출되지 않음
- 필요 시 재시작 로직 구현 필요

### 5. 타임아웃

기본 타임아웃: 10초 (`BRIDGE_TIMEOUT_MS`)
- 타임아웃 발생 시 요청이 거부됨
- 프로세스가 응답하지 않으면 자동으로 정리

## 🔄 마이그레이션 체크리스트

- [x] C# 프로젝트를 독립 실행형 `.exe`로 변경
- [x] `Program.cs`에서 stdio 통신 구현
- [x] `electron/main/onVoiceBridge.ts`를 spawn 방식으로 재작성
- [x] JSON over stdio 통신 프로토콜 정의
- [x] UUID 기반 요청-응답 매칭 구현
- [x] 오디오 데이터 푸시 메커니즘 구현
- [x] 프로세스 경로 처리 (개발/배포 모드)
- [x] 오류 처리 및 타임아웃 처리
- [x] `electron-edge-js` 의존성 제거
- [x] 관련 스크립트 파일 제거
- [x] 문서 업데이트

## 📚 관련 문서

- [Task 29: OnVoice COM Bridge 통합](./29-onvoice-com-bridge-integration.md)
- [Task 30: electron-edge-js 마이그레이션](./30-electron-edge-js-migration.md) ⚠️ **Deprecated**
- [Task 31: COM 이벤트 구현 가이드](./31-com-event-implementation-guide.md)
- [Task 34: Windows OCR 성능 최적화](./34-windows-ocr-optimization.md)

## 🗒️ 업데이트 로그

- 2025-01-XX: Task 45 완료 - Spawn 방식 Bridge 마이그레이션
  - `electron-edge-js` 의존성 제거
  - `child_process.spawn` 방식으로 전환
  - JSON over stdio 통신 프로토콜 구현
  - 독립 프로세스 실행으로 안정성 향상

