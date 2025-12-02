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
27. **[Deepgram STT 통합](./27-deepgram-stt-integration.md)** ✅ 완료 (Task 35로 실시간 스트리밍 방식으로 업데이트됨)
28. **[PaddleOCR 서버 연동 및 Tesseract.js 대체](./28-paddle-ocr-integration.md)** ✅ 완료 (현재는 Windows SDK OCR로 대체됨)
29. **[OnVoice COM Bridge 통합](./29-onvoice-com-bridge-integration.md)** ✅ 완료
30. **[AudioManager 트레이 통합](./33-audiomanager-tray-integration.md)** ✅ 완료
31. **[Windows OCR 성능 최적화](./34-windows-ocr-optimization.md)** ✅ 완료
32. **[Deepgram 실시간 스트리밍 방식](./35-deepgram-realtime-streaming.md)** ✅ 완료
33. **[로컬 Whisper 폴백 시스템](./36-local-whisper-fallback.md)** ✅ 완료
34. **[Ubuntu 서버 FastAPI 배포](./37-ubuntu-fastapi-deployment.md)** ✅ 문서화 완료
35. **[코드 리팩토링 및 정리](./38-code-refactoring-cleanup.md)** ✅ 완료
36. **[C# 기반 PID 볼륨 제어 통합](./39-csharp-volume-control.md)** ✅ 완료
37. **[C++ Core Audio 구현 상세](./40-cpp-core-audio-implementation.md)** ✅ 완료
38. **[파인튜닝된 KoElectra 분류기 연동](./41-koelectra-classifier-integration.md)** ✅ 완료
39. **[Electron 앱 배포](./42-electron-app-deployment.md)** ✅ 완료
40. **[Threshold(임계값) 설정 및 최적화](./43-threshold-configuration.md)** ✅ 완료
41. **[Vercel 관리자 대시보드 구축 가이드](./44-vercel-admin-dashboard.md)** 📝 계획 단계
42. **[Spawn 방식 Bridge 마이그레이션](./45-spawn-bridge-migration.md)** ✅ 완료
43. **[Supabase 기반 관리자 DB 및 로깅 시스템 구축](./46-supabase-admin-db.md)** 📝 계획 단계
44. **[메인 대시보드 구축 및 멀티 윈도우 관리](./47-main-dashboard-multi-window.md)** ✅ 완료
45. **[애플리케이션 성능 최적화](./48-performance-optimization.md)** ✅ 완료
46. **[유해 표현 블라인드 처리 및 OCR 연속 감지](./49-harmful-content-blind-ocr-continuous.md)** ✅ 완료
47. **[테스트 자동화 구현](./50-test-automation.md)** ✅ 완료

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
34-windows-ocr-optimization
    └─ 29-onvoice-com-bridge-integration
35-deepgram-realtime-streaming
    └─ 27-deepgram-stt-integration
36-local-whisper-fallback
    ├─ 35-deepgram-realtime-streaming
    └─ 34-windows-ocr-optimization (로컬 분석 로직 참고)
37-ubuntu-fastapi-deployment
    ├─ 20-fastapi-setup
    ├─ 24-audio-stt-api
    └─ 35-deepgram-realtime-streaming
38-code-refactoring-cleanup
    ├─ 34-windows-ocr-optimization
    └─ 26-app-volume-migration
39-csharp-volume-control
    ├─ 26-app-volume-migration
    ├─ 29-onvoice-com-bridge-integration
    └─ 38-code-refactoring-cleanup
40-cpp-core-audio-implementation
    └─ 29-onvoice-com-bridge-integration
41-koelectra-classifier-integration
    ├─ 21-text-analysis-api
    └─ 35-deepgram-realtime-streaming
42-electron-app-deployment
    ├─ 01-electron-setup
    ├─ 30-electron-edge-js-migration (Deprecated)
    ├─ 39-csharp-volume-control
    └─ 45-spawn-bridge-migration
43-threshold-configuration
    ├─ 21-text-analysis-api
    └─ 41-koelectra-classifier-integration
44-vercel-admin-dashboard
    ├─ 20-fastapi-setup
    ├─ 21-text-analysis-api
    └─ 43-threshold-configuration
45-spawn-bridge-migration
    ├─ 29-onvoice-com-bridge-integration
    ├─ 39-csharp-volume-control
    └─ 42-electron-app-deployment
46-supabase-admin-db
    └─ 20-fastapi-setup
47-main-dashboard-multi-window
    ├─ 01-electron-setup
    ├─ 02-system-tray
    └─ 03-overlay-window
48-performance-optimization
    ├─ 47-main-dashboard-multi-window
    └─ 34-windows-ocr-optimization
49-harmful-content-blind-ocr-continuous
    ├─ 47-main-dashboard-multi-window
    ├─ 48-performance-optimization
    └─ 16-server-alert-blind
50-test-automation
    ├─ 49-harmful-content-blind-ocr-continuous
    ├─ 48-performance-optimization
    └─ 47-main-dashboard-multi-window
46-supabase-admin-db
    ├─ 20-fastapi-setup
    ├─ 21-text-analysis-api
    ├─ 43-threshold-configuration
    └─ 44-vercel-admin-dashboard
47-main-dashboard-multi-window
    ├─ 42-electron-app-deployment
    └─ 45-spawn-bridge-migration
48-performance-optimization
    ├─ 34-windows-ocr-optimization
    └─ 47-main-dashboard-multi-window
```

## 작업 상태

| 작업                                   | 상태           | 진행률 | 우선순위 |
| -------------------------------------- | -------------- | ------ | -------- | --------------------------------- |
| 기본 Electron 앱 설정                  | ✅ 완료        | 100%   | High     |
| 시스템 트레이                          | ✅ 완료        | 100%   | High     |
| 투명 오버레이 창                       | ✅ 완료        | 100%   | High     |
| ROI 선택 기능                          | ✅ 완료        | 100%   | High     |
| Edit Mode 관리                         | ✅ 완료        | 100%   | High     |
| 상태 관리                              | ✅ 완료        | 100%   | High     |
| IPC 통신                               | ✅ 완료        | 100%   | High     |
| 개발자 도구 통합                       | ✅ 완료        | 100%   | Medium   |
| 키보드 단축키                          | ✅ 완료        | 100%   | Medium   |
| Preload API                            | ✅ 완료        | 100%   | High     |
| 상태 모델 정의                         | ✅ 완료        | 80%    | High     |
| 트레이 메뉴 "영역 지정"                | ✅ 완료        | 100%   | High     |
| 설정 모드 ROI 선택                     | ✅ 완료        | 100%   | High     |
| 감시 모니터링 & HUD/OCR                | ✅ 완료        | 100%   | High     |
| OCR/STT 파이프라인 스텁                | ✅ 완료        | 100%   | Medium   | (Task 28에서 PaddleOCR로 대체됨)  |
| 서버 알림 및 블라인드                  | ✅ 완료        | 100%   | High     |
| ESC/트레이 재진입                      | ✅ 완료        | 100%   | Medium   |
| ROI/모드 영속화                        | ⚠️ 부분 완료   | 80%    | Medium   |
| 네이티브 Tesseract 통합                | 🔄 대체됨      | -      | -        | (Task 28로 대체됨)                |
| FastAPI 기본 구조                      | ✅ 완료        | 100%   | Medium   |
| 텍스트 분석 API                        | ✅ 완료        | 100%   | High     |
| IPC 서버 핸들러                        | ✅ 완료        | 100%   | High     |
| Electron 통합                          | ✅ 완료        | 100%   | High     |
| 음성 STT API                           | ✅ 완료        | 100%   | Medium   |
| 음성 Electron 연동                     | ✅ 완료        | 100%   | High     |
| 앱별 볼륨 조절 마이그레이션            | ✅ 완료        | 100%   | High     |
| Deepgram STT 통합                      | ✅ 완료        | 100%   | High     |
| PaddleOCR 서버 연동                    | ✅ 완료        | 100%   | High     | (현재는 Windows SDK OCR로 대체됨) |
| OnVoice COM Bridge 통합                | ✅ 완료        | 100%   | High     |
| AudioManager 트레이 통합               | ✅ 완료        | 100%   | High     |
| Windows OCR 성능 최적화                | ✅ 완료        | 100%   | High     |
| Deepgram 실시간 스트리밍               | ✅ 완료        | 100%   | High     |
| 로컬 Whisper 폴백 시스템               | ✅ 완료        | 100%   | High     |
| Ubuntu 서버 FastAPI 배포               | ✅ 문서화 완료 | 100%   | Medium   |
| 코드 리팩토링 및 정리                  | ✅ 완료        | 100%   | Medium   |
| C# 기반 PID 볼륨 제어 통합             | ✅ 완료        | 100%   | High     |
| C++ Core Audio 구현 상세               | ✅ 완료        | 100%   | Low      |
| 파인튜닝된 KoElectra 분류기 연동       | ✅ 완료        | 100%   | High     |
| Electron 앱 배포                       | ✅ 완료        | 100%   | Medium   |
| Threshold 설정 및 최적화               | ✅ 완료        | 100%   | Medium   |
| Vercel 관리자 대시보드                 | 📝 계획 단계   | 0%     | Low      |
| Spawn 방식 Bridge 마이그레이션         | ✅ 완료        | 100%   | High     |
| Supabase 기반 관리자 DB 및 로깅 시스템 | 📝 계획 단계   | 0%     | Medium   |
| 메인 대시보드 구축 및 멀티 윈도우 관리 | ✅ 완료        | 100%   | High     |
| 애플리케이션 성능 최적화                | 🔄 진행 중     | 10%    | High     |

## 최근 변경 사항 (2025-11-26)

- **Windows SDK OCR 적용**: PaddleOCR 제거, Windows.Media.Ocr API 사용
  - Electron에서 C# COM Bridge를 통해 직접 처리
  - 서버 불필요, 네이티브 성능 활용
- **venv312 환경 사용**: Python 3.12 가상환경(venv312)으로 변경
- **OCR 아키텍처 개선**: 서버 기반 → 클라이언트 기반 (Windows SDK)
- **Task 34: Windows OCR 성능 최적화 완료**
  - 처리 시간: 2-3초 → 14-17ms (약 120-200배 개선)
  - 서버 분석 제거, Node.js 로컬 분석으로 전환
  - OCR 엔진 캐싱, 이미지 변환 최적화, ROI 처리 제거
- **Task 35: Deepgram 실시간 스트리밍 완료**
  - 레이턴시: ~2.0초 → ~0.5초 (버퍼링 제거)
  - 중간 결과(Interim Results) 지원으로 문장 완성 전에도 감지 가능
  - WebSocket 기반 실시간 양방향 통신
- **Task 36: 로컬 Whisper 폴백 시스템** ⚠️ 제거됨
  - ~~서버 연결 실패 시 자동으로 로컬 Whisper 모드로 전환~~
  - **현재**: 서버 STT만 사용, 자동 재연결 로직으로 대체
  - LocalSTT 관련 코드 제거, 서버 WebSocket 연결만 사용
- **Task 37: Ubuntu 서버 배포 가이드 작성 완료**
  - systemd, Nginx, SSL, Gunicorn 설정 가이드 제공
  - `docs/37-ubuntu-fastapi-deployment.md` 참조
- **KoElectra 모델 지원 추가**
  - 빠른 추론 속도를 위한 KoElectra 모델 지원
  - 환경 변수 `MODEL_TYPE`으로 모델 선택 가능 (koelectra/kanana)
  - KoElectra: 경량 모델 (약 110M 파라미터), 빠른 추론
  - Kanana: 더 정확하지만 느림 (약 2.1B 파라미터)
- **Task 38: 코드 리팩토링 및 정리 완료**
  - Startup.cs: 불필요한 using 제거로 서버 의존성 완전 제거
  - AppVolumeController.ts: WMIC 주석 추가, sessionKey 형식 개선, 복원 타이머 세션별 관리
  - VolumeController.ts: AppVolumeController 주입 구조로 변경, PID 기반 볼륨 제어 추가
  - 디바이스/세션 접근이 AppVolumeController로 중앙화되어 중복 제거 및 유지보수성 향상
- **Task 39: C# 기반 PID 볼륨 제어 통합 완료**
  - native-sound-mixer 완전 제거: 모든 볼륨 제어 기능을 C# Bridge로 마이그레이션
  - C# Bridge에 `listSessions` 커맨드 추가: 오디오 세션 목록 조회 기능 통합
  - AppVolumeController 리팩토링: C# Bridge 기반으로 전환, 세션 캐싱 및 주기적 갱신
  - 아키텍처 통일: 모든 Windows API 호출이 C# Bridge로 통합되어 유지보수성 향상
  - 빌드/호환성 개선: 네이티브 모듈 빌드 문제 해결, 의존성 단순화
- **Task 40: C++ Core Audio 구현 상세 문서화 완료**
  - Application Loopback 내부 구현 원리 문서화
  - `AUDIOCLIENT_ACTIVATION_PARAMS`를 사용한 PID 기반 오디오 캡처 상세 설명
  - Windows OCR (C++/WinRT) 구현 내용 포함
  - 빌드 및 배포 주의사항 정리 (Windows SDK 버전, 런타임 요구사항 등)
- **Task 41: 파인튜닝된 KoElectra 분류기 연동 완료**
  - 로컬 파인튜닝 모델(`server/models/koelectra-classifier-v1`) 로드 지원
  - `MODEL_PATH` 환경 변수를 통한 로컬 모델 경로 지정
  - 모델 파일 검증 및 로드 실패 시 Hugging Face Base 모델로 폴백
  - 파인튜닝된 모델 사용으로 유해 표현 분류 정확도 향상
- **중간 결과(Interim Results) 활용 개선**
  - 말하는 도중에도 유해 표현 즉시 감지 (문장 완성 대기 불필요)
  - 체감 지연 시간: 2-3초 → 0.5-0.8초로 대폭 단축
  - 중간 결과도 AI 모델로 분석하여 실시간 차단 가능
  - 중복 분석 방지: 텍스트 길이 증가 시에만 분석 (최소 5자, 3자 이상 증가)
- **성능 측정 및 로깅 개선**
  - 볼륨 조절 단계별 시간 측정 로그 추가 (세션 조회, 앱 찾기, C# Bridge 호출 등)
  - 타임스탬프(ISO 8601) 추가로 정밀한 지연 시간 분석 가능
  - C# 로그 인코딩 수정 (UTF-8)으로 한글 로그 정상 출력
- **Task 43: Threshold 설정 및 최적화 완료**
  - 모델별 기본 Threshold 설정 (KoElectra: 0.5, Kanana: 0.22)
  - 환경 변수 `CLASSIFIER_THRESHOLD` 지원
  - API를 통한 동적 Threshold 조정 (`/analyze?threshold=0.5`)
  - 서버 재시작 없이 Threshold 변경 API (`POST /settings/threshold`)
  - Electron 트레이 메뉴 민감도 설정 연동
  - `/health` 엔드포인트에 Threshold 정보 포함
- **Task 44: Vercel 관리자 대시보드 구축 가이드 작성**
  - Next.js 기반 관리자 대시보드 가이드
  - FastAPI 서버 연동 방법
  - Vercel 배포 설정 가이드
  - 실시간 모니터링 및 설정 관리 기능 제안
- **Task 45: Spawn 방식 Bridge 마이그레이션 완료**
  - electron-edge-js → child_process.spawn 방식으로 전환
  - 프로세스 분리 및 안정성 향상 (Fault Isolation)
  - Electron 버전 종속성 제거, 배포 안정성 향상
  - Self-contained `.exe` 파일로 배포 (.NET 런타임 포함)
  - JSON over stdio 통신 프로토콜 사용
  - 포터블 빌드 검증 문서 추가: `docs/PORTABLE_BUILD_VERIFICATION.md`
- **Task 46: Supabase 기반 관리자 DB 및 로깅 시스템 구축 계획**
  - PostgreSQL 로그 저장
  - 설정 원격 관리
  - 관리자 API
- **Task 47: 메인 대시보드 구축 및 멀티 윈도우 관리 완료**
  - 모드 선택 화면 (OCR/음성)
  - 멀티 윈도우 관리 시스템
  - 성능 최적화
- **Task 48: 애플리케이션 성능 최적화 완료**
  - 마우스 버벅거림 해결 (React 렌더링 최적화)
  - IPC 통신 최적화 (Deep Compare)
  - GPU 가속 활성화
- **Task 49: 유해 표현 블라인드 처리 및 OCR 연속 감지 완료**
  - 블러 강도 설정 (15, 25, 40px)
  - 트레이 메뉴 블러 강도 변경 기능
  - setContentProtection 활성화 (스크린샷 방지)
  - OCR 연속 감지 (블러 표시 중에도 OCR 작동)
- **Task 50: 테스트 자동화 구현 완료**
  - Jest 유닛 테스트 (15개 테스트 케이스)
  - Playwright E2E 테스트 (10개 테스트 케이스)
  - 테스트 헬퍼 유틸리티
  - 빠른 시작 스크립트 (Windows)
