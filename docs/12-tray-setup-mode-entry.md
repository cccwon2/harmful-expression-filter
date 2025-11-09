# 작업 12: 트레이 메뉴 "영역 지정" → 설정 모드 진입

## 상태

✅ 완료

## 개요

트레이 메뉴에서 "영역 지정" 항목을 추가하여 설정 모드로 진입할 수 있도록 합니다.

## 요구사항

### 트레이 메뉴 항목 추가

- [x] "영역 지정(Select Region)" 메뉴 항목 추가
- [x] 클릭 시 설정 모드 진입 로직 구현 (공통 헬퍼 호출)

### 설정 모드 진입 동작

- [x] 오버레이 창 표시 및 포커스 (`enterSetupMode` 헬퍼)
- [x] 클릭-스루 비활성화 (`SET_CLICK_THROUGH(false)` → renderer 호출)
- [x] IPC로 모드 변경 알림 (`OVERLAY_SET_MODE`)
- [x] 상태 브로드캐스트 (`OVERLAY_STATE_PUSH`)

### 로그 출력

- [x] 메인 프로세스: `[Tray] Entering setup mode`
- [x] 렌더러 프로세스: `[Overlay] Mode change received from main process: setup`

## 의존성

- [작업 2: 시스템 트레이](./02-system-tray.md)
- [작업 3: 투명 오버레이 창](./03-overlay-window.md)
- [작업 11: 상태 모델 정의](./11-state-model-definition.md)
- [작업 7: IPC 통신](./07-ipc-communication.md)

## 관련 파일

- `electron/tray.ts` - 트레이 메뉴 수정
- `electron/main.ts` - IPC 핸들러 추가 (필요 시)
- `renderer/src/overlay/OverlayApp.tsx` - 모드 변경 리스너

## 참조해야 할 핵심 파일

- `@electron/ipc/channels.ts` - `OVERLAY_SET_MODE` 채널 확인
- `@electron/tray.ts` - 트레이 메뉴 구조 확인
- `@electron/windows/createOverlayWindow.ts` - 오버레이 창 참조
- `@renderer/src/overlay/roiTypes.ts` - `OverlayMode` 타입 확인
- `@electron/preload.ts` - Preload API 확인

## 구현 계획

### 1. IPC 채널 확인

```typescript
// electron/ipc/channels.ts
OVERLAY_SET_MODE: 'overlay:setMode',  // main -> renderer (send)
```

### 2. 트레이 메뉴 수정

```typescript
// electron/tray.ts
{
  label: '영역 지정 (Select Region)',
  type: 'normal',
  click: () => {
    handlers.enterSetupMode();
  },
}
```

### 3. 렌더러에서 모드 변경 수신

```typescript
// renderer/src/overlay/OverlayApp.tsx
useEffect(() => {
  const unsubscribe = window.api.overlay.onModeChange((mode) => {
    setMode(mode);
    applyModeEffects(mode);
  });
  return unsubscribe;
}, []);
```

### 4. 상태 브로드캐스트 수신

```typescript
// renderer/src/overlay/OverlayApp.tsx
useEffect(() => {
  const unsubscribe = window.api.overlay.onStatePush((state) => {
    setMode(state.mode);
    if (state.roi) setRoi(state.roi);
  });
  return unsubscribe;
}, []);
```

## 산출물/수락 기준

- ✅ 메뉴 클릭 시 오버레이가 전면 표시됨
- ✅ 오버레이가 `mode='setup'`으로 전환되고 콘솔 로그 확인 가능
- ✅ 클릭-스루가 비활성화되어 마우스 입력 가능 (`SET_CLICK_THROUGH(false)` 로그)
- ✅ `OVERLAY_STATE_PUSH` 수신 후 렌더러 상태 동기화

## 테스트 방법

1. 트레이 아이콘 우클릭 → "영역 지정" 메뉴 클릭
2. 오버레이 창이 표시되고 ROI 선택 가능한지 확인
3. 개발자 도구 콘솔에서 `[Overlay] Mode change...`, `[Overlay] State push received...` 로그 확인

## 다음 작업

- [작업 13: 설정 모드 ROI 선택 및 감지 모드 전환](./13-setup-mode-roi-selection.md)

## 참조

- [INTERFACES.md](../INTERFACES.md): 핵심 인터페이스 문서
- [PROJECT_SPEC.md](../PROJECT_SPEC.md): 프로젝트 명세서
