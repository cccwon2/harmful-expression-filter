# 작업 13: 설정 모드 ROI 선택 및 감지 모드 전환

## 상태
✅ 완료

## 개요
설정 모드에서 드래그로 ROI 영역을 선택하고, 선택 완료 시 자동으로 감지 모드로 전환합니다.

## 요구사항

### ROI 선택 기능
- [x] 마우스 다운으로 선택 시작 좌표 기억 (이미 구현됨)
- [x] 마우스 이동으로 실시간 박스 렌더링 (이미 구현됨)
- [x] 마우스 업으로 ROI 계산 및 검증 (이미 구현됨)
- [x] 최소 크기 체크 (4px 미만 무시) (이미 구현됨)

### ROI 저장
- [x] `window.api.overlay.sendROI(roi)` API 추가
- [x] 메인 프로세스에서 ROI 저장 (electron-store 사용)
- [x] 저장 완료 로그 출력

### 감지 모드 자동 전환
- [x] ROI 저장 후 메인 프로세스에서 감지 모드 전환 IPC 전송
- [x] 렌더러에서 모드 변경 수신 및 클릭-스루 활성화
- [x] 상태 브로드캐스트 및 스타일 업데이트

## 의존성
- [작업 4: ROI 선택 기능](./04-roi-selection.md)
- [작업 11: 상태 모델 정의](./11-state-model-definition.md)
- [작업 12: 트레이 메뉴 "영역 지정" → 설정 모드 진입](./12-tray-setup-mode-entry.md)
- [작업 7: IPC 통신](./07-ipc-communication.md)

## 관련 파일
- `renderer/src/overlay/OverlayApp.tsx` - ROI 선택 로직
- `electron/ipc/roi.ts` - ROI 저장 핸들러
- `electron/preload.ts` - `sendROI` API 추가
- `electron/store.ts` (새로 생성) - electron-store 설정

## 참조해야 할 핵심 파일
- `@electron/ipc/channels.ts` - `ROI_SELECTED` 채널 확인
- `@renderer/src/overlay/roiTypes.ts` - `ROI` 타입 확인
- `@electron/ipc/roi.ts` - ROI 핸들러 구조 확인
- `@renderer/src/overlay/OverlayApp.tsx` - 기존 ROI 선택 로직 확인

## 구현 메모

1. **ROI 선택 완료 → IPC 전송**
   - `renderer/src/overlay/OverlayApp.tsx`에서 드래그가 최소 4px 이상이면 `window.api.roi.sendSelected(roi)` 호출.
   - 선택 완료 후 로컬 상태는 `isSelectionComplete=true`로 유지하여 클릭-스루 효과를 UI에서도 반영.

2. **ROI 저장 및 감지 모드 전환**
   - `electron/ipc/roi.ts`에서 `ROI_SELECTED` 수신 시 `setROI(roi)` / `setMode('detect')`로 JSON 스토어에 영구 저장.
   - 저장 직후 `OVERLAY_SET_MODE('detect')`와 `OVERLAY_STATE_PUSH({ mode: 'detect', roi })`를 브로드캐스트.
   - 동일 위치에서 `overlayWindow.setIgnoreMouseEvents(true, { forward: true })`를 호출해 클릭-스루를 즉시 재활성화.

3. **스토어 래퍼**
   - `electron/store.ts`는 `getROI`, `setROI`, `getMode`, `setMode`, `getStoreSnapshot` API로 정리.
   - 현재는 파일 기반(JSON) 구현이며, T18에서 electron-store 모듈로 교체 예정.

4. **Preload / 타입 정의**
   - `electron/preload.ts`와 `renderer/src/global.d.ts`는 `ROI` 타입 기준으로 `roi.sendSelected`와 `overlay.sendROI`를 노출.
   - `INTERFACES.md`에 동일한 시그니처를 문서화하여 명칭을 `ROI`로 일원화.

5. **모니터링 루프 & HUD**
   - ROI 선택 직후 `overlay.startMonitoring()` IPC를 통해 메인 프로세스가 주기적으로 스크린샷을 캡처.
   - 렌더러는 `isMonitoring` 상태로 빨간색 테두리와 “🔴 감시 중” 배지를 표시하며 클릭은 투과된다.
   - 메인 프로세스는 `captureAndProcessROI()`에서 캡처 → OCR → 서버 전송을 담당하며, 중단 시 `STOP_MONITORING`으로 동기화.

## 산출물/수락 기준
- ✅ 드래그-드롭 후 메인 프로세스 로그에 ROI 좌표 출력
- ✅ ROI 저장 완료 (`electron/store.ts` 스냅샷 반영)
- ✅ 즉시 감지 모드로 전환 (`mode='detect'`)
- ✅ 클릭-스루 활성화 (마우스 입력이 뒤 앱으로 전달)

## 테스트 방법
1. 설정 모드에서 여러 위치/크기로 드래그
2. ROI 좌표가 콘솔에 출력되는지 확인
3. 감지 모드로 자동 전환되는지 확인
4. 화면 클릭이 뒤 앱으로 전달되는지 확인

## 다음 작업
- [작업 14: 감지 모드 HUD 표시](./14-detect-mode-hud.md)
- [작업 15: OCR/STT 파이프라인 스텁](./15-ocr-stt-stub.md)

## 참조
- [INTERFACES.md](../INTERFACES.md): 핵심 인터페이스 문서
- [PROJECT_SPEC.md](../PROJECT_SPEC.md): 프로젝트 명세서

