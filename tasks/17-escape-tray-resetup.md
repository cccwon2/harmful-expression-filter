# 작업 17: ESC/트레이로 설정 모드 재진입

## 상태
⏳ 진행 예정

## 개요
ESC 키 또는 트레이 메뉴를 통해 언제든지 설정 모드로 재진입하여 ROI를 다시 지정할 수 있도록 합니다.

## 요구사항

### ESC 키 처리
- [ ] `keydown` 이벤트에서 Escape 키 감지
- [ ] `harmful` 상태를 `false`로 리셋
- [ ] 모드를 `setup`으로 변경
- [ ] 클릭-스루 비활성화 (`setClickThrough(false)`)
- [ ] 드래그 재활성화

### 트레이 메뉴
- [ ] "영역 재지정(Re-setup)" 메뉴 항목 추가
- [ ] 클릭 시 설정 모드 진입 (작업 12와 동일한 로직)

### OCR 중지
- [ ] 설정 모드 진입 시 `OCR_STOP` IPC 전송
- [ ] OCR 타이머 정리

## 의존성
- [작업 12: 트레이 메뉴 "영역 지정" → 설정 모드 진입](./12-tray-setup-mode-entry.md)
- [작업 15: OCR/STT 파이프라인 스텁](./15-ocr-stt-stub.md)
- [작업 16: 서버 알림 수신 및 블라인드 표시](./16-server-alert-blind.md)
- [작업 9: 키보드 단축키](./09-keyboard-shortcuts.md)

## 관련 파일
- `renderer/src/overlay/OverlayApp.tsx` - ESC 키 처리
- `electron/tray.ts` - 트레이 메뉴 수정
- `electron/main.ts` - OCR_STOP IPC 처리

## 참조해야 할 핵심 파일
- `@electron/ipc/channels.ts` - `OVERLAY_SET_MODE`, `OCR_STOP` 채널 확인
- `@renderer/src/overlay/OverlayApp.tsx` - 기존 ESC 키 처리 로직 확인
- `@electron/tray.ts` - 트레이 메뉴 구조 확인

## 구현 계획

### 1. ESC 키 처리
```typescript
// renderer/src/overlay/OverlayApp.tsx
useEffect(() => {
  const handleKeyDown = async (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      e.stopPropagation();
      
      // 유해 상태 리셋
      setHarmful(false);
      
      // 설정 모드로 전환
      setMode('setup');
      await window.api.overlay.setClickThrough(false);
      
      // ROI 선택 상태 리셋
      setSelectionState(null);
      setIsSelectionComplete(false);
      
      console.log('[Overlay] Reset to setup mode (ESC)');
    }
  };
  
  document.addEventListener('keydown', handleKeyDown, true);
  return () => {
    document.removeEventListener('keydown', handleKeyDown, true);
  };
}, []);
```

### 2. 트레이 메뉴 수정
```typescript
// electron/tray.ts
{
  label: '영역 재지정 (Re-setup)',
  type: 'normal',
  click: () => {
    // OCR 중지
    ipcMain.emit(IPC_CHANNELS.OCR_STOP);
    
    // 설정 모드 진입
    overlayWindow.show();
    overlayWindow.setIgnoreMouseEvents(false);
    overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_SET_MODE, 'setup');
    
    console.log('[Tray] Reset to setup mode');
  },
}
```

### 3. 설정 모드 진입 시 OCR 중지
```typescript
// electron/ipc/roi.ts 또는 electron/main.ts
ipcMain.on(IPC_CHANNELS.OVERLAY_SET_MODE, (event, mode: OverlayMode) => {
  if (mode === 'setup') {
    // OCR 중지
    ipcMain.emit(IPC_CHANNELS.OCR_STOP);
  }
});
```

## 산출물/수락 기준
- ✅ ESC 키로 언제든 설정 모드 재진입 가능
- ✅ 트레이 메뉴로 언제든 설정 모드 재진입 가능
- ✅ 설정 모드 진입 시 OCR 스텁이 정지됨
- ✅ 유해 상태가 리셋되고 블라인드가 제거됨
- ✅ ROI 선택이 재활성화됨

## 테스트 방법
1. 감지 모드에서 ESC 키 누르기
2. 설정 모드로 전환되는지 확인
3. ROI 재선택 가능한지 확인
4. 트레이 메뉴에서 "영역 재지정" 클릭
5. 설정 모드로 전환되는지 확인

## 다음 작업
- [작업 18: ROI/모드 영속화 및 부팅 시 복원](./18-persistence-boot-restore.md)

## 참조
- [INTERFACES.md](../INTERFACES.md): 핵심 인터페이스 문서
- [PROJECT_SPEC.md](../PROJECT_SPEC.md): 프로젝트 명세서

