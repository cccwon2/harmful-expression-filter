# 작업 10: Preload API

## 상태
✅ 완료

## 개요
Context Isolation을 사용하여 렌더러 프로세스에 안전한 API를 노출합니다.

## 완료된 기능

### 보안 설정
- ✅ contextIsolation: true
- ✅ nodeIntegration: false
- ✅ sandbox: true

### API 노출
- ✅ `window.api.appVersion`: 앱 버전
- ✅ `window.api.getVersion()`: 버전 가져오기
- ✅ `window.api.roi`: ROI 관련 IPC API
- ✅ `window.api.editMode`: Edit Mode 관련 IPC API
- ✅ `window.api.overlay`: 오버레이 관련 IPC API

### ROI API
- ✅ `sendSelected(rect)`: ROI 선택 완료
- ✅ `sendStartSelection()`: ROI 선택 시작
- ✅ `sendCancelSelection()`: ROI 선택 취소

### Edit Mode API
- ✅ `exit()`: Edit Mode 종료
- ✅ `exitAndHide()`: Edit Mode 종료 및 오버레이 숨김

### Overlay API
- ✅ `hide()`: 오버레이 숨김
- ✅ `setClickThrough(enabled)`: 클릭-스루 설정 (Promise 반환)

## 의존성
- [작업 1: 기본 Electron 앱 설정](./01-electron-setup.md)
- [작업 7: IPC 통신](./07-ipc-communication.md)

## 관련 파일
- `electron/preload.ts` ⚠️ **핵심 연결부 파일** (INTERFACES.md 참조)
- `renderer/src/global.d.ts` ⚠️ **핵심 연결부 파일** (INTERFACES.md 참조)

## 주요 코드
```typescript
contextBridge.exposeInMainWorld('api', {
  appVersion: '1.0.0',
  getVersion: () => '1.0.0',
  roi: {
    sendSelected: (rect: ROIRect) => {
      ipcRenderer.send(IPC_CHANNELS.ROI_SELECTED, rect);
    },
    sendStartSelection: () => {
      ipcRenderer.send(IPC_CHANNELS.ROI_START_SELECTION);
    },
    sendCancelSelection: () => {
      ipcRenderer.send(IPC_CHANNELS.ROI_CANCEL_SELECTION);
    },
  },
  editMode: {
    exit: () => {
      ipcRenderer.send(IPC_CHANNELS.EXIT_EDIT_MODE);
    },
    exitAndHide: () => {
      ipcRenderer.send(IPC_CHANNELS.EXIT_EDIT_MODE_AND_HIDE);
    },
  },
  overlay: {
    hide: () => {
      ipcRenderer.send(IPC_CHANNELS.HIDE_OVERLAY);
    },
    setClickThrough: (enabled: boolean) => {
      return ipcRenderer.invoke(IPC_CHANNELS.SET_CLICK_THROUGH, enabled);
    },
  },
});
```

## 타입 정의
```typescript
declare global {
  interface Window {
    api: {
      appVersion: string;
      getVersion: () => string;
      roi: {
        sendSelected: (rect: ROIRect) => void;
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
      };
    };
  }
}
```

## 다음 작업
- [작업 4: ROI 선택 기능](./04-roi-selection.md)
- [작업 5: Edit Mode 관리](./05-edit-mode.md)
- [작업 6: 상태 관리](./06-state-management.md)

