# 빠른 시작 가이드

## 현재 상태

✅ **코드 작성 완료**: Phase 1-4 모든 코드가 준비되었습니다.
❌ **빌드 도구 필요**: Visual Studio Build Tools 설치가 필요합니다.

## 다음 단계

### 1. Visual Studio Build Tools 설치

1. **다운로드**
   - https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
   - "Build Tools for Visual Studio 2022" 다운로드

2. **설치**
   - 설치 프로그램 실행
   - **"C++ build tools"** 워크로드 선택
   - "Windows 10 SDK" 및 "MSVC v143 - VS 2022 C++ x64/x86 build tools" 포함 확인
   - 설치 진행 (약 3-4GB, 10-30분 소요)

3. **설치 확인**
   ```powershell
   # PowerShell에서 실행
   npm config set msvs_version 2022
   ```

### 2. naudiodon2 빌드

```bash
npm rebuild naudiodon2
```

또는

```bash
npm install naudiodon2 --force
```

### 3. 테스트 실행

```bash
# Phase 1: 오디오 캡처 테스트
npx tsx electron/test/test_audio_capture.ts

# Phase 2: 오디오 프로세서 테스트
npx tsx electron/test/test_audio_processor.ts
```

## 문제 해결

### 에러: "Could not find Visual Studio installation"

- Visual Studio Build Tools가 제대로 설치되었는지 확인
- 시스템 재시작 후 다시 시도
- `npm config set msvs_version 2022` 실행

### 에러: "Could not locate the bindings file"

- `npm rebuild naudiodon2` 실행
- 또는 `npm install naudiodon2 --force` 실행

## 참고

- Visual Studio Build Tools는 약 3-4GB의 디스크 공간이 필요합니다
- 설치 후 시스템 재시작을 권장합니다
- 설치가 완료되면 위의 명령어들을 순서대로 실행하세요

