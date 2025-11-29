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

## ✅ 결론

포터블 배포가 정상적으로 동작하도록 구현되어 있습니다:

1. ✅ **경로 처리**: `process.resourcesPath`를 사용하여 NSIS와 포터블 버전 모두 동일하게 동작
2. ✅ **빌드 설정**: `extraResources`가 올바르게 설정되어 모든 파일이 포함됨
3. ✅ **파일 검증**: 파일 존재 확인 로직으로 조기 오류 감지
4. ✅ **에러 로깅**: 디버깅을 위한 상세한 경로 로그

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

