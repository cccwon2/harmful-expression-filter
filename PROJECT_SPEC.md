# 프로젝트 명세서 (Project Specification)

## 프로젝트 개요

**라이브 플랫폼 유해 표현 필터링, 마스킹, 비프음, 볼륨 조절** 애플리케이션

전체 화면 투명 오버레이를 사용하여 사용자가 지정한 ROI (Region of Interest) 영역을 모니터링하고, 유해한 표현을 감지하면 마스킹, 비프음, 볼륨 조절 등의 조치를 취하는 Electron 애플리케이션입니다.

## 아키텍처 개요

### 프로세스 구조
- **Main Process**: Electron 메인 프로세스 (창 관리, 시스템 트레이, IPC 처리)
- **Renderer Process**: React + TypeScript 렌더러 (오버레이 UI)
- **Preload Script**: Context Isolation을 통한 안전한 API 노출

### 핵심 개념

1. **헤드리스 실행**: 메인 창 없이 시스템 트레이에서만 실행
2. **투명 오버레이**: 전체 화면 투명 창으로 ROI 선택 및 모니터링
3. **Edit Mode**: ROI 선택을 위한 모드 (클릭-스루 비활성화)
4. **상태 머신**: setup → detect → alert 상태 전환
5. **IPC 통신**: 메인-렌더러 간 안전한 통신

## 작업 목록 및 요구사항

### T1: 기본 Electron 앱 설정
- TypeScript + Vite + React 환경 구성
- 개발 및 빌드 스크립트 설정
- 메인 프로세스 진입점 구성

### T2: 시스템 트레이
- 시스템 트레이 아이콘 생성 ("H" 텍스트)
- 컨텍스트 메뉴 (Show/Hide Overlay, Edit Mode, DevTools, Quit)
- 더블 클릭으로 오버레이 표시/숨김

### T3: 투명 오버레이 창
- 전체 화면 투명 창 생성
- 항상 최상위 (alwaysOnTop)
- 클릭-스루 기능 (Edit Mode에 따라 토글)
- 개발자 도구 통합 (detach 모드)

### T4: ROI 선택 기능
- 마우스 드래그로 ROI 영역 선택
- 선택 영역 시각적 표시 (반투명 배경 + 테두리)
- ROI 좌표 IPC 전송
- 최소 드래그 크기 체크 (4px)

### T5: Edit Mode 관리
- Edit Mode 상태 중앙 관리
- Edit Mode 활성화 시: 마우스 이벤트 활성화, 오버레이 표시
- Edit Mode 비활성화 시: 클릭-스루 활성화, 오버레이 숨김
- 앱 시작 시 기본적으로 Edit Mode 활성화

### T6: 상태 관리 (State Machine)
- 상태 모드: `setup` | `detect` | `alert`
- 상태 전환:
  - `setup` → `detect`: ROI 선택 완료
  - `detect` → `alert`: 유해 표현 감지 (향후)
  - `alert` → `detect`: 알림 처리 완료 (향후)
- 모드별 클릭-스루 설정:
  - `setup`: 클릭-스루 비활성화 (ROI 선택 가능)
  - `detect`: 클릭-스루 활성화 (모니터링 중)
  - `alert`: 클릭-스루 활성화 (알림 표시 중)

### T7: IPC 통신
- IPC 채널 정의 및 타입 안전성
- ROI 관련 IPC (선택 시작, 완료, 취소)
- Edit Mode 관련 IPC (종료, 숨김)
- 클릭-스루 설정 IPC (invoke)

### T8: 개발자 도구 통합
- Ctrl+Shift+I, F12로 개발자 도구 토글
- detach 모드로 개발자 도구 열기
- 개발자 도구 열림 시 키보드 포커스 관리
- 콘솔 로그 연결 확인

### T9: 키보드 단축키
- Ctrl+Shift+I, F12: 개발자 도구 토글
- Ctrl+E, Ctrl+Q: Edit Mode 종료 및 오버레이 숨김
- ESC: ROI 선택 취소/리셋

### T10: Preload API
- Context Isolation을 통한 안전한 API 노출
- ROI, Edit Mode, Overlay API
- 타입 정의 및 문서화

## 향후 작업 (Future Tasks)

### T11: OCR 서비스 (예정)
- ROI 영역 이미지 캡처
- OCR 텍스트 추출
- `OCR_START`, `OCR_STOP` IPC 채널 사용

### T12: 유해 표현 감지 (예정)
- OCR 텍스트 분석
- 유해 표현 감지 알고리즘
- 상태를 `detect` → `alert`로 전환

### T13: 마스킹 및 알림 (예정)
- 유해 표현 마스킹
- 비프음 재생
- 볼륨 조절
- `ALERT_FROM_SERVER` IPC 채널 사용

## 핵심 인터페이스 및 타입

### IPC 채널
참조: `electron/ipc/channels.ts`

```typescript
export const IPC_CHANNELS = {
  ROI_SELECTED: 'roi:selected',
  ROI_START_SELECTION: 'roi-start-selection',
  ROI_CANCEL_SELECTION: 'roi-cancel-selection',
  EXIT_EDIT_MODE: 'exit-edit-mode',
  HIDE_OVERLAY: 'hide-overlay',
  EXIT_EDIT_MODE_AND_HIDE: 'exit-edit-mode-and-hide',
  SET_CLICK_THROUGH: 'overlay:setClickThrough',
  OVERLAY_SET_MODE: 'overlay:setMode',
  OVERLAY_STATE_PUSH: 'overlay:state',
  OCR_START: 'ocr:start',
  OCR_STOP: 'ocr:stop',
  ALERT_FROM_SERVER: 'alert:server',
} as const;
```

### 타입 정의
참조: `renderer/src/overlay/roiTypes.ts`

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

### Preload API
참조: `renderer/src/global.d.ts`

```typescript
interface Window {
  api: {
    roi: {
      sendSelected: (rect: ROIRect) => void;
      sendStartSelection: () => void;
      sendCancelSelection: () => void;
    };
    editMode: {
      exit: () => void;
      exitAndHide: () => void;
    };
    overlay: {
      hide: () => void;
      setClickThrough: (enabled: boolean) => Promise<void>;
    };
  };
}
```

## 보안 요구사항

- ✅ Context Isolation: `true`
- ✅ Node Integration: `false`
- ✅ Sandbox: `true`
- ✅ Preload Script를 통한 안전한 API 노출

## 개발 환경

- Node.js
- TypeScript
- Electron 28.0.0
- React 18.2.0
- Vite 5.0.5

## 빌드 및 실행

```bash
# 개발 모드
npm run dev

# 메인 프로세스 빌드
npm run build:main

# 타입 체크
npm run typecheck

# 프로덕션 실행
npm start
```

## 작업 문서

각 작업의 상세 내용은 `tasks/` 폴더의 문서를 참조하세요:
- `tasks/00-overview.md`: 전체 작업 개요
- `tasks/01-electron-setup.md`: 기본 설정
- `tasks/02-system-tray.md`: 시스템 트레이
- ... (기타 작업 문서)

## 업데이트 히스토리

- 2024-01-XX: 초기 명세서 작성

