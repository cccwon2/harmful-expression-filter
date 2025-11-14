# 프로젝트 명세서 (Project Specification)

## 프로젝트 개요

**라이브 플랫폼 유해 표현 필터링, Blur 처리, 비프음, 볼륨 조절** 애플리케이션

전체 화면 투명 오버레이를 사용하여 사용자가 지정한 ROI (Region of Interest) 영역을 모니터링하고, 유해한 표현을 감지하면 Blur 처리, 비프음, 볼륨 조절 등의 조치를 취하는 Electron 애플리케이션입니다. FastAPI 백엔드와 연동하여 텍스트 분석 및 향후 음성 분석 API를 제공합니다.

## 아키텍처 개요

### 프로세스 구조
- **Main Process**: Electron 메인 프로세스 (창 관리, 시스템 트레이, IPC 처리)
- **Renderer Process**: React + TypeScript 렌더러 (오버레이 UI)
- **Preload Script**: Context Isolation을 통한 안전한 API 노출
- **FastAPI Server**: 텍스트 분석 API, 향후 STT/알림 엔드포인트 제공

### 핵심 개념

1. **헤드리스 실행**: 메인 창 없이 시스템 트레이에서만 실행
2. **투명 오버레이**: 전체 화면 투명 창으로 ROI 선택 및 모니터링
3. **Edit Mode**: ROI 선택을 위한 모드 (클릭-스루 비활성화)
4. **상태 머신**: setup → detect → alert 상태 전환
5. **IPC 통신**: 메인-렌더러 간 안전한 통신
6. **서버 연동**: Electron ↔ FastAPI IPC 헬스체크/분석/키워드 조회 (Task 22~23 완료)

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

### T11: 상태 모델 정의 ✅ (기본 구현 완료)
- 상태 타입 정의 (ROI, OverlayMode, OverlayState)
- 상태 머신 훅 구현
- 모드별 효과 적용 함수

### T12: 트레이 메뉴 "영역 지정" → 설정 모드 진입 ✅
- 트레이 메뉴에 "영역 지정" 항목 추가
- 설정 모드 진입 로직 구현 (OVERLAY_SET_MODE, OVERLAY_STATE_PUSH 브로드캐스트 및 클릭-스루 해제)

### T13: 설정 모드 ROI 선택 및 감지 모드 전환 ✅
- 드래그로 ROI 선택
- ROI 저장 (electron-store 스텁)
- 감지 모드 자동 전환 (OVERLAY_SET_MODE, OVERLAY_STATE_PUSH, 클릭-스루 활성화)

### T14: 감지 모드 HUD 표시 ✅
- ROI 영역에 빨간색 테두리 및 "감시 중" 라벨 표시
- 감지 모드에서 클릭-스루 유지

### T15: OCR/STT 파이프라인 스텁 ✅
- Tesseract.js 기반 OCR 워커 초기화
- ROI 캡처 및 OCR 결과 로그 출력
- 감지 모드 전환 시 자동 처리 루프 시작

### T16: 서버 알림 수신 및 블라인드 표시 ⏳
- 서버 연결 스텁 (테스트용 토글)
- 블라인드 표시 (`rgba(0,0,0,0.4)`)
- 블라인드 해제 및 페이드 애니메이션
- 감시 루프에서 추출한 텍스트/이미지 전송 (axios + multipart)

### T17: ESC/트레이로 설정 모드 재진입 ✅
- ESC 키로 설정 모드 재진입 (클릭-스루/유해 상태 리셋)
- 트레이 메뉴로 설정 모드 재진입
- 모니터링(OCR) 중지 처리

### T18: ROI/모드 영속화 및 부팅 시 복원 ⚠️ 부분 완료
- 부팅 시 마지막 ROI/모드를 자동 복원 (감지 모드 & 모니터링 자동 시작)
- electron-store 마이그레이션 및 alert 상태 복원은 추후 진행

### T19: 네이티브 Tesseract 통합 ⏳
- WASM 대신 네이티브 실행 파일 호출로 OCR 성능 개선

### T20: FastAPI 기본 구조 ✅
- FastAPI 앱/엔드포인트(`/health`, `/keywords`, `/`) 구축
- CORS 설정 및 키워드 로딩 처리

### T21: 텍스트 분석 API ✅
- `/analyze`, `/test` 엔드포인트 구현
- 키워드 기반 필터링 및 수동 검증 스크립트 제공

### T22: IPC 서버 핸들러 ✅
- Electron 메인에서 FastAPI 호출을 위한 IPC 핸들러 구현
- `SERVER_CHANNELS` 정의 및 오류 처리 응답 표준화

### T23: Electron 통합 ✅
- Preload에서 서버 API를 노출하고 타입 정의 업데이트
- Renderer 개발용 `ServerTest` 컴포넌트로 헬스/분석/키워드 조회 테스트 가능

### T24: 음성 STT API ✅
- FastAPI 서버에 WebSocket 기반 음성 스트리밍 엔드포인트 구현
- Whisper 모델을 사용한 실시간 음성 인식
- 유해성 판별 통합

### T25: 음성 Electron 연동 ✅
- Windows 오디오 캡처 (WASAPI Loopback)
- WebSocket을 통한 실시간 오디오 스트리밍
- 서버 응답 기반 유해성 감지
- 앱별 볼륨 조절 (T26으로 마이그레이션됨)

### T26: 앱별 볼륨 조절 마이그레이션 ✅
- `loudness` 패키지 제거 및 `native-sound-mixer`로 마이그레이션
- 앱별 독립 볼륨 조절 기능
- 기획서 요구사항 충족: "음성이 발생한 프로그램 오디오 크기 조절"

## 향후 작업 (Future Tasks)

- T16: 서버 알림 수신 및 블라인드 표시 (진행 중)
- T18: 저장소 마이그레이션 및 상태 복원 마무리
- T19: 네이티브 Tesseract 통합 (성능 향상)
- T25 Phase 6: 통합 테스트 및 성능 최적화

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
  AUDIO_STATUS: 'audio:status',
  AUDIO_HARMFUL_DETECTED: 'audio:harmful-detected',
} as const;

export const SERVER_CHANNELS = {
  HEALTH_CHECK: 'server:health-check',
  ANALYZE_TEXT: 'server:analyze-text',
  GET_KEYWORDS: 'server:get-keywords',
} as const;

export const AUDIO_CHANNELS = {
  START_MONITORING: 'audio:start-monitoring',
  STOP_MONITORING: 'audio:stop-monitoring',
  GET_STATUS: 'audio:get-status',
  SET_VOLUME_LEVEL: 'audio:set-volume-level',
  SET_BEEP_ENABLED: 'audio:set-beep-enabled',
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
    server: ServerAPI;
    audio: {
      startMonitoring: () => Promise<{ success: boolean; error?: string }>;
      stopMonitoring: () => Promise<{ success: boolean }>;
      getStatus: () => Promise<{
        isMonitoring: boolean;
        volumeLevel: number;
        beepEnabled: boolean;
      }>;
      setVolumeLevel: (level: number) => Promise<{ success: boolean }>;
      setBeepEnabled: (enabled: boolean) => Promise<{ success: boolean }>;
      onStatusChange: (callback: (status: any) => void) => void;
      onHarmfulDetected: (callback: (data: any) => void) => void;
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
- Python 3.11+
- FastAPI
- Whisper (음성 인식)

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

각 작업의 상세 내용은 `docs/` 폴더의 문서를 참조하세요:
- `docs/00-overview.md`: 전체 작업 개요
- `docs/01-electron-setup.md`: 기본 설정
- `docs/02-system-tray.md`: 시스템 트레이
- ... (기타 작업 문서)

## 업데이트 히스토리

- 2025-01-XX: 초기 명세서 작성
- 2025-XX-XX: T24-T26 완료 반영


