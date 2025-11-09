# 작업 6: 상태 관리 (State Machine)

## 상태
✅ 완료

## 개요
오버레이 애플리케이션의 상태를 상태 머신 패턴으로 관리합니다.

## 완료된 기능

### 상태 모델
- ✅ `OverlayMode`: 'setup' | 'detect' | 'alert'
- ✅ `OverlayState`: mode, roi, harmful 상태 포함
- ✅ `ROI`: ROI 좌표 정보
- ✅ `SelectionState`: ROI 선택 중 임시 상태

### 상태 전환
- ✅ setup → detect: ROI 선택 완료 시
- ✅ detect → alert: 유해 표현 감지 시 (향후 구현)
- ✅ alert → detect: 알림 처리 완료 시 (향후 구현)

### 모드 효과 적용
- ✅ setup 모드: 클릭-스루 비활성화 (ROI 선택 가능)
- ✅ detect 모드: 클릭-스루 활성화 (모니터링 중)
- ✅ alert 모드: 클릭-스루 활성화 (알림 표시 중)

### 상태 노출
- ✅ `window.__overlayState`: 개발자 도구에서 상태 접근 가능
- ✅ 상태 변경 로그 출력

## 의존성
- [작업 4: ROI 선택 기능](./04-roi-selection.md)
- [작업 7: IPC 통신](./07-ipc-communication.md)

## 관련 파일
- `renderer/src/overlay/OverlayApp.tsx` ⚠️ **핵심 연결부 파일** (INTERFACES.md 참조)
- `renderer/src/overlay/roiTypes.ts` ⚠️ **핵심 연결부 파일** (INTERFACES.md 참조)

## 타입 정의
```typescript
export type OverlayMode = 'setup' | 'detect' | 'alert';

export type OverlayState = {
  mode: OverlayMode;
  roi?: ROI;
  harmful?: boolean;
};
```

## 주요 코드
```typescript
const applyModeEffects = useCallback((newMode: OverlayMode) => {
  const clickThrough = newMode !== 'setup';
  window.api.overlay.setClickThrough(clickThrough);
}, []);

// ROI 선택 완료 시 모드 전환
setRoi(rect);
handleModeChange('detect');
```

## 다음 작업
- 향후: OCR 및 유해 표현 감지 기능 (detect 모드)
- 향후: 서버 알림 처리 (alert 모드)

