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

각 작업의 상세 내용은 [docs/](./docs/) 폴더를 참조하세요. 현재까지 **Task 1~37**까지 진행 중입니다:

- **Task 1~18**: 기본 Electron 앱 설정, 시스템 트레이, 오버레이 창, ROI 선택, OCR 모니터링, 서버 연동
- **Task 20~23**: FastAPI 서버 구축 및 Electron 통합 (텍스트 분석 API)
- **Task 24~27**: 음성 STT API, Electron 오디오 연동, Deepgram STT 통합
- **Task 28**: PaddleOCR 서버 연동 및 Tesseract.js 대체 (현재는 Windows SDK OCR로 대체됨)
- **Task 29**: OnVoice COM Bridge 통합 (프로세스별 오디오 캡처)
- **Task 30~32**: electron-edge-js 마이그레이션 (winax → electron-edge-js + C#)
- **Task 33**: AudioManager 트레이 통합 (보안 강화, 시스템 트레이 직접 제어)
- **Task 34**: Windows OCR 성능 최적화 (2-3초 → 14-17ms, 약 120-200배 개선)
- **Task 35**: Deepgram 실시간 스트리밍 방식 (버퍼링 제거, 레이턴시 ~2.0초 → ~0.5초)
- **Task 36**: 로컬 Whisper 폴백 시스템 (⚠️ 제거됨 - 서버 STT만 사용, 자동 재연결)
- **Task 37**: Ubuntu 서버 FastAPI 배포 (systemd, Nginx 리버스 프록시, 프로덕션 환경 구성)

### 주요 기술 스택

- **OCR**: Windows SDK OCR (Windows.Media.Ocr) - C# COM Bridge를 통해 사용
  - **성능**: 14-17ms 처리 시간 (서버 분석 제거, 로컬 분석으로 전환)
  - **최적화**: OCR 엔진 캐싱, 이미지 변환 최적화, ROI 처리 제거
- **STT**: Deepgram (WebSocket 기반 실시간 음성 인식) - 서버 STT만 사용
  - **정상 모드**: Deepgram 실시간 스트리밍 (~0.5초 레이턴시)
    - 중간 결과(Interim Results) 지원, 문장 완성 전에도 감지 가능
    - 서버 연결 실패 시 자동 재연결 시도
- **NLP 모델**: KoElectra 또는 Kanana Nano (환경 변수로 선택)
  - **KoElectra** (`monologg/koelectra-base-v3-discriminator`): 빠른 추론, 경량 모델 (약 110M 파라미터)
  - **Kanana Nano** (`kakaocorp/kanana-nano-2.1b-instruct`): 더 정확하지만 느림 (약 2.1B 파라미터)
    - Base 모델만 사용 또는 LoRA 어댑터 사용 가능
- **오디오 캡처**: [OnVoice COM Bridge](https://github.com/cccwon2/onvoice-com-bridge) (Windows WASAPI 기반 프로세스별 오디오 캡처)
- **백엔드**: FastAPI (Python 3.12, venv312 환경)

## ⚙️ 환경 변수 설정

프로젝트 루트와 `server` 폴더에 `.env` 파일을 생성하여 환경 변수를 설정합니다.

### 루트 `.env` 파일 (프로젝트 루트)

```env
# 서버 URL (Electron에서 사용)
SERVER_URL=http://127.0.0.1:8000

# WebSocket URL (오디오 스트리밍용)
SERVER_WS_URL=ws://127.0.0.1:8000/ws/audio
```

### `server/.env` 파일

```env
# Deepgram API Key (STT용)
# 발급: https://console.deepgram.com/signup
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# [AI 모델 설정]

# 모델 타입 (koelectra, kanana 기본값)
# - koelectra: KoElectra 모델 사용 (빠른 추론, 경량)
# - kanana: Kanana Nano 모델 사용 (더 정확하지만 느림)
MODEL_TYPE=koelectra

# Base 모델 (Hugging Face 모델 이름)
# KoElectra 사용 시:
BASE_MODEL_NAME=monologg/koelectra-base-v3-discriminator
# Kanana 사용 시:
#BASE_MODEL_NAME=kakaocorp/kanana-nano-2.1b-instruct

# 학습된 LoRA 어댑터 경로 (server 폴더 기준 상대 경로)
# Base 모델만 사용하려면 비워두거나 주석 처리
#MODEL_PATH=models/kanana-lora-v1
MODEL_PATH=
```

**참고**:

- `.env` 파일은 `.gitignore`에 포함되어 있어 Git에 커밋되지 않습니다.
- Deepgram API 키는 [Deepgram Console](https://console.deepgram.com/signup)에서 발급받을 수 있습니다.
- 무료 크레딧: $200 (약 16,000분 사용 가능)
- **모델 선택**:
  - `MODEL_TYPE=koelectra`: 빠른 추론 속도, 경량 모델 (약 110M 파라미터)
  - `MODEL_TYPE=kanana`: 더 정확하지만 느림 (약 2.1B 파라미터)
  - `MODEL_PATH`를 설정하면 Kanana LoRA 어댑터 사용 (더 정확한 유해성 판별)

## 🚀 빠른 시작

```bash
# FastAPI 백엔드 (터미널 1)
# ⚠️ 중요: server 폴더의 모든 Python 라이브러리는 venv312 가상환경에서만 관리합니다
cd server

# Windows
venv312\Scripts\activate

# 의존성 설치 (venv312 활성화 후)
.\venv312\Scripts\python.exe -m pip install -r requirements.txt
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
├── docs/                    # 작업/문서 모음
│   ├── PROJECT_SPEC.md      # 마스터 플랜 (전체 프로젝트 명세서)
│   ├── INTERFACES.md        # 핵심 인터페이스 및 연결부 코드
│   └── ...                  # 각 작업 문서 (00~37)
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
├── server/                  # FastAPI 백엔드 서버
│   ├── main.py              # FastAPI 앱 진입점
│   ├── requirements.txt     # Python 의존성 목록
│   ├── .env                 # 환경 변수 (DEEPGRAM_API_KEY 등)
│   ├── audio/               # 오디오 처리 모듈
│   │   ├── deepgram_service.py    # Deepgram STT 서비스
│   │   ├── whisper_service.py     # Whisper STT 서비스 (레거시)
│   │   ├── buffer_manager.py      # 오디오 버퍼 관리 (레거시)
│   │   └── pipeline.py            # 오디오 처리 파이프라인 (레거시)
│   ├── nlp/                 # 자연어 처리 모듈
│   │   └── harmful_classifier.py  # 유해 표현 분류기
│   ├── services/            # 외부 서비스 연동
│   ├── data/                # 데이터 파일
│   │   └── bad_words.json   # 유해어 목록
│   ├── tests/               # 테스트 파일
│   └── venv312/             # Python 3.12 가상환경
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
- `electron/main/AudioManager.ts` – 오디오 스트리밍 관리자 (Singleton, 트레이 메뉴 통합, 폴백 로직 포함)
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
