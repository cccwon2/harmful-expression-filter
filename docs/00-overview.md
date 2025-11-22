# 작업 개요 (Tasks Overview)

이 문서는 프로젝트의 모든 작업 목록과 상태를 제공합니다.

## 📚 필수 참조 문서

작업을 시작하기 전에 다음 문서를 반드시 확인하세요:

- **[PROJECT_SPEC.md](./PROJECT_SPEC.md)**: 전체 프로젝트 명세서 및 요구사항
- **[INTERFACES.md](./INTERFACES.md)**: 핵심 인터페이스 및 연결부 코드 (⚠️ 매우 중요)

## 작업 목록

1. **[기본 Electron 앱 설정](./01-electron-setup.md)** ✅ 완료
2. **[시스템 트레이](./02-system-tray.md)** ✅ 완료
3. **[투명 오버레이 창](./03-overlay-window.md)** ✅ 완료
4. **[ROI 선택 기능](./04-roi-selection.md)** ✅ 완료
5. **[Edit Mode 관리](./05-edit-mode.md)** ✅ 완료
6. **[상태 관리 (State Machine)](./06-state-management.md)** ✅ 완료
7. **[IPC 통신](./07-ipc-communication.md)** ✅ 완료
8. **[개발자 도구 통합](./08-devtools-integration.md)** ✅ 완료
9. **[키보드 단축키](./09-keyboard-shortcuts.md)** ✅ 완료
10. **[Preload API](./10-preload-api.md)** ✅ 완료
11. **[상태 모델 정의](./11-state-model-definition.md)** ✅ 완료 (기본 구현, 개선 필요)
12. **[트레이 메뉴 "영역 지정" → 설정 모드 진입](./12-tray-setup-mode-entry.md)** ✅ 완료
13. **[설정 모드 ROI 선택 및 감지 모드 전환](./13-setup-mode-roi-selection.md)** ✅ 완료
14. **[감시 모니터링 & HUD/OCR](./14-monitoring-ocr.md)** ✅ 완료
15. **[OCR/STT 파이프라인 스텁](./15-ocr-stt-stub.md)** ✅ 완료 (Task 28에서 PaddleOCR로 대체됨)
16. **[서버 알림 수신 및 블라인드 표시](./16-server-alert-blind.md)** ✅ 완료
17. **[ESC/트레이로 설정 모드 재진입](./17-escape-tray-resetup.md)** ✅ 완료
18. **[ROI/모드 영속화 및 부팅 시 복원](./18-persistence-boot-restore.md)** ⚠️ 부분 완료
19. **[네이티브 Tesseract 통합](./19-native-tesseract-integration.md)** 🔄 Task 28로 대체됨
20. **[FastAPI 기본 구조](./20-fastapi-setup.md)** ✅ 완료
21. **[텍스트 분석 API](./21-text-analysis-api.md)** ✅ 완료
22. **[IPC 서버 핸들러](./22-ipc-server-handlers.md)** ✅ 완료
23. **[Electron 통합](./23-electron-integration.md)** ✅ 완료
24. **[음성 STT API](./24-audio-stt-api.md)** ✅ 완료
25. **[음성 Electron 연동](./25-audio-electron-integration.md)** ✅ 완료
26. **[앱별 볼륨 조절 마이그레이션](./26-app-volume-migration.md)** ✅ 완료
27. **[Deepgram STT 통합](./27-deepgram-stt-integration.md)** ✅ 완료
28. **[PaddleOCR 서버 연동 및 Tesseract.js 대체](./28-paddle-ocr-integration.md)** ✅ 완료
29. **[OnVoice COM Bridge 통합](./29-onvoice-com-bridge-integration.md)** ✅ 완료
33. **[AudioManager 트레이 통합](./33-audiomanager-tray-integration.md)** ✅ 완료

## 작업 의존성 그래프

```
01-electron-setup
    ├─ 02-system-tray
    ├─ 03-overlay-window
    │   ├─ 04-roi-selection
    │   ├─ 05-edit-mode
    │   └─ 06-state-management
    ├─ 07-ipc-communication
    │   ├─ 04-roi-selection
    │   └─ 05-edit-mode
    ├─ 08-devtools-integration
    │   └─ 03-overlay-window
    ├─ 09-keyboard-shortcuts
    │   ├─ 03-overlay-window
    │   └─ 05-edit-mode
    ├─ 10-preload-api
    │   └─ 07-ipc-communication
    └─ 11-state-model-definition
        ├─ 12-tray-setup-mode-entry
        ├─ 13-setup-mode-roi-selection
        │   ├─ 14-monitoring-ocr
        │   └─ 15-ocr-stt-stub
        ├─ 16-server-alert-blind
        ├─ 17-escape-tray-resetup
        └─ 18-persistence-boot-restore
20-fastapi-setup
    ├─ 21-text-analysis-api
    ├─ 22-ipc-server-handlers
    │   └─ 23-electron-integration
    ├─ 24-audio-stt-api
    │   ├─ 25-audio-electron-integration
    │   │   └─ 26-app-volume-migration
    │   └─ 27-deepgram-stt-integration
    ├─ 28-paddle-ocr-integration
    │   ├─ 15-ocr-stt-stub (대체)
    │   └─ 19-native-tesseract-integration (대체)
    └─ 29-onvoice-com-bridge-integration
        ├─ 24-audio-stt-api
        └─ 27-deepgram-stt-integration
33-audiomanager-tray-integration
    ├─ 29-onvoice-com-bridge-integration
    └─ 02-system-tray
```

## 작업 상태

| 작업                    | 상태         | 진행률 | 우선순위 |
| ----------------------- | ------------ | ------ | -------- |
| 기본 Electron 앱 설정   | ✅ 완료      | 100%   | High     |
| 시스템 트레이           | ✅ 완료      | 100%   | High     |
| 투명 오버레이 창        | ✅ 완료      | 100%   | High     |
| ROI 선택 기능           | ✅ 완료      | 100%   | High     |
| Edit Mode 관리          | ✅ 완료      | 100%   | High     |
| 상태 관리               | ✅ 완료      | 100%   | High     |
| IPC 통신                | ✅ 완료      | 100%   | High     |
| 개발자 도구 통합        | ✅ 완료      | 100%   | Medium   |
| 키보드 단축키           | ✅ 완료      | 100%   | Medium   |
| Preload API             | ✅ 완료      | 100%   | High     |
| 상태 모델 정의          | ✅ 완료      | 80%    | High     |
| 트레이 메뉴 "영역 지정" | ✅ 완료      | 100%   | High     |
| 설정 모드 ROI 선택      | ✅ 완료      | 100%   | High     |
| 감시 모니터링 & HUD/OCR | ✅ 완료      | 100%   | High     |
| OCR/STT 파이프라인 스텁 | ✅ 완료      | 100%   | Medium   | (Task 28에서 PaddleOCR로 대체됨)
| 서버 알림 및 블라인드   | ✅ 완료      | 100%   | High     |
| ESC/트레이 재진입       | ✅ 완료      | 100%   | Medium   |
| ROI/모드 영속화         | ⚠️ 부분 완료 | 80%    | Medium   |
| 네이티브 Tesseract 통합 | 🔄 대체됨    | -      | -        | (Task 28로 대체됨)
| FastAPI 기본 구조       | ✅ 완료      | 100%   | Medium   |
| 텍스트 분석 API         | ✅ 완료      | 100%   | High     |
| IPC 서버 핸들러         | ✅ 완료      | 100%   | High     |
| Electron 통합          | ✅ 완료      | 100%   | High     |
| 음성 STT API           | ✅ 완료      | 100%   | Medium   |
| 음성 Electron 연동     | ✅ 완료      | 100%   | High     |
| 앱별 볼륨 조절 마이그레이션 | ✅ 완료 | 100%   | High     |
| Deepgram STT 통합     | ✅ 완료      | 100%   | High     |
| PaddleOCR 서버 연동    | ✅ 완료      | 100%   | High     |
| OnVoice COM Bridge 통합 | ✅ 완료      | 100%   | High     |
| AudioManager 트레이 통합 | ✅ 완료      | 100%   | High     |

## 다음 단계

프로젝트의 다음 개발 단계를 확인하려면 각 작업 문서를 참조하세요.

## 업데이트 히스토리

- 2025-01-XX: AudioManager 추가 - 트레이 메뉴 기반 오디오 스트리밍, 보안 강화 (Deepgram API 키를 서버에서만 관리)
- 2025-01-XX: 파일명 네이밍 규칙 통일 - `onvoice*` → `onVoice*` (onVoiceBridge, onVoiceService, onVoiceBridgeAdapter, onVoiceHandlers)
- 2025-01-XX: Task 29 완료 - OnVoice COM Bridge 통합, 프로세스별 오디오 캡처 및 Deepgram/서버 STT 연동
- 2025-01-XX: Task 28 완료 - PaddleOCR 서버 연동 및 Tesseract.js 대체, venv311 가상환경 사용 명시
- 2025-11-13: 오디오 모니터링과 ROI 독립성 구현, 시스템 트레이 오디오 모니터링 상태 표시 추가, 오버레이 UI 개선
- 2025-01-XX: 초기 작업 문서 생성
