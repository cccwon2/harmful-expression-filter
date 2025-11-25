# Task 39: C# 기반 PID 볼륨 제어 통합

## 상태

🔄 진행 중

## 📋 작업 개요

**목표**: Node.js 라이브러리(`native-sound-mixer`)에 의존하던 볼륨 제어 기능을 **C# COM Bridge (`OnVoiceComBridge`)**로 통합합니다.

**배경**:

- 현재 OCR, 오디오 캡처는 C# Bridge에서 담당하고 있지만, 볼륨 제어만 별도 Node.js 네이티브 모듈을 사용 중입니다.
- 아키텍처 통일성을 높이고, `native-sound-mixer`의 빌드/호환성 문제를 제거하기 위해 Windows Core Audio API를 직접 사용하는 C# 코드로 마이그레이션합니다.
- Task 38에서 정리된 `AppVolumeController` 구조를 유지하되, 내부 구현체만 교체합니다.

**관련 작업**:

- Task 26 (앱별 볼륨 조절 마이그레이션) ✅ - `native-sound-mixer` 기반 구현
- Task 29 (OnVoice COM Bridge 통합) ✅ - C# Bridge 인프라 구축
- Task 38 (코드 리팩토링 및 정리) ✅ - `AppVolumeController` 구조 정리

## 🎯 핵심 목표

- ✅ **아키텍처 통일**: 모든 Windows API 호출을 C# Bridge로 통합
- ✅ **의존성 제거**: `native-sound-mixer` 패키지 제거
- ✅ **호환성 개선**: 네이티브 모듈 빌드 문제 해결
- ✅ **기존 인터페이스 유지**: `AppVolumeController` API 변경 없음

---

## 1. C# 프로젝트 의존성 추가

### 1.1 NAudio 패키지 설치

**파일**: `dotnet/OnVoiceComBridge/OnVoiceComBridge.csproj`

Windows Core Audio API 접근을 위해 `NAudio.Wasapi` 패키지가 필요합니다.

**수정 내용**:

```xml
<ItemGroup>
  <PackageReference Include="NAudio.Wasapi" Version="2.2.1" />
</ItemGroup>
```

**설치 명령어**:

```bash
cd dotnet/OnVoiceComBridge
dotnet add package NAudio.Wasapi --version 2.2.1
```

**효과**:

- Windows Core Audio API (`WASAPI`) 직접 접근 가능
- `MMDeviceEnumerator`, `AudioSessionManager`, `SimpleAudioVolume` 사용 가능

---

## 2. C# 볼륨 제어 메서드 구현

### 2.1 Startup.cs에 setVolume 커맨드 추가

**파일**: `dotnet/OnVoiceComBridge/Startup.cs`

`Invoke` 메서드의 `switch` 문에 `setVolume` 커맨드를 추가합니다.

**요구사항**:

- **입력**: `{ "command": "setVolume", "pid": int, "volume": float }` (volume은 0.0 ~ 1.0)
- **로직**:
  1. `MMDeviceEnumerator`로 기본 렌더링 장치 획득
  2. `AudioSessionManager`에서 세션 열거
  3. 세션의 `GetProcessID`가 입력받은 PID와 일치하는지 확인
  4. 일치하면 `SimpleAudioVolume.Volume` 속성 설정
- **출력**: `{ "ok": true, "pid": 1234, "volume": 0.5 }` (실패 시 `ok: false`)

**구현 코드**:

```csharp
using NAudio.CoreAudioApi;

// ...

case "setVolume":
    return SetApplicationVolume(input);

// ...

private object SetApplicationVolume(dynamic input)
{
    try
    {
        int targetPid = (int)input.pid;
        float volume = (float)input.volume; // 0.0 ~ 1.0
        
        var deviceEnumerator = new MMDeviceEnumerator();
        var device = deviceEnumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        
        var sessions = device.AudioSessionManager.Sessions;
        bool found = false;
        
        for (int i = 0; i < sessions.Count; i++)
        {
            var session = sessions[i];
            if (session.GetProcessID == targetPid)
            {
                session.SimpleAudioVolume.Volume = volume;
                found = true;
                break; // 첫 번째 일치하는 세션만 조절
            }
        }
        
        return new { ok = found, pid = targetPid, volume = volume };
    }
    catch (Exception ex)
    {
        return new { ok = false, error = ex.Message };
    }
}
```

**주의사항**:

- `GetProcessID`는 속성이 아닌 메서드일 수 있으므로, 실제 API에 맞게 수정 필요
- 여러 세션이 같은 PID를 가질 수 있으므로, 첫 번째 일치하는 세션만 조절하거나 모든 세션을 조절할지 결정 필요

---

## 3. Electron Bridge 함수 추가

### 3.1 onVoiceBridge.ts에 setVolumeByPid 함수 추가

**파일**: `electron/main/onVoiceBridge.ts`

C# Bridge를 호출하는 TypeScript 래퍼 함수를 추가합니다.

**구현 코드**:

```typescript
/**
 * 특정 PID의 애플리케이션 볼륨 조절 (C# Bridge)
 * @param pid 프로세스 ID
 * @param volume 0.0 ~ 1.0 사이의 실수
 * @returns 성공 여부
 */
export async function setVolumeByPid(pid: number, volume: number): Promise<boolean> {
  const payload = {
    command: 'setVolume',
    pid: pid,
    volume: volume
  };
  
  try {
    const result = await callBridge(payload);
    return result && result.ok === true;
  } catch (error) {
    console.error(`[OnVoiceBridge] 볼륨 조절 실패 (PID: ${pid})`, error);
    return false;
  }
}
```

**주요 기능**:

- C# Bridge의 `setVolume` 커맨드 호출
- 에러 처리 및 로깅
- 성공/실패 여부 반환

---

## 4. AppVolumeController 리팩토링

### 4.1 native-sound-mixer 의존성 제거

**파일**: `electron/audio/appVolumeController.ts`

`native-sound-mixer` 의존성을 제거하고, C# Bridge의 `setVolumeByPid`를 사용하도록 수정합니다.

**변경 사항**:

- `import ... from 'native-sound-mixer'` 제거
- `import { setVolumeByPid } from '../main/onVoiceBridge'` 추가
- `setVolumeByPid` 메서드 내부 구현 교체

**스케일 변환 주의**:

- `AppVolumeController`는 내부적으로 0~10 스케일을 사용
- C#에 보낼 때는 **0.0 ~ 1.0**으로 정규화 필요

**수정된 코드**:

```typescript
// 변경 전
import soundMixer, { Device, DeviceType, AudioSession } from 'native-sound-mixer';

// 변경 후
import { setVolumeByPid as setVolumeByPidBridge } from '../main/onVoiceBridge';

// ...

public async setVolumeByPid(
  pid: number, 
  volumeLevel: number, 
  restoreDelayMs: number = this.DEFAULT_RESTORE_DELAY_MS
): Promise<boolean> {
  // level (0~10) -> volume (0.0 ~ 1.0)
  const normalizedVolume = Math.max(0, Math.min(1, volumeLevel / 10));
  
  const success = await setVolumeByPidBridge(pid, normalizedVolume);
  
  if (success) {
    // 원래 볼륨 저장 및 복원 타이머 설정 로직 유지
    // ...
  }
  
  return success;
}
```

**제거되는 기능**:

- `getAudioSessions()`: C# Bridge에서 제공하지 않으므로, 기존 로직 유지 또는 별도 구현 필요
- `setAppVolume()`: 앱 이름 기반 조절은 PID 조회 후 `setVolumeByPid` 호출로 대체

**대안**:

- `getAudioSessions()`는 기존 `native-sound-mixer` 로직을 유지하거나, C# Bridge에 `getAudioSessions` 커맨드를 추가
- 또는 WMIC/PowerShell을 사용하여 PID 조회 후 `setVolumeByPid` 호출

---

## 5. 의존성 정리

### 5.1 package.json에서 native-sound-mixer 제거

**파일**: `package.json`

`native-sound-mixer` 패키지를 제거합니다.

**명령어**:

```bash
npm uninstall native-sound-mixer
```

**확인 사항**:

- `package.json`에서 `native-sound-mixer` 항목 제거 확인
- `package-lock.json` 자동 업데이트 확인
- 다른 파일에서 `native-sound-mixer` import가 없는지 확인

---

## ✅ 검증 체크리스트

### 빌드 검증

- [ ] `npm run build:dotnet` 실행 시 에러 없이 DLL이 빌드되는가?
- [ ] `dotnet build` 실행 시 NAudio 패키지가 정상적으로 다운로드되는가?

### 런타임 검증

- [ ] `npm start` 실행 후, Electron 앱이 정상 구동되는가?
- [ ] C# Bridge 초기화 시 에러가 발생하지 않는가?

### 기능 검증

- [ ] 오디오가 발생하는 앱(Chrome/Youtube 등)을 켜고, 유해 표현 감지 시(또는 테스트 시) 해당 앱의 볼륨이 실제로 줄어드는가?
- [ ] PID 기반 볼륨 조절이 정상적으로 동작하는가?
- [ ] 볼륨 복원 기능이 정상적으로 동작하는가?

### 코드 정리 검증

- [ ] `native-sound-mixer` 관련 코드가 프로젝트에서 완전히 제거되었는가?
- [ ] `AppVolumeController`에서 `native-sound-mixer` import가 제거되었는가?
- [ ] `package.json`에서 `native-sound-mixer` 의존성이 제거되었는가?

---

## 🔧 기술 스택

- **C# COM Bridge**: `electron-edge-js` (기존)
- **C# DLL**: `OnVoiceComBridge.dll` (기존)
- **Windows Audio API**: `NAudio.Wasapi` (v2.2.1) - **신규 추가**
- **제거**: `native-sound-mixer` - **제거 예정**

---

## 📝 구현 세부사항

### C# 구현 시 주의사항

1. **GetProcessID 메서드**:
   - `AudioSessionControl.GetProcessID`는 속성일 수도 있고 메서드일 수도 있습니다.
   - 실제 NAudio API 문서를 참조하여 올바른 사용법 확인 필요

2. **세션 열거**:
   - `AudioSessionManager.Sessions`는 `IReadOnlyList<AudioSessionControl>`을 반환합니다.
   - 각 세션의 `SimpleAudioVolume` 속성을 통해 볼륨 조절 가능

3. **에러 처리**:
   - PID가 존재하지 않는 경우
   - 세션이 이미 종료된 경우
   - 권한 부족 등의 예외 처리 필요

### TypeScript 구현 시 주의사항

1. **스케일 변환**:
   - `AppVolumeController`는 0~10 스케일 사용
   - C# Bridge는 0.0~1.0 스케일 사용
   - 변환 로직을 명확히 구현

2. **비동기 처리**:
   - C# Bridge 호출은 비동기이므로 `async/await` 사용
   - 타임아웃 처리 고려 (기존 `BRIDGE_TIMEOUT_MS` 활용)

3. **에러 핸들링**:
   - C# Bridge 호출 실패 시 적절한 로깅 및 폴백 처리

---

## 🔗 참조 파일

- `dotnet/OnVoiceComBridge/Startup.cs`: C# 진입점
- `dotnet/OnVoiceComBridge/OnVoiceComBridge.csproj`: C# 프로젝트 파일
- `electron/main/onVoiceBridge.ts`: Electron ↔ C# 통신
- `electron/audio/appVolumeController.ts`: 볼륨 제어 로직
- `package.json`: Node.js 의존성 관리

---

## 🔄 마이그레이션 전략

### 단계별 접근

1. **Phase 1**: C# Bridge에 `setVolume` 커맨드 추가 및 테스트
2. **Phase 2**: `onVoiceBridge.ts`에 `setVolumeByPid` 함수 추가
3. **Phase 3**: `AppVolumeController.setVolumeByPid` 리팩토링
4. **Phase 4**: `native-sound-mixer` 의존성 제거
5. **Phase 5**: 전체 시스템 테스트 및 검증

### 롤백 계획

- 각 단계에서 이전 버전으로 롤백 가능하도록 Git 커밋 분리
- `native-sound-mixer` 코드는 완전히 제거하기 전까지 주석 처리로 보존

---

## 📊 성능 및 호환성

### 예상 개선사항

- **빌드 시간**: 네이티브 모듈 빌드 단계 제거로 빌드 시간 단축
- **호환성**: Windows 버전별 네이티브 모듈 호환성 문제 해결
- **아키텍처**: 모든 Windows API 호출이 C# Bridge로 통일되어 유지보수성 향상

### 잠재적 이슈

- **getAudioSessions()**: C# Bridge에서 제공하지 않으므로, 기존 로직 유지 또는 별도 구현 필요
- **앱 이름 기반 조절**: PID 조회 로직이 필요하므로, WMIC 또는 PowerShell 사용 필요

---

## 🔗 관련 작업

- **Task 26**: 앱별 볼륨 조절 마이그레이션 (loudness → native-sound-mixer) ✅
- **Task 29**: OnVoice COM Bridge 통합 ✅
- **Task 38**: 코드 리팩토링 및 정리 ✅

---

## 📝 다음 단계

- [ ] C# 프로젝트에 NAudio 패키지 추가
- [ ] `Startup.cs`에 `setVolume` 커맨드 구현
- [ ] `onVoiceBridge.ts`에 `setVolumeByPid` 함수 추가
- [ ] `AppVolumeController.setVolumeByPid` 리팩토링
- [ ] `native-sound-mixer` 의존성 제거
- [ ] 전체 시스템 테스트 및 검증
- [ ] `getAudioSessions()` 대안 구현 (필요 시)

---

## 업데이트 히스토리

- 2025-01-XX: Task 39 시작 - C# 기반 PID 볼륨 제어 통합 계획 수립

