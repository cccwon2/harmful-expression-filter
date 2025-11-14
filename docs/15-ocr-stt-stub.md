# 작업 15: OCR/STT 파이프라인 스텁 및 ROI 캡처 시작/중지

## 상태
✅ 완료 (Task 28에서 PaddleOCR 서버 기반 OCR로 대체됨)

## ⚠️ 중요 참고사항
이 작업은 초기 스텁 구현이었으며, **Task 28: PaddleOCR 서버 연동**에서 실제 구현으로 대체되었습니다.
- 기존 Tesseract.js (WASM) → PaddleOCR 서버 기반 OCR로 전환
- 클라이언트 측 OCR → 서버 측 OCR로 아키텍처 변경
- 자세한 내용은 [Task 28 문서](./28-paddle-ocr-integration.md) 참조

## 개요
OCR/STT 파이프라인의 스텁을 구현하여 감지 모드에서 ROI 영역 캡처를 시작/중지합니다. 실제 OCR/STT 구현은 후속 작업에서 진행합니다.

## 요구사항

### OCR 스텁 구현
- [ ] `OCR_START` IPC 채널 핸들러 구현
- [ ] `OCR_STOP` IPC 채널 핸들러 구현
- [ ] 주기적 타이머로 스텁 로그 출력 (1-2초 주기)

### ROI 캡처 준비
- [ ] ROI 좌표 기반 캡처 영역 설정
- [ ] 실제 구현 시 `desktopCapturer` 사용 예정 (스텁에서는 로그만)
- [ ] 크롭/OS 캡처 라이브러리 통합 준비

### 모드 전환 연동
- [ ] 감지 모드 전환 시 `OCR_START(roi)` 발생
- [ ] 설정 모드 복귀/앱 종료 시 `OCR_STOP` 발생
- [ ] 타이머 누적 없이 정확한 시작/정지

## 의존성
- [작업 13: 설정 모드 ROI 선택 및 감지 모드 전환](./13-setup-mode-roi-selection.md)
- [작업 7: IPC 통신](./07-ipc-communication.md)
- [작업 11: 상태 모델 정의](./11-state-model-definition.md)

## 관련 파일
- `electron/main.ts` 또는 `electron/ocrWorker.ts` (새로 생성) - OCR 스텁 구현
- `electron/ipc/channels.ts` - `OCR_START`, `OCR_STOP` 채널 확인

## 참조해야 할 핵심 파일
- `@electron/ipc/channels.ts` - `OCR_START`, `OCR_STOP` 채널 확인
- `@renderer/src/overlay/roiTypes.ts` - `ROI` 타입 확인
- `@electron/ipc/roi.ts` - ROI 핸들러 구조 확인

## 구현 계획

### 1. OCR Worker 생성 (선택 사항)
```typescript
// electron/ocrWorker.ts (새로 생성)
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from './ipc/channels';
import type { ROIRect } from './ipc/roi';

let captureInterval: NodeJS.Timeout | null = null;

export function setupOCRHandlers() {
  ipcMain.on(IPC_CHANNELS.OCR_START, (_event, roi: ROIRect) => {
    console.log('[OCR] Starting capture for ROI:', roi);
    
    // 기존 타이머 정리
    if (captureInterval) {
      clearInterval(captureInterval);
    }
    
    // 스텁: 주기적 로그 출력
    captureInterval = setInterval(() => {
      console.log('[OCR] tick - ROI:', roi);
      // TODO: 실제 OCR/STT 구현
      // - desktopCapturer로 ROI 영역 캡처
      // - OCR 텍스트 추출
      // - 서버로 전송
    }, 2000); // 2초 주기
  });
  
  ipcMain.on(IPC_CHANNELS.OCR_STOP, () => {
    console.log('[OCR] Stopping capture');
    if (captureInterval) {
      clearInterval(captureInterval);
      captureInterval = null;
    }
  });
}
```

### 2. 메인 프로세스에서 OCR 핸들러 등록
```typescript
// electron/main.ts
import { setupOCRHandlers } from './ocrWorker';

app.whenReady().then(() => {
  // ...
  setupOCRHandlers();
});
```

### 3. 감지 모드 전환 시 OCR 시작
```typescript
// electron/ipc/roi.ts
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from './channels';

ipcMain.on(IPC_CHANNELS.ROI_SELECTED, (_event, roi: ROIRect) => {
  // ROI 저장
  store.set('roi', roi);
  
  // OCR 시작
  ipcMain.emit(IPC_CHANNELS.OCR_START, roi);
  
  // 감지 모드 전환
  overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_SET_MODE, 'detect');
});
```

### 4. 설정 모드 복귀 시 OCR 중지
```typescript
// electron/tray.ts 또는 electron/ipc/roi.ts
// 설정 모드로 전환 시
ipcMain.emit(IPC_CHANNELS.OCR_STOP);
```

## 산출물/수락 기준
- ✅ 감지 모드로 바뀌면 OCR 스텁 로그가 1-2초 주기로 출력됨
- ✅ 설정 모드 복귀/앱 종료 시 OCR 스텁이 정지됨
- ✅ 모드 토글 여러 차례 해도 타이머 누적 없이 정확히 시작/정지
- ✅ ROI 좌표가 OCR 스텁에 정확히 전달됨

## 테스트 방법
1. ROI 선택 후 감지 모드 전환
2. 콘솔에서 OCR 스텁 로그가 주기적으로 출력되는지 확인
3. 설정 모드로 복귀
4. OCR 스텁 로그가 중지되는지 확인
5. 여러 번 모드 토글하여 타이머 누적 없이 동작하는지 확인

## 향후 작업
- 실제 OCR 구현: `desktopCapturer` 사용
- 실제 STT 구현: 오디오 캡처 및 텍스트 변환
- 서버 전송: OCR/STT 결과를 서버로 전송

## 다음 작업
- [작업 16: 서버 알림 수신 및 블라인드 표시](./16-server-alert-blind.md)

## 참조
- [INTERFACES.md](./INTERFACES.md): 핵심 인터페이스 문서
- [PROJECT_SPEC.md](./PROJECT_SPEC.md): 프로젝트 명세서

