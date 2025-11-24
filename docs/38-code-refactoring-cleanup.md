# Task 38: 코드 리팩토링 및 정리

## 상태

✅ 완료

## 📋 작업 개요

**목표**: "C# = Windows 래퍼 / PID 볼륨 = AppVolumeController" 목표 달성을 위한 코드 정리 및 리팩토링

**배경**:

- Task 34에서 서버 분석 로직을 제거하고 C# 브리지를 Windows API 래퍼로 정리
- Task 26에서 앱별 볼륨 제어를 `native-sound-mixer`로 마이그레이션
- 하지만 일부 파일에서 아직 완전히 정리되지 않은 부분과 버그가 존재
- 특히 `VolumeController`가 아직 `AppVolumeController`를 사용하지 않고 중복된 디바이스 접근 구조 유지

**관련 작업**:

- T34 (Windows OCR 성능 최적화) ✅ - 서버 분석 제거
- T26 (앱별 볼륨 조절 마이그레이션) ✅ - AppVolumeController 구현

## 🎯 리팩토링 목표

1. **Startup.cs**: 불필요한 using 제거로 서버 의존성 완전 제거
2. **AppVolumeController.ts**: WMIC 주석 추가, sessionKey 형식 개선, 복원 타이머 세션별 관리
3. **VolumeController.ts**: AppVolumeController 주입 구조로 변경, 생성자 버그 수정, 볼륨 스케일링 정리

---

## 1. Startup.cs 리팩토링

### 1.1 불필요한 using 제거

**문제점**:

- 서버 분석 로직이 제거되었지만 `HttpClient`, `Json`, HTTP 관련 using이 남아있음
- 빌드에는 문제 없지만 "서버 로직 제거"를 코드 레벨에서 명확하게 하기 위해 정리 필요

**수정 내용**:

```csharp
// ❌ 제거된 using
using System.Net.Http;
using System.Text.Json;
using System.Text;

// ✅ 유지된 using
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Threading;
using System.Threading.Tasks;
using System.Reflection;
using System.Drawing; 
using System.Drawing.Imaging;
using System.IO;
```

**효과**:

- 서버 의존성 완전 제거를 코드 레벨에서 명확히 표현
- 불필요한 네임스페이스 제거로 코드 가독성 향상

### 1.2 ocrAndBlur 주석 개선

**수정 내용**:

```csharp
case "ocrAndBlur":
    try
    {
        // Node.js에서 유해 표현 분석을 수행하므로, 이 메서드는
        // OCR 텍스트만 반환하고 blur는 별도 "blur" 명령에서 처리합니다.
        
        byte[] imageBytes = (byte[])input.imageData;
        // ...
    }
```

**효과**:

- 메서드의 역할이 명확해짐
- OCR과 blur의 분리 의도가 명시됨

### 1.3 현재 상태

- ✅ `HttpClient`, `_serverUrl`, `AnalyzeTextForHarmfulContent` 같은 서버 분석 로직 완전 제거
- ✅ `ocr`, `ocrAndBlur`, `blur` 모두 **로컬 작업(OCR / Blur)**만 수행
- ✅ "Windows API 래퍼" 역할에 충실

---

## 2. AppVolumeController.ts 리팩토링

### 2.1 WMIC 의존성 주석 추가

**문제점**:

- WMIC은 최신 Windows에서 deprecated 상태
- 장기적으로 PowerShell 또는 C# 브리지로 교체 예정이지만 주석이 없음

**수정 내용**:

```typescript
/**
 * PID로 프로세스 경로 조회 (Windows 전용)
 *
 * NOTE:
 *  - wmic은 최신 Windows에서 deprecated 상태입니다.
 *  - 현재는 PoC 용도로 사용하고, 추후 PowerShell(Get-Process) 또는
 *    C# 브리지 메서드로 대체하는 것이 좋습니다.
 */
private async getProcessPathByPid(pid: number): Promise<string | null> {
  // ...
}
```

**효과**:

- 향후 개선 방향 명시
- 유지보수 시 참고 가능

### 2.2 sessionKey 형식 개선

**문제점**:

- 현재 `"name_appName"` 형식 사용
- 앱 이름에 `_`가 포함될 경우 파싱 시 문제 발생 가능

**수정 내용**:

```typescript
// ❌ 이전: "name_appName" 형식
id: s.name + '_' + s.appName

// ✅ 개선: JSON.stringify 형식
id: JSON.stringify({ name: s.name, appName: s.appName })
```

**복원 로직도 함께 수정**:

```typescript
// ❌ 이전: split('_') 사용
const [name, appName] = key.split('_');

// ✅ 개선: JSON.parse 사용
const { name, appName } = JSON.parse(key);
```

**효과**:

- 파싱 안전성 향상
- 앱 이름에 특수 문자가 포함되어도 문제 없음

### 2.3 복원 타이머 세션별 관리

**문제점**:

- 단일 `restoreTimer` 사용
- 동시에 여러 앱 볼륨을 건드렸을 때 마지막 호출이 이전 타이머를 덮어씀

**수정 내용**:

```typescript
// ❌ 이전: 단일 타이머
private restoreTimer: NodeJS.Timeout | null = null;

// ✅ 개선: 세션별 타이머 관리
private restoreTimers: Map<string, NodeJS.Timeout> = new Map();
```

**타이머 설정 로직**:

```typescript
// 기존 복원 타이머 취소 (해당 세션의 타이머만)
const existingTimer = this.restoreTimers.get(sessionKey);
if (existingTimer) {
  clearTimeout(existingTimer);
  this.restoreTimers.delete(sessionKey);
}

// 자동 복원 타이머 설정 (세션별로 관리)
if (restoreDelayMs > 0) {
  const timer = setTimeout(() => {
    void this.restoreVolume(sessionKey, actualSession);
    this.restoreTimers.delete(sessionKey);
  }, restoreDelayMs);
  this.restoreTimers.set(sessionKey, timer);
}
```

**효과**:

- 여러 앱을 동시에 제어해도 각각 독립적으로 복원 타이머 관리
- 타이머 충돌 방지

---

## 3. VolumeController.ts 리팩토링

### 3.1 AppVolumeController 주입 구조로 변경

**문제점**:

- `VolumeController`가 여전히 직접 `native-sound-mixer`와 디바이스를 잡고 있음
- `AppVolumeController`도 내부에서 `getDefaultDevice()`를 하고 있어 디바이스/세션 중복 접근 구조 유지

**목표**:

> VolumeController를 AppVolumeController 인스턴스를 사용하도록 리팩터링
> → 디바이스/세션 폴링은 한 군데(AppVolumeController)만.

**수정 내용**:

```typescript
// ❌ 이전: 직접 native-sound-mixer 사용
import soundMixer, { Device, DeviceType, AudioSession } from 'native-sound-mixer';

export class VolumeController {
  private defaultDevice: Device | null = null;
  
  private initializeDefaultDevice(): void {
    this.defaultDevice = soundMixer.getDefaultDevice(DeviceType.RENDER);
  }
}

// ✅ 개선: AppVolumeController 주입
import { AppVolumeController } from './appVolumeController';

export class VolumeController {
  private readonly appVolumeController: AppVolumeController;
  private currentVolumeLevel: number = DEFAULT_VOLUME_LEVEL;
  private targetAppKey: string | null = null;
  private targetAppIdentifier: string | null = null;

  constructor(appVolumeController: AppVolumeController, targetAppName?: string | null) {
    this.appVolumeController = appVolumeController;
    if (targetAppName) {
      this.setTargetApp(targetAppName);
    }
  }
}
```

**앱 이름 매핑 개선**:

```typescript
/**
 * 대상 앱 이름 설정
 *
 * - "chrome" → "chrome.exe"
 * - "edge"   → "msedge.exe"
 * - "discord" → "Discord.exe"
 * - 그 외에는 입력값 그대로 사용
 */
setTargetApp(targetApp: 'chrome' | 'edge' | 'discord' | string | null): void {
  if (!targetApp) {
    this.targetAppKey = null;
    this.targetAppIdentifier = null;
    return;
  }

  const lower = targetApp.toLowerCase();
  const appNameMap: Record<string, string> = {
    chrome: 'chrome.exe',
    edge: 'msedge.exe',
    discord: 'Discord.exe',
  };

  this.targetAppKey = lower;
  this.targetAppIdentifier = appNameMap[lower] ?? targetApp;
}
```

**볼륨 설정 로직 변경**:

```typescript
// ✅ 개선: AppVolumeController 위임
async setVolumeLevel(
  level: number,
  options?: { restoreDelayMs?: number },
): Promise<void> {
  const clampedLevel = this.clampLevel(level);
  this.currentVolumeLevel = clampedLevel;

  if (!this.targetAppIdentifier) {
    console.warn('[VolumeController] Target app not set');
    return;
  }

  const controllerLevel = this.volumeLevelToControllerLevel(clampedLevel);
  const restoreDelay = options?.restoreDelayMs;

  await this.appVolumeController.setAppVolume(
    this.targetAppIdentifier,
    controllerLevel,
    restoreDelay,
  );
}
```

**효과**:

- `native-sound-mixer` 의존성은 모두 `AppVolumeController` 안으로 집중
- `VolumeController`는 "레벨(1~9), 타겟 앱 추상화"에만 집중
- 디바이스/세션 중복 접근 제거
- 앱 이름 매핑이 명확해짐

### 3.2 생성자 버그 수정 및 PID 기반 제어 추가

**문제점**:

- 생성자에서 `targetAppName`만 설정하고 `setTargetApp()`을 호출하지 않음
- PID 기반 볼륨 제어 기능이 없음

**수정 내용**:

```typescript
// ❌ 이전: setTargetApp 호출 안 함, PID 지원 없음
constructor(targetAppName?: string) {
  this.targetAppName = targetAppName || null;
  this.initializeDefaultDevice();
}

// ✅ 개선: setTargetApp 자동 호출, PID 지원 추가
constructor(appVolumeController: AppVolumeController, targetAppName?: string | null) {
  this.appVolumeController = appVolumeController;
  if (targetAppName) {
    this.setTargetApp(targetAppName);
  }
}

/**
 * PID 기반 볼륨 제어
 */
async setVolumeByPid(
  pid: number,
  level?: number,
  options?: { restoreDelayMs?: number },
): Promise<boolean> {
  const effectiveLevel = level ?? this.currentVolumeLevel ?? DEFAULT_VOLUME_LEVEL;
  const clampedLevel = this.clampLevel(effectiveLevel);
  this.currentVolumeLevel = clampedLevel;

  const controllerLevel = this.volumeLevelToControllerLevel(clampedLevel);
  const restoreDelay = options?.restoreDelayMs;

  return await this.appVolumeController.setVolumeByPid(
    pid,
    controllerLevel,
    restoreDelay,
  );
}
```

**효과**:

- 생성자에서 `targetAppName`을 넘기면 자동으로 `setTargetApp()` 호출
- `targetAppIdentifier`가 올바르게 초기화됨
- PID 기반 볼륨 제어 지원으로 `AudioManager`에서 직접 PID로 제어 가능

### 3.3 볼륨 스케일링 명시화

**문제점**:

- `VolumeController`: 1~9 → 10%~90%, 0은 사용 안 함 (무소음 제외)
- `AppVolumeController`: 0~10 → 0%~100%, 0은 음소거
- 두 모듈이 연결될 때 변환 규칙이 명시적이지 않음

**수정 내용**:

```typescript
/**
 * 레벨(1~9)을 10%~90% 퍼센트로 변환
 */
private volumeLevelToPercent(level: number): number {
  const clampedLevel = this.clampLevel(level);
  return clampedLevel * 10; // 1~9 → 10%~90%
}

/**
 * 레벨(1~9)을 AppVolumeController에서 사용하는 0~10 스케일로 변환
 * 여기서는 "최대 90%" 정책을 유지하기 위해 1~9를 그대로 1~9로 사용 (10은 사용 안 함)
 */
private volumeLevelToControllerLevel(level: number): number {
  return this.clampLevel(level); // 1~9 유지 (AppVolumeController: 0~10 → 0%~100%)
}

/**
 * 레벨 범위 보정 (1~9)
 */
private clampLevel(level: number): number {
  return Math.max(MIN_VOLUME_LEVEL, Math.min(MAX_VOLUME_LEVEL, Math.round(level)));
}
```

**사용 위치**:

```typescript
async setVolumeLevel(
  level: number,
  options?: { restoreDelayMs?: number },
): Promise<void> {
  const clampedLevel = this.clampLevel(level);
  this.currentVolumeLevel = clampedLevel;

  const controllerLevel = this.volumeLevelToControllerLevel(clampedLevel); // 1~9
  const restoreDelay = options?.restoreDelayMs;

  await this.appVolumeController.setAppVolume(
    this.targetAppIdentifier,
    controllerLevel,
    restoreDelay,
  );
}
```

**효과**:

- 변환 규칙이 명시적으로 함수로 분리됨
- 향후 스케일 변경 시 수정 용이
- 레벨 보정 로직이 명확해짐

### 3.4 주석 오타 수정

**문제점**:

- `getCurrentVolumeLevel()` 주석: `현재 볼륨 레벨 반환 (0~9)`라고 되어 있지만
- 실제 값은 `MIN_VOLUME_LEVEL = 1`부터라 1~9가 맞음

**수정 내용**:

```typescript
/**
 * 현재 볼륨 레벨 반환 (1~9)
 */
getCurrentVolumeLevel(): number {
  return this.currentVolumeLevel;
}
```

**효과**:

- 문서와 실제 동작 일치
- 혼란 방지

---

## 4. 사용처 업데이트

### 4.1 AudioManager.ts

```typescript
// AppVolumeController를 생성하고 VolumeController에 주입
this.appVolumeController = new AppVolumeController();
this.volumeController = new VolumeController(this.appVolumeController);

// 유해 표현 감지 시 PID 기반 볼륨 제어
async handleHarmfulExpressionDetected() {
  if (this.currentPid) {
    // PID 기반 볼륨 감소 (예: 레벨 1 = 10%)
    await volumeController.setVolumeByPid(this.currentPid, 1);
  } else {
    // PID 없으면 fallback으로 타깃 앱 이름 기반
    await volumeController.setVolumeLevel(1);
  }
}
```

### 4.2 onvoiceService.ts

```typescript
// 볼륨 조절 활성화 시 AppVolumeController와 VolumeController 초기화
if (this.options.enableVolumeControl) {
  this.appVolumeController = new AppVolumeController();
  this.volumeController = new VolumeController(this.appVolumeController);
  // ...
}
```

---

## ✅ 완료된 작업 요약

### Startup.cs
- ✅ 불필요한 using 제거 (`System.Net.Http`, `System.Text.Json`, `System.Text`)
- ✅ 서버 의존성 완전 제거를 코드 레벨에서 명확히 표현
- ✅ `ocrAndBlur` 주석 개선 (OCR과 blur 분리 의도 명시)

### AppVolumeController.ts
- ✅ WMIC 의존성 주석 추가 (향후 PowerShell/C# 브리지로 대체 예정)
- ✅ sessionKey 형식 개선 (`JSON.stringify` 사용)
- ✅ 복원 타이머 세션별 관리 (`Map<string, NodeJS.Timeout>`)

### VolumeController.ts
- ✅ AppVolumeController 주입 구조로 변경
- ✅ `native-sound-mixer` 의존성 완전 제거 (모두 AppVolumeController로 위임)
- ✅ 생성자 버그 수정 (자동으로 `setTargetApp()` 호출)
- ✅ PID 기반 볼륨 제어 추가 (`setVolumeByPid()` 메서드)
- ✅ 앱 이름 매핑 개선 (chrome → chrome.exe, edge → msedge.exe, discord → Discord.exe)
- ✅ 볼륨 스케일링 명시화 (`clampLevel()`, `volumeLevelToControllerLevel()` 함수 추가)
- ✅ 주석 오타 수정 (0~9 → 1~9)

### 사용처 업데이트
- ✅ `AudioManager.ts`: AppVolumeController 주입
- ✅ `onvoiceService.ts`: AppVolumeController 주입

---

## 🎯 최종 결과

### 아키텍처 정리

```
C# 브리지 (Startup.cs)
  └─ COM + OCR + Blur 래퍼 (서버 의존성 완전 제거)

Node.js 측
  └─ AppVolumeController (중앙 디바이스/세션 관리)
      └─ VolumeController (레벨 스케일링 + 앱명 추상화)
          └─ AudioManager / OnVoiceService (사용)
```

### 개선 효과

1. **중복 제거**: 디바이스/세션 접근이 `AppVolumeController`로 중앙화
2. **역할 분리**: 
   - `AppVolumeController`: 디바이스/세션 관리, PID 기반 제어
   - `VolumeController`: 레벨 스케일링, 앱명 추상화
3. **유지보수성 향상**: 
   - 버그 수정 (생성자, sessionKey 파싱)
   - 명시적 변환 규칙
   - 향후 개선 방향 명시 (WMIC → PowerShell/C#)

---

## 📝 관련 파일

- `dotnet/OnVoiceComBridge/Startup.cs` - C# COM Bridge
- `electron/audio/appVolumeController.ts` - 앱별 볼륨 제어 (중앙 관리)
- `electron/audio/volumeController.ts` - 볼륨 레벨 컨트롤러 (파사드)
- `electron/main/AudioManager.ts` - 오디오 스트리밍 관리자
- `electron/audio/onvoiceService.ts` - OnVoice 서비스

---

## 🔗 관련 작업

- [Task 34: Windows OCR 성능 최적화](./34-windows-ocr-optimization.md) - 서버 분석 제거
- [Task 26: 앱별 볼륨 조절 마이그레이션](./26-app-volume-migration.md) - AppVolumeController 구현

