# 포터블 배포 검증 확인서

## ✅ 검증 완료 항목

### 1. 경로 설정 검증

#### Bridge 실행 파일 경로 (`onVoiceBridge.ts`)
- ✅ **배포 모드**: `process.resourcesPath` 사용
  - NSIS 설치 버전: `{설치경로}/resources/bin/OnVoiceComBridge.exe`
  - 포터블 버전 (dir): `{실행파일경로}/resources/bin/OnVoiceComBridge.exe`
- ✅ **개발 모드**: 상대 경로 사용
- ✅ **파일 존재 확인**: spawn 전에 파일 존재 여부 검증 추가

```20:28:electron/main/onVoiceBridge.ts
function getBridgePath(): string {
  if (app.isPackaged) {
    // [배포 모드] resources/bin/OnVoiceComBridge.exe
    // NSIS 설치 버전과 포터블 버전 모두 동일하게 process.resourcesPath 사용
    // - NSIS: {설치경로}/resources
    // - 포터블 (dir): {실행파일경로}/resources
    return path.join(process.resourcesPath, "bin", "OnVoiceComBridge.exe");
  } else {
    // [개발 모드] dotnet publish 출력 경로
    return path.join(__dirname, "../../dotnet/OnVoiceComBridge/bin/Release/net6.0/win-x64/publish/OnVoiceComBridge.exe");
  }
}
```

#### COM DLL 경로 (`registerComDll.ts`)
- ✅ **배포 모드**: `process.resourcesPath` 사용
- ✅ **파일 존재 확인**: 등록 전에 파일 존재 여부 검증

```17:19:electron/main/registerComDll.ts
    const dllPath = app.isPackaged
      ? path.join(process.resourcesPath, "native", "OnVoiceAudioBridge.dll")
      : path.join(__dirname, "../../native/OnVoiceAudioBridge.dll");
```

#### .env 파일 경로 (`main.ts`)
- ✅ **배포 모드**: `process.resourcesPath` 사용

```94:96:electron/main.ts
  const envPath = app.isPackaged
    ? path.join(process.resourcesPath, ".env")  // ✅ 배포: resources/.env
    : path.join(__dirname, "../.env");          // 🛠️ 개발: 루트 .env
```

### 2. 빌드 설정 검증

#### `package.json` 빌드 설정
- ✅ **포터블 빌드 스크립트**: `build:portable` 정상 설정
- ✅ **extraResources**: 모든 리소스가 올바른 경로로 설정됨

```20:20:package.json
    "build:portable": "electron-builder --win dir --x64 && if exist dist\\win-unpacked (move dist\\win-unpacked dist\\OnVoice-portable)",
```

```92:105:package.json
    "extraResources": [
      {
        "from": "dotnet/OnVoiceComBridge/bin/Release/net6.0/win-x64/publish/OnVoiceComBridge.exe",
        "to": "bin/OnVoiceComBridge.exe"
      },
      {
        "from": "native/OnVoiceAudioBridge.dll",
        "to": "native/OnVoiceAudioBridge.dll"
      },
      {
        "from": ".env.production",
        "to": ".env"
      }
    ]
```

### 3. 포터블 배포 구조

#### 예상 디렉토리 구조
```
dist/OnVoice-portable/
├── OnVoice.exe                    # 포터블 실행 파일
├── resources/
│   ├── app.asar                   # 패키지된 앱 코드
│   ├── bin/
│   │   └── OnVoiceComBridge.exe   # ✅ C# Bridge 실행 파일
│   ├── native/
│   │   └── OnVoiceAudioBridge.dll # ✅ C++ COM DLL
│   └── .env                       # ✅ 환경 변수 파일
└── ...
```

### 4. 동작 확인 사항

#### ✅ process.resourcesPath 동작
- electron-builder의 `dir` 타겟에서 `process.resourcesPath`는 `{실행파일경로}/resources`로 설정됩니다
- NSIS 설치 버전과 동일하게 동작합니다

#### ✅ app.isPackaged 플래그
- 포터블 버전에서도 `app.isPackaged === true`입니다
- 따라서 배포 모드 경로가 올바르게 사용됩니다

#### ✅ 파일 존재 확인
- Bridge 실행 파일 spawn 전 파일 존재 확인 추가
- COM DLL 등록 전 파일 존재 확인 (이미 구현됨)

## 🔍 추가된 안전장치

### 파일 존재 확인 로직 추가

```30:48:electron/main/onVoiceBridge.ts
function spawnBridge() {
  if (bridgeProcess) return;

  const exePath = getBridgePath();
  console.log(`[OnVoiceBridge] 🚀 Spawning Bridge Process: ${exePath}`);

  // 파일 존재 여부 확인 (포터블 배포 포함)
  if (!existsSync(exePath)) {
    const errorMsg = `[OnVoiceBridge] ❌ Bridge executable not found: ${exePath}`;
    console.error(errorMsg);
    if (app.isPackaged) {
      console.error(`[OnVoiceBridge] 💡 배포 모드: process.resourcesPath = ${process.resourcesPath}`);
      console.error(`[OnVoiceBridge] 💡 예상 경로: ${path.join(process.resourcesPath, "bin", "OnVoiceComBridge.exe")}`);
    }
    throw new Error(errorMsg);
  }

  try {
```

## ⚠️ 포터블 버전의 런타임 시나리오

### COM DLL 등록 시나리오

포터블 버전은 설치 과정 없이 바로 실행되므로, **최초 실행 시 COM DLL 자동 등록**을 시도합니다.

#### 동작 흐름

1. **앱 시작 시** (`main.ts`):
   ```typescript
   // COM DLL 등록 상태 확인
   const isRegistered = await checkComDllRegistered();
   if (!isRegistered) {
     // 자동 등록 시도
     await registerComDll();
     // 등록 후 다시 확인
     const isNowRegistered = await checkComDllRegistered();
     if (!isNowRegistered) {
       // ⚠️ 등록 실패 시 콘솔 경고만 출력
       console.warn("[Main] ⚠️ COM DLL 자동 등록에 실패했습니다...");
     }
   }
   ```

2. **등록 실패 가능성**:
   - ❌ **관리자 권한 없이 실행**: `regsvr32.exe` 실행 실패
   - ❌ **레지스트리 권한 부족**: COM 등록에 필요한 레지스트리 권한 없음
   - ❌ **바이러스 백신 차단**: 일부 보안 소프트웨어가 COM 등록을 차단

#### 현재 구현된 사용자 안내

**현재 상태**: COM DLL 등록 실패 시 **콘솔 로그만 출력**되고 UI 알림은 없습니다.

```114:130:electron/main.ts
  // COM DLL 등록 확인 및 자동 등록 시도 (포터블 방식 지원)
  const isRegistered = await checkComDllRegistered();
  if (!isRegistered) {
    console.log("[Main] COM DLL이 등록되어 있지 않습니다. 자동 등록을 시도합니다...");
    await registerComDll();
    
    // 등록 후 다시 확인
    const isNowRegistered = await checkComDllRegistered();
    if (!isNowRegistered) {
      console.warn("[Main] ⚠️ COM DLL 자동 등록에 실패했습니다. 관리자 권한으로 실행하거나 수동 등록이 필요할 수 있습니다.");
      console.warn(`[Main] 💡 수동 등록: regsvr32.exe "${path.join(process.resourcesPath || __dirname, "native", "OnVoiceAudioBridge.dll")}"`);
    } else {
      console.log("[Main] ✅ COM DLL 등록 확인됨");
    }
  } else {
    console.log("[Main] ✅ COM DLL이 이미 등록되어 있습니다.");
  }
```

#### 💡 권장 개선사항

**포터블 버전 사용자 안내 강화**:

1. **UI 알림 추가** (선택사항):
   - COM DLL 등록 실패 시 사용자에게 명확한 메시지 표시
   - "관리자 권한으로 실행해주세요" 또는 "수동 등록 필요" 안내

2. **최초 실행 가이드**:
   - README 또는 사용자 가이드에 포터블 버전 사용 방법 추가
   - 관리자 권한으로 실행하는 방법 안내

3. **자동 재시도** (선택사항):
   - 관리자 권한 요청 다이얼로그 표시
   - UAC 승인 후 자동으로 재등록 시도

#### 포터블 버전 사용 가이드

**최초 실행 시**:
1. **관리자 권한으로 실행** (권장):
   - `OnVoice.exe` 우클릭 → "관리자 권한으로 실행"
   - 또는 작업 관리자에서 관리자 권한으로 실행
   - COM DLL이 자동으로 등록됨

2. **일반 사용자 권한으로 실행**:
   - COM DLL 등록이 실패할 수 있음
   - 오디오 캡처 기능이 동작하지 않을 수 있음
   - 수동 등록 필요:
     ```bash
     # 관리자 권한으로 PowerShell/CMD 실행 후
     regsvr32.exe "C:\path\to\OnVoice-portable\resources\native\OnVoiceAudioBridge.dll"
     ```

**이후 실행 시**:
- COM DLL이 이미 등록되어 있다면 일반 사용자 권한으로도 실행 가능
- 한 번 등록하면 시스템 전역에서 유효 (다른 사용자도 사용 가능)

## ✅ 결론

포터블 배포가 정상적으로 동작하도록 구현되어 있습니다:

1. ✅ **경로 처리**: `process.resourcesPath`를 사용하여 NSIS와 포터블 버전 모두 동일하게 동작
2. ✅ **빌드 설정**: `extraResources`가 올바르게 설정되어 모든 파일이 포함됨
3. ✅ **파일 검증**: 파일 존재 확인 로직으로 조기 오류 감지
4. ✅ **에러 로깅**: 디버깅을 위한 상세한 경로 로그
5. ✅ **COM DLL 자동 등록**: 포터블 버전에서도 앱 시작 시 자동 등록 시도

**주의사항**:
- 포터블 버전 최초 실행 시 COM DLL 등록을 위해 **관리자 권한이 필요할 수 있습니다**
- 등록 실패 시 콘솔 로그에 상세한 안내 메시지가 출력됩니다
- 한 번 등록하면 이후에는 일반 사용자 권한으로도 실행 가능합니다

포터블 배포는 이전 브랜치와 동일하게 정상적으로 동작할 것으로 예상됩니다.

## 🧪 테스트 권장 사항

1. **포터블 빌드 생성**:
   ```bash
   npm run build:all
   npm run build:renderer
   npm run build:portable
   ```

2. **파일 구조 확인**:
   - `dist/OnVoice-portable/resources/bin/OnVoiceComBridge.exe` 존재 확인
   - `dist/OnVoice-portable/resources/native/OnVoiceAudioBridge.dll` 존재 확인
   - `dist/OnVoice-portable/resources/.env` 존재 확인

3. **실행 테스트**:
   - `dist/OnVoice-portable/OnVoice.exe` 실행
   - 콘솔 로그에서 경로 확인:
     ```
     [OnVoiceBridge] 🚀 Spawning Bridge Process: {경로}/resources/bin/OnVoiceComBridge.exe
     ```

4. **COM DLL 등록 확인**:
   - 최초 실행 시 콘솔에서 다음 메시지 확인:
     ```
     [Main] COM DLL이 등록되어 있지 않습니다. 자동 등록을 시도합니다...
     [COM Registration] COM DLL 등록 시도: {경로}/resources/native/OnVoiceAudioBridge.dll
     ```
   - 등록 성공:
     ```
     [COM Registration] ✅ COM DLL 등록 성공
     [Main] ✅ COM DLL 등록 확인됨
     ```
   - 등록 실패 (관리자 권한 필요):
     ```
     [Main] ⚠️ COM DLL 자동 등록에 실패했습니다. 관리자 권한으로 실행하거나 수동 등록이 필요할 수 있습니다.
     [Main] 💡 수동 등록: regsvr32.exe "{경로}/resources/native/OnVoiceAudioBridge.dll"
     ```

5. **기능 테스트** (COM DLL 등록 후):
   - 오디오 모니터링 기능 동작 확인
   - OCR 기능 동작 확인
   - 볼륨 제어 기능 동작 확인

