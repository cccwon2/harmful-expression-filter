# 작업 42: Electron 앱 배포

## 상태
✅ 완료

## 개요

Electron 애플리케이션을 Windows용 설치 패키지(NSIS 인스톨러)로 빌드하고 배포하는 프로세스를 설정합니다. electron-builder를 사용하여 프로덕션 빌드, C# DLL 및 C++ COM DLL 포함, 설치 패키지 생성 등을 자동화합니다.

## 완료된 기능

### 빌드 시스템 구성
- ✅ electron-builder 설정 (`package.json`)
- ✅ Windows NSIS 인스톨러 타겟 설정
- ✅ C# DLL 자동 포함 (extraResources)
- ✅ C++ COM DLL 포함 방법 문서화
- ✅ 프로덕션 빌드 스크립트

### 주요 설정

#### package.json 빌드 설정
```json
{
  "build": {
    "productName": "OnVoice",
    "appId": "com.onvoice.app",
    "directories": {
      "output": "dist"
    },
    "win": {
      "target": "nsis",
      "requestedExecutionLevel": "asInvoker"
    },
    "extraResources": [
      {
        "from": "dotnet/OnVoiceComBridge/bin/Debug/net6.0",
        "to": "dotnet",
        "filter": [
          "**/*.dll",
          "**/*.json"
        ]
      }
    ]
  }
}
```

### 빌드 프로세스

1. **C# DLL 빌드**: `.NET 6` 프로젝트를 빌드하여 DLL 생성
2. **C++ COM DLL 빌드** (선택): C++ COM DLL을 **Release 모드**로 빌드하거나 기존 Release DLL 사용
   - ⚠️ **중요**: 배포 시에는 반드시 **Release 빌드**를 사용해야 합니다
   - Debug 빌드는 Debug Runtime 라이브러리에 의존하여 일반 사용자 PC에서 실행되지 않습니다
3. **DLL 복사**: 빌드된 DLL들을 적절한 위치로 복사 (Release 우선)
4. **TypeScript 컴파일**: 메인 프로세스 TypeScript 코드 컴파일
5. **렌더러 빌드**: Vite를 사용하여 React 앱 빌드
6. **패키징**: electron-builder로 설치 패키지 생성

## 의존성

- [작업 1: 기본 Electron 앱 설정](./01-electron-setup.md)
- [작업 30: electron-edge-js 마이그레이션](./30-electron-edge-js-migration.md)
- [작업 39: C# 기반 PID 볼륨 제어 통합](./39-csharp-volume-control.md)

## 빌드 스크립트

### 개발 빌드
```bash
# 전체 빌드 (C# DLL + 복사 + TypeScript)
npm run build:all
```

### 프로덕션 빌드
```bash
# 1. 전체 소스 빌드
npm run build:all

# 2. 렌더러 빌드 (Vite)
npm run build:renderer

# 3. Electron 패키지 생성 (electron-builder)
npm run build:electron
```

### 통합 빌드 스크립트 (권장)
`package.json`에 다음 스크립트를 추가할 수 있습니다:

```json
{
  "scripts": {
    "build": "npm run build:all && npm run build:renderer && electron-builder",
    "build:renderer": "vite build",
    "build:electron": "electron-builder",
    "build:win": "npm run build && electron-builder --win"
  }
}
```

## 배포 단계

### 1. 사전 요구사항 확인

#### 필수 도구
- Node.js 18+ 및 npm
- .NET 6 SDK (C# DLL 빌드용)
- Windows SDK (Windows 빌드용)
- **Visual Studio 2019 이상 또는 Visual Studio Build Tools** (C++ 컴파일러)
  - "C++ 빌드 도구" 워크로드 필수
  - MSBuild가 PATH에 없어도 스크립트가 자동으로 찾습니다

#### 환경 변수
```bash
# .NET 경로 확인
echo %DOTNET_ROOT%
# 또는
echo $env:DOTNET_ROOT

# Electron 환경 변수
set EDGE_USE_CORECLR=1
set DOTNET_ROOT=C:\Program Files\dotnet

# C++ COM DLL 프로젝트 경로 (선택사항, 기본값 자동 탐색)
set NATIVE_PROJECT_PATH=C:\github\onvoice-com-bridge\phase3-com-dll\OnVoiceAudioBridge
```

### 2. 프로젝트 빌드

```bash
# 의존성 설치
npm install

# 전체 빌드
npm run build:all

# 렌더러 빌드
npm run build:renderer
```

### 3. Electron 패키지 생성

```bash
# Windows 인스톨러 생성
npm run build:electron

# 또는 직접 실행
npx electron-builder
```

### 4. 빌드 결과물

빌드가 완료되면 `dist/` 폴더에 다음 파일들이 생성됩니다:

```
dist/
├── OnVoice Setup 1.0.0.exe    # NSIS 인스톨러
├── win-unpacked/              # 압축 해제된 앱 (테스트용)
│   ├── OnVoice.exe
│   ├── resources/
│   │   ├── app.asar          # 패키지된 앱 코드
│   │   └── dotnet/            # C# DLL 포함
│   └── ...
└── builder-debug.yml          # 빌드 로그
```

## 빌드 설정 상세

### Windows 설정

#### NSIS 인스톨러 옵션
```json
{
  "win": {
    "target": [
      {
        "target": "nsis",
        "arch": ["x64"]
      }
    ],
    "requestedExecutionLevel": "asInvoker",
    "icon": "build/icon.ico"  // 아이콘 파일 경로 (선택사항)
  }
}
```

#### 추가 NSIS 옵션 (선택사항)
```json
{
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "OnVoice"
  }
}
```

### 리소스 포함

#### C# DLL 포함
`extraResources` 설정을 통해 C# DLL이 앱과 함께 배포됩니다:

```json
{
  "extraResources": [
    {
      "from": "dotnet/OnVoiceComBridge/bin/Debug/net6.0",
      "to": "dotnet",
      "filter": ["**/*.dll", "**/*.json"]
    }
  ]
}
```

런타임에서 DLL 경로 접근:
```typescript
// electron/main/onvoiceBridge.ts
const dllPath = path.join(
  process.resourcesPath,
  'dotnet',
  'OnVoiceComBridge.dll'
);
```

#### C++ COM DLL 포함 (필수)

C# DLL이 `OnVoiceAudioBridge.OnVoiceCapture` COM 객체를 사용하므로, C++ COM DLL도 함께 배포해야 합니다.

**포함 방법 선택**

C++ COM DLL을 프로젝트에 포함하는 방법은 여러 가지가 있습니다:

##### 방법 1: Git 서브모듈로 포함 (권장)

별도 리포지토리의 C++ 프로젝트를 서브모듈로 포함:

```bash
# 서브모듈 추가
git submodule add https://github.com/cccwon2/onvoice-com-bridge.git native/OnVoiceAudioBridge

# 서브모듈 초기화 및 업데이트
git submodule update --init --recursive
```

프로젝트 구조:
```
harmful-expression-filter/
├── native/
│   └── OnVoiceAudioBridge/     # 서브모듈
│       └── phase3-com-dll/
│           └── OnVoiceAudioBridge/  # 실제 프로젝트
│               ├── OnVoiceCapture.cpp
│               ├── OnVoiceCapture.h
│               └── OnVoiceAudioBridge.sln
├── dotnet/
└── electron/
```

**참고**: 실제 프로젝트는 `phase3-com-dll/OnVoiceAudioBridge/` 경로에 있습니다.

빌드 스크립트 추가 (`package.json`):
```json
{
  "scripts": {
    "build:native": "cd native/OnVoiceAudioBridge && msbuild OnVoiceAudioBridge.sln /p:Configuration=Release",
    "build:all": "npm run build:dotnet && npm run build:native && npm run copy:dll && npm run build:main"
  }
}
```

##### 방법 2: 상대 경로로 프로젝트 사용 (권장)

C++ 프로젝트가 현재 프로젝트와 같은 레벨에 있는 경우:

```
github/
├── harmful-expression-filter/  # 현재 프로젝트
│   ├── electron/
│   ├── dotnet/
│   └── native/                  # 빌드된 DLL 저장
└── onvoice-com-bridge/          # C++ 프로젝트
    └── phase3-com-dll/
        └── OnVoiceAudioBridge/
            └── OnVoiceAudioBridge.sln
```

스크립트가 자동으로 `../onvoice-com-bridge/phase3-com-dll/OnVoiceAudioBridge` 경로를 찾습니다:

```bash
# 빌드 실행 (자동으로 상대 경로 탐색)
npm run build:native
```

또는 환경 변수로 상대 경로 지정:

```bash
# 상대 경로로 지정
set NATIVE_PROJECT_PATH=../onvoice-com-bridge/phase3-com-dll/OnVoiceAudioBridge
npm run build:native
```

빌드된 DLL 복사:

```bash
# 빌드된 DLL을 native 폴더로 복사
copy ..\onvoice-com-bridge\phase3-com-dll\OnVoiceAudioBridge\x64\Release\OnVoiceAudioBridge.dll native\
npm run copy:native
```

##### 방법 3: 절대 경로로 프로젝트 사용

C++ 프로젝트가 다른 위치에 있는 경우:

```bash
# 환경 변수로 절대 경로 지정
set NATIVE_PROJECT_PATH=C:\github\onvoice-com-bridge\phase3-com-dll\OnVoiceAudioBridge
npm run build:native
```

##### 방법 3: C++ 소스 코드 직접 포함

C++ 소스 코드를 프로젝트에 직접 포함:

```bash
# native 폴더 생성
mkdir -p native/OnVoiceAudioBridge

# C++ 소스 코드 복사 또는 클론
git clone https://github.com/cccwon2/onvoice-com-bridge.git native/OnVoiceAudioBridge
```

프로젝트 구조:
```
harmful-expression-filter/
├── native/
│   └── OnVoiceAudioBridge/     # C++ 소스 코드
│       ├── OnVoiceCapture.cpp
│       ├── OnVoiceCapture.h
│       ├── OnVoiceAudioBridge.sln
│       └── ...
├── dotnet/
└── electron/
```

**권장 방법**: 방법 1 (Git 서브모듈)을 사용하면:
- 원본 리포지토리와 동기화 가능
- 버전 관리 용이
- 프로젝트 구조가 깔끔함

**빌드된 DLL을 package.json에 추가**

어떤 방법을 선택하든, 최종적으로 빌드된 DLL을 `native/` 폴더에 배치하고 `package.json`에 추가합니다:

```json
{
  "scripts": {
    "build:native": "cd native/OnVoiceAudioBridge && msbuild OnVoiceAudioBridge.sln /p:Configuration=Release /p:Platform=x64",
    "copy:native": "node scripts/copy-native-dll.js",
    "build:all": "npm run build:dotnet && npm run build:native && npm run copy:dll && npm run copy:native && npm run build:main"
  },
  "build": {
    "extraResources": [
      {
        "from": "dotnet/OnVoiceComBridge/bin/Debug/net6.0",
        "to": "dotnet",
        "filter": ["**/*.dll", "**/*.json"]
      },
      {
        "from": "native/OnVoiceAudioBridge.dll",
        "to": "native",
        "filter": ["*.dll"]
      }
    ],
    "nsis": {
      "include": "build/installer.nsh"
    }
  }
}
```

**DLL 복사 스크립트** (`scripts/copy-native-dll.js`):

```javascript
const fs = require('fs');
const path = require('path');

// C++ DLL 빌드 출력 경로 (Visual Studio 기본 경로)
const sourcePaths = [
  path.join(__dirname, '..', 'native', 'OnVoiceAudioBridge', 'x64', 'Release', 'OnVoiceAudioBridge.dll'),
  path.join(__dirname, '..', 'native', 'OnVoiceAudioBridge', 'Release', 'OnVoiceAudioBridge.dll'),
  path.join(__dirname, '..', 'native', 'OnVoiceAudioBridge.dll'), // 이미 복사된 경우
];

const targetDir = path.join(__dirname, '..', 'native');
const targetFile = path.join(targetDir, 'OnVoiceAudioBridge.dll');

// 소스 파일 찾기
let sourceFile = null;
for (const sourcePath of sourcePaths) {
  if (fs.existsSync(sourcePath)) {
    sourceFile = sourcePath;
    break;
  }
}

if (!sourceFile) {
  console.error('[Copy Native DLL] ❌ DLL을 찾을 수 없습니다.');
  console.error('           다음 경로를 확인하세요:');
  sourcePaths.forEach(p => console.error(`           - ${p}`));
  process.exit(1);
}

// 타겟 디렉토리 생성
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// DLL 복사
fs.copyFileSync(sourceFile, targetFile);
console.log(`[Copy Native DLL] ✅ 복사 완료: ${sourceFile} → ${targetFile}`);
```

**3. COM 등록 스크립트 생성**

`build/installer.nsh` 파일 생성:

```nsis
; NSIS 스크립트: 설치 후 COM DLL 등록
Section -Post
  ; COM DLL 등록 (관리자 권한 필요)
  ExecWait '"$SYSDIR\regsvr32.exe" /s "$INSTDIR\resources\native\OnVoiceAudioBridge.dll"'
SectionEnd

Section Uninstall
  ; COM DLL 등록 해제
  ExecWait '"$SYSDIR\regsvr32.exe" /s /u "$INSTDIR\resources\native\OnVoiceAudioBridge.dll"'
SectionEnd
```

**4. 대안: 설치 후 스크립트로 등록**

관리자 권한 없이 설치하는 경우, 앱 시작 시 자동 등록:

```typescript
// electron/main.ts
import { exec } from 'child_process';
import path from 'path';

function registerComDll() {
  const dllPath = path.join(
    process.resourcesPath,
    'native',
    'OnVoiceAudioBridge.dll'
  );
  
  exec(`regsvr32.exe /s "${dllPath}"`, (error) => {
    if (error) {
      console.error('[COM Registration] Failed:', error);
    } else {
      console.log('[COM Registration] Success');
    }
  });
}

// 앱 시작 시 한 번만 실행
app.whenReady().then(() => {
  registerComDll();
});
```

**주의사항**:
- COM 등록은 관리자 권한이 필요할 수 있습니다.
- 사용자가 관리자 권한을 거부하면 COM 객체를 사용할 수 없습니다.
- 설치 시 자동 등록이 가장 안정적입니다.

## 코드 서명 (선택사항)

### Windows 코드 서명 설정

코드 서명을 사용하려면 `package.json`에 다음 설정을 추가합니다:

```json
{
  "build": {
    "win": {
      "certificateFile": "path/to/certificate.pfx",
      "certificatePassword": "password",
      "signingHashAlgorithms": ["sha256"],
      "sign": "path/to/signtool.exe"
    }
  }
}
```

또는 환경 변수 사용:
```bash
set CSC_LINK=path/to/certificate.pfx
set CSC_KEY_PASSWORD=password
```

## 자동 업데이트 (선택사항)

### electron-updater 통합

자동 업데이트 기능을 추가하려면:

1. **의존성 설치**
```bash
npm install electron-updater
```

2. **메인 프로세스에 업데이트 로직 추가**
```typescript
// electron/main.ts
import { autoUpdater } from 'electron-updater';

if (process.env.NODE_ENV === 'production') {
  autoUpdater.checkForUpdatesAndNotify();
}
```

3. **package.json 설정**
```json
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "your-username",
      "repo": "harmful-expression-filter"
    }
  }
}
```

## 배포 체크리스트

### 빌드 전 확인사항
- [ ] 모든 의존성이 설치되어 있는지 확인 (`npm install`)
- [ ] C# 프로젝트가 정상적으로 빌드되는지 확인 (`npm run build:dotnet`)
- [ ] TypeScript 컴파일 오류가 없는지 확인 (`npm run typecheck`)
- [ ] 환경 변수가 올바르게 설정되어 있는지 확인

### 빌드 후 확인사항
- [ ] `dist/` 폴더에 인스톨러가 생성되었는지 확인
- [ ] `win-unpacked/OnVoice.exe`가 실행되는지 확인
- [ ] C# DLL이 `resources/dotnet/`에 포함되었는지 확인
- [ ] **C++ COM DLL이 Release 빌드인지 확인** (Debug 빌드는 배포 불가)
- [ ] 앱이 정상적으로 시작되는지 확인
- [ ] 시스템 트레이 아이콘이 표시되는지 확인
- [ ] 오디오 캡처 기능이 작동하는지 확인

### 배포 전 테스트
- [ ] 깨끗한 Windows 환경에서 설치 테스트
- [ ] .NET 6 런타임이 설치되지 않은 환경에서 테스트 (필요 시)
- [ ] 관리자 권한 없이 설치 가능한지 확인
- [ ] 제거(Uninstall)가 정상적으로 작동하는지 확인
- [ ] C++ COM DLL이 정상적으로 등록되었는지 확인 (`reg query "HKEY_CLASSES_ROOT\OnVoiceAudioBridge.OnVoiceCapture"`)
- [ ] COM 객체를 통한 오디오 캡처가 정상 작동하는지 확인

## ⚠️ 중요: Debug vs Release 빌드

### 배포 시 반드시 Release 빌드 사용

C++ COM DLL의 Debug와 Release 빌드는 성능, 배포, 동작 방식에서 **매우 큰 차이**가 있습니다. 특히 현재 개발 중인 `OnVoiceComBridge`와 같은 실시간 오디오 캡처 모듈에서는 이 차이가 시스템 안정성과 성능에 직접적인 영향을 미칩니다.

#### 1. 🚀 성능 및 최적화 (가장 중요)

- **Debug**: 컴파일러 최적화가 꺼져 있습니다. 변수가 메모리에 항상 상주하며, 코드가 작성된 그대로 기계어로 번역됩니다. 오디오 버퍼 처리 루프(Pump)에서 불필요한 연산이 포함되어 **오디오 캡처 레이턴시나 CPU 사용량**이 늘어날 수 있습니다.
- **Release**: 코드 최적화(`O2` 옵션 등)가 적용됩니다. 함수 인라인화, 루프 최적화, 불필요한 코드 제거 등이 수행되어 **속도가 훨씬 빠르고 파일 크기가 작습니다.**
  - Task 40의 `IAudioCaptureClient::GetBuffer` 루프와 같은 고빈도 작업에서는 Release 빌드가 필수적입니다.

#### 2. 📦 런타임 라이브러리 (배포 시 사고 원인 1순위)

가장 흔하게 겪는 **"내 컴퓨터에선 되는데 다른 컴퓨터에선 안 돼요"**의 원인입니다.

- **Debug**: **Debug Runtime (`MSVCPxxD.dll`, `VCRUNTIME140D.dll`)**에 의존합니다.
  - 파일명 끝에 `D`가 붙습니다.
  - 이 파일들은 Visual Studio가 설치된 개발자 PC에만 있고, **일반 사용자 PC에는 없습니다.**
  - 따라서 Debug 버전 DLL을 다른 PC로 가져가면 "DLL을 찾을 수 없다"는 오류가 발생합니다.
- **Release**: **Standard Runtime (`MSVCPxx.dll`, `VCRUNTIME140.dll`)**에 의존합니다.
  - 일반적인 "Visual C++ 재배포 가능 패키지(VC++ Redistributable)"만 설치되어 있으면 어디서든 실행됩니다.

#### 3. 🛡️ 메모리 검사 및 디버깅 정보

- **Debug**:
  - **디버그 심볼(.pdb)** 정보를 포함하여 용량이 큽니다.
  - **메모리 릭 탐지**, 경계 검사(Boundary Check), 초기화되지 않은 변수 체크 등을 위한 추가 코드가 삽입됩니다.
  - `assert()` 매크로가 작동하여 개발자가 의도한 조건이 맞는지 검사합니다.
- **Release**:
  - 디버그 정보가 제거되어 용량이 작습니다.
  - 메모리 보호 코드가 제거되어 속도가 빠르지만, 잘못된 메모리 접근 시 바로 크래시(Crash)가 날 수 있습니다.
  - `assert()` 코드는 아예 컴파일에서 제외됩니다.

#### 4. 🧩 힙(Heap) 메모리 관리 (COM의 경우)

COM 프로그래밍에서는 Debug/Release 혼용 시 메모리 할당 문제가 발생할 수 있습니다.

- **원칙**: COM은 인터페이스 기반이라 메모리 할당/해제 주체가 명확해야 합니다.
- **위험**: 만약 Node.js(Release 빌드)가 C++ DLL(Debug 빌드)에 `std::string` 같은 C++ 객체를 직접 넘기고 해제하려 하면, **서로 다른 힙 관리자(Debug Heap vs Release Heap)를 사용**하게 되어 즉시 프로그램이 터집니다.
- **현재 프로젝트**: `OnVoiceComBridge`는 COM 인터페이스와 `SAFEARRAY` 등을 사용하여 데이터를 주고받으므로(마샬링) 이 위험은 적지만, 여전히 런타임 의존성 문제는 남습니다.

### 💡 결론 및 권장 사항

1. **개발 중 (Local Development)**:
   - **Debug 빌드**를 사용하세요. 브레이크포인트를 걸고 변수 값을 확인하거나, `assert`로 로직 오류를 잡는 데 유리합니다.

2. **배포 및 최종 테스트 (Production)**:
   - **무조건 Release 빌드**여야 합니다.
   - 사용자 PC에는 Debug 런타임 라이브러리가 없기 때문에 Debug 빌드는 실행조차 안 될 확률이 99%입니다.
   - `npm run build:native` 스크립트가 C++ 프로젝트를 빌드할 때 `/p:Configuration=Release` 옵션을 사용하는지 확인하세요.

**요약**: 개발할 때는 Debug로 하시고, **"이제 됐다, 서버에 올리거나 배포하자" 할 때는 반드시 Release 모드로 다시 빌드**해서 DLL을 교체해야 합니다.

### 빌드 타입 확인

```bash
# Release 빌드로 빌드
npm run build:native

# DLL 복사 (Release 우선)
npm run copy:native

# 복사된 DLL이 Release인지 확인 (경고 메시지 확인)
# "✅ Release 빌드 확인됨 (배포 준비 완료)" 메시지가 나와야 합니다
```

## 문제 해결

### 빌드 실패

#### C# DLL을 찾을 수 없음
```bash
# DLL 복사 스크립트 수동 실행
npm run copy:dll

# C# 프로젝트 재빌드
npm run build:dotnet
```

#### MSBuild를 찾을 수 없음
```bash
# MSBuild 경로 확인
node scripts/find-msbuild.js

# 해결 방법:
# 1. Visual Studio 2019 이상 또는 Visual Studio Build Tools 설치
# 2. 또는 Visual Studio Developer Command Prompt에서 직접 빌드
cd native/OnVoiceAudioBridge
msbuild OnVoiceAudioBridge.sln /p:Configuration=Release /p:Platform=x64

# 3. 또는 Visual Studio에서 솔루션을 열어 직접 빌드
# 4. 또는 빌드된 DLL을 수동으로 복사
```

**Visual Studio Build Tools 설치**:
1. [Visual Studio Build Tools 다운로드](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
2. "C++ 빌드 도구" 워크로드 선택
3. 설치 후 재시도

#### electron-builder 오류
```bash
# 캐시 정리
rm -rf node_modules/.cache
rm -rf dist

# 재빌드
npm run build:all
npm run build:renderer
npm run build:electron
```

### 런타임 오류

#### DLL 로드 실패
- `process.resourcesPath` 경로 확인
- DLL 파일이 `resources/dotnet/`에 포함되었는지 확인
- .NET 6 런타임이 설치되어 있는지 확인

#### COM 객체 생성 실패
```bash
# COM 등록 확인
reg query "HKEY_CLASSES_ROOT\OnVoiceAudioBridge.OnVoiceCapture"

# COM DLL 수동 등록 (관리자 권한 필요)
regsvr32.exe "C:\path\to\OnVoiceAudioBridge.dll"

# COM DLL 등록 해제
regsvr32.exe /u "C:\path\to\OnVoiceAudioBridge.dll"
```

**해결 방법**:
1. C++ COM DLL이 `resources/native/`에 포함되었는지 확인
2. 설치 후 COM 등록이 실행되었는지 확인
3. 관리자 권한으로 설치했는지 확인
4. 앱 시작 시 자동 등록 스크립트가 실행되었는지 확인

#### Debug Runtime 라이브러리 오류 (일반 사용자 PC에서 실행 실패)

**증상**: "DLL을 찾을 수 없습니다" 또는 "MSVCP140D.dll을 찾을 수 없습니다" 오류

**원인**: Debug 빌드 DLL을 배포했을 때 발생합니다. Debug Runtime 라이브러리는 Visual Studio가 설치된 개발자 PC에만 있습니다.

**해결 방법**:
```bash
# 1. Release 빌드로 다시 빌드
npm run build:native

# 2. Release DLL 복사
npm run copy:native

# 3. "✅ Release 빌드 확인됨" 메시지 확인
# 4. Visual Studio가 설치되지 않은 깨끗한 PC에서 테스트
```

**예방**: 배포 전에 항상 Release 빌드를 사용하고, `npm run copy:native` 실행 시 경고 메시지를 확인하세요.

#### electron-edge-js 오류
```bash
# 환경 변수 확인
echo %EDGE_USE_CORECLR%
echo %DOTNET_ROOT%

# 재빌드
npm run build:all
```

## 빌드 최적화

### 파일 크기 최적화

#### 불필요한 파일 제외
```json
{
  "build": {
    "files": [
      "dist-electron/**/*",
      "dist/renderer/**/*",
      "package.json"
    ],
    "extraFiles": [
      {
        "from": "dotnet/OnVoiceComBridge/bin/Debug/net6.0",
        "to": "dotnet",
        "filter": ["**/*.dll"]
      }
    ]
  }
}
```

#### asar 압축
electron-builder는 기본적으로 `app.asar`로 앱을 압축합니다. 비활성화하려면:

```json
{
  "build": {
    "asar": false
  }
}
```

### 빌드 속도 최적화

#### 병렬 빌드
```json
{
  "scripts": {
    "build:parallel": "npm-run-all --parallel build:dotnet build:main build:renderer"
  }
}
```

#### 캐시 활용
electron-builder는 자동으로 캐시를 사용합니다. 캐시 위치:
- Windows: `%LOCALAPPDATA%\electron-builder\Cache`

## 관련 파일

- `package.json`: 빌드 설정 및 스크립트
- `electron/tsconfig.json`: 메인 프로세스 TypeScript 설정
- `vite.config.ts`: 렌더러 빌드 설정
- `scripts/copy-dll.js`: C# DLL 복사 스크립트
- `scripts/copy-native-dll.js`: C++ COM DLL 복사 스크립트
- `dotnet/OnVoiceComBridge/OnVoiceComBridge.csproj`: C# 프로젝트 설정
- `native/OnVoiceAudioBridge/`: C++ COM DLL 소스 코드 (서브모듈 또는 직접 포함)
- `build/installer.nsh`: NSIS 설치 스크립트 (COM 등록)

## 다음 작업

- [ ] 코드 서명 인증서 설정 (프로덕션 배포 시)
- [ ] 자동 업데이트 시스템 구축
- [ ] 빌드 자동화 (CI/CD 파이프라인)
- [ ] 릴리스 노트 자동 생성
- [ ] 다중 아키텍처 지원 (x64, arm64)

## 참고 자료

- [electron-builder 공식 문서](https://www.electron.build/)
- [NSIS 인스톨러 가이드](https://www.electron.build/configuration/nsis)
- [작업 1: 기본 Electron 앱 설정](./01-electron-setup.md)
- [작업 30: electron-edge-js 마이그레이션](./30-electron-edge-js-migration.md)
- [작업 39: C# 기반 PID 볼륨 제어 통합](./39-csharp-volume-control.md)

