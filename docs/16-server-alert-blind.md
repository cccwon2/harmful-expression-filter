# 작업 16: 서버 알림 수신 및 블라인드 표시

## 상태
✅ 완료

## 개요
서버에서 "유해함(1)" 신호를 수신하면 ROI 영역에 블라인드를 표시하고, 해제(0) 신호 시 블라인드를 제거합니다.

## 요구사항

### 서버 연결 스텁
- [x] 테스트용으로 3초마다 0/1 토글 신호 생성
- [x] `ALERT_FROM_SERVER` IPC 채널로 렌더러에 전송

### 블라인드 표시
- [x] `harmful=true`일 때 ROI 사각형을 `rgba(0,0,0,0.4)` 반투명 블라인드로 채움
- [x] 테두리는 유지 (선택 사항: 테두리 색상 변경)
- [x] 모드를 `alert`로 전환

### 블라인드 해제
- [x] `harmful=false`일 때 블라인드 제거
- [x] 모드를 `detect`로 복귀 (테두리만 유지)
- [x] CSS 트랜지션으로 200ms 페이드 효과

### 시각 효과
- [x] 블라인드 페이드 인/아웃 애니메이션
- [x] 성능 최적화 (프레임 드랍 없음)

## 의존성
- [작업 15: OCR/STT 파이프라인 스텁](./15-ocr-stt-stub.md)
- [작업 11: 상태 모델 정의](./11-state-model-definition.md)
- [작업 7: IPC 통신](./07-ipc-communication.md)

## 관련 파일
- `electron/main.ts` 또는 `electron/serverClient.ts` (새로 생성) - 서버 연결 스텁
- `renderer/src/overlay/OverlayApp.tsx` - 블라인드 렌더링 로직
- `electron/preload.ts` - `onServerAlert` API 추가

## 참조해야 할 핵심 파일
- `@electron/ipc/channels.ts` - `ALERT_FROM_SERVER` 채널 확인
- `@renderer/src/overlay/roiTypes.ts` - `OverlayMode`, `OverlayState` 타입 확인
- `@renderer/src/overlay/OverlayApp.tsx` - 상태 머신 및 렌더링 로직 확인

## 구현 계획

### 1. 서버 연결 스텁
```typescript
// electron/serverClient.ts (새로 생성)
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from './ipc/channels';

let alertInterval: NodeJS.Timeout | null = null;
let isHarmful = false;

export function setupServerClientStub(overlayWindow: BrowserWindow) {
  // 테스트용: 3초마다 0/1 토글
  alertInterval = setInterval(() => {
    isHarmful = !isHarmful;
    overlayWindow.webContents.send(IPC_CHANNELS.ALERT_FROM_SERVER, {
      harmful: isHarmful,
    });
    console.log('[Server] Alert signal:', isHarmful ? 1 : 0);
  }, 3000);
}

export function stopServerClientStub() {
  if (alertInterval) {
    clearInterval(alertInterval);
    alertInterval = null;
  }
}
```

### 2. Preload API 확장
```typescript
// electron/preload.ts
contextBridge.exposeInMainWorld('overlay', {
  // ...
  onServerAlert: (cb: (harmful: boolean) => void) => {
    const listener = (_: unknown, payload: { harmful: boolean }) => {
      cb(payload.harmful);
    };
    ipcRenderer.on(IPC_CHANNELS.ALERT_FROM_SERVER, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ALERT_FROM_SERVER, listener);
    };
  },
});
```

### 3. 렌더러에서 서버 알림 수신
```typescript
// renderer/src/overlay/OverlayApp.tsx
useEffect(() => {
  const unsubscribe = window.api.overlay.onServerAlert((harmful) => {
    setHarmful(harmful);
    if (harmful) {
      setMode('alert');
    } else {
      setMode('detect');
    }
  });
  return unsubscribe;
}, []);
```

### 4. 블라인드 렌더링
```typescript
// renderer/src/overlay/OverlayApp.tsx
{mode === 'alert' && roi && harmful && (
  <div
    style={{
      position: 'absolute',
      left: `${roi.x}px`,
      top: `${roi.y}px`,
      width: `${roi.width}px`,
      height: `${roi.height}px`,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      border: '2px solid rgba(255, 0, 0, 0.5)',
      pointerEvents: 'none',
      zIndex: 1001,
      transition: 'opacity 200ms ease-in-out',
      boxSizing: 'border-box',
    }}
  />
)}
```

## 산출물/수락 기준
- ✅ 서버 신호 1에서 ROI가 블라인드로 덮임
- ✅ 서버 신호 0에서 블라인드가 즉시 해제됨 (감지 모드 HUD로 복귀)
- ✅ 블라인드 페이드 인/아웃 애니메이션 동작
- ✅ 프레임 드랍/클릭 전달 이상 없음

## 테스트 방법
1. 감지 모드로 전환
2. 서버 스텁이 3초마다 0/1 토글하는지 확인
3. 신호 1에서 ROI가 블라인드로 덮이는지 확인
4. 신호 0에서 블라인드가 해제되는지 확인
5. 블라인드 중에도 클릭이 뒤 앱으로 전달되는지 확인

## 향후 작업
- 실제 서버 연결: WebSocket 또는 HTTP 폴링
- 서버 인증 및 보안
- 재연결 로직

## 다음 작업
- [작업 17: ESC/트레이로 설정 모드 재진입](./17-escape-tray-resetup.md)

## 참조
- [INTERFACES.md](../INTERFACES.md): 핵심 인터페이스 문서
- [PROJECT_SPEC.md](../PROJECT_SPEC.md): 프로젝트 명세서

