# 핵심 인터페이스 및 연결부 코드 (Core Interfaces)

이 문서는 프로젝트의 핵심 연결부 파일들을 문서화합니다. **새로운 작업을 시작할 때 반드시 참조해야 할 파일들**입니다.

## 왜 이 문서가 중요한가?

AI가 새로운 작업을 수행할 때, 이전 작업에서 만든 인터페이스와 타입을 정확히 참조하여 **기능 섬이 아닌 연결된 시스템**을 만들 수 있도록 합니다.

## 필수 참조 파일

### 1. IPC 채널 정의
**파일**: `electron/ipc/channels.ts`

모든 IPC 통신의 채널 이름이 정의된 파일입니다. 새로운 IPC 통신을 추가할 때는 반드시 이 파일을 참조하세요.

```typescript
export const IPC_CHANNELS = {
  ROI_SELECTED: 'roi:selected',
  ROI_START_SELECTION: 'roi-start-selection',
  ROI_CANCEL_SELECTION: 'roi-cancel-selection',
  EXIT_EDIT_MODE: 'exit-edit-mode',
  HIDE_OVERLAY: 'hide-overlay',
  EXIT_EDIT_MODE_AND_HIDE: 'exit-edit-mode-and-hide',
  SET_CLICK_THROUGH: 'overlay:setClickThrough',
  OVERLAY_SET_MODE: 'overlay:setMode',
  OVERLAY_STATE_PUSH: 'overlay:state',
  OCR_START: 'ocr:start',
  OCR_STOP: 'ocr:stop',
  ALERT_FROM_SERVER: 'alert:server',
} as const;
```

**사용 예시**:
- 새로운 IPC 채널 추가 시: 이 파일에 채널 이름 추가
- IPC 통신 구현 시: 이 파일의 채널 이름 사용

---

### 2. 타입 정의
**파일**: `renderer/src/overlay/roiTypes.ts`

프로젝트 전체에서 사용하는 핵심 타입 정의입니다.

```typescript
export type ROI = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OverlayMode = 'setup' | 'detect' | 'alert';

export type OverlayState = {
  mode: OverlayMode;
  roi?: ROI;
  harmful?: boolean;
};

export interface SelectionState {
  isSelecting: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}
```

**사용 예시**:
- 새로운 타입 추가 시: 이 파일에 타입 정의 추가
- 타입 사용 시: 이 파일에서 타입 import

---

### 3. Preload API 타입
**파일**: `renderer/src/global.d.ts`

렌더러 프로세스에서 사용 가능한 `window.api`의 타입 정의입니다.

```typescript
declare global {
  interface Window {
    api: {
      appVersion: string;
      getVersion: () => string;
      roi: {
        sendSelected: (rect: ROI) => void;
        sendStartSelection: () => void;
        sendCancelSelection: () => void;
      };
      editMode: {
        exit: () => void;
        exitAndHide: () => void;
      };
      overlay: {
        hide: () => void;
        setClickThrough: (enabled: boolean) => Promise<void>;
        sendROI: (roi: ROI) => void;
        onModeChange: (callback: (mode: OverlayMode) => void) => () => void;
        onStatePush: (callback: (state: OverlayState) => void) => () => void;
      };
    };
  }
}
```

**사용 예시**:
- 새로운 API 추가 시: `electron/preload.ts`와 이 파일 모두 업데이트
- API 사용 시: `window.api.xxx` 형태로 사용

---

### 4. Preload 구현
**파일**: `electron/preload.ts`

렌더러 프로세스에 노출되는 실제 API 구현입니다.

```typescript
contextBridge.exposeInMainWorld('api', {
  // API 구현
});
```

**사용 예시**:
- 새로운 API 추가 시: 이 파일에 API 구현 추가
- IPC 채널 사용: `IPC_CHANNELS`에서 채널 이름 import

---

### 5. 오버레이 창 생성
**파일**: `electron/windows/createOverlayWindow.ts`

투명 오버레이 창을 생성하고 관리하는 함수입니다.

**주요 기능**:
- 전체 화면 투명 창 생성
- 클릭-스루 설정
- 개발자 도구 통합
- 키보드 이벤트 처리

**사용 예시**:
- 오버레이 창 관련 작업 시: 이 파일 참조
- 새로운 창 기능 추가 시: 이 파일 수정

---

### 6. Edit Mode 상태 관리
**파일**: `electron/state/editMode.ts`

Edit Mode 상태를 중앙에서 관리하는 모듈입니다.

```typescript
export function getEditModeState(): boolean;
export function setEditModeState(value: boolean, options?: { hideOverlay?: boolean }): void;
export function setOverlayWindow(window: BrowserWindow | null): void;
export function setTrayUpdateCallback(callback: (() => void) | null): void;
```

**사용 예시**:
- Edit Mode 상태 확인/변경 시: 이 모듈의 함수 사용
- 오버레이 창 관련 작업 시: 이 모듈 참조

---

### 7. ROI IPC 핸들러
**파일**: `electron/ipc/roi.ts`

ROI 선택 관련 IPC 통신을 처리하는 핸들러입니다.

```typescript
export function setupROIHandlers(overlayWindow: BrowserWindow): void;
export function isROISelectionCompleteState(): boolean;
export function isROISelectingState(): boolean;
```

**사용 예시**:
- ROI 관련 IPC 추가 시: 이 파일 참조
- ROI 상태 확인 시: export된 함수 사용

---

### 8. 오버레이 React 컴포넌트
**파일**: `renderer/src/overlay/OverlayApp.tsx`

오버레이 창의 React UI 컴포넌트입니다.

**주요 상태**:
- `mode`: OverlayMode ('setup' | 'detect' | 'alert')
- `roi`: ROI 좌표
- `harmful`: 유해 표현 감지 여부
- `selectionState`: ROI 선택 중 상태

**사용 예시**:
- 오버레이 UI 수정 시: 이 파일 수정
- 상태 머신 로직 추가 시: 이 파일 참조

---

### 9. 저장소 (electron-store)
**파일**: `electron/store.ts`

ROI와 모드 상태를 영속화하는 경량 래퍼입니다.

```typescript
export function getROI(): ROI | null;
export function setROI(roi: ROI | null): void;
export function getMode(): OverlayMode;
export function setMode(mode: OverlayMode): void;
export function getStoreSnapshot(): StoreData;
```

**사용 예시**:
- ROI 저장: `setROI(roi)`
- ROI 읽기: `const roi = getROI()`
- 모드 저장: `setMode('detect')`
- 저장소 전체 확인: `const state = getStoreSnapshot()`

---

### 10. OCR Worker - 향후 추가
**파일**: `electron/ocrWorker.ts` (새로 생성 예정)

OCR/STT 파이프라인을 관리하는 모듈입니다.

**사용 예시**:
- OCR 시작: `ipcMain.on(OCR_START, ...)`
- OCR 중지: `ipcMain.on(OCR_STOP, ...)`

---

### 11. 서버 클라이언트 - 향후 추가
**파일**: `electron/serverClient.ts` (새로 생성 예정)

서버 연결 및 알림을 처리하는 모듈입니다.

**사용 예시**:
- 서버 연결: WebSocket 또는 HTTP 폴링
- 알림 전송: `overlayWindow.webContents.send(ALERT_FROM_SERVER, ...)`

---

## 새로운 작업 시작 시 체크리스트

새로운 작업(예: T12: 트레이 메뉴 "영역 지정")을 시작할 때:

1. ✅ **마스터 플랜 확인**: `PROJECT_SPEC.md`에서 작업 요구사항 확인
2. ✅ **IPC 채널 확인**: `electron/ipc/channels.ts`에서 사용 가능한 채널 확인
3. ✅ **타입 확인**: `renderer/src/overlay/roiTypes.ts`에서 사용 가능한 타입 확인
4. ✅ **API 확인**: `renderer/src/global.d.ts`와 `electron/preload.ts`에서 사용 가능한 API 확인
5. ✅ **연결부 파일 확인**: 위의 핵심 파일들을 모두 참조하여 작업 시작

## 예시: T12 (트레이 메뉴 "영역 지정") 작업 시작

```
작업 지시:
1. PROJECT_SPEC.md에서 T12 요구사항 확인
2. 다음 파일들을 반드시 참조:
   - @electron/ipc/channels.ts (OVERLAY_SET_MODE 채널 확인)
   - @electron/tray.ts (트레이 메뉴 구조 확인)
   - @electron/windows/createOverlayWindow.ts (오버레이 창 참조)
   - @renderer/src/overlay/roiTypes.ts (OverlayMode 타입 확인)
   - @renderer/src/overlay/OverlayApp.tsx (모드 변경 리스너 확인)
3. electron/tray.ts에 "영역 지정" 메뉴 항목 추가
4. 클릭 시 설정 모드 진입 로직 구현
```

## 예시: T15 (OCR/STT 파이프라인 스텁) 작업 시작

```
작업 지시:
1. PROJECT_SPEC.md에서 T15 요구사항 확인
2. 다음 파일들을 반드시 참조:
   - @electron/ipc/channels.ts (OCR_START, OCR_STOP 채널 확인)
   - @renderer/src/overlay/roiTypes.ts (ROI 타입 확인)
   - @electron/windows/createOverlayWindow.ts (오버레이 창 참조)
   - @renderer/src/overlay/OverlayApp.tsx (상태 머신 확인)
   - @electron/ipc/roi.ts (ROI 핸들러 구조 확인)
3. electron/ocrWorker.ts 파일 생성 (또는 electron/main.ts에 추가)
4. OCR_START/OCR_STOP IPC 핸들러 구현
5. 주기적 타이머로 스텁 로그 출력 (1-2초 주기)
```

## 업데이트 규칙

이 문서는 프로젝트의 핵심 인터페이스가 변경될 때마다 업데이트해야 합니다:
- 새로운 IPC 채널 추가 시
- 새로운 타입 추가 시
- 새로운 API 추가 시
- 핵심 모듈 변경 시

## 관련 문서

- `PROJECT_SPEC.md`: 전체 프로젝트 명세서
- `tasks/00-overview.md`: 작업 개요
- 각 작업 문서: `tasks/01-electron-setup.md` 등

