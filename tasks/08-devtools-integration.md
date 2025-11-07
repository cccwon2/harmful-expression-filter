# 작업 8: 개발자 도구 통합

## 상태
✅ 완료

## 개요
개발자 도구를 오버레이 창에 통합하여 디버깅과 개발을 지원합니다.

## 완료된 기능

### 개발자 도구 열기/닫기
- ✅ Ctrl+Shift+I: 개발자 도구 토글
- ✅ F12: 개발자 도구 토글
- ✅ 트레이 메뉴: "Toggle DevTools" 옵션
- ✅ detach 모드로 열기 (독립 창)

### 키보드 포커스 관리
- ✅ 개발자 도구 열림 시 오버레이 창 포커스 해제 (blur())
- ✅ 개발자 도구가 키보드 입력을 받을 수 있도록 설정

### 콘솔 로그 연결
- ✅ `console-message` 이벤트 리스너: 렌더러 콘솔 로그를 메인 프로세스에서 확인
- ✅ `devtools-opened` 이벤트 리스너: 개발자 도구 열림 시 테스트 로그 출력
- ✅ 개발자 도구 열림 시 자동 테스트 로그 출력

### 상태 노출
- ✅ `window.__overlayState`: 개발자 도구에서 상태 접근 가능
- ✅ 테스트 로그로 상태 확인 가능

### 클릭-스루 관리
- ✅ 개발자 도구 열림 시 Edit Mode 상태에 따라 클릭-스루 설정
- ✅ Edit Mode 활성화 시: 마우스 이벤트 유지 (ROI 선택 가능)
- ✅ Edit Mode 비활성화 시: 클릭-스루 활성화 (개발자 도구 상호작용 가능)

## 의존성
- [작업 3: 투명 오버레이 창](./03-overlay-window.md)
- [작업 5: Edit Mode 관리](./05-edit-mode.md)
- [작업 9: 키보드 단축키](./09-keyboard-shortcuts.md)

## 관련 파일
- `electron/main.ts`
- `electron/tray.ts`
- `electron/windows/createOverlayWindow.ts`
- `renderer/src/overlay/OverlayApp.tsx`

## 주요 코드
```typescript
// 개발자 도구 열기
overlayWindow.webContents.openDevTools({ mode: 'detach' });
overlayWindow.blur(); // 키보드 포커스 해제

// 테스트 로그 출력
overlayWindow.webContents.executeJavaScript(`
  console.log('[DevTools] DevTools opened successfully!');
  console.log('[DevTools] Overlay state:', window.__overlayState);
`);
```

## 다음 작업
- 향후: 개발자 도구에서 상태 변경 기능

