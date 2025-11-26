# 작업 42: Electron 앱 배포

## 상태
✅ 완료

## 개요

Electron 애플리케이션을 Windows용 설치 패키지(NSIS 인스톨러)로 빌드하고 배포하는 프로세스를 설정합니다. electron-builder를 사용하여 프로덕션 빌드, C# DLL 포함, 설치 패키지 생성 등을 자동화합니다.

## 완료된 기능

### 빌드 시스템 구성
- ✅ electron-builder 설정 (`package.json`)
- ✅ Windows NSIS 인스톨러 타겟 설정
- ✅ C# DLL 자동 포함 (extraResources)
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
2. **DLL 복사**: 빌드된 DLL을 `dist-electron/dotnet`으로 복사
3. **TypeScript 컴파일**: 메인 프로세스 TypeScript 코드 컴파일
4. **렌더러 빌드**: Vite를 사용하여 React 앱 빌드
5. **패키징**: electron-builder로 설치 패키지 생성

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
- Visual Studio 2022 또는 Build Tools (C++ 컴파일러)

#### 환경 변수
```bash
# .NET 경로 확인
echo %DOTNET_ROOT%
# 또는
echo $env:DOTNET_ROOT

# Electron 환경 변수
set EDGE_USE_CORECLR=1
set DOTNET_ROOT=C:\Program Files\dotnet
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

## 문제 해결

### 빌드 실패

#### C# DLL을 찾을 수 없음
```bash
# DLL 복사 스크립트 수동 실행
npm run copy:dll

# C# 프로젝트 재빌드
npm run build:dotnet
```

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
- `scripts/copy-dll.js`: DLL 복사 스크립트
- `dotnet/OnVoiceComBridge/OnVoiceComBridge.csproj`: C# 프로젝트 설정

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

