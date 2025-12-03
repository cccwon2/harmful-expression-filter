# "Side-by-side configuration is incorrect" 오류 해결 가이드

## 🚨 오류 메시지

```
'OnVoiceComBridge.exe' 프로그램을 실행하지 못했습니다. 
응용 프로그램의 side-by-side 구성이 잘못되어 응용 프로그램을 시작하지 못했습니다.
```

## 원인

이 오류는 **C++ DLL(`OnVoiceAudioBridge.dll`)이 Debug 모드로 빌드되어 있을 때** 또는 **매니페스트 파일에서 참조하는 DLL이 실행 파일과 같은 폴더에 없을 때** 발생합니다.

### 주요 원인

1. **Debug 빌드 DLL 사용**
   - Debug 빌드는 Visual Studio Debug Runtime 라이브러리(`MSVCP140D.dll`, `VCRUNTIME140D.dll`)에 의존
   - 이 라이브러리들은 Visual Studio가 설치된 개발자 PC에만 있습니다
   - 일반 사용자 PC(데스크탑)에는 없어서 실행이 실패합니다

2. **매니페스트 파일의 DLL 참조 문제**
   - `OnVoiceComBridge.exe.manifest`에서 `OnVoiceAudioBridge.dll`을 참조
   - 이 DLL이 실행 파일과 같은 폴더(publish 폴더)에 없으면 오류 발생

## 🔍 1단계: 현재 DLL 빌드 모드 확인

```bash
npm run check:dll
```

이 명령어는 현재 복사된 DLL이 Release인지 Debug인지 확인합니다.

### 예상 출력

**Release 빌드인 경우:**
```
✅ Release 빌드로 확인됨
이 DLL은 배포에 적합합니다.
```

**Debug 빌드인 경우:**
```
❌ Debug 빌드로 확인됨!
⚠️  이 DLL은 일반 사용자 PC에서 실행되지 않을 수 있습니다.
```

## 🛠️ 2단계: Release 빌드로 재빌드

### 방법 1: 자동 빌드 (권장)

```bash
# 1. C++ 프로젝트를 Release 모드로 빌드
npm run build:native

# 2. Release DLL 복사
npm run copy:native
```

`copy:native` 실행 후 다음 메시지가 표시되어야 합니다:
```
[Copy Native DLL] ✅ Release 빌드 확인됨 (배포 준비 완료)
```

### 방법 2: Visual Studio에서 직접 빌드

1. Visual Studio에서 `OnVoiceAudioBridge.sln` 열기
2. 상단 툴바에서 **'Debug'**를 **'Release'**로 변경
3. **솔루션 빌드** 실행 (F7 또는 빌드 메뉴)
4. 빌드 완료 후:
   ```bash
   npm run copy:native
   ```

## 🔍 3단계: 빌드 모드 재확인

```bash
npm run check:dll
```

이제 **"✅ Release 빌드로 확인됨"** 메시지가 표시되어야 합니다.

## 🔍 4단계: C# 프로젝트 재빌드

DLL이 교체되었으니 C# 프로젝트도 깨끗하게 다시 빌드합니다:

```powershell
# 기존 빌드 삭제
Remove-Item -Path "dotnet/OnVoiceComBridge/bin", "dotnet/OnVoiceComBridge/obj" -Recurse -Force

# 다시 빌드 (OnVoiceAudioBridge.dll이 자동으로 publish 폴더로 복사됨)
npm run build:dotnet
```

**중요**: `OnVoiceComBridge.csproj`가 수정되어 `OnVoiceAudioBridge.dll`이 자동으로 publish 폴더로 복사됩니다.

## ✅ 5단계: 수동 실행 확인

```powershell
& "C:\Dev\harmful-expression-filter\dotnet\OnVoiceComBridge\bin\Release\net6.0\win-x64\publish\OnVoiceComBridge.exe"
```

**이제 오류 메시지 없이 실행되어야 합니다.**

- 커서가 깜빡이는 상태면 성공입니다
- `Ctrl+C`로 종료하고 `npm run dev` 실행

## 📋 전체 프로세스 요약

```bash
# 1. 현재 상태 확인
npm run check:dll

# 2. Release 빌드 생성
npm run build:native

# 3. Release DLL 복사
npm run copy:native

# 4. 빌드 모드 재확인
npm run check:dll

# 5. C# 프로젝트 재빌드 (DLL 자동 복사 포함)
Remove-Item -Path "dotnet/OnVoiceComBridge/bin", "dotnet/OnVoiceComBridge/obj" -Recurse -Force
npm run build:dotnet

# 6. publish 폴더에 DLL이 복사되었는지 확인
Test-Path "dotnet\OnVoiceComBridge\bin\Release\net6.0\win-x64\publish\OnVoiceAudioBridge.dll"

# 7. 수동 실행 테스트
& "C:\Dev\harmful-expression-filter\dotnet\OnVoiceComBridge\bin\Release\net6.0\win-x64\publish\OnVoiceComBridge.exe"
```

## 🔍 고급 진단

### 방법 1: 진단 스크립트 실행 (권장)

```powershell
.\scripts\diagnose-side-by-side-error.ps1
```

이 스크립트는 다음을 확인합니다:
- DLL 의존성 (Debug Runtime 라이브러리 포함 여부)
- publish 폴더의 모든 DLL 파일
- 매니페스트 파일
- .NET 런타임 설치 상태
- **OnVoiceAudioBridge.dll이 publish 폴더에 있는지 확인**

### 방법 2: sxstrace 사용

만약 위 방법으로 해결되지 않으면, Windows의 `sxstrace.exe`를 사용하여 정확한 오류를 확인할 수 있습니다:

#### 1. sxstrace 시작

```powershell
# 관리자 권한으로 PowerShell 실행
sxstrace.exe Trace -logfile:sxstrace.etl
```

#### 2. 프로그램 실행

다른 PowerShell 창에서:
```powershell
& "C:\Dev\harmful-expression-filter\dotnet\OnVoiceComBridge\bin\Release\net6.0\win-x64\publish\OnVoiceComBridge.exe"
```

#### 3. 추적 중지

첫 번째 PowerShell 창에서 `Ctrl+C`로 중지

#### 4. 로그 파싱

```powershell
sxstrace.exe Parse -logfile:sxstrace.etl -outfile:sxstrace.txt
notepad sxstrace.txt
```

로그 파일에서 누락된 DLL을 확인할 수 있습니다.

### 방법 3: Windows SDK 런타임 문제

C# 프로젝트가 `net6.0-windows10.0.19041.0`을 사용하고 있고, `UseWindowsSdkPackage=true`로 설정되어 있습니다. 

Windows SDK 런타임 DLL이 누락되었을 수 있습니다. 다음을 확인하세요:

1. **Windows SDK 설치 확인**:
   ```powershell
   Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\Redist" -Recurse -Filter "*.dll" | Select-Object FullName
   ```

2. **publish 폴더에 Windows SDK DLL 복사**:
   - `Microsoft.Windows.SDK.NET.dll`이 publish 폴더에 있는지 확인
   - 없으면 수동으로 복사하거나 `--self-contained true` 옵션으로 재빌드

## ⚠️ 주의사항

1. **배포 시 항상 Release 빌드 사용**
   - Debug 빌드는 개발 환경에서만 사용
   - 배포 전에 반드시 Release 빌드로 교체

2. **빌드 후 확인**
   - `npm run copy:native` 실행 후 메시지 확인
   - "✅ Release 빌드 확인됨" 메시지가 없으면 Debug 빌드가 복사된 것입니다

3. **매니페스트 파일과 DLL 위치**
   - `OnVoiceComBridge.exe.manifest`는 실행 파일과 같은 폴더에 있어야 합니다
   - 매니페스트에서 참조하는 `OnVoiceAudioBridge.dll`도 같은 폴더에 있어야 합니다
   - `OnVoiceComBridge.csproj`가 자동으로 DLL을 복사하도록 수정되었습니다

4. **Visual Studio 버전**
   - Visual Studio 2022: 플랫폼 도구 집합 `v143`
   - Visual Studio 2019: 플랫폼 도구 집합 `v142`
   - 빌드 스크립트가 자동으로 감지합니다

## 📚 관련 문서

- [Debug vs Release 빌드 가이드](./DEBUG_VS_RELEASE_BUILD.md)
- [Electron 앱 배포 가이드](./docs/42-electron-app-deployment.md)
