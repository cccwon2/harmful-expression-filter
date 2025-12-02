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

각 작업의 상세 내용은 [docs/](./docs/) 폴더를 참조하세요. 현재까지 **Task 1~50**까지 진행 중입니다:

- **Task 1~18**: 기본 Electron 앱 설정, 시스템 트레이, 오버레이 창, ROI 선택, OCR 모니터링, 서버 연동
- **Task 20~23**: FastAPI 서버 구축 및 Electron 통합 (텍스트 분석 API)
- **Task 24~27**: 음성 STT API, Electron 오디오 연동, Deepgram STT 통합
- **Task 28**: PaddleOCR 서버 연동 및 Tesseract.js 대체 (현재는 Windows SDK OCR로 대체됨)
- **Task 29**: OnVoice COM Bridge 통합 (프로세스별 오디오 캡처)
- **Task 30~32**: electron-edge-js 마이그레이션 (⚠️ Deprecated - Task 45로 대체됨)
- **Task 33**: AudioManager 트레이 통합 (보안 강화, 시스템 트레이 직접 제어)
- **Task 34**: Windows OCR 성능 최적화 (2-3초 → 14-17ms, 약 120-200배 개선)
- **Task 35**: Deepgram 실시간 스트리밍 방식 (버퍼링 제거, 레이턴시 ~2.0초 → ~0.5초)
- **Task 36**: 로컬 Whisper 폴백 시스템 (⚠️ 제거됨 - 서버 STT만 사용, 자동 재연결)
- **Task 37**: Ubuntu 서버 FastAPI 배포 가이드 (systemd, Nginx, SSL, 프로덕션 환경 구성)
- **Task 38**: 코드 리팩토링 및 정리 (서버 의존성 완전 제거, AppVolumeController 중앙화, PID 기반 볼륨 제어 추가)
- **Task 39**: C# 기반 PID 볼륨 제어 통합 (native-sound-mixer 완전 제거, C# Bridge로 통합)
- **Task 40**: C++ Core Audio 구현 상세 (Application Loopback 내부 구현 원리 문서화)
- **Task 41**: 파인튜닝된 KoElectra 분류기 연동 (로컬 모델 로드, 정확도 향상)
- **Task 42**: Electron 앱 배포 (Windows NSIS 인스톨러 생성, C# 및 C++ DLL 포함, electron-builder 통합, 오버레이 창 배포 모드 문제 해결, 포터블 버전 지원, COM DLL 자동 등록)
- **Task 43**: Threshold(임계값) 설정 및 최적화 (모델별 기본값 설정, 환경 변수 지원, API를 통한 동적 조정, Electron 트레이 연동)
- **Task 44**: Vercel 관리자 대시보드 구축 가이드 (Next.js 기반 대시보드, FastAPI 서버 연동, 실시간 모니터링)
- **Task 45**: Spawn 방식 Bridge 마이그레이션 (electron-edge-js → child_process.spawn, 프로세스 분리 및 안정성 향상)
- **Task 46**: Supabase 기반 관리자 DB 및 로깅 시스템 구축 (PostgreSQL 로그 저장, 설정 원격 관리, 관리자 API) 📝 계획 단계
- **Task 47**: 메인 대시보드 구축 및 멀티 윈도우 관리 (모드 선택 화면, OCR/음성 모드 분리, 성능 최적화)
- **Task 48**: 애플리케이션 성능 최적화 (마우스 버벅거림 해결, React 렌더링 최적화, IPC 통신 최적화)
- **Task 49**: 유해 표현 블라인드 처리 및 OCR 연속 감지 (블러 강도 설정, 트레이 메뉴 통합, setContentProtection)
- **Task 50**: 테스트 자동화 구현 (Jest 유닛 테스트, Playwright E2E 테스트, 자동화 인프라) ✅ 완료

### 주요 기술 스택

- **OCR**: Windows SDK OCR (Windows.Media.Ocr) - C# COM Bridge를 통해 사용
  - **성능**: 14-17ms 처리 시간 (서버 분석 제거, 로컬 분석으로 전환)
  - **최적화**: OCR 엔진 캐싱, 이미지 변환 최적화, ROI 처리 제거
- **STT**: Deepgram (WebSocket 기반 실시간 음성 인식) - 서버 STT만 사용
  - **정상 모드**: Deepgram 실시간 스트리밍 (~0.5초 레이턴시)
    - 중간 결과(Interim Results) 지원, 문장 완성 전에도 감지 가능
    - 말하는 도중에도 유해 표현 즉시 감지 (체감 지연: 2-3초 → 0.5-0.8초)
    - 서버 연결 실패 시 자동 재연결 시도
- **NLP 모델**: KoElectra 또는 Kanana Nano (환경 변수로 선택)
  - **KoElectra** (`skplanet/dialog-koelectra-small-discriminator`): 빠른 추론, 경량 모델 (약 110M 파라미터)
    - CPU 환경에 최적화, `optimum`/`onnxruntime`로 추가 가속 가능
    - **파인튜닝 모델 지원**: `server/models/koelectra-classifier-v1` 로컬 모델 사용 가능
  - **Kanana Nano** (`kakaocorp/kanana-nano-2.1b-instruct`): 더 정확하지만 느림 (약 2.1B 파라미터)
    - Base 모델만 사용 또는 LoRA 어댑터 사용 가능
    - **8-bit 양자화 지원**: GPU 사용 시 `bitsandbytes` 설치 후 메모리 사용량 감소 및 추론 속도 2-4배 향상 가능 (CPU에서는 동작하지 않음)
- **오디오 캡처**: [OnVoice COM Bridge](https://github.com/cccwon2/onvoice-com-bridge) (Windows WASAPI 기반 프로세스별 오디오 캡처)
  - C++ Native 구현: `AUDIOCLIENT_ACTIVATION_PARAMS`를 사용한 PID 기반 Application Loopback
  - Windows 10 SDK (10.0.20348.0) 이상 필요
- **볼륨 제어**: C# Bridge (NAudio.Wasapi) - Windows Core Audio API 직접 사용
  - PID 기반 앱별 볼륨 조절
  - 오디오 세션 목록 조회 (C# Bridge 통합)
- **C# Bridge 통신**: `child_process.spawn` 방식 (Out-of-Process)
  - 별도 프로세스로 실행하여 안정성 향상 (Fault Isolation)
  - JSON over stdio 통신 프로토콜
  - Electron 버전 종속성 제거, 배포 안정성 향상
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

# ==========================================
# [MODE 1] KoElectra (CPU 추천, 빠름)
# ==========================================
MODEL_TYPE=koelectra
BASE_MODEL_NAME=skplanet/dialog-koelectra-small-discriminator
MODEL_PATH=
USE_QUANTIZATION=false

# ==========================================
# [MODE 2] Kanana (GPU 추천, 정확함)
# ==========================================
# MODEL_TYPE=kanana
# BASE_MODEL_NAME=kakaocorp/kanana-nano-2.1b-instruct
# MODEL_PATH=models/kanana-lora-v1
# USE_QUANTIZATION=false

# ==========================================
# Threshold 설정 (선택사항)
# ==========================================
# CLASSIFIER_THRESHOLD=0.5  # 0.0 ~ 1.0 (기본값: KoElectra=0.5, Kanana=0.22)
# 환경 변수를 설정하지 않으면 모델별 기본값이 사용됩니다.
# 자세한 내용은 docs/43-threshold-configuration.md 참조
```

**참고**:

- `.env` 파일은 `.gitignore`에 포함되어 있어 Git에 커밋되지 않습니다.
- Deepgram API 키는 [Deepgram Console](https://console.deepgram.com/signup)에서 발급받을 수 있습니다.
- 무료 크레딧: $200 (약 16,000분 사용 가능)
- **모델 선택**:
  - **MODE 1 (KoElectra)**: CPU 환경에 추천, 빠른 추론 속도, 경량 모델 (약 110M 파라미터)
    - `MODEL_TYPE=koelectra`로 설정
    - `MODEL_PATH=models/koelectra-classifier-v1`로 설정 시 파인튜닝 모델 사용 (정확도 향상)
    - `USE_QUANTIZATION=false` (CPU에서는 양자화 불필요)
  - **MODE 2 (Kanana)**: GPU 환경에 추천, 더 정확하지만 느림 (약 2.1B 파라미터)
    - `MODEL_TYPE=kanana`로 설정
    - `MODEL_PATH`를 설정하면 LoRA 어댑터 사용 가능 (더 정확한 유해성 판별)
    - `USE_QUANTIZATION=false` (CPU 사용 시 자동으로 비활성화됨)
- **Threshold 설정** (선택사항):
  - `CLASSIFIER_THRESHOLD`: 유해 표현 판단 임계값 (0.0 ~ 1.0)
  - 설정하지 않으면 모델별 기본값 사용 (KoElectra: 0.5, Kanana: 0.22)
  - Electron 트레이 메뉴에서도 동적으로 조정 가능
  - 자세한 내용은 [docs/43-threshold-configuration.md](./docs/43-threshold-configuration.md) 참조

## 🚀 빠른 시작

### Python 의존성

#### CPU 환경 (`requirements.txt`)

`server/requirements.txt`는 CPU 환경에 최적화되어 있습니다:

- **FastAPI & Web**: FastAPI, uvicorn, pydantic, websockets
- **AI Models**: transformers, accelerate
  - `bitsandbytes`: CPU 호환 불가로 제거됨 (GPU 사용 시 별도 설치)
  - `peft`: 학습이 아닌 추론만 한다면 불필요 (LoRA 어댑터 사용 시 필요)
- **PyTorch**: CPU 버전 권장 (`torch`, `torchaudio`)
  - `torchvision`: KoElectra와 무관하므로 제거됨
- **CPU 추론 가속 (선택)**: `optimum`, `onnxruntime` (추천)

#### GPU 환경 (`requirements-gpu.txt`)

`server/requirements-gpu.txt`는 GPU 환경(Ubuntu 24 서버 권장)에 최적화되어 있습니다:

- **FastAPI & Web**: FastAPI, uvicorn, pydantic, websockets
- **AI Models**: transformers, peft, accelerate, bitsandbytes
  - `bitsandbytes>=0.46.1`: CUDA 13 드라이버 호환 릴리스 기준
  - `peft>=0.7.0`: LoRA 어댑터 사용 시 필요
- **PyTorch**: CUDA 버전 별도 설치 필요 (아래 GPU 사용 섹션 참조)

### CPU 사용 (기본)

```bash
# FastAPI 백엔드 (터미널 1)
# ⚠️ 중요: server 폴더의 모든 Python 라이브러리는 venv312 가상환경에서만 관리합니다
cd server

# Windows
venv312\Scripts\activate

# 의존성 설치 (venv312 활성화 후)
# 1. 먼저 CPU 버전의 PyTorch 설치 (OS에 따라 다를 수 있으나 Linux/Windows 공통적으로 아래 인덱스 권장)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# 2. 나머지 패키지 설치
pip install -r requirements.txt
# 또는
# .\venv312\Scripts\python.exe -m pip install -r requirements.txt

# 서버 실행
uvicorn main:app --reload
```

**참고:**

- `requirements.txt`는 CPU 최적화를 위해 구성되어 있습니다:
  - `bitsandbytes`: CPU 호환 불가로 제거됨
  - `peft`: 학습(Fine-tuning)이 아닌 추론(Inference)만 한다면 필요 없음 (유지해도 무방)
  - `torchvision`: KoElectra와 무관하므로 제거됨
  - `optimum`, `onnxruntime`: CPU 추론 가속용 (선택 사항, 추천)

### GPU 사용 (CUDA) - 성능 향상

**GPU를 사용하면 추론 속도가 2-4배 빨라집니다!**

#### 1. NVIDIA GPU 확인

```bash
# GPU 확인 (Windows/Linux 공통)
nvidia-smi
```

#### 2. CUDA 지원 PyTorch 설치

**방법 1: PyTorch 공식 사이트 사용 (권장)**

1. https://pytorch.org/get-started/locally/ 접속
2. 환경 선택 (OS, Python, CUDA 버전)
3. 생성된 명령어 실행

**방법 2: 직접 설치 (CUDA 12.1 예시 - Windows/Linux 공통)**

```bash
# venv312 활성화 후
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
# torchvision은 KoElectra와 무관하므로 선택 사항
```

**방법 3: CUDA 11.8 사용 시**

```bash
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118
```

**방법 4: CUDA 13 드라이버 사용 시 (Ubuntu 24 서버 권장)**

```bash
# venv312 활성화 후
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
```

#### 3. 나머지 패키지 설치

**Windows / Linux (CPU 또는 GPU 기본 설치)**

```bash
# PyTorch 설치 후 나머지 패키지 설치
pip install -r requirements.txt
```

**Ubuntu 24 서버 (GPU 전용 - requirements-gpu.txt 사용)**

```bash
# venv312 활성화 후
cd server

# 1. CUDA 13 드라이버용 PyTorch 설치
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130

# 2. GPU 전용 requirements 파일로 나머지 패키지 설치
pip install -r requirements-gpu.txt
```

**참고:**

- `requirements-gpu.txt`는 GPU 환경에 최적화된 패키지 목록입니다:
  - `bitsandbytes>=0.46.1`: CUDA 13 드라이버 호환 릴리스 기준
  - `peft>=0.7.0`: LoRA 어댑터 사용 시 필요
  - `transformers>=4.38.0`: Hugging Face 모델 지원
- GPU 사용 시 `bitsandbytes`를 설치하면 8-bit 양자화 사용 가능 (CPU에서는 동작하지 않음)
- `peft`는 LoRA 어댑터 사용 시 필요 (Base 모델만 사용하면 불필요)

#### 4. GPU 인식 확인

서버 실행 시 로그에서 다음 메시지 확인:

```
🚀 Device selected: cuda
✅ 8-bit 양자화 활성화 (성능 개선: 메모리 사용량 감소, 추론 속도 향상)
```

**참고:** CPU 환경에서는 자동으로 `Device selected: cpu`로 표시됩니다.

**참고:**

- CUDA Toolkit을 별도로 설치할 필요는 없습니다 (PyTorch가 자체 CUDA 런타임 포함)
- NVIDIA 드라이버는 최신 버전으로 업데이트 권장
- GPU가 없으면 자동으로 CPU로 동작합니다
- **Ubuntu 24 서버**: CUDA 13 드라이버 사용 시 `cu130` 인덱스 사용 권장

### Ubuntu 24 서버 GPU 설정 (프로덕션 환경)

Ubuntu 24 서버에서 GPU를 사용하는 경우 다음 단계를 따르세요:

#### 1. CUDA 관련 확인 및 설치

```bash
# NVIDIA GPU 확인
nvidia-smi

# CUDA 드라이버 버전 확인 (CUDA 13 이상 권장)
nvidia-smi | grep "CUDA Version"
```

#### 2. Python 가상환경 설정

```bash
cd /opt/harmful-expression-filter/server

# Python 3.12 가상환경 생성 (없는 경우)
python3.12 -m venv venv312

# 가상환경 활성화
source venv312/bin/activate

# pip 업그레이드
pip install --upgrade pip setuptools wheel
```

#### 3. CUDA 13 드라이버용 PyTorch 설치

```bash
# venv312 활성화 후
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
```

#### 4. GPU 전용 패키지 설치

```bash
# requirements-gpu.txt 사용 (bitsandbytes, peft 포함)
pip install -r requirements-gpu.txt
```

#### 5. GPU 인식 확인

```bash
# Python에서 GPU 확인
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'CUDA version: {torch.version.cuda}'); print(f'Device count: {torch.cuda.device_count()}')"
```

서버 실행 시 로그에서 다음 메시지 확인:

```
🚀 Device selected: cuda
✅ 8-bit 양자화 활성화 (성능 개선: 메모리 사용량 감소, 추론 속도 향상)
```

**참고:**

- `requirements-gpu.txt`는 CUDA 13 드라이버 호환을 기준으로 작성되었습니다
- CUDA 12.x 드라이버 사용 시 `cu121` 또는 `cu124` 인덱스 사용
- 자세한 배포 가이드는 [docs/37-ubuntu-fastapi-deployment.md](./docs/37-ubuntu-fastapi-deployment.md) 참조

### Electron 앱 (터미널 2)

```bash
npm install
npm run dev
```

### 주요 스크립트

```bash
# 메인 프로세스 타입 체크 및 빌드
npm run typecheck
npm run build:main

# 전체 빌드 (C# DLL + C++ DLL + TypeScript)
npm run build:all

# 개별 빌드
npm run build:dotnet    # C# DLL 빌드
npm run build:native    # C++ COM DLL 빌드
npm run copy:dll        # C# DLL 복사
npm run copy:native     # C++ DLL 복사

# 프로덕션 빌드 및 패키징
npm run build:renderer  # 렌더러 빌드 (Vite)
npm run build:electron  # Electron 패키지 생성 (NSIS 인스톨러)
npm run build:portable  # 포터블 버전 생성 (설치 없이 실행 가능)
npm run build           # 전체 빌드 + 패키징

# 프로덕션 실행
npm start

# 테스트
npm test                    # 전체 테스트 실행 (유닛 + E2E)
npm run test:unit           # 유닛 테스트만 실행
npm run test:unit:watch     # 유닛 테스트 Watch 모드
npm run test:unit:coverage  # 유닛 테스트 커버리지 포함
npm run test:e2e            # E2E 테스트 실행
npm run test:e2e:ui         # E2E 테스트 UI 모드
npm run test:e2e:debug      # E2E 테스트 디버그 모드
npm run test:report         # 테스트 리포트 확인
```

**테스트 관련**:

- 자세한 테스트 가이드는 [docs/TEST_AUTOMATION_GUIDE.md](./docs/TEST_AUTOMATION_GUIDE.md) 참조
- 빠른 시작: `scripts\quick-start-test.bat` 실행 (Windows)

**배포 관련**:

- 자세한 배포 가이드는 [docs/42-electron-app-deployment.md](./docs/42-electron-app-deployment.md) 참조
- 포터블 빌드 검증: [docs/PORTABLE_BUILD_VERIFICATION.md](./docs/PORTABLE_BUILD_VERIFICATION.md) 참조
- C++ COM DLL은 상대 경로(`../onvoice-com-bridge/phase3-com-dll/OnVoiceAudioBridge`)에서 자동 탐색
- 빌드된 DLL은 `native/OnVoiceAudioBridge.dll`로 복사되어 electron-builder에 포함됨
- **포터블 버전**: `npm run build:portable`로 설치 없이 실행 가능한 버전 생성
  - **Registration-Free COM 지원**: 관리자 권한 없이 실행 가능 (매니페스트 파일 포함)
    - `OnVoice.exe.manifest`: Electron 앱 매니페스트
    - `resources/native/OnVoiceAudioBridge.dll.manifest`: COM DLL 매니페스트
    - `resources/bin/OnVoiceComBridge.exe.manifest`: C# Bridge 매니페스트
  - 매니페스트 파일이 없으면 앱 시작 시 자동으로 COM DLL 등록 시도 (관리자 권한 필요할 수 있음)
  - NSIS 설치 버전과 동일한 경로 구조 (`process.resourcesPath` 사용)
  - 레지스트리 등록 없이 COM 객체 사용 가능
  - 빌드 후 매니페스트 파일이 누락된 경우 수동으로 복사 필요할 수 있음
- **설치 버전**: `npm run build:electron`로 NSIS 인스톨러 생성
  - 설치 시 자동으로 COM DLL 등록 (`build/installer.nsh`)
  - Registration-Free COM 매니페스트도 포함되어 관리자 권한 없이 실행 가능
- **C# Bridge**: `child_process.spawn` 방식으로 별도 프로세스 실행 (Task 45)
  - Self-contained `.exe` 파일로 배포 (`.NET 런타임 포함`)
  - Electron 버전과 무관하게 동작, 배포 안정성 향상

## 📖 프로젝트 구조

```
harmful-expression-filter/
├── README.md                # 프로젝트 개요 및 빠른 시작 가이드
├── docs/                    # 작업/문서 모음
│   ├── PROJECT_SPEC.md      # 마스터 플랜 (전체 프로젝트 명세서)
│   ├── INTERFACES.md        # 핵심 인터페이스 및 연결부 코드
│   └── ...                  # 각 작업 문서 (00~42)
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
├── native/                  # C++ COM DLL (빌드 산출물)
│   ├── .gitkeep            # 폴더 구조 유지
│   └── OnVoiceAudioBridge.dll  # 빌드된 C++ COM DLL (배포용)
│   └── OnVoiceAudioBridge/  # C++ 소스 코드 (서브모듈)
│       └── phase3-com-dll/
│           └── OnVoiceAudioBridge/  # 실제 프로젝트
├── scripts/                 # 빌드 스크립트
│   ├── copy-dll.js         # C# DLL 복사
│   ├── copy-native-dll.js  # C++ DLL 복사
│   ├── build-native.js     # C++ DLL 빌드 (MSBuild 자동 탐색)
│   └── find-msbuild.js     # MSBuild 경로 찾기
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
├── tests/                   # 테스트 자동화 (Task 50)
│   ├── e2e/                 # E2E 테스트 (Playwright)
│   │   └── task49-blur.spec.ts
│   ├── unit/                # 유닛 테스트 (Jest)
│   │   └── blurIntensity.test.ts
│   ├── helpers/             # 테스트 헬퍼
│   │   └── ocr-simulator.ts
│   └── setup.ts             # Jest 전역 setup
├── playwright.config.ts     # Playwright 설정
├── jest.config.js           # Jest 설정
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
- `electron/main/onVoiceBridge.ts` – OnVoice Bridge 모듈 (spawn 방식, Windows SDK OCR 포함, Task 45)
- `electron/main/registerComDll.ts` – COM DLL 자동 등록 유틸리티 (포터블 방식 지원)
- `electron/main/AudioManager.ts` – 오디오 스트리밍 관리자 (Singleton, 트레이 메뉴 통합, 폴백 로직 포함)
- `dotnet/OnVoiceComBridge/Startup.cs` – C# COM Bridge (Windows SDK OCR + OnVoice COM 래퍼)
- `electron/utils/harmfulAnalysisClient.ts` – FastAPI 유해 표현 분석 클라이언트
- `electron/audio/volumeController.ts` – 볼륨 레벨(1~9) 및 타깃 앱 관리 (AppVolumeController 파사드)
- `electron/audio/appVolumeController.ts` – 앱별 볼륨 제어 (C# Bridge 기반, PID 지원)
- `electron/tray.ts` – 시스템 트레이 (오디오 모니터링 상태 표시, AudioManager 통합)
- `electron/windows/createOverlayWindow.ts` – 오버레이 창 생성
- `electron/state/editMode.ts` – Edit Mode 상태 관리
- `scripts/build-native.js` – C++ COM DLL 빌드 스크립트 (MSBuild 자동 탐색, .slnx 지원)
- `scripts/copy-native-dll.js` – C++ COM DLL 복사 스크립트 (상대 경로 자동 탐색)
- `package.json` – electron-builder 설정 (Windows NSIS 인스톨러, C# 및 C++ DLL 포함)
- `docs/43-threshold-configuration.md` – Threshold 설정 및 최적화 문서 (Task 43)
- `docs/44-vercel-admin-dashboard.md` – Vercel 관리자 대시보드 구축 가이드 (Task 44)
- `docs/45-spawn-bridge-migration.md` – Spawn 방식 마이그레이션 문서 (Task 45)
- `docs/48-performance-optimization.md` – 애플리케이션 성능 최적화 문서 (Task 48)
- `docs/49-harmful-content-blind-ocr-continuous.md` – 유해 표현 블라인드 처리 및 OCR 연속 감지 (Task 49)
- `docs/50-test-automation.md` – 테스트 자동화 구현 문서 (Task 50)
- `docs/TEST_AUTOMATION_GUIDE.md` – 테스트 자동화 사용 가이드
- `docs/PORTABLE_BUILD_VERIFICATION.md` – 포터블 빌드 검증 문서
- `tests/unit/blurIntensity.test.ts` – 블러 강도 설정 유닛 테스트 (Task 50)
- `tests/e2e/task49-blur.spec.ts` – 블러 강도 및 OCR 연속 감지 E2E 테스트 (Task 50)
- `tests/helpers/ocr-simulator.ts` – 테스트 헬퍼 유틸리티 (OCR 시뮬레이터, IPC 모킹)
- `playwright.config.ts` – Playwright E2E 테스트 설정
- `jest.config.js` – Jest 유닛 테스트 설정

자세한 내용은 [docs/INTERFACES.md](./docs/INTERFACES.md)와 각 Task 문서를 참조하세요.

**배포 관련**: 자세한 배포 가이드는 [docs/42-electron-app-deployment.md](./docs/42-electron-app-deployment.md)를 참조하세요.

## 📝 작업 추가하기

새로운 작업을 추가할 때는 [docs/TASK_WORKFLOW.md](./docs/TASK_WORKFLOW.md)의 워크플로우를 따르고, 관련 Task 문서를 업데이트해 주세요.

## 📄 라이선스

MIT
