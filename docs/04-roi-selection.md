# 작업 4: ROI 선택 기능

## 상태
✅ 완료

## 개요
마우스 드래그로 ROI (Region of Interest) 영역을 선택하는 기능을 구현합니다.

## 완료된 기능

### ROI 선택 UI
- ✅ 마우스 다운 이벤트로 선택 시작
- ✅ 마우스 드래그로 선택 영역 표시 (반투명 배경 + 테두리)
- ✅ 마우스 업 이벤트로 선택 완료
- ✅ 최소 드래그 크기 체크 (4px)

### ROI 선택 상태 관리
- ✅ 선택 중 상태 (`isSelecting`)
- ✅ 선택 완료 상태 (`isSelectionComplete`)
- ✅ 선택 취소 기능 (ESC 키)

### IPC 통신
- ✅ `ROI_START_SELECTION`: 선택 시작 알림
- ✅ `ROI_SELECTED`: 선택 완료 및 ROI 좌표 전송
- ✅ `ROI_CANCEL_SELECTION`: 선택 취소 알림

### 메인 프로세스 처리
- ✅ ROI 선택 시작 시 마우스 이벤트 활성화
- ✅ ROI 선택 완료 후 Edit Mode 상태에 따라 클릭-스루 설정
- ✅ ROI 선택 취소 후 상태 복원

## 의존성
- [작업 3: 투명 오버레이 창](./03-overlay-window.md)
- [작업 5: Edit Mode 관리](./05-edit-mode.md)
- [작업 7: IPC 통신](./07-ipc-communication.md)

## 관련 파일
- `renderer/src/overlay/OverlayApp.tsx`
- `electron/ipc/roi.ts`
- `renderer/src/overlay/roiTypes.ts`

## 타입 정의
```typescript
export type ROI = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export interface SelectionState {
  isSelecting: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}
```

## 주요 코드
```typescript
// ROI 선택 핸들러
ipcMain.on(IPC_CHANNELS.ROI_START_SELECTION, () => {
  // 마우스 이벤트 활성화
  overlayWindow.setIgnoreMouseEvents(false);
});

ipcMain.on(IPC_CHANNELS.ROI_SELECTED, (_event, rect: ROIRect) => {
  // ROI 좌표 저장 및 처리
  // 클릭-스루 설정 (Edit Mode 상태에 따라)
});
```

## 다음 작업
- [작업 6: 상태 관리](./06-state-management.md)
- [작업 9: 키보드 단축키](./09-keyboard-shortcuts.md)

