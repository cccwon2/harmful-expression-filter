# 작업 7: IPC 통신

## 상태
✅ 완료

## 개요
메인 프로세스와 렌더러 프로세스 간의 안전한 IPC 통신을 구현합니다.

## 완료된 기능

### IPC 채널 정의
- ✅ `ROI_SELECTED`: ROI 선택 완료
- ✅ `ROI_START_SELECTION`: ROI 선택 시작
- ✅ `ROI_CANCEL_SELECTION`: ROI 선택 취소
- ✅ `EXIT_EDIT_MODE`: Edit Mode 종료
- ✅ `HIDE_OVERLAY`: 오버레이 숨김
- ✅ `EXIT_EDIT_MODE_AND_HIDE`: Edit Mode 종료 및 오버레이 숨김
- ✅ `SET_CLICK_THROUGH`: 클릭-스루 설정 (invoke)
- ✅ `OVERLAY_SET_MODE`: 오버레이 모드 설정 (향후 구현)
- ✅ `OVERLAY_STATE_PUSH`: 오버레이 상태 전송 (향후 구현)
- ✅ `OCR_START`: OCR 시작 (향후 구현)
- ✅ `OCR_STOP`: OCR 중지 (향후 구현)
- ✅ `ALERT_FROM_SERVER`: 서버 알림 (향후 구현)

### ROI IPC 핸들러
- ✅ ROI 선택 시작: 마우스 이벤트 활성화
- ✅ ROI 선택 완료: ROI 좌표 저장, 클릭-스루 설정
- ✅ ROI 선택 취소: 상태 복원, 클릭-스루 설정

### Edit Mode IPC 핸들러
- ✅ Edit Mode 종료: 상태 업데이트, 트레이 메뉴 업데이트
- ✅ 오버레이 숨김: 창 숨김, 상태 업데이트

### Click-through IPC 핸들러
- ✅ invoke 방식으로 클릭-스루 설정 (응답 반환)

## 의존성
- [작업 1: 기본 Electron 앱 설정](./01-electron-setup.md)
- [작업 10: Preload API](./10-preload-api.md)

## 관련 파일
- `electron/ipc/channels.ts` ⚠️ **핵심 연결부 파일** (INTERFACES.md 참조)
- `electron/ipc/roi.ts`
- `electron/main.ts`
- `electron/preload.ts` ⚠️ **핵심 연결부 파일** (INTERFACES.md 참조)

## 주요 코드
```typescript
// IPC 채널 정의
export const IPC_CHANNELS = {
  ROI_SELECTED: 'roi:selected',
  ROI_START_SELECTION: 'roi-start-selection',
  ROI_CANCEL_SELECTION: 'roi-cancel-selection',
  // ...
} as const;

// ROI 핸들러 설정
export function setupROIHandlers(overlayWindow: BrowserWindow) {
  ipcMain.on(IPC_CHANNELS.ROI_SELECTED, (_event, rect: ROIRect) => {
    // ROI 처리
  });
}
```

## 다음 작업
- [작업 4: ROI 선택 기능](./04-roi-selection.md)
- [작업 5: Edit Mode 관리](./05-edit-mode.md)
- [작업 10: Preload API](./10-preload-api.md)

