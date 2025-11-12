# naudiodon2 설치 가이드

## 사전 요구사항

Visual Studio Build Tools 2022가 설치되어 있어야 합니다.

## 설치 방법

### 1. Visual Studio Build Tools 설치 확인

```powershell
# PowerShell에서 확인
npm config set msvs_version 2022
```

### 2. naudiodon2 설치

```bash
npm install naudiodon2
```

### 3. 설치 확인

```bash
# Phase 1 테스트 실행
npx tsx electron/test/test_audio_capture.ts
```

## 문제 해결

### 에러: "Could not find Visual Studio installation"

- Visual Studio Build Tools가 제대로 설치되었는지 확인
- 시스템 재시작 후 다시 시도
- `npm config set msvs_version 2022` 실행

### 에러: "node-gyp rebuild failed"

- Visual Studio Build Tools의 "C++ build tools" 워크로드가 설치되었는지 확인
- Windows SDK가 포함되어 있는지 확인

