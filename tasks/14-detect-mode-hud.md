# 작업 14: 감지 모드 HUD 표시

## 상태
⏳ 진행 예정

## 개요
감지 모드에서 ROI 영역에 희미한 테두리 HUD를 표시하여 "이 영역 감시 중"을 시각적으로 표시합니다.

## 요구사항

### HUD 시각화
- [ ] ROI 사각형에 반투명 테두리 표시
- [ ] 화면 클릭/키 입력은 오버레이가 가로채지 않음 (클릭-스루 ON)
- [ ] HUD 요소는 CSS로 가볍게 구현 (blur 금지)

### 클릭-스루 설정
- [ ] `setClickThrough(true)` 호출 시 `{ forward: true }` 옵션 사용
- [ ] 클릭/드래그가 뒤 앱으로 정상 전달되는지 확인

### 스타일링
- [ ] 반투명 테두리 (예: `rgba(0, 255, 0, 0.3)`)
- [ ] 얇은 선 두께 (1-2px)
- [ ] 성능 최적화 (애니메이션 최소화)

## 의존성
- [작업 13: 설정 모드 ROI 선택 및 감지 모드 전환](./13-setup-mode-roi-selection.md)
- [작업 11: 상태 모델 정의](./11-state-model-definition.md)
- [작업 3: 투명 오버레이 창](./03-overlay-window.md)

## 관련 파일
- `renderer/src/overlay/OverlayApp.tsx` - HUD 렌더링 로직
- `electron/preload.ts` - `setClickThrough` API 확인
- `electron/main.ts` - `SET_CLICK_THROUGH` 핸들러 확인

## 참조해야 할 핵심 파일
- `@renderer/src/overlay/roiTypes.ts` - `ROI` 타입 확인
- `@renderer/src/overlay/OverlayApp.tsx` - 기존 ROI 렌더링 로직 확인
- `@electron/ipc/channels.ts` - `SET_CLICK_THROUGH` 채널 확인

## 구현 계획

### 1. 감지 모드 HUD 렌더링
```typescript
// renderer/src/overlay/OverlayApp.tsx
{mode === 'detect' && roi && (
  <div
    style={{
      position: 'absolute',
      left: `${roi.x}px`,
      top: `${roi.y}px`,
      width: `${roi.width}px`,
      height: `${roi.height}px`,
      border: '2px solid rgba(0, 255, 0, 0.3)',
      pointerEvents: 'none',
      zIndex: 1000,
      boxSizing: 'border-box',
    }}
  />
)}
```

### 2. 클릭-스루 설정 확인
```typescript
// electron/main.ts
ipcMain.handle(IPC_CHANNELS.SET_CLICK_THROUGH, (_event, enabled: boolean) => {
  if (overlayWindow) {
    overlayWindow.setIgnoreMouseEvents(enabled, { forward: true });
    return true;
  }
  return false;
});
```

### 3. 모드 전환 시 클릭-스루 적용
```typescript
// renderer/src/overlay/OverlayApp.tsx
const applyModeEffects = useCallback(async (newMode: OverlayMode) => {
  const clickThrough = newMode !== 'setup';
  await window.api.overlay.setClickThrough(clickThrough);
  
  console.log(`[Overlay] Mode: ${newMode}, Click-through: ${clickThrough}`);
}, []);
```

## 산출물/수락 기준
- ✅ 감지 모드에서 ROI 상자 테두리가 보임
- ✅ 화면 클릭이 뒤 앱으로 전달됨
- ✅ 게임/채팅창 정상 클릭 가능
- ✅ HUD가 성능에 영향 없음 (프레임 드랍 없음)

## 테스트 방법
1. ROI 선택 후 감지 모드 전환
2. ROI 영역에 희미한 테두리가 표시되는지 확인
3. ROI 영역 내외부 클릭 테스트
4. 뒤 앱(게임/채팅창)이 정상 클릭되는지 확인

## 다음 작업
- [작업 15: OCR/STT 파이프라인 스텁](./15-ocr-stt-stub.md)
- [작업 16: 서버 알림 수신 및 블라인드 표시](./16-server-alert-blind.md)

## 참조
- [INTERFACES.md](../INTERFACES.md): 핵심 인터페이스 문서
- [PROJECT_SPEC.md](../PROJECT_SPEC.md): 프로젝트 명세서

