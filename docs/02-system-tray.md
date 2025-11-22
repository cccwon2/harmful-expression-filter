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
- ✅ 오디오 캡처 섹션 (AudioManager 통합):
  - 상태 표시: "🟢 스트리밍 중 (chrome/edge/discord)" 또는 "⚪ 스트리밍 중지"
  - "Capture Chrome": Chrome 오디오 캡처 시작
  - "Capture Edge": Edge 오디오 캡처 시작
  - "Capture Discord": Discord 오디오 캡처 시작
  - "Stop Capture": 캡처 중지 (스트리밍 중일 때만 활성화)
- ✅ Quit: 애플리케이션 종료

### 기능
- ✅ 더블 클릭으로 오버레이 표시/숨김
- ✅ 동적 메뉴 업데이트 (오버레이 표시 상태, Edit Mode 상태, 오디오 스트리밍 상태에 따라)
- ✅ 트레이 메뉴 업데이트 콜백 시스템
- ✅ 트레이 아이콘 색상 변경 (오디오 스트리밍 상태에 따라)
  - 초록색 배경 (#10b981): 오디오 스트리밍 중
  - 파란색 배경 (#2563eb): 오디오 스트리밍 중지
- ✅ 트레이 툴팁에 오디오 스트리밍 상태 표시 (대상 앱 포함)
- ✅ 오디오 스트리밍 상태 변경 시 자동 업데이트
- ✅ AudioManager 통합 (트레이에서 직접 오디오 캡처 제어)

## 의존성
- [작업 1: 기본 Electron 앱 설정](./01-electron-setup.md)
- [작업 3: 투명 오버레이 창](./03-overlay-window.md)
- [작업 5: Edit Mode 관리](./05-edit-mode.md)
- [작업 25: 음성 Electron 연동](./25-audio-electron-integration.md) - 오디오 모니터링 상태 표시
- [작업 29: OnVoice COM Bridge 통합](./29-onvoice-com-bridge-integration.md) - AudioManager 통합

## 관련 파일
- `electron/tray.ts` - 트레이 아이콘, 메뉴, 오디오 스트리밍 상태 표시 (AudioManager 통합)
- `electron/main.ts` - 트레이 생성 및 AudioManager 초기화
- `electron/main/AudioManager.ts` - 오디오 스트리밍 관리자 (Singleton, 트레이 메뉴 통합)
- `electron/main/onVoiceBridge.ts` - OnVoice Bridge 모듈
- `electron/ipc/audioHandlers.ts` - 오디오 모니터링 서비스 접근 (기존 AudioService)
- `electron/audio/audioService.ts` - 오디오 모니터링 상태 관리 (naudiodon2 기반)

## 주요 코드
```typescript
import AudioManager from './main/AudioManager';

export function createTray(overlayWindow: BrowserWindow, handlers: TrayHandlers): Tray {
  const icon = createTrayIcon(false);
  const tray = new Tray(icon);
  
  const updateContextMenu = () => {
    const audioManager = AudioManager.getInstance();
    const audioStatus = audioManager.getStatus();
    const isStreaming = audioStatus.isStreaming || false;
    
    // 트레이 아이콘 업데이트
    const newIcon = createTrayIcon(isStreaming);
    tray.setImage(newIcon);
    
    // 컨텍스트 메뉴 설정
    const contextMenu = Menu.buildFromTemplate([
      // ... 기타 메뉴 항목
      {
        label: 'Capture Chrome',
        click: async () => {
          await audioManager.startStream('chrome');
        },
      },
      // ... 기타 캡처 옵션
    ]);
    
    tray.setContextMenu(contextMenu);
  };
  
  // 더블 클릭 핸들러
  return tray;
}
```

## 다음 작업
- [작업 3: 투명 오버레이 창](./03-overlay-window.md)
- [작업 5: Edit Mode 관리](./05-edit-mode.md)

