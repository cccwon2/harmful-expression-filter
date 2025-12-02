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

### 테스트 종류

- **유닛 테스트 (Jest)**: 15개 테스트 케이스
  - 블러 강도 설정 및 유효성 검증
  - OCR 시뮬레이션
  - IPC 통신 테스트

- **E2E 테스트 (Playwright)**: 10개 테스트 케이스
  - 트레이 메뉴 블러 강도 변경
  - OCR 연속 감지
  - 블러 오버레이 렌더링
  - 스크린샷 캡처

---

## 설치 가이드

### 필수 요구사항

- **Node.js**: 16.x 이상
- **npm**: 7.x 이상
- **OS**: Windows 10 이상 (setContentProtection 테스트)
- **빌드 환경**: E2E 테스트를 위해서는 앱 빌드 필요

### 빠른 설치 (권장)

#### Windows

```bash
scripts\quick-start-test.bat
```

#### Linux/Mac

```bash
chmod +x scripts/quick-start-test.sh
./scripts/quick-start-test.sh
```

### 수동 설치

#### 1. 패키지 설치

```bash
npm install
```

#### 2. Playwright 브라우저 설치

```bash
npx playwright install --with-deps
```

#### 3. 앱 빌드 (E2E 테스트용)

```bash
npm run build:all
npm run build:renderer
```

---

## 실행 가이드

### 전체 테스트 실행

```bash
npm test
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
npm run build:all
npm run build:renderer

# 일반 실행 (headless)
npm run test:e2e

# UI 모드 (브라우저 인터페이스)
npm run test:e2e:ui

# 디버그 모드
npm run test:e2e:debug

# 브라우저 표시 (headed)
npm run test:e2e:headed
```

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
├── jest.config.js                    # Jest 설정
├── tests/
│   ├── setup.ts                      # Jest 전역 setup
│   ├── e2e/
│   │   └── task49-blur.spec.ts      # E2E 테스트
│   ├── unit/
│   │   └── blurIntensity.test.ts    # 유닛 테스트
│   └── helpers/
│       └── ocr-simulator.ts          # 테스트 헬퍼
└── scripts/
    ├── quick-start-test.bat         # Windows 빠른 시작
    └── quick-start-test.sh          # Linux/Mac 빠른 시작
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
rm -rf node_modules package-lock.json  # Windows: rmdir /s /q node_modules
npm install
```

---

### 문제 2: E2E 테스트 실행 실패

**증상**:
```
Error: Cannot find Electron app at dist-electron/main.js
```

**해결**:
```bash
# 앱 빌드
npm run build:all
npm run build:renderer

# 빌드 확인
ls dist-electron/main.js  # Windows: dir dist-electron\main.js
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

# 또는 시스템 의존성 설치 (Linux)
npx playwright install-deps
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
        npm run build:all
        npm run build:renderer
    
    - name: Install Playwright browsers
      run: npx playwright install --with-deps
    
    - name: Run E2E tests
      run: npm run test:e2e
    
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

### GitLab CI 예시

`.gitlab-ci.yml`:

```yaml
test:
  stage: test
  image: node:18
  before_script:
    - npm ci
    - npx playwright install --with-deps
  script:
    - npm run test:unit:coverage
    - npm run build:all
    - npm run build:renderer
    - npm run test:e2e
  artifacts:
    when: always
    paths:
      - test-results/
      - coverage/
    reports:
      junit: test-results/results.xml
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
- [Electron Testing Guide](https://www.electronjs.org/docs/latest/tutorial/automated-testing)
- [Task 49 문서](./49-harmful-content-blind-ocr-continuous.md)

---

**작성일**: 2025-12-02  
**작성자**: 김원  
**상태**: ✅ 완료

