# 작업 18: ROI/모드 영속화 및 부팅 시 복원

## 상태
✅ 부분 완료 (부팅 시 자동 복원 구현, electron-store 마이그레이션 보류)

## 개요
앱 재시작 시 마지막 ROI와 모드 상태를 복원하여 바로 감지 모드부터 시작할 수 있도록 합니다.

## 요구사항

### 데이터 영속화
- [ ] `electron-store`를 사용하여 ROI와 모드 저장 (현재 JSON 기반 저장소 유지)
- [x] ROI 선택 완료 시 자동 저장 (`setROI`)
- [x] 모드 변경 시 자동 저장 (`setMode`)
- [ ] 알림 중 종료해도 재시작 시 `alert` 상태까지 복원 (현재는 `detect` 모드로 복원)

### 부팅 시 복원
- [x] `app.whenReady()` 시 저장된 ROI 확인
- [x] ROI가 있으면 감지 모드로 자동 전환
- [x] 오버레이 창 표시 및 클릭-스루 활성화
- [x] 모니터링 자동 시작 (`startMonitoring()`)

### 로그 출력
- [x] 복원된 ROI와 모드 로그 출력
- [x] 복원 실패 시 기본 상태로 시작

## 의존성
- [작업 13: 설정 모드 ROI 선택 및 감지 모드 전환](./13-setup-mode-roi-selection.md)
- [작업 15: OCR/STT 파이프라인 스텁](./15-ocr-stt-stub.md)
- [작업 11: 상태 모델 정의](./11-state-model-definition.md)

## 관련 파일
- `electron/store.ts` - electron-store 설정 (작업 13에서 생성 예정)
- `electron/main.ts` - 부팅 시 복원 로직
- `electron/ipc/roi.ts` - ROI 저장 로직

## 참조해야 할 핵심 파일
- `@electron/store.ts` - 저장소 구조 확인
- `@renderer/src/overlay/roiTypes.ts` - `ROI`, `OverlayMode` 타입 확인
- `@electron/ipc/channels.ts` - `OVERLAY_SET_MODE`, `OCR_START` 채널 확인

## 구현 계획

### 1. 데이터 저장
```typescript
// electron/store.ts
import Store from 'electron-store';
import type { ROIRect } from './ipc/roi';
import type { OverlayMode } from '../../renderer/src/overlay/roiTypes';

interface StoreData {
  roi: ROIRect | null;
  mode: OverlayMode;
}

const store = new Store<StoreData>({
  defaults: {
    roi: null,
    mode: 'setup',
  },
});

export { store };
```

### 2. ROI 저장 로직
```typescript
// electron/ipc/roi.ts
import { store } from '../store';

ipcMain.on(IPC_CHANNELS.ROI_SELECTED, (_event, roi: ROIRect) => {
  // ROI 저장
  store.set('roi', roi);
  store.set('mode', 'detect');
  
  console.log('[ROI] Saved to store:', roi);
});
```

### 3. 부팅 시 복원
```typescript
// electron/main.ts
import { store } from './store';
import type { ROIRect } from './ipc/roi';

app.whenReady().then(() => {
  // 오버레이 창 생성
  overlayWindow = createOverlayWindow();
  
  // 저장된 ROI 복원
  overlayWindow.webContents.once('did-finish-load', () => {
    const savedRoi = store.get('roi') as ROIRect | null;
    const savedMode = store.get('mode') as OverlayMode;
    
    if (savedRoi && savedMode === 'detect') {
      console.log('[Main] Restoring saved ROI:', savedRoi);
      
      // 오버레이 표시
      overlayWindow.show();
      overlayWindow.setSkipTaskbar(false);
      
      // 클릭-스루 활성화
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      
      // 감지 모드로 전환
      overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_SET_MODE, 'detect');
      overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_PUSH, {
        mode: 'detect',
        roi: savedRoi,
        harmful: false,
      });
      
      // OCR 시작
      setTimeout(() => {
        ipcMain.emit(IPC_CHANNELS.OCR_START, savedRoi);
      }, 500);
    } else {
      // 기본 상태: 설정 모드
      console.log('[Main] No saved ROI, starting in setup mode');
      overlayWindow.show();
      overlayWindow.setSkipTaskbar(false);
      overlayWindow.setIgnoreMouseEvents(false);
      overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_SET_MODE, 'setup');
    }
  });
});
```

### 4. 상태 동기화 IPC 채널
```typescript
// electron/ipc/channels.ts
OVERLAY_STATE_PUSH: 'overlay:state',  // main -> renderer (send)
```

### 5. 렌더러에서 상태 복원
```typescript
// renderer/src/overlay/OverlayApp.tsx
useEffect(() => {
  const unsubscribe = window.api.overlay.onStatePush((state: OverlayState) => {
    if (state.roi) {
      setRoi(state.roi);
    }
    if (state.mode) {
      setMode(state.mode);
      applyModeEffects(state.mode);
    }
    if (state.harmful !== undefined) {
      setHarmful(state.harmful);
    }
  });
  return unsubscribe;
}, []);
```

## 산출물/수락 기준
- ✅ 앱 재시작 시 마지막 ROI가 자동 복원됨
- ✅ 감지 모드로 자동 전환 및 모니터링 자동 시작
- ⚠️ `alert` 모드 복원은 향후 서버 알림과 연동하여 확장 필요
- ✅ 저장된 데이터는 기존 JSON 저장소를 통해 유지됨 (electron-store 전환은 추후 진행)

## 테스트 방법
1. ROI 선택 후 감지 모드로 전환
2. 앱 종료
3. 앱 재시작
4. 저장된 ROI와 감지 모드가 자동 복원되는지 확인
5. OCR 스텁이 자동 시작되는지 확인

## 다음 작업
- 추가 작업 없음 (electron-store 마이그레이션 시 재검토)

## 참조
- [INTERFACES.md](./INTERFACES.md): 핵심 인터페이스 문서
- [PROJECT_SPEC.md](./PROJECT_SPEC.md): 프로젝트 명세서

