# 작업 19: Preload API 확장

## 상태
⏳ 진행 예정

## 개요
모드 전환, 서버 알림, 상태 동기화를 위한 Preload API를 확장합니다.

## 요구사항

### API 메서드 추가
- [ ] `window.api.overlay.sendROI(roi)`: ROI 전송
- [ ] `window.api.overlay.onModeChange(cb)`: 모드 변경 리스너
- [ ] `window.api.overlay.onServerAlert(cb)`: 서버 알림 리스너
- [ ] `window.api.overlay.onStatePush(cb)`: 상태 동기화 리스너

### 타입 안전성
- [ ] 모든 API 메서드에 타입 정의
- [ ] `global.d.ts`에 타입 추가
- [ ] 빌드 에러 없이 컴파일

### 메모리 관리
- [ ] 리스너 해제 함수 반환
- [ ] 컴포넌트 언마운트 시 리스너 정리
- [ ] 메모리 누수 방지

## 의존성
- [작업 10: Preload API](./10-preload-api.md)
- [작업 7: IPC 통신](./07-ipc-communication.md)
- [작업 11: 상태 모델 정의](./11-state-model-definition.md)

## 관련 파일
- `electron/preload.ts` - Preload API 구현
- `renderer/src/global.d.ts` - 타입 정의
- `renderer/src/overlay/OverlayApp.tsx` - API 사용 예시

## 참조해야 할 핵심 파일
- `@electron/ipc/channels.ts` - IPC 채널 확인
- `@renderer/src/overlay/roiTypes.ts` - 타입 정의 확인
- `@electron/preload.ts` - 기존 API 구조 확인

## 구현 계획

### 1. Preload API 확장
```typescript
// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './ipc/channels';
import type { ROIRect } from './ipc/roi';
import type { OverlayMode, OverlayState } from '../../renderer/src/overlay/roiTypes';

contextBridge.exposeInMainWorld('overlay', {
  // ROI 전송
  sendROI: (roi: ROIRect) => {
    ipcRenderer.send(IPC_CHANNELS.ROI_SELECTED, roi);
  },
  
  // 클릭-스루 설정
  setClickThrough: (enabled: boolean) => {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_CLICK_THROUGH, enabled);
  },
  
  // 모드 변경 리스너
  onModeChange: (callback: (mode: OverlayMode) => void) => {
    const listener = (_: unknown, mode: OverlayMode) => {
      callback(mode);
    };
    ipcRenderer.on(IPC_CHANNELS.OVERLAY_SET_MODE, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.OVERLAY_SET_MODE, listener);
    };
  },
  
  // 서버 알림 리스너
  onServerAlert: (callback: (harmful: boolean) => void) => {
    const listener = (_: unknown, payload: { harmful: boolean }) => {
      callback(payload.harmful);
    };
    ipcRenderer.on(IPC_CHANNELS.ALERT_FROM_SERVER, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ALERT_FROM_SERVER, listener);
    };
  },
  
  // 상태 동기화 리스너
  onStatePush: (callback: (state: OverlayState) => void) => {
    const listener = (_: unknown, state: OverlayState) => {
      callback(state);
    };
    ipcRenderer.on(IPC_CHANNELS.OVERLAY_STATE_PUSH, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.OVERLAY_STATE_PUSH, listener);
    };
  },
});
```

### 2. 타입 정의 추가
```typescript
// renderer/src/global.d.ts
interface ROIRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type OverlayMode = 'setup' | 'detect' | 'alert';

type OverlayState = {
  mode: OverlayMode;
  roi?: ROIRect;
  harmful?: boolean;
};

declare global {
  interface Window {
    api: {
      // 기존 API...
      overlay: {
        sendROI: (roi: ROIRect) => void;
        setClickThrough: (enabled: boolean) => Promise<void>;
        onModeChange: (callback: (mode: OverlayMode) => void) => () => void;
        onServerAlert: (callback: (harmful: boolean) => void) => () => void;
        onStatePush: (callback: (state: OverlayState) => void) => () => void;
      };
    };
  }
}
```

### 3. 렌더러에서 API 사용
```typescript
// renderer/src/overlay/OverlayApp.tsx
useEffect(() => {
  // 모드 변경 리스너
  const unsubscribeMode = window.api.overlay.onModeChange((mode) => {
    setMode(mode);
    applyModeEffects(mode);
  });
  
  // 서버 알림 리스너
  const unsubscribeAlert = window.api.overlay.onServerAlert((harmful) => {
    setHarmful(harmful);
    if (harmful) {
      setMode('alert');
    } else {
      setMode('detect');
    }
  });
  
  // 상태 동기화 리스너
  const unsubscribeState = window.api.overlay.onStatePush((state) => {
    if (state.roi) setRoi(state.roi);
    if (state.mode) {
      setMode(state.mode);
      applyModeEffects(state.mode);
    }
    if (state.harmful !== undefined) setHarmful(state.harmful);
  });
  
  return () => {
    unsubscribeMode();
    unsubscribeAlert();
    unsubscribeState();
  };
}, []);
```

## 산출물/수락 기준
- ✅ 모든 API 메서드가 타입 안전하게 구현됨
- ✅ 빌드 에러 없이 컴파일됨
- ✅ 리스너가 정상적으로 구독/해제됨
- ✅ 메모리 누수 없음 (컴포넌트 언마운트 시 정리)

## 테스트 방법
1. 개발자 도구에서 `window.api.overlay` 확인
2. 각 API 메서드 호출 테스트
3. 리스너 구독/해제 테스트
4. 컴포넌트 언마운트 시 리스너 정리 확인

## 다음 작업
모든 작업 완료 후 실제 OCR/STT 구현으로 진행

## 참조
- [INTERFACES.md](../INTERFACES.md): 핵심 인터페이스 문서
- [PROJECT_SPEC.md](../PROJECT_SPEC.md): 프로젝트 명세서
- [작업 10: Preload API](./10-preload-api.md)

