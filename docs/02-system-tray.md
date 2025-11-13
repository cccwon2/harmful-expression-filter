# 작업 2: 시스템 트레이

## 상태
✅ 완료

## 개요
시스템 트레이 아이콘과 컨텍스트 메뉴를 구현하여 애플리케이션을 제어합니다.

## 완료된 기능

### 트레이 아이콘
- ✅ "H" 텍스트가 있는 32x32 픽셀 아이콘 생성
- ✅ 파란색 배경 (#2563eb) 및 흰색 텍스트
- ✅ 고해상도 디스플레이 지원

### 컨텍스트 메뉴
- ✅ Show/Hide Overlay: 오버레이 창 표시/숨김 토글
- ✅ Edit Mode/Exit Edit Mode: Edit Mode 활성화/비활성화
- ✅ Toggle DevTools: 개발자 도구 열기/닫기
- ✅ 오디오 모니터링 섹션:
  - 상태 표시: "🟢 오디오 모니터링 중" 또는 "⚪ 오디오 모니터링 중지"
  - 시작/중지 버튼: "▶️ 오디오 모니터링 시작" 또는 "⏸️ 오디오 모니터링 중지"
- ✅ Quit: 애플리케이션 종료

### 기능
- ✅ 더블 클릭으로 오버레이 표시/숨김
- ✅ 동적 메뉴 업데이트 (오버레이 표시 상태, Edit Mode 상태, 오디오 모니터링 상태에 따라)
- ✅ 트레이 메뉴 업데이트 콜백 시스템
- ✅ 트레이 아이콘 색상 변경 (오디오 모니터링 상태에 따라)
  - 초록색 배경 (#10b981): 오디오 모니터링 중
  - 파란색 배경 (#2563eb): 오디오 모니터링 중지
- ✅ 트레이 툴팁에 오디오 모니터링 상태 표시
- ✅ 오디오 모니터링 상태 변경 시 자동 업데이트

## 의존성
- [작업 1: 기본 Electron 앱 설정](./01-electron-setup.md)
- [작업 3: 투명 오버레이 창](./03-overlay-window.md)
- [작업 5: Edit Mode 관리](./05-edit-mode.md)
- [작업 25: 음성 Electron 연동](./25-audio-electron-integration.md) - 오디오 모니터링 상태 표시

## 관련 파일
- `electron/tray.ts` - 트레이 아이콘, 메뉴, 오디오 모니터링 상태 표시
- `electron/main.ts` - 트레이 생성 및 오디오 모니터링 콜백 등록
- `electron/ipc/audioHandlers.ts` - 오디오 모니터링 서비스 접근
- `electron/audio/audioService.ts` - 오디오 모니터링 상태 관리

## 주요 코드
```typescript
export function createTray(overlayWindow: BrowserWindow): Tray {
  const icon = createTrayIcon();
  const tray = new Tray(icon);
  // 컨텍스트 메뉴 설정
  // 더블 클릭 핸들러
  return tray;
}
```

## 다음 작업
- [작업 3: 투명 오버레이 창](./03-overlay-window.md)
- [작업 5: Edit Mode 관리](./05-edit-mode.md)

