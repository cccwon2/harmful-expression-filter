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
2. **C++ COM DLL 빌드** (선택): C++ COM DLL을 빌드하거나 기존 DLL 사용
3. **DLL 복사**: 빌드된 DLL들을 적절한 위치로 복사
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

