# Windows 빌드 도구 설치 가이드

## 문제 상황

`windows-build-tools` 패키지는 최신 Node.js(v18+)와 호환되지 않습니다. 대신 Visual Studio Build Tools를 수동으로 설치해야 합니다.

## 해결 방법

### 방법 1: Visual Studio Build Tools 수동 설치 (권장)

1. **Visual Studio Build Tools 다운로드**
   - https://visualstudio.microsoft.com/downloads/ 방문
   - "Tools for Visual Studio" 섹션에서 "Build Tools for Visual Studio 2022" 다운로드

2. **설치 옵션 선택**
   - 설치 프로그램 실행
   - "C++ build tools" 워크로드 선택
   - "Windows 10 SDK" 및 "MSVC v143 - VS 2022 C++ x64/x86 build tools" 포함 확인
   - 설치 진행

3. **설치 확인**
   ```powershell
   # PowerShell에서 확인
   npm config set msvs_version 2022
   ```

4. **naudiodon2 재설치**
   ```bash
   npm install naudiodon2
   ```

### 방법 2: node-gyp만 설치 (Visual Studio Build Tools는 수동 설치)

```bash
# node-gyp만 전역 설치
npm install --global node-gyp

# Visual Studio Build Tools는 위의 방법 1로 수동 설치
```

### 방법 3: 대안 라이브러리 고려

`naudiodon2` 대신 다른 오디오 캡처 라이브러리 사용:
- `node-record-lpcm16` (간단하지만 기능 제한적)
- `@suldashi/lame` (MP3 인코딩)
- 또는 Electron의 `desktopCapturer` API 활용 (화면 캡처와 함께)

## 참고

- Visual Studio Build Tools는 약 3-4GB의 디스크 공간이 필요합니다
- 설치 시간은 인터넷 속도에 따라 10-30분 소요될 수 있습니다
- 설치 후 시스템 재시작을 권장합니다

## 설치 후 테스트

```bash
# Phase 1 테스트 실행
npx tsx electron/test/test_audio_capture.ts
```

