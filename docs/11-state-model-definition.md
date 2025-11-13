# 작업 11: 상태 모델 정의 (State Model Definition)

## 상태
✅ 완료 (기본 구현 완료, 개선 필요)

## 개요
모드 전환/클릭-스루/ROI HUD/블라인드 반응을 명시적 상태로 관리하는 상태 모델을 정의합니다.

## 완료된 기능

### 타입 정의
- ✅ `ROI` 타입: ROI 좌표 정보
- ✅ `OverlayMode` 타입: 'setup' | 'detect' | 'alert'
- ✅ `OverlayState` 타입: mode, roi, harmful 상태 포함
- ✅ `SelectionState` 타입: ROI 선택 중 임시 상태

### 상태 머신 구현
- ✅ `OverlayApp.tsx`에 상태 머신 훅 구현
- ✅ `mode`, `setMode`: 오버레이 모드 상태
- ✅ `roi`, `setRoi`: ROI 좌표 상태
- ✅ `harmful`, `setHarmful`: 유해 표현 감지 상태
- ✅ `applyModeEffects`: 모드별 효과 적용 함수

### 모드 효과 적용
- ✅ setup 모드: 클릭-스루 비활성화 (ROI 선택 가능)
- ✅ detect 모드: 클릭-스루 활성화 (모니터링 중)
- ✅ alert 모드: 클릭-스루 활성화 (알림 표시 중)

## 개선 필요 사항

### Preload API 확장
- ⚠️ `window.overlay.sendROI()` 메서드 추가 필요
- ⚠️ `window.overlay.onModeChange()` 리스너 추가 필요
- ⚠️ `window.overlay.onServerAlert()` 리스너 추가 필요

### 상태 브로드캐스트
- ⚠️ `OVERLAY_STATE_PUSH` IPC 채널을 통한 상태 동기화 필요

## 의존성
- [작업 6: 상태 관리](./06-state-management.md)
- [작업 10: Preload API](./10-preload-api.md)

## 관련 파일
- `renderer/src/overlay/roiTypes.ts` ⚠️ **핵심 연결부 파일** (INTERFACES.md 참조)
- `renderer/src/overlay/OverlayApp.tsx` ⚠️ **핵심 연결부 파일** (INTERFACES.md 참조)

## 타입 정의
```typescript
export type ROI = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OverlayMode = 'setup' | 'detect' | 'alert';

export type OverlayState = {
  mode: OverlayMode;
  roi?: ROI;
  harmful?: boolean;
};
```

## 주요 코드
```typescript
// OverlayApp.tsx
const [mode, setMode] = useState<OverlayMode>('setup');
const [roi, setRoi] = useState<ROI | undefined>(undefined);
const [harmful, setHarmful] = useState<boolean>(false);

const applyModeEffects = useCallback((newMode: OverlayMode) => {
  const clickThrough = newMode !== 'setup';
  window.api.overlay.setClickThrough(clickThrough);
}, []);
```

## 다음 작업
- [작업 12: 트레이 메뉴 "영역 지정" → 설정 모드 진입](./12-tray-setup-mode-entry.md)
- [작업 13: 설정 모드 ROI 선택 및 감지 모드 전환](./13-setup-mode-roi-selection.md)
- [작업 14: 감시 모니터링 & HUD/OCR](./14-monitoring-ocr.md)

## 참조
- [INTERFACES.md](./INTERFACES.md): 핵심 인터페이스 문서
- [PROJECT_SPEC.md](./PROJECT_SPEC.md): 프로젝트 명세서

