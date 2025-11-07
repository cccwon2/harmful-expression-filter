# 작업 3: 투명 오버레이 창

## 상태
✅ 완료

## 개요
전체 화면 투명 오버레이 창을 생성하여 ROI 선택 및 다른 기능을 위한 UI를 제공합니다.

## 완료된 기능

### 창 설정
- ✅ 전체 화면 (fullscreen: true)
- ✅ 프레임 없음 (frame: false)
- ✅ 투명 배경 (transparent: true)
- ✅ 항상 최상위 (alwaysOnTop: true)
- ✅ 작업표시줄 숨김 (skipTaskbar: true)
- ✅ 클릭 가능 (focusable: true)

### 클릭-스루 기능
- ✅ 기본 상태: 클릭-스루 활성화 (마우스 이벤트 무시)
- ✅ Edit Mode 활성화 시: 클릭-스루 비활성화 (마우스 이벤트 수신)
- ✅ 개발자 도구 열림 시: 조건부 클릭-스루 (Edit Mode 상태에 따라)

### 개발자 도구 통합
- ✅ detach 모드로 개발자 도구 열기
- ✅ 개발자 도구 열림 시 키보드 포커스 해제 (overlayWindow.blur())
- ✅ 개발자 도구 콘솔 로그 연결 확인

### 키보드 이벤트 처리
- ✅ before-input-event 리스너로 메인 프로세스에서 키 입력 처리
- ✅ Ctrl+Shift+I, F12: 개발자 도구 토글
- ✅ Ctrl+E, Ctrl+Q: Edit Mode 종료

## 의존성
- [작업 1: 기본 Electron 앱 설정](./01-electron-setup.md)
- [작업 5: Edit Mode 관리](./05-edit-mode.md)
- [작업 8: 개발자 도구 통합](./08-devtools-integration.md)

## 관련 파일
- `electron/windows/createOverlayWindow.ts`
- `renderer/src/overlay/OverlayApp.tsx`
- `renderer/overlay.html`

## 주요 코드
```typescript
export function createOverlayWindow(): BrowserWindow {
  const overlayWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    // ...
  });
  
  // 클릭-스루 기본 설정
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  
  return overlayWindow;
}
```

## 다음 작업
- [작업 4: ROI 선택 기능](./04-roi-selection.md)
- [작업 5: Edit Mode 관리](./05-edit-mode.md)
- [작업 6: 상태 관리](./06-state-management.md)
- [작업 8: 개발자 도구 통합](./08-devtools-integration.md)

