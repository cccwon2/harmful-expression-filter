# Harmful Expression Filter

라이브 플랫폼 유해 표현 필터링, 블러, 볼륨 조절 Electron 애플리케이션. FastAPI 백엔드와 연동해 텍스트 분석과 알림 흐름을 처리합니다.

## 📚 시작하기

### 필수 문서

새로운 작업을 시작하기 전에 **반드시** 다음 문서를 확인하세요:

1. **[docs/PROJECT_SPEC.md](./docs/PROJECT_SPEC.md)**: 전체 프로젝트 명세서 및 요구사항
2. **[docs/INTERFACES.md](./docs/INTERFACES.md)**: 핵심 인터페이스 및 연결부 코드 (⚠️ 매우 중요)
3. **[docs/TASK_WORKFLOW.md](./docs/TASK_WORKFLOW.md)**: 작업 워크플로우 가이드
4. **[docs/00-overview.md](./docs/00-overview.md)**: 현재 작업 현황 및 상태 요약

### 작업 문서

각 작업의 상세 내용은 [docs/](./docs/) 폴더를 참조하세요. 현재까지 **Task 1~33**까지 완료되었습니다:

- **Task 1~18**: 기본 Electron 앱 설정, 시스템 트레이, 오버레이 창, ROI 선택, OCR 모니터링, 서버 연동
- **Task 20~23**: FastAPI 서버 구축 및 Electron 통합 (텍스트 분석 API)
- **Task 24~27**: 음성 STT API, Electron 오디오 연동, Deepgram STT 통합
- **Task 28**: PaddleOCR 서버 연동 및 Tesseract.js 대체 (현재는 Windows SDK OCR로 대체됨)
- **Task 29**: OnVoice COM Bridge 통합 (프로세스별 오디오 캡처)
- **Task 30~32**: electron-edge-js 마이그레이션 (winax → electron-edge-js + C#)
- **Task 33**: AudioManager 트레이 통합 (보안 강화, 시스템 트레이 직접 제어)

### 주요 기술 스택

- **OCR**: Windows SDK OCR (Windows.Media.Ocr) - C# COM Bridge를 통해 사용
- **STT**: Deepgram (WebSocket 기반 실시간 음성 인식)
- **오디오 캡처**: OnVoice COM Bridge (프로세스별 오디오 캡처)
- **백엔드**: FastAPI (Python 3.10, venv310 환경)

## 🚀 빠른 시작

```bash
# FastAPI 백엔드 (터미널 1)
# ⚠️ 중요: server 폴더의 모든 Python 라이브러리는 venv310 가상환경에서만 관리합니다
cd server

# Windows
venv310\Scripts\activate

# 의존성 설치 (venv310 활성화 후)
.\venv310\Scripts\python.exe -m pip install -r requirements.txt
# 또는
# python -m pip install -r requirements.txt

# 서버 실행
uvicorn main:app --reload

# Electron 앱 (터미널 2)
npm install
npm run dev
```

### 주요 스크립트

```bash
# 메인 프로세스 타입 체크 및 빌드
npm run typecheck
npm run build:main

# 전체 빌드 (C# DLL + TypeScript)
npm run build:all

# C# DLL 빌드 및 복사
npm run build:dotnet
npm run copy:dll

# 프로덕션 실행
npm start
```

## 📖 프로젝트 구조

```
harmful-expression-filter/
├── README.md                # 프로젝트 개요 및 빠른 시작 가이드
├── docs/                    # 작업/문서 모음 (Task 00~33)
│   ├── PROJECT_SPEC.md      # 마스터 플랜 (전체 프로젝트 명세서)
│   ├── INTERFACES.md        # 핵심 인터페이스 및 연결부 코드
│   └── ...                  # 각 작업 문서 (01~33)
├── electron/                # Electron 메인 프로세스 (IPC, 창, 상태)
│   ├── main/                # 메인 프로세스 핵심 모듈
│   │   ├── AudioManager.ts  # 오디오 스트리밍 관리자 (Singleton)
│   │   └── onVoiceBridge.ts # OnVoice Bridge 모듈 (Windows SDK OCR 포함)
│   ├── audio/               # 오디오 관련 서비스
│   │   ├── onVoiceService.ts        # OnVoice 서비스 (IPC용)
│   │   └── onVoiceBridgeAdapter.ts  # OnVoice 브리지 어댑터
│   └── ipc/                 # IPC 핸들러
│       └── onVoiceHandlers.ts       # OnVoice IPC 핸들러
├── dotnet/                  # C# COM Bridge
│   └── OnVoiceComBridge/    # .NET 6 프로젝트
│       └── Startup.cs       # Windows SDK OCR + OnVoice COM 래퍼
└── renderer/                # React 렌더러 프로세스 (오버레이/UI)
```

## 🔗 핵심 파일

작업 시 반드시 참조해야 할 핵심 연결부 파일들:

- `electron/ipc/channels.ts` – IPC 채널 정의 (SERVER_CHANNELS, AUDIO_CHANNELS, ONVOICE_CHANNELS 포함)
- `electron/ipc/serverHandlers.ts` – FastAPI 연동 IPC 핸들러
- `electron/ipc/audioHandlers.ts` – 오디오 모니터링 IPC 핸들러
- `electron/ipc/onVoiceHandlers.ts` – OnVoice COM 브리지 IPC 핸들러
- `electron/preload.ts` – Preload API 구현 및 서버 브리지
- `renderer/src/global.d.ts` – Preload API 타입 정의
- `renderer/src/components/ServerTest.tsx` – 서버 테스트용 개발 UI
- `renderer/src/components/AudioMonitor.tsx` – 오디오 모니터링 UI 컴포넌트
- `electron/audio/audioService.ts` – 오디오 모니터링 서비스 (naudiodon2 기반)
- `electron/audio/onVoiceService.ts` – OnVoice COM 브리지 서비스 (프로세스별 캡처)
- `electron/audio/onVoiceBridgeAdapter.ts` – OnVoice COM 브리지 어댑터
- `electron/main/onVoiceBridge.ts` – OnVoice Bridge 모듈 (electron-edge-js 기반, Windows SDK OCR 포함)
- `electron/main/AudioManager.ts` – 오디오 스트리밍 관리자 (Singleton, 트레이 메뉴 통합)
- `dotnet/OnVoiceComBridge/Startup.cs` – C# COM Bridge (Windows SDK OCR + OnVoice COM 래퍼)
- `electron/utils/harmfulAnalysisClient.ts` – FastAPI 유해 표현 분석 클라이언트
- `electron/audio/appVolumeController.ts` – 앱별 볼륨 제어
- `electron/tray.ts` – 시스템 트레이 (오디오 모니터링 상태 표시, AudioManager 통합)
- `electron/windows/createOverlayWindow.ts` – 오버레이 창 생성
- `electron/state/editMode.ts` – Edit Mode 상태 관리

자세한 내용은 [docs/INTERFACES.md](./docs/INTERFACES.md)와 각 Task 문서를 참조하세요.

## 📝 작업 추가하기

새로운 작업을 추가할 때는 [docs/TASK_WORKFLOW.md](./docs/TASK_WORKFLOW.md)의 워크플로우를 따르고, 관련 Task 문서를 업데이트해 주세요.

## 📄 라이선스

MIT
