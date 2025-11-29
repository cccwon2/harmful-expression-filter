# Task 45: Spawn 방식 Bridge 마이그레이션

## ✅ 상태: 완료

## 📋 작업 개요

`electron-edge-js` 기반의 C# COM Bridge를 Node.js의 `child_process.spawn` 방식으로 마이그레이션하여 더 안정적이고 독립적인 프로세스 통신 구조를 구현했습니다.

## 🎯 마이그레이션 배경

### 기존 방식 (electron-edge-js)의 문제점

1. **Electron 버전 종속성**: Electron 버전이 변경될 때마다 재빌드 필요

   - Node ABI 버전 호환성 문제로 실행 실패 가능
   - 배포 시 가장 큰 걸림돌 (Task 42 배포 단계의 주요 문제점)

2. **네이티브 모듈 복잡성**: `.node` 파일 관리 및 빌드 복잡도

   - 빌드 도구 체인 복잡
   - 플랫폼별 빌드 환경 구축 필요

3. **패키징 이슈**: electron-builder 패키징 시 모듈 재빌드 문제

   - 패키징 과정에서 모듈이 잘못 재빌드되는 경우 발생

4. **디버깅 어려움**: 프로세스 내에서 실행되어 디버깅이 어려움

   - Electron과 C# 코드가 섞여 있어 분리 디버깅 복잡

5. **크래시 영향**: C# 코드 오류가 Electron 메인 프로세스를 함께 종료시킬 수 있음

   - 라이브 방송 보조 도구에서는 치명적 (방송 중 앱 종료)

6. **메인 프로세스 블로킹**: 무거운 작업 시 Electron UI가 버벅거릴 수 있음

### 새로운 방식 (Spawn)의 장점

1. **프로세스 분리 및 안정성**: C# Bridge가 별도 프로세스로 실행되어 안정성 향상

   - C# 프로세스가 죽어도 Electron은 살아있음 (Fault Isolation)
   - 오디오 서비스 재시작 로직 구현 가능

2. **배포 안정성**: "DLL Hell" 및 Node 버전 의존성 탈출 (가장 큰 장점)

   - Electron 업데이트와 무관하게 동작
   - Self-contained 배포로 .NET 런타임도 함께 포함

3. **빌드 단순화**: `.exe` 파일만 필요, 네이티브 모듈 불필요

   - 표준 .NET 빌드 프로세스만 사용

4. **디버깅 용이**: 독립 프로세스로 실행되어 디버깅 및 로깅이 쉬움

   - Visual Studio에서 EXE만 따로 실행/디버깅 가능
   - Electron 없이도 C# 로직 테스트 가능

5. **패키징 단순화**: `extraResources`에 `.exe`만 포함하면 됨

   - 네이티브 모듈 빌드 스크립트 불필요

6. **표준 통신**: JSON over stdio를 통한 표준 프로세스 간 통신

   - 프로세스 간 통신 표준 패턴

7. **메인 프로세스 성능**: OS 스케줄러에 의해 완전히 별도의 프로세스로 동작
   - 무거운 작업이 Electron UI 성능에 영향을 주지 않음

### 아키텍처 비교표

| 비교 항목              | **electron-edge-js (기존)**                                  | **spawn / Sidecar (변경 후)**                                                     |
| :--------------------- | :----------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| **실행 방식**          | Electron 메인 프로세스 내부에서 DLL 직접 로드 (In-Process)   | 별도의 `.exe` 프로세스로 실행하고 표준 입출력(Stdio) 등으로 통신 (Out-of-Process) |
| **통신 속도**          | ⚡ **매우 빠름** (메모리 직접 접근, 함수 호출 수준)          | 🐌 **느림** (직렬화/역직렬화 오버헤드 + 파이프 통신 비용)                         |
| **안정성**             | ❌ **낮음** (C# 코드 크래시 = Electron 앱 전체 종료)         | ✅ **높음** (C# 프로세스가 죽어도 Electron은 살아있음)                            |
| **호환성**             | ⚠️ **까다로움** (Electron/Node 버전에 민감, ABI 호환성 문제) | ✅ **우수함** (Node 버전과 무관, OS에서 실행만 되면 됨)                           |
| **디버깅**             | 어려움 (Electron과 섞여 있어 분리 디버깅 복잡)               | 쉬움 (Visual Studio에서 EXE만 따로 실행/디버깅 가능)                              |
| **배포 복잡도**        | 높음 (네이티브 모듈 빌드 및 ABI 호환성 관리)                 | 낮음 (Self-contained EXE만 포함)                                                  |
| **파일 크기**          | 작음 (DLL만 포함)                                            | 큼 (Self-contained 배포 시 .NET 런타임 포함)                                      |
| **메인 프로세스 영향** | 있음 (메인 스레드 리소스 공유)                               | 없음 (완전히 별도 프로세스)                                                       |

### 새로운 방식 (Spawn)의 단점 및 주의사항

1. **통신 오버헤드와 레이턴시 (Latency)**

   - 모든 데이터를 JSON으로 직렬화/역직렬화해야 함
   - Base64 인코딩으로 바이너리 데이터 변환 필요
   - **영향 분석**:
     - ✅ 단순 명령(볼륨 제어, OCR 결과 수신): 문제없음
     - ⚠️ **실시간 오디오 데이터**: 대용량 데이터의 경우 직렬화 비용 증가
     - 💡 **완화 방법**: OnVoice는 이미 WebSocket이나 C++ Native 모듈을 통해 오디오를 처리하므로, C# Bridge는 명령 전달만 담당하여 병목이 되지 않음

2. **프로세스 수명 관리 복잡도 증가**

   - Electron 시작 시 프로세스 spawn 필요
   - Electron 종료 시 프로세스 확실히 종료 필요 (고아 프로세스 방지)
   - 예기치 않은 종료 시 재연결 로직 필요
   - 좀비 프로세스 방지 로직 필요

3. **배포 파일 크기 증가**
   - Self-contained 배포 시 .NET 런타임 포함 (약 50-100MB 증가)
   - 기존 DLL만 포함하던 방식 대비 용량 증가
   - **완화 방법**: Framework-dependent 배포 사용 시 용량 절감 가능 (단, .NET 런타임 설치 필요)

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
  console.log("Audio data received:", pcm.length, "bytes");
  // 오디오 데이터 처리
});
```

### 프로세스 찾기

```typescript
const pid = await onVoiceBridge.findProcess("chrome");
// 또는
const pid = await onVoiceBridge.findProcess("edge");
// 또는
const pid = await onVoiceBridge.findProcess("discord");
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
  console.log("OCR text:", result.text);
  console.log("Is harmful:", result.isHarmful);
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
console.log("[OnVoiceBridge] 🚀 Spawning Bridge Process:", exePath);
console.log("[OnVoiceBridge] 📨 Sending command:", command);
console.log("[OnVoiceBridge] 📥 Received response:", msg);
```

### 통신 로그 확인

```bash
# C# 프로세스의 stdout/stderr는 Electron 콘솔에 출력됨
# stderr는 'inherit'로 설정되어 있음
```

## ⚠️ 주의사항 및 모범 사례

### 1. 프로세스 경로

**개발 모드**:

```typescript
path.join(__dirname, "../../dotnet/OnVoiceComBridge/bin/Release/net6.0/win-x64/publish/OnVoiceComBridge.exe");
```

**배포 모드**:

```typescript
path.join(process.resourcesPath, "bin", "OnVoiceComBridge.exe");
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
- 대용량 데이터 전송 시 성능 고려 필요

### 4. 프로세스 수명 관리 (Lifecycle Management)

프로세스 수명 관리는 spawn 방식에서 가장 중요한 부분입니다.

#### 프로세스 시작 (Spawn)

```typescript
function spawnBridge() {
  if (bridgeProcess) return; // 중복 방지

  bridgeProcess = spawn(exePath, [], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });

  // 프로세스 종료 이벤트 처리
  bridgeProcess.on("exit", (code, signal) => {
    console.log(`Bridge process exited with code ${code}`);
    bridgeProcess = null;
    // 모든 대기 중인 요청 거부
    rejectAllPendingRequests();
  });

  bridgeProcess.on("error", (err) => {
    console.error("Bridge process error:", err);
    bridgeProcess = null;
  });
}
```

#### 프로세스 종료 (Cleanup)

**Electron 종료 시 확실한 프로세스 종료:**

```typescript
app.on("before-quit", () => {
  if (bridgeProcess) {
    // SIGTERM으로 우아하게 종료 시도
    bridgeProcess.kill("SIGTERM");

    // 5초 후에도 종료되지 않으면 강제 종료
    setTimeout(() => {
      if (bridgeProcess && !bridgeProcess.killed) {
        bridgeProcess.kill("SIGKILL");
      }
    }, 5000);
  }
});

// 윈도우 닫기 시에도 처리
app.on("window-all-closed", () => {
  cleanupBridgeProcess();
});
```

**좀비 프로세스 방지:**

```typescript
function cleanupBridgeProcess() {
  if (bridgeProcess) {
    try {
      if (!bridgeProcess.killed) {
        bridgeProcess.kill();
      }
      bridgeProcess = null;
      bridgeReadline = null;
    } catch (error) {
      console.error("Error cleaning up bridge process:", error);
    }
  }
}
```

#### 예기치 않은 종료 감지 및 재시작

```typescript
bridgeProcess.on("exit", (code, signal) => {
  if (code !== 0 && code !== null) {
    console.error(`Bridge process crashed with code ${code}`);

    // 재시작 로직 (선택적)
    if (shouldAutoRestart) {
      setTimeout(() => {
        console.log("Attempting to restart bridge process...");
        spawnBridge();
      }, 1000);
    }
  }

  // 모든 대기 중인 요청 거부
  for (const [id, req] of pendingRequests) {
    clearTimeout(req.timer);
    req.reject(new Error("Bridge process exited unexpectedly"));
  }
  pendingRequests.clear();
});
```

#### 작업 관리자에서 강제 종료된 경우 처리

```typescript
// 주기적으로 프로세스 상태 확인 (선택적)
setInterval(() => {
  if (bridgeProcess && bridgeProcess.killed) {
    console.warn("Bridge process was killed externally");
    bridgeProcess = null;
    // 필요 시 재시작 로직
  }
}, 5000);
```

### 5. 타임아웃

기본 타임아웃: 10초 (`BRIDGE_TIMEOUT_MS`)

- 타임아웃 발생 시 요청이 거부됨
- 프로세스가 응답하지 않으면 자동으로 정리
- 오디오 스트리밍 같은 장시간 작업은 타임아웃 적용 제외

### 6. 실시간 오디오 데이터 처리 최적화

**현재 아키텍처 (Task 35)에서의 오디오 처리:**

OnVoice 프로젝트는 이미 다음과 같은 구조를 사용하므로, C# Bridge의 통신 오버헤드는 문제가 되지 않습니다:

1. **오디오 캡처**: C++ Native 모듈 (`OnVoiceAudioBridge.dll`)에서 직접 처리
2. **오디오 전송**: WebSocket을 통해 Python FastAPI 서버로 스트리밍
3. **C# Bridge 역할**:
   - 프로세스 찾기 (`findProcess`)
   - 볼륨 제어 (`setVolume`)
   - OCR 처리 (`performOCR`)
   - 명령 전달만 담당하므로 통신 오버헤드 최소

**만약 향후 C# Bridge를 통한 대용량 데이터 전송이 필요하다면:**

- Named Pipe 사용 고려 (Windows 전용이지만 더 빠름)
- Shared Memory 사용 고려 (최고 성능, 복잡도 증가)
- Binary 프로토콜 사용 고려 (JSON 대신)

### 7. 성능 모니터링

```typescript
// 통신 지연 시간 측정 (디버깅용)
const callBridgeWithTiming = async (command: string, payload: any) => {
  const startTime = Date.now();
  try {
    const result = await callBridge(command, payload);
    const elapsed = Date.now() - startTime;
    if (elapsed > 100) {
      // 100ms 이상 걸리면 경고
      console.warn(`[Bridge] Slow command: ${command} took ${elapsed}ms`);
    }
    return result;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[Bridge] Command failed: ${command} (${elapsed}ms)`, error);
    throw error;
  }
};
```

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

## 🎯 OnVoice 프로젝트에 Spawn 방식이 적합한 이유

멘토 분석에 따르면, OnVoice 프로젝트에는 Spawn 방식이 더 적합합니다:

1. **안정성이 최우선**: 라이브 방송 보조 도구는 방송 중 앱이 꺼지면 치명적입니다. 오디오 모듈이 죽더라도 UI는 살아있어야 합니다.

2. **배포 스트레스 감소**: 네이티브 모듈 빌드와 ABI 호환성은 배포 시 가장 큰 걸림돌입니다. 이를 제거하는 것만으로도 큰 이득입니다.

3. **성능 이슈는 해결 가능**:

   - 단순 명령(볼륨 제어, OCR 결과 수신)은 JSON 통신으로 충분합니다.
   - 대용량 오디오 데이터는 어차피 현재 아키텍처(Task 35)에서 C++ Native 모듈이나 WebSocket을 통해 처리하므로, C# 쪽에 spawn을 써도 병목이 되지 않습니다.

4. **개발 생산성 향상**: C# 로직을 Electron 없이 독립적으로 개발하고 테스트할 수 있습니다.

## 🔍 검증 체크리스트

마이그레이션 후 다음 사항들을 확인하세요:

- [ ] Electron 종료 시 `bridgeProcess.kill()`이 확실히 호출되는가?
- [ ] 예기치 않게 종료되었을 때 좀비 프로세스가 남지 않는가?
- [ ] 프로세스가 강제 종료되었을 때 재연결 로직이 동작하는가?
- [ ] 통신 지연 시간이 허용 범위 내인가? (단순 명령: <100ms)
- [ ] 메모리 누수가 없는가? (pendingRequests 정리 확인)
- [ ] 오류 처리 및 로깅이 충분한가?

## 🗒️ 업데이트 로그

- 2025-01-XX: Task 45 완료 - Spawn 방식 Bridge 마이그레이션
  - `electron-edge-js` 의존성 제거
  - `child_process.spawn` 방식으로 전환
  - JSON over stdio 통신 프로토콜 구현
  - 독립 프로세스 실행으로 안정성 향상
  - 프로세스 수명 관리(Lifecycle Management) 구현
  - 멘토 피드백 반영: 장단점 분석 및 모범 사례 추가
