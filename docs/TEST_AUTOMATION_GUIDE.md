# 테스트 자동화 가이드

Task 50: 유해 표현 블라인드 처리 및 OCR 연속 감지 기능의 자동화된 테스트 시스템 사용 가이드

## 📋 목차

1. [개요](#개요)
2. [설치 가이드](#설치-가이드)
3. [실행 가이드](#실행-가이드)
4. [테스트 구조](#테스트-구조)
5. [문제 해결](#문제-해결)
6. [CI/CD 통합](#cicd-통합)

---

## 개요

이 테스트 자동화 시스템은 Task 49에서 구현된 블러 강도 설정 및 OCR 연속 감지 기능을 검증합니다.

**주요 특징**:
- ✅ 실제 Electron 앱 실행 및 테스트 지원
- ✅ 단일 인스턴스 락 자동 우회
- ✅ DOM API 테스트 지원 (jsdom 환경)
- ✅ 브라우저 시뮬레이션 및 실제 Electron 앱 테스트 병행

### 테스트 종류

- **유닛 테스트 (Jest)**: 15개 테스트 케이스
  - 블러 강도 설정 및 유효성 검증
  - OCR 시뮬레이션
  - IPC 통신 테스트
  - DOM API 테스트 (jsdom 환경)

- **E2E 테스트 (Playwright)**: 20개 테스트 케이스
  - **브라우저 시뮬레이션 테스트**: 10개 (`task49-blur.spec.ts`)
    - 트레이 메뉴 블러 강도 변경
    - OCR 연속 감지
    - 블러 오버레이 렌더링
    - 스크린샷 캡처
  - **실제 Electron 앱 테스트**: 10개 (`task49-blur-electron.spec.ts`) ✅
    - 실제 Electron 앱 실행 및 검증
    - Playwright의 `_electron` API 사용
    - 윈도우 생성 및 DOM 접근 테스트

---

## 설치 가이드

### 필수 요구사항

- **Node.js**: 16.x 이상
- **npm**: 7.x 이상
- **OS**: Windows 10 이상 (setContentProtection 테스트)
- **빌드 환경**: E2E 테스트를 위해서는 앱 빌드 필요

### 빠른 설치 (권장)

```bash
scripts\quick-start-test.bat
```

### 수동 설치

#### 1. 패키지 설치

```bash
npm install
```

#### 2. Playwright 브라우저 설치

```bash
# Chromium만 설치 (Electron 테스트용, 권장)
npx playwright install chromium

# 또는 모든 브라우저 설치
npx playwright install --with-deps
```

#### 3. 앱 빌드 (E2E 테스트용)

```bash
# 메인 프로세스 빌드 (필수)
npm run build:main

# 렌더러 빌드 (필수)
npm run build:renderer
```

**중요**: Electron 앱 테스트를 실행하기 전에 반드시 `npm run build:main`을 실행해야 합니다.

---

## 실행 가이드

### 전체 테스트 실행

```bash
npm test
```

이 명령어는 유닛 테스트(블러 강도 + 성능)와 E2E 테스트를 순차적으로 실행합니다.

### 성능 테스트만 실행

```bash
# 성능 유닛 테스트만 실행
npm run test:unit -- performance.test.ts

# 또는 Jest 패턴 매칭
npm run test:unit -- --testPathPattern=performance
```

이 명령어는 유닛 테스트와 E2E 테스트를 순차적으로 실행합니다.

### 유닛 테스트만 실행

```bash
# 일반 실행
npm run test:unit

# Watch 모드 (파일 변경 감지)
npm run test:unit:watch

# 커버리지 포함
npm run test:unit:coverage
```

### E2E 테스트만 실행

```bash
# 먼저 앱 빌드 (필수)
npm run build:main
npm run build:renderer

# 브라우저 시뮬레이션 테스트 실행
npm run test:e2e

# 실제 Electron 앱 테스트 실행 (권장)
npm run test:e2e:electron

# UI 모드 (브라우저 인터페이스)
npm run test:e2e:ui

# 디버그 모드
npm run test:e2e:debug

# 브라우저 표시 (headed)
npm run test:e2e:headed
```

**참고**: 
- `test:e2e`: 브라우저 환경에서 시뮬레이션 (일부 기능 제한)
- `test:e2e:electron`: 실제 Electron 앱 실행 (모든 기능 테스트 가능) ✅ 권장

### 테스트 리포트 확인

```bash
npm run test:report
```

---

## 테스트 구조

### 디렉토리 구조

```
프로젝트루트/
├── playwright.config.ts              # Playwright 설정
├── jest.config.js                    # Jest 설정 (jsdom 환경)
├── tests/
│   ├── setup.ts                      # Jest 전역 setup
│   ├── e2e/
│   │   ├── task49-blur.spec.ts      # E2E 테스트 (브라우저 시뮬레이션)
│   │   └── task49-blur-electron.spec.ts  # E2E 테스트 (실제 Electron 앱)
│   ├── unit/
│   │   ├── blurIntensity.test.ts    # 유닛 테스트 (Task 49)
│   │   └── performance.test.ts      # 성능 테스트 (Task 48) 🆕
│   └── helpers/
│       ├── ocr-simulator.ts          # 테스트 헬퍼
│       ├── performance-helpers.ts    # 성능 테스트 헬퍼 🆕
│       └── electron-launcher.ts      # Electron 앱 실행 헬퍼
└── scripts/
    └── quick-start-test.bat         # 빠른 시작 스크립트
```

### 유닛 테스트 그룹

#### 1. 블러 강도 설정 테스트 (7개)

- ✅ 유효한 블러 강도 값 (15, 25, 40) 허용
- ✅ 유효하지 않은 블러 강도 값 거부
- ✅ 블러 강도 설정 저장
- ✅ 유효하지 않은 블러 강도 저장 거부
- ✅ 블러 강도 변경 시 IPC 메시지 전송
- ✅ 트레이 메뉴 블러 강도 변경 시 즉시 반영
- ✅ 블러 강도 기본값 확인 (40px)

#### 2. OCR 연속 감지 테스트 (5개)

- ✅ OCR 텍스트 정상 추출
- ✅ 유해 표현 정확 감지
- ✅ 정상 텍스트 판별
- ✅ 블러 표시 중 OCR 계속 작동
- ✅ 블러 오버레이가 OCR 캡처에 영향 없음

#### 3. UX 개선 테스트 (3개)

- ✅ 블러 오버레이 경고 아이콘 표시
- ✅ 블러 오버레이 안내 메시지 표시
- ✅ GPU 가속 적용

### 성능 최적화 테스트 그룹 (Task 48) 🆕

#### 1. React 렌더링 최적화 테스트 (5개)

- ✅ 메모이제이션 효과 테스트
- ✅ 상태 변경 시에만 리렌더링 확인
- ✅ requestAnimationFrame 사용 확인
- ✅ requestAnimationFrame 성능 측정 (60 FPS 이상)
- ✅ 불필요한 리렌더링 최소화 확인

#### 2. IPC 통신 최적화 테스트 (4개)

- ✅ 중복 상태 전송 방지 확인
- ✅ 상태 변경 시에만 전송 확인
- ✅ IPC 스로틀링 적용 확인
- ✅ 중복 전송 방지 효과 측정

#### 3. OCR 처리 최적화 테스트 (3개)

- ✅ 적응형 인터벌: 텍스트 변경 시 최소 간격(500ms)으로 리셋
- ✅ 적응형 인터벌: 텍스트 동일 시 간격 점진적 증가
- ✅ 간격이 최대 2000ms를 초과하지 않음 확인

#### 4. 메모리 최적화 테스트 (3개)

- ✅ cleanup 함수 호출 시 이벤트 리스너 제거 확인
- ✅ 컴포넌트 언마운트 시 모든 리스너 정리 확인
- ✅ 타이머 및 requestAnimationFrame 정리 확인

#### 5. 렌더링 최적화 테스트 (2개)

- ✅ GPU 가속 CSS 속성 적용 확인
- ✅ GPU 가속 상세 정보 확인

### E2E 테스트 그룹

#### 1. 블러 강도 설정 E2E (2개)

- ✅ 트레이 메뉴에서 블러 강도 변경
- ✅ 블러 강도 변경 즉시 오버레이 반영

#### 2. OCR 연속 감지 E2E (3개)

- ✅ 블러 표시 중 OCR 계속 작동
- ✅ setContentProtection 활성화 확인
- ✅ 유해 표현 사라지면 블러 즉시 해제

#### 3. UX 개선 E2E (3개)

- ✅ 블러 오버레이 아이콘/메시지 표시
- ✅ 블러 오버레이 애니메이션 작동
- ✅ GPU 가속 적용 확인

#### 4. 스크린샷 테스트 (2개)

- ✅ 블러 오버레이 스크린샷 캡처
- ✅ 블러 강도별 스크린샷 캡처 (15, 25, 40px)

### Electron 앱 테스트 그룹 (task49-blur-electron.spec.ts)

실제 Electron 앱을 실행하고 테스트합니다. 모든 테스트가 통과합니다. ✅

#### 1. 블러 강도 설정 E2E (Electron) (2개)
- ✅ 트레이 메뉴에서 블러 강도 변경 (Electron 앱 실행 확인)
- ✅ 블러 강도 변경 즉시 오버레이 반영 (window.api 확인)

#### 2. OCR 연속 감지 E2E (Electron) (3개)
- ✅ 블러 표시 중 OCR 계속 작동 (윈도우 생성 확인)
- ✅ setContentProtection 활성화 확인 (윈도우 URL 확인)
- ✅ 유해 표현이 사라지면 블러 즉시 해제 (네트워크 대기)

#### 3. UX 개선 E2E (Electron) (3개)
- ✅ 블러 오버레이 아이콘/메시지 표시 (DOM 확인)
- ✅ 블러 오버레이 애니메이션 작동 (CSS transition 확인)
- ✅ 블러 오버레이 GPU 가속 적용 (CSS transform 확인)

#### 4. 스크린샷 테스트 (Electron) (2개)
- ✅ 블러 오버레이 스크린샷 캡처
- ✅ 블러 강도별 스크린샷 캡처

---

## 문제 해결

### 문제 1: 패키지 설치 실패

**증상**:
```
npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
```

**해결**:
```bash
# 캐시 삭제
npm cache clean --force

# node_modules 삭제 후 재설치
rmdir /s /q node_modules
del package-lock.json
npm install
```

---

### 문제 2: E2E 테스트 실행 실패

**증상**:
```
Error: Cannot find Electron app at dist-electron/main.js
Error: browserType.launch: Executable doesn't exist
```

**해결**:
```bash
# 메인 프로세스 빌드
npm run build:main

# 렌더러 빌드
npm run build:renderer

# 빌드 확인
dir dist-electron\main.js

# Playwright 브라우저 설치 (최초 1회)
npx playwright install chromium
```

---

### 문제 3: TypeScript 컴파일 오류

**증상**:
```
error TS2307: Cannot find module '@playwright/test'
```

**해결**:
```bash
# 타입 정의 설치
npm install --save-dev @types/node

# TypeScript 재컴파일
npx tsc --noEmit
```

---

### 문제 4: Playwright 브라우저 설치 실패

**증상**:
```
Error: Browser download failed
```

**해결**:
```bash
# 브라우저만 재설치
npx playwright install chromium
```

---

### 문제 5: 유닛 테스트 타임아웃

**증상**:
```
Timeout - Async callback was not invoked within the 10000ms timeout
```

**해결**:
1. `jest.config.js`에서 `testTimeout` 값 증가
2. 테스트에서 비동기 작업이 제대로 완료되는지 확인
3. 테스트 환경에서 외부 의존성 (서버 등) 확인

---

### 문제 6: E2E 테스트가 불안정하게 실패

**증상**:
테스트가 가끔 실패하고 재실행하면 통과

**해결**:
1. `playwright.config.ts`에서 `retries` 설정 확인
2. `waitForTimeout` 대신 `waitForSelector` 사용
3. 테스트 간 상태 초기화 확인

---

### 문제 7: 단일 인스턴스 락으로 인한 즉시 종료

**증상**:
```
테스트가 4-5ms 만에 실패 (앱이 즉시 종료됨)
```

**해결**:
1. 테스트 스크립트가 자동으로 `SKIP_SINGLE_INSTANCE_LOCK=true` 환경 변수를 설정합니다
2. 수동으로 실행할 경우:
   ```bash
   cross-env SKIP_SINGLE_INSTANCE_LOCK=true NODE_ENV=test npm run test:e2e:electron
   ```
3. 실행 중인 Electron 프로세스가 있는지 확인:
   ```bash
   tasklist | findstr electron
   ```
4. 모든 Electron 프로세스 종료 후 테스트 재실행

---

### 문제 8: DOM API 테스트 실패 (document is not defined)

**증상**:
```
ReferenceError: document is not defined
```

**해결**:
```bash
# jest-environment-jsdom 설치 (이미 설치되어 있어야 함)
npm install --save-dev jest-environment-jsdom

# jest.config.js에서 testEnvironment: 'jsdom' 확인
```

---

## CI/CD 통합

### GitHub Actions 예시

프로젝트에 `.github/workflows/test.yml` 파일을 생성:

```yaml
name: Test

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  test:
    runs-on: windows-latest

    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run unit tests
      run: npm run test:unit:coverage
    
    - name: Build app
      run: |
        npm run build:main
        npm run build:renderer
    
    - name: Install Playwright browsers
      run: npx playwright install chromium
    
    - name: Run E2E tests (Electron)
      run: npm run test:e2e:electron
      env:
        SKIP_SINGLE_INSTANCE_LOCK: true
        NODE_ENV: test
    
    - name: Upload playwright report
      if: always()
      uses: actions/upload-artifact@v3
      with:
        name: playwright-report
        path: playwright-report/
    
    - name: Upload test results
      if: always()
      uses: actions/upload-artifact@v3
      with:
        name: test-results
        path: test-results/
    
    - name: Upload coverage
      if: always()
      uses: actions/upload-artifact@v3
      with:
        name: coverage
        path: coverage/
```

---

## 테스트 커버리지 목표

현재 설정된 커버리지 임계값:

- **Branches**: 70%
- **Functions**: 70%
- **Lines**: 70%
- **Statements**: 70%

커버리지 확인:

```bash
npm run test:unit:coverage
```

---

## 추가 리소스

- [Jest 공식 문서](https://jestjs.io/)
- [Playwright 공식 문서](https://playwright.dev/)
- [Playwright Electron API](https://playwright.dev/docs/api/class-electron)
- [Electron Testing Guide](https://www.electronjs.org/docs/latest/tutorial/automated-testing)
- [Task 49 문서](./49-harmful-content-blind-ocr-continuous.md)
- [Task 50 문서](./50-test-automation.md)

---

**작성일**: 2025-12-02  
**작성자**: 김원  
**상태**: ✅ 완료  
**최종 업데이트**: 2025-12-02 (실제 Electron 앱 테스트 추가)

