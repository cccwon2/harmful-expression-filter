# 작업 47: 메인 대시보드 구축 및 멀티 윈도우 관리

## 상태

✅ 완료

## 개요

앱 실행 시 즉시 오버레이(OCR)를 띄우던 기존 방식을 변경하여, **메인 대시보드(Home)**를 먼저 띄우고 사용자가 **음성 필터링**과 **OCR 필터링**을 선택적으로 켜고 끌 수 있는 구조로 개편합니다.

## 배경

### 사용자 경험(UX) 개선

- 앱 시작과 동시에 화면 전체를 가리는 오버레이는 사용자에게 강제적인 느낌을 줌
- 게임 화면을 가리지 않고 음성 채팅만 필터링하고 싶은 니즈를 충족시키지 못함
- 사용자가 원할 때만 OCR 기능을 활성화할 수 있어야 함

### 리소스 효율성

- OCR은 화면 캡처와 이미지 분석으로 리소스를 소모함
- 음성 필터링만 필요한 경우 OCR 프로세스를 비활성화하여 시스템 부하를 줄여야 함
- 불필요한 리소스 사용을 방지하여 배터리 수명 및 성능 향상

### 확장성

- 추후 통계 확인, 설정 변경 등을 위한 공간(대시보드)이 필요함
- 멀티 윈도우 관리 구조로 향후 기능 추가가 용이함

## 의존성

- [작업 42: Electron 앱 배포](./42-electron-app-deployment.md) ✅ - 윈도우 생성 로직 (`createOverlayWindow.ts`)
- [작업 45: Spawn 방식 Bridge 마이그레이션](./45-spawn-bridge-migration.md) ✅ - 음성 필터링 제어 연동
- [작업 46: Supabase 관리자 DB](./46-supabase-admin-db.md) - 로그 데이터 연동 (선택사항)

## 아키텍처 변경

### 기존 (Single Window Flow)

```
앱 실행 ➔ OverlayWindow 생성 (투명, 전체화면) ➔ 즉시 OCR 작동
```

### 변경 후 (Mode Selection Flow) ✅

```
앱 실행 ➔ MainWindow (Mode Selection) 생성

사용자 인터랙션:
  - OCR 모드 선택 ➔ OverlayWindow 동적 생성 ➔ ROI 선택 ➔ OCR 모니터링 시작
  - 음성 모드 선택 ➔ AudioManager를 통한 음성 스트리밍 시작
```

**구현 완료 사항:**

- ✅ 모드 선택 화면 (OCR/음성 선택)
- ✅ OCR 모드 선택 시 오버레이 윈도우 동적 생성
- ✅ ROI 선택 기능 및 모니터링 자동 시작
- ✅ ESC 키로 ROI 재선택 가능
- ✅ Ctrl+E/Q 단축키로 오버레이 숨김
- ✅ 시스템 트레이 아이콘 표시
- ✅ 서버 AI 분석 연동 및 블러 처리
- ✅ 로그 최적화 (유해 표현 감지 위주)
- ✅ OCR 간격 개선 (300ms, 비동기 처리)

## 구현 완료 사항 ✅

### 1. Electron Main Process 수정

#### 1.1 윈도우 관리자 구현 ✅

**MainWindow (Mode Selection)**:

- ✅ 일반적인 OS 윈도우 (프레임 있음, 크기 조절 가능)
- ✅ 앱 실행 시 기본으로 표시
- ✅ 모드 선택 UI 표시 (OCR/음성)

**OverlayWindow**:

- ✅ OCR 모드 선택 시 동적 생성 (초기에는 생성하지 않음)
- ✅ 투명, 클릭 투루(Click-through) 가능한 전체 화면 윈도우
- ✅ ROI 선택 후 자동으로 모니터링 시작

#### 1.2 IPC 핸들러 구현 ✅

- ✅ `dashboard:select-mode`: OCR/음성 모드 선택
- ✅ `overlay:mode-changed`: 오버레이 모드 변경 알림 (렌더러 → 메인)
- ✅ `overlay:setMode`: 오버레이 모드 설정 (메인 → 렌더러)
- ✅ `overlay:state`: 오버레이 상태 푸시 (메인 → 렌더러)

### 2. Frontend 구현 ✅

#### 2.1 모드 선택 UI ✅

- ✅ **ModeSelection 컴포넌트**: OCR/음성 모드 선택 화면
- ✅ **OCR 모드 선택**: 오버레이 윈도우 동적 생성 및 ROI 선택
- ✅ **음성 모드 선택**: AudioManager를 통한 음성 스트리밍 시작

#### 2.2 오버레이 최적화 ✅

- ✅ OCR 간격 개선: 500ms → 300ms
- ✅ 비동기 처리로 지연 최소화
- ✅ 유해 표현 감지 시에만 블러 처리
- ✅ 로그 최적화: 유해 표현 감지 위주로 출력

## 구현 완료 내용

### 1. Electron Main Process 수정 ✅

#### 윈도우 관리자 구현

**`electron/main.ts`**:

- ✅ 앱 시작 시 `mainWindow`만 생성 (대시보드)
- ✅ `overlayWindow`는 `null`로 초기화, OCR 모드 선택 시 동적 생성
- ✅ `setOverlayWindowInstance` 함수로 외부에서 오버레이 윈도우 업데이트 가능
- ✅ `getOverlayWindow` 함수로 `state/editMode.ts`의 오버레이 윈도우 접근

**`electron/ipc/dashboardHandlers.ts`**:

- ✅ `SELECT_MODE` IPC 핸들러 구현
- ✅ OCR 모드 선택 시 오버레이 윈도우 동적 생성
- ✅ ROI 핸들러, OnVoice 핸들러, Audio 핸들러 등록
- ✅ Ctrl+E/Q 단축키 핸들러 설정
- ✅ 트레이 아이콘 생성 및 관리

#### IPC 채널 구현

**`electron/ipc/channels.ts`**:

- ✅ `DASHBOARD_CHANNELS.SELECT_MODE`: 모드 선택 (ocr | voice)
- ✅ `IPC_CHANNELS.OVERLAY_MODE_CHANGED`: 오버레이 모드 변경 알림

### 2. Frontend 구현 ✅

#### 2.1 모드 선택 UI

**`renderer/src/components/ModeSelection.tsx`**:

- ✅ OCR 필터링 / 음성 필터링 선택 버튼
- ✅ 모드 선택 후 활성화 메시지 표시
- ✅ `window.api.dashboard.selectMode()` 호출

**`renderer/src/App.tsx`**:

- ✅ `ModeSelection` 컴포넌트 렌더링

#### 2.2 오버레이 최적화

**`renderer/src/overlay/OverlayApp.tsx`**:

- ✅ `onServerAlert` 핸들러로 유해 표현 감지 시 블러 처리
- ✅ ESC 키로 ROI 재선택 가능
- ✅ 유해 표현 감지 시에만 로그 출력

**`electron/main.ts`**:

- ✅ OCR 캡처 간격: 500ms → 300ms
- ✅ 비동기 처리로 지연 최소화 (다음 캡처를 먼저 스케줄링)

### 3. 서버 통신 및 블러 처리 ✅

**`electron/main/onVoiceBridge.ts`**:

- ✅ 서버 AI 분석 타임아웃: 3초
- ✅ 재시도 로직 (1회 재시도)
- ✅ 유해 표현 감지 시에만 상세 로그 출력

**`electron/main.ts`**:

- ✅ 서버로부터 `is_harmful` 응답 처리
- ✅ `ALERT_FROM_SERVER` IPC 채널로 렌더러에 전송
- ✅ `state/editMode.ts`의 오버레이 윈도우도 확인하여 전송

### 4. 키보드 단축키 및 트레이 ✅

**`electron/windows/createOverlayWindow.ts`**:

- ✅ `before-input-event` 리스너로 Ctrl+E/Q 감지
- ✅ `setExitEditModeAndHideHandler`로 핸들러 설정

**`electron/ipc/dashboardHandlers.ts`**:

- ✅ `globalShortcut`으로 Ctrl+E/Q 등록
- ✅ 트레이 아이콘 생성 및 표시

**`electron/tray.ts`**:

- ✅ 트레이 메뉴 "영역 지정" 기능
- ✅ 오버레이 표시/숨김 기능

## 검증 체크리스트

### 기능 검증 ✅

- [x] 앱 실행 시 오버레이 대신 **모드 선택 화면**이 뜨는가? ✅
- [x] OCR 모드 선택 시 오버레이가 정상적으로 화면에 덮이는가? ✅
- [x] ROI 영역 선택이 정상적으로 작동하는가? ✅
- [x] ROI 선택 후 OCR 모니터링이 자동으로 시작되는가? ✅
- [x] ESC 키로 ROI 재선택이 가능한가? ✅
- [x] Ctrl+E/Q 단축키로 오버레이가 숨겨지는가? ✅
- [x] 트레이 아이콘이 시스템 트레이에 표시되는가? ✅
- [x] 음성 모드 선택 시 AudioManager가 정상 작동하는가? ✅
- [x] 서버로부터 `is_harmful=true` 응답 시 블러 처리가 되는가? ✅

### 성능 검증 ✅

- [x] OCR 캡처 간격이 300ms로 설정되어 있는가? ✅
- [x] 서버 AI 분석 타임아웃이 3초로 설정되어 있는가? ✅
- [x] 유해 표현 감지 시에만 로그가 출력되는가? ✅

### 배포 검증

- [ ] `npm run build` 후 생성된 실행 파일에서도 모든 기능이 정상 작동하는가?

## 변경된 파일 목록 ✅

1. ✅ `electron/main.ts`:

   - 윈도우 관리 로직 수정 (mainWindow만 초기 생성, overlayWindow는 동적 생성)
   - `setOverlayWindowInstance`, `setCurrentROI` 함수 추가
   - OCR 캡처 간격 300ms로 조정
   - 비동기 처리 개선
   - 서버 AI 분석 응답 처리 및 블러 처리 로직

2. ✅ `electron/preload.ts`:

   - `window.api.dashboard.selectMode` 추가
   - `window.api.overlay.sendModeChange` 추가
   - 로그 최적화

3. ✅ `renderer/src/App.tsx`:

   - `ModeSelection` 컴포넌트 렌더링

4. ✅ `renderer/src/components/ModeSelection.tsx`:

   - OCR/음성 모드 선택 UI 구현 (신규)

5. ✅ `renderer/src/overlay/OverlayApp.tsx`:

   - ESC 키로 ROI 재선택 기능
   - `onServerAlert` 핸들러로 블러 처리
   - 로그 최적화

6. ✅ `electron/ipc/channels.ts`:

   - `DASHBOARD_CHANNELS.SELECT_MODE` 추가
   - `IPC_CHANNELS.OVERLAY_MODE_CHANGED` 추가

7. ✅ `electron/ipc/dashboardHandlers.ts`:

   - 모드 선택 IPC 핸들러 구현 (신규)
   - 오버레이 윈도우 동적 생성
   - Ctrl+E/Q 단축키 등록
   - 트레이 아이콘 생성

8. ✅ `electron/windows/createOverlayWindow.ts`:

   - `setExitEditModeAndHideHandler` 함수
   - `before-input-event` 리스너로 Ctrl+E/Q 감지

9. ✅ `electron/state/editMode.ts`:

   - `getOverlayWindow` 함수 추가

10. ✅ `electron/main/onVoiceBridge.ts`:

    - 서버 AI 분석 타임아웃 3초로 조정
    - 재시도 로직 추가
    - 로그 최적화

11. ✅ `electron/tray.ts`:

    - `setTrayUpdateCallback` 함수 추가
    - 트레이 메뉴 "영역 지정" 기능 개선

12. ✅ `electron/ipc/roi.ts`:
    - ROI 선택 시 `main.ts`의 `currentROI` 업데이트

## 주요 구현 내용

### 모드 선택 화면

- 앱 시작 시 OCR/음성 모드를 선택할 수 있는 화면 표시
- 각 모드 선택 시 해당 기능 활성화

### OCR 모드 동작

1. OCR 모드 선택 → 오버레이 윈도우 동적 생성
2. ROI 영역 선택 → 자동으로 OCR 모니터링 시작
3. 서버 AI 분석 → 유해 표현 감지 시 블러 처리
4. ESC 키 → ROI 재선택 가능
5. Ctrl+E/Q → 오버레이 숨김

### 음성 모드 동작

1. 음성 모드 선택 → AudioManager를 통한 음성 스트리밍 시작
2. 서버 AI 분석 → 유해 표현 감지 시 볼륨 조절

### 성능 최적화

- OCR 캡처 간격: 300ms
- 서버 AI 분석 타임아웃: 3초 (재시도 1회)
- 비동기 처리로 지연 최소화
- 로그 최적화: 유해 표현 감지 위주로 출력

## 다음 작업 (선택사항)

- [ ] 대시보드 UI 확장 (통계, 설정 등)
- [ ] 로그 미리보기 기능 (Task 46 연동)
- [ ] 배포 검증 및 최종 테스트

## 참고 자료

- [작업 42: Electron 앱 배포](./42-electron-app-deployment.md)
- [작업 45: Spawn 방식 Bridge 마이그레이션](./45-spawn-bridge-migration.md)
- [작업 46: Supabase 관리자 DB](./46-supabase-admin-db.md)
