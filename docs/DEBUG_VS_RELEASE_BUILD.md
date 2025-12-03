# Debug vs Release 빌드 가이드

## 🚨 중요: "Side-by-side configuration is incorrect" 오류 해결

이 오류는 **C++ DLL이 Debug 모드로 빌드되어 있을 때** 발생합니다.

### 원인

- **Debug 빌드**: Visual Studio Debug Runtime 라이브러리(`MSVCPxxD.dll`, `VCRUNTIME140D.dll`)에 의존
- **Release 빌드**: Standard Runtime 라이브러리(`MSVCPxx.dll`, `VCRUNTIME140.dll`)에 의존
- 일반 사용자 PC에는 Debug Runtime이 설치되어 있지 않아 Debug 빌드는 실행되지 않습니다.

### 해결 방법

#### 1단계: C++ 프로젝트 Release 빌드

```bash
# 자동 빌드 (권장)
npm run build:native

# 또는 수동 빌드
cd native/OnVoiceAudioBridge
msbuild OnVoiceAudioBridge.sln /p:Configuration=Release /p:Platform=x64
```

#### 2단계: Release DLL 복사

```bash
npm run copy:native
```

이 명령어는:
- Release 빌드를 우선적으로 찾아 복사합니다
- Debug 빌드가 복사되면 경고 메시지를 표시합니다
- `native/OnVoiceAudioBridge.dll`로 복사합니다

#### 3단계: C# 프로젝트 재빌드 (선택사항)

DLL이 교체되었으니 C# 프로젝트도 깨끗하게 다시 빌드하는 것을 권장합니다:

```bash
# 기존 빌드 삭제 (PowerShell)
Remove-Item -Path "dotnet/OnVoiceComBridge/bin", "dotnet/OnVoiceComBridge/obj" -Recurse -Force

# 다시 빌드
npm run build:dotnet
```

#### 4단계: 수동 실행 확인

```powershell
# Bridge 실행 파일 직접 실행
& "C:\Dev\harmful-expression-filter\dotnet\OnVoiceComBridge\bin\Release\net6.0\win-x64\publish\OnVoiceComBridge.exe"
```

오류 메시지 없이 실행되면 성공입니다. (`Ctrl+C`로 종료)

## 빌드 모드 확인

### Release 빌드 확인

`copy:native` 실행 후 다음 메시지가 표시되어야 합니다:

```
[Copy Native DLL] ✅ Release 빌드 확인됨 (배포 준비 완료)
```

### Debug 빌드 경고

만약 다음 경고가 표시되면 Release 빌드로 다시 빌드해야 합니다:

```
[Copy Native DLL] ⚠️  경고: Debug 빌드를 복사하고 있습니다!
[Copy Native DLL] ⚠️  Debug 빌드는 일반 사용자 PC에서 실행되지 않을 수 있습니다.
```

## 빌드 스크립트 동작

### `build:native` 스크립트

- **항상 Release 모드로 빌드**합니다 (`/p:Configuration=Release`)
- Visual Studio 버전에 맞는 플랫폼 도구 집합을 자동으로 감지합니다
- 빌드 출력: `{프로젝트경로}/x64/Release/OnVoiceAudioBridge.dll`

### `copy:native` 스크립트

- **Release 빌드를 우선적으로 찾습니다**
- 다음 순서로 경로를 확인합니다:
  1. `x64/Release/OnVoiceAudioBridge.dll` (우선)
  2. `Release/OnVoiceAudioBridge.dll`
  3. `x64/Debug/OnVoiceAudioBridge.dll` (fallback)
  4. `Debug/OnVoiceAudioBridge.dll` (fallback)
- Debug 빌드가 복사되면 경고를 표시합니다

## 개발 vs 배포

### 개발 환경 (노트북)

- Debug 빌드 사용 가능 (Visual Studio가 설치되어 있음)
- 개발 중에는 Debug 빌드로 빠르게 테스트 가능

### 배포 환경 (데스크탑/일반 PC)

- **반드시 Release 빌드 사용**
- Debug Runtime 라이브러리가 없어 Debug 빌드는 실행되지 않음

## 문제 해결

### "DLL을 찾을 수 없습니다" 오류

1. Release 빌드가 생성되었는지 확인:
   ```bash
   dir native\OnVoiceAudioBridge\x64\Release\OnVoiceAudioBridge.dll
   ```

2. Release 빌드가 없으면 빌드:
   ```bash
   npm run build:native
   ```

3. 복사:
   ```bash
   npm run copy:native
   ```

### "Side-by-side configuration is incorrect" 오류

이 오류는 **Debug 빌드가 복사되었을 때** 발생합니다.

1. Release 빌드 확인:
   ```bash
   npm run build:native
   npm run copy:native
   ```

2. 복사된 DLL이 Release인지 확인:
   - `[Copy Native DLL] ✅ Release 빌드 확인됨` 메시지 확인
   - 경고 메시지가 없어야 합니다

3. C# 프로젝트 재빌드:
   ```bash
   npm run build:dotnet
   ```

## 요약

- ✅ **배포 시**: 항상 Release 빌드 사용
- ⚠️ **개발 시**: Debug 빌드 사용 가능 (Visual Studio 설치된 환경)
- 🔍 **확인 방법**: `npm run copy:native` 실행 후 메시지 확인
- 🛠️ **해결 방법**: `npm run build:native && npm run copy:native`

