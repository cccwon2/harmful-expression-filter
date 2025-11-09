# 작업 14: 감시 모드 HUD & 모니터링 루프

## 상태
✅ 완료

## 개요
감지 모드 진입 시 ROI 영역을 시각적으로 고정 표시하고, 해당 영역을 주기적으로 캡처하여 OCR/서버 전송까지 수행하는 모니터링 파이프라인을 구축한다.

> **참고**  
> 기존 문서 `14-detect-mode-hud.md`의 HUD 요구사항(테두리 표시, 클릭-스루 유지 등)을 모두 흡수한 통합 문서입니다.

## 요구사항

- [x] 감지 모드에서 ROI 사각형을 빨간색 테두리로 표시하고, “🔴 감시 중” 라벨을 HUD로 노출
- [x] 감지 모드 동안 클릭-스루 유지 (뒤 앱과 상호작용 가능)
- [x] 1초 간격으로 ROI를 캡처하거나 즉시 재호출 시 중복 방지 로직 적용
- [x] `desktopCapturer`로 전체 화면 캡처 후 ROI 영역만 크롭하여 PNG로 저장
- [x] `tesseract.js` 워커로 OCR을 수행하고 결과 텍스트 로그 출력
- [x] OCR 결과와 이미지를 multipart/form-data로 서버에 전송 (`axios` + `form-data`)
- [x] 감시 중단 시 HUD와 ROI 상태 초기화, 렌더러에 `STOP_MONITORING` 브로드캐스트

## 핵심 구현 정리

1. **Preload & 타입 정의**
   - `overlay.startMonitoring`, `overlay.onStopMonitoring`, `overlay.removeAllListeners` 추가.
   - `renderer/src/global.d.ts`, `INTERFACES.md`에 API 반영.

2. **렌더러 (`OverlayApp.tsx`)**
   - `isMonitoring` 상태 도입, ROI 선택 시 `startMonitoring()` IPC 호출.
   - 감시 중 빨간색 테두리와 배지를 렌더링. 클릭은 `pointerEvents: 'none'` 처리.
   - `onStopMonitoring` 수신 시 ROI/상태 초기화.

3. **메인 프로세스 (`electron/main.ts`)**
   - `START_MONITORING`/`STOP_MONITORING` IPC 핸들러 구현.
   - `captureAndProcessROI()`에서 `desktopCapturer`로 스크린샷 → ROI 크롭 → PNG 저장.
   - `tesseract.js` 워커(`initOCR`, `performOCR`)로 OCR 수행.
   - `axios + form-data`로 서버 전송 (`MONITORING_ENDPOINT` 환경변수 사용 권장).
   - `STOP_MONITORING` 브로드캐스트 및 상태 리셋.

4. **패키지 의존성**
   - `npm install tesseract.js axios form-data`

## 테스트 시나리오

1. 트레이 메뉴에서 영역 지정 → ROI 선택.
2. 오버레이에 빨간 테두리와 "🔴 감시 중" 라벨이 표시되는지 확인.
3. ROI 내부/외부 클릭 시 뒤 앱이 정상적으로 입력을 받는지 확인.
4. `AppData/Roaming/<AppName>/captured.png` 파일이 1초 간격으로 갱신되는지 확인.
5. 메인 프로세스 로그에서 OCR 결과 텍스트, 서버 전송 로그 확인.
6. `STOP_MONITORING` (IPC 또는 수동 호출) 시 HUD가 사라지고 모드가 `setup`으로 복귀하는지 확인.

## 열린 과제

- 서버 엔드포인트를 운영값으로 교체하고, 전송 실패 시 재시도/백오프 로직 추가.
- 감시 중단/재시작을 위한 전용 UI 및 단축키.
- OCR 언어/간격/정확도 튜닝 및 GPU 사용 검토.

