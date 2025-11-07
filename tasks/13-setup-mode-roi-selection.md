# 작업 13: 설정 모드 ROI 선택 및 감지 모드 전환

## 상태
⏳ 진행 예정

## 개요
설정 모드에서 드래그로 ROI 영역을 선택하고, 선택 완료 시 자동으로 감지 모드로 전환합니다.

## 요구사항

### ROI 선택 기능
- [ ] 마우스 다운으로 선택 시작 좌표 기억
- [ ] 마우스 이동으로 실시간 박스 렌더링
- [ ] 마우스 업으로 ROI 계산 및 검증
- [ ] 최소 크기 체크 (4px 미만 무시)

### ROI 저장
- [ ] `window.api.overlay.sendROI(roi)` 호출
- [ ] 메인 프로세스에서 ROI 저장 (electron-store 사용)
- [ ] 저장 완료 로그 출력

### 감지 모드 자동 전환
- [ ] ROI 저장 후 클릭-스루 활성화 (`setClickThrough(true)`)
- [ ] 모드를 `detect`로 변경
- [ ] 상태 브로드캐스트 및 스타일 업데이트

## 의존성
- [작업 4: ROI 선택 기능](./04-roi-selection.md)
- [작업 11: 상태 모델 정의](./11-state-model-definition.md)
- [작업 12: 트레이 메뉴 "영역 지정" → 설정 모드 진입](./12-tray-setup-mode-entry.md)
- [작업 7: IPC 통신](./07-ipc-communication.md)

## 관련 파일
- `renderer/src/overlay/OverlayApp.tsx` - ROI 선택 로직
- `electron/ipc/roi.ts` - ROI 저장 핸들러
- `electron/preload.ts` - `sendROI` API 추가
- `electron/store.ts` (새로 생성) - electron-store 설정

## 참조해야 할 핵심 파일
- `@electron/ipc/channels.ts` - `ROI_SELECTED` 채널 확인
- `@renderer/src/overlay/roiTypes.ts` - `ROI` 타입 확인
- `@electron/ipc/roi.ts` - ROI 핸들러 구조 확인
- `@renderer/src/overlay/OverlayApp.tsx` - 기존 ROI 선택 로직 확인

## 구현 계획

### 1. Preload API 확장
```typescript
// electron/preload.ts
contextBridge.exposeInMainWorld('overlay', {
  sendROI: (roi: ROI) => {
    ipcRenderer.send(IPC_CHANNELS.ROI_SELECTED, roi);
  },
  // ...
});
```

### 2. ROI 저장 (electron-store)
```typescript
// electron/store.ts (새로 생성)
import Store from 'electron-store';

const store = new Store({
  defaults: {
    roi: null,
    mode: 'setup',
  },
});

export { store };
```

### 3. ROI 핸들러 업데이트
```typescript
// electron/ipc/roi.ts
import { store } from '../store';

ipcMain.on(IPC_CHANNELS.ROI_SELECTED, (_event, roi: ROIRect) => {
  store.set('roi', roi);
  console.log('[ROI] Saved:', roi);
  // 감지 모드 전환을 위한 IPC 전송
  overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_SET_MODE, 'detect');
});
```

### 4. OverlayApp에서 ROI 선택 완료 처리
```typescript
// renderer/src/overlay/OverlayApp.tsx
const handleMouseUp = async () => {
  // ROI 계산
  const roi = calculateROI(selectionState);
  
  // 최소 크기 체크
  if (roi.width < 4 || roi.height < 4) {
    return;
  }
  
  // ROI 전송
  window.api.overlay.sendROI(roi);
  
  // 클릭-스루 활성화
  await window.api.overlay.setClickThrough(true);
  
  // ROI 저장 및 모드 전환
  setRoi(roi);
  setMode('detect');
  applyModeEffects('detect');
};
```

## 의존성 추가

### electron-store 설치
```bash
npm install electron-store
npm install --save-dev @types/electron-store
```

## 산출물/수락 기준
- ✅ 드래그-드롭 후 메인 프로세스 로그에 ROI 좌표 출력
- ✅ ROI 저장 완료 (electron-store)
- ✅ 즉시 감지 모드로 전환 (`mode='detect'`)
- ✅ 클릭-스루 활성화 (마우스 입력이 뒤 앱으로 전달)

## 테스트 방법
1. 설정 모드에서 여러 위치/크기로 드래그
2. ROI 좌표가 콘솔에 출력되는지 확인
3. 감지 모드로 자동 전환되는지 확인
4. 화면 클릭이 뒤 앱으로 전달되는지 확인

## 다음 작업
- [작업 14: 감지 모드 HUD 표시](./14-detect-mode-hud.md)
- [작업 15: OCR/STT 파이프라인 스텁](./15-ocr-stt-stub.md)

## 참조
- [INTERFACES.md](../INTERFACES.md): 핵심 인터페이스 문서
- [PROJECT_SPEC.md](../PROJECT_SPEC.md): 프로젝트 명세서

