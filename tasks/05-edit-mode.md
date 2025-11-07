# 작업 5: Edit Mode 관리

## 상태
✅ 완료

## 개요
Edit Mode 상태를 중앙에서 관리하여 오버레이 창의 클릭-스루 및 마우스 이벤트를 제어합니다.

## 완료된 기능

### 상태 관리
- ✅ 중앙화된 Edit Mode 상태 (`electron/state/editMode.ts`)
- ✅ 오버레이 창 참조 관리
- ✅ 트레이 메뉴 업데이트 콜백 시스템

### Edit Mode 활성화/비활성화
- ✅ 활성화 시: 마우스 이벤트 활성화, 오버레이 표시
- ✅ 비활성화 시: 클릭-스루 활성화, 오버레이 숨김
- ✅ 앱 시작 시 기본적으로 Edit Mode 활성화

### IPC 통신
- ✅ `EXIT_EDIT_MODE`: Edit Mode 종료
- ✅ `HIDE_OVERLAY`: 오버레이 숨김
- ✅ `EXIT_EDIT_MODE_AND_HIDE`: Edit Mode 종료 및 오버레이 숨김

### 키보드 단축키
- ✅ Ctrl+E, Ctrl+Q: Edit Mode 종료 및 오버레이 숨김
- ✅ ESC: ROI 선택 취소 (Edit Mode는 유지)

## 의존성
- [작업 3: 투명 오버레이 창](./03-overlay-window.md)
- [작업 7: IPC 통신](./07-ipc-communication.md)
- [작업 9: 키보드 단축키](./09-keyboard-shortcuts.md)

## 관련 파일
- `electron/state/editMode.ts`
- `electron/main.ts`
- `electron/tray.ts`
- `electron/windows/createOverlayWindow.ts`

## 주요 코드
```typescript
export function setEditModeState(value: boolean) {
  isEditMode = value;
  if (overlayWindow) {
    if (value) {
      // Edit Mode 활성화: 마우스 이벤트 활성화
      overlayWindow.setIgnoreMouseEvents(false);
    } else {
      // Edit Mode 비활성화: 클릭스루 활성화
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      if (overlayWindow.isVisible()) {
        overlayWindow.hide();
      }
    }
  }
  // 트레이 메뉴 업데이트
  if (trayUpdateCallback) {
    trayUpdateCallback();
  }
}
```

## 다음 작업
- [작업 6: 상태 관리](./06-state-management.md)
- [작업 9: 키보드 단축키](./09-keyboard-shortcuts.md)

