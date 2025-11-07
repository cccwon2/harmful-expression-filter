# 작업 9: 키보드 단축키

## 상태
✅ 완료

## 개요
애플리케이션의 주요 기능을 키보드 단축키로 제어합니다.

## 완료된 기능

### 개발자 도구 단축키
- ✅ Ctrl+Shift+I: 개발자 도구 토글
- ✅ F12: 개발자 도구 토글
- ✅ 글로벌 단축키 등록 (globalShortcut)

### Edit Mode 단축키
- ✅ Ctrl+E: Edit Mode 종료 및 오버레이 숨김
- ✅ Ctrl+Q: Edit Mode 종료 및 오버레이 숨김
- ✅ 메인 프로세스에서 처리 (before-input-event)

### ROI 선택 단축키
- ✅ ESC: ROI 선택 취소/리셋
  - 선택 중: 선택 취소
  - 선택 완료: 선택 리셋
  - 선택 없음: 아무 동작 없음

### 키보드 이벤트 처리
- ✅ before-input-event: 메인 프로세스에서 키 입력 차단/전달
- ✅ keydown: 렌더러 프로세스에서 키 입력 처리
- ✅ ESC 키는 렌더러에서 처리 (ROI 선택 취소)

## 의존성
- [작업 3: 투명 오버레이 창](./03-overlay-window.md)
- [작업 5: Edit Mode 관리](./05-edit-mode.md)
- [작업 8: 개발자 도구 통합](./08-devtools-integration.md)

## 관련 파일
- `electron/main.ts`
- `electron/windows/createOverlayWindow.ts`
- `renderer/src/overlay/OverlayApp.tsx`

## 주요 코드
```typescript
// 글로벌 단축키 등록
globalShortcut.register('CommandOrControl+Shift+I', () => {
  // 개발자 도구 토글
});

// before-input-event 리스너
overlayWindow.webContents.on('before-input-event', (event, input) => {
  if (input.key === 'F12') {
    // 개발자 도구 토글
    event.preventDefault();
  }
  if ((input.control || input.meta) && input.key === 'e') {
    // Edit Mode 종료
    event.preventDefault();
  }
});
```

## 단축키 목록

| 단축키 | 기능 | 처리 위치 |
|--------|------|-----------|
| Ctrl+Shift+I | 개발자 도구 토글 | Main Process (globalShortcut) |
| F12 | 개발자 도구 토글 | Main Process (before-input-event) |
| Ctrl+E | Edit Mode 종료 | Main Process (before-input-event) |
| Ctrl+Q | Edit Mode 종료 | Main Process (before-input-event) |
| ESC | ROI 선택 취소/리셋 | Renderer Process (keydown) |

## 다음 작업
- 향후: 사용자 정의 단축키 설정 기능

