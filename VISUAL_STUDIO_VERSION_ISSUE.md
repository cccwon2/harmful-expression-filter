# Visual Studio 버전 호환성 문제

## 문제 상황

Visual Studio 2026이 설치되어 있지만, `node-gyp`는 Visual Studio 2017-2022까지만 지원합니다.

## 해결 방법

### 방법 1: Visual Studio 2022 Build Tools 설치 (권장)

1. **다운로드**
   - https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
   - "Build Tools for Visual Studio 2022" 다운로드

2. **설치**
   - "C++ build tools" 워크로드 선택
   - "MSVC v143 - VS 2022 C++ x64/x86 build tools" 포함
   - "Windows 10 SDK" 또는 "Windows 11 SDK" 포함

3. **설치 후 테스트**
   ```bash
   npm rebuild naudiodon2
   ```

### 방법 2: Visual Studio 2022 Community Edition 설치

Visual Studio 2022 Community Edition을 설치하고 "Desktop development with C++" 워크로드를 선택하세요.

### 방법 3: node-gyp 업데이트 (시도해볼 수 있음)

```bash
npm install -g node-gyp@latest
npm rebuild naudiodon2
```

하지만 Visual Studio 2026 지원이 추가되지 않았을 수 있습니다.

## 참고

- Visual Studio 2026은 최신 버전이지만, node-gyp는 아직 지원하지 않습니다
- Visual Studio 2022와 2026을 함께 설치해도 문제없습니다
- Visual Studio 2022 Build Tools만 설치해도 충분합니다

