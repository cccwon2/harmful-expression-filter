# 작업 37: Ubuntu 서버 FastAPI 배포

## 상태

✅ 완료

## 개요

FastAPI 백엔드 서버를 Ubuntu 서버에 프로덕션 환경으로 배포합니다. systemd를 통한 자동 시작, Nginx 리버스 프록시 설정, 로깅 및 모니터링 구성을 포함합니다.

**서버 역할**:
- **실시간 STT 중계(Deepgram)**: WebSocket 기반 실시간 음성 인식
- **텍스트 유해성 분석(NLP)**: KoElectra/Kanana 모델 기반 유해 표현 판별
- **OCR 처리 (PaddleOCR)**: 서버 측 PaddleOCR로 이미지 텍스트 추출 (Task 28)
  - CPU 버전 및 GPU 버전 지원
  - GPU 사용 시 CUDA 12.x 환경 권장
  - Ubuntu 24.04 Server + CUDA 12.4/12.6 환경 테스트 완료

**주요 기능**:
- Git Sparse Checkout으로 server 폴더만 배포 (프로덕션 최적화)
- GPU 가속 PaddleOCR 지원
- systemd 서비스 자동 재시작
- Nginx WebSocket 프록시 설정

## 요구사항

### 시스템 요구사항

  - Ubuntu 20.04 LTS 이상 (권장: **Ubuntu 24.04 LTS**)
  - Python 3.12 이상
  - **RAM**:
      - 최소 2GB (단순 STT 중계만 수행 시)
      - **권장 4GB** (KoElectra 등 NLP 모델 로드 및 유해성 분석 수행 시)
      - **GPU 사용 시**: 8GB 이상 권장 (PaddleOCR GPU 메모리 사용)
  - 최소 10GB 디스크 공간 (가상환경, 로그, 모델 캐시 포함)
  - **GPU 사용 시**: NVIDIA GPU + CUDA 드라이버 (CUDA 12.x 권장)

### 네트워크 요구사항

  - 포트 8000 (FastAPI 서버, 내부용)
  - 포트 80/443 (Nginx 리버스 프록시, 외부 노출용)
  - Deepgram API 접근 가능 (아웃바운드 HTTPS/WSS)
  - HuggingFace Model Hub 접근 가능 (최초 모델 다운로드용)

## 의존성

  - **Python 3.12+** (venv312 가상환경 사용 필수)
  - FastAPI, Uvicorn, Gunicorn
  - systemd (서비스 관리)
  - Nginx (리버스 프록시)
  - [작업 20: FastAPI 기본 구조](./20-fastapi-setup.md)
  - [작업 24: 음성 STT API](./24-audio-stt-api.md)
  - [작업 28: PaddleOCR 서버 연동](./28-paddle-ocr-integration.md)
  - [작업 35: Deepgram 실시간 스트리밍](./35-deepgram-realtime-streaming.md)

## 배포 단계

### 0. SSH 접속 설정 (참고)

서버 접속을 위한 SSH 설정 예시:

```bash
# ~/.ssh/config 파일에 추가
Host Instance-Hear
  HostName 13.62.175.113
  IdentityFile ~/Downloads/hear_key.pem
  User ubuntu

# 접속
ssh Instance-Hear
```

### 1. 시스템 패키지 설치

```bash
# 시스템 업데이트
sudo apt update && sudo apt upgrade -y

# 이전 버전의 Python을 설치할 수 있는 저장소 추가
sudo add-apt-repository ppa:deadsnakes/ppa -y
sudo apt update

# Python 3.12 및 필수 도구 설치
sudo apt install -y \
    python3.12 \
    python3.12-venv \
    python3-pip \
    git \
    build-essential \
    curl \
    wget \
    nginx \
    swig

# GPU 사용 시 추가 의존성 (NVIDIA GPU)
# nvidia-smi 명령어로 GPU 확인 가능
# sudo apt install -y nvidia-driver-XXX  # CUDA 드라이버는 별도 설치 필요

# 방화벽 설정 (UFW 사용 시)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (Nginx)
sudo ufw allow 443/tcp   # HTTPS (Nginx)
# sudo ufw allow 8000/tcp  # FastAPI 직접 접근 필요 시에만 허용
sudo ufw enable
```

### 2. 프로젝트 배포 (Git Sparse Checkout)

**방법 A: server 폴더만 가져오기 (권장, 프로덕션 환경)**

```bash
# 프로젝트 디렉토리 생성
sudo mkdir -p /opt/harmful-expression-filter
sudo chown $USER:$USER /opt/harmful-expression-filter

# server 폴더만 가져오기 (Sparse Checkout)
cd /opt/harmful-expression-filter
git init
git remote add -f origin https://github.com/cccwon2/harmful-expression-filter

# 부분 체크아웃 활성화
git config core.sparseCheckout true

# 가져올 폴더 지정 (server 폴더만)
echo "server/" >> .git/info/sparse-checkout

# 코드 당겨오기 (Pull)
git pull origin main

# 확인: ls -l 을 입력했을 때 server 폴더 하나만 보이면 성공
ls -l
```

**방법 B: 전체 저장소 클론**

```bash
# 전체 저장소 클론
cd /opt/harmful-expression-filter
git clone https://github.com/cccwon2/harmful-expression-filter .
```

**방법 C: 로컬에서 server 폴더만 전송**

```bash
# 로컬에서 server 폴더만 전송
scp -r server/ user@server:/opt/harmful-expression-filter/
```

### 3. 가상환경 설정

```bash
cd /opt/harmful-expression-filter/server

# Python 3.12 가상환경 생성
python3.12 -m venv venv312

# 가상환경 활성화
source venv312/bin/activate

# pip 업그레이드
pip install --upgrade pip setuptools wheel
```

### 4. 의존성 설치

#### 4.1. CPU 버전 설치

```bash
# venv312 활성화 상태에서
cd /opt/harmful-expression-filter/server

# 시스템 의존성
sudo apt install -y \
    libopenblas-dev \
    liblapack-dev \
    libatlas-base-dev \
    gfortran

# 필수 도구 업그레이드
pip install --upgrade pip setuptools wheel

# CPU 버전 PyTorch 설치
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# 나머지 패키지 설치
pip install -r requirements.txt

# NumPy 버전 고정 (PaddleOCR 호환성)
pip install "numpy<2.0"

# 설치 확인
python -c "import fastapi; import uvicorn; import torch; print('✅ 설치 및 PyTorch 로드 완료')"
```

#### 4.2. GPU 버전 설치 (Ubuntu 24.04 Server + CUDA 12.x)

**⚠️ 중요**: GPU 사용 시 CUDA 드라이버가 설치되어 있어야 합니다. `nvidia-smi` 명령어로 확인하세요.

```bash
# venv312 활성화 상태에서
cd /opt/harmful-expression-filter/server

# 필수 도구 업그레이드
pip install --upgrade pip setuptools wheel

# CUDA 12.4용 PyTorch 설치 (시스템 드라이버가 CUDA 13.0이어도 PyTorch는 12.4 사용)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124

# PaddlePaddle GPU 설치 (CUDA 12.6)
pip install paddlepaddle-gpu==3.2.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/

# PyMuPDF 설치 (SWIG 필요, 이미 설치되어 있어야 함)
pip install pymupdf

# GPU 전용 requirements 파일로 나머지 패키지 설치
pip install -r requirements-gpu.txt

# NumPy 버전 고정 (PaddleOCR 호환성)
pip install "numpy<2.0"

# GPU 인식 확인
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'CUDA version: {torch.version.cuda}')"
python -c "import paddle; print(f'PaddlePaddle CUDA: {paddle.device.is_compiled_with_cuda()}')"
```

**참고**:
- CUDA 13 드라이버 사용 시에도 PyTorch는 `cu124` 인덱스 사용 권장 (안정성)
- PaddlePaddle은 `cu126` 인덱스 사용 (CUDA 12.6 호환)
- GPU 메모리가 부족할 경우 워커 수 조절 필요

### 5. 환경 변수 설정

```bash
# .env 파일 생성
cd /opt/harmful-expression-filter/server
nano .env
```

`.env` 파일 내용:

```env
# Deepgram API Key (필수)
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# 서버 설정
SERVER_URL=http://localhost:8000
HOST=0.0.0.0
PORT=8000

# 로깅 레벨
LOG_LEVEL=INFO

# [AI 모델 설정]

# 모델 타입 (koelectra, kanana)
# - koelectra: KoElectra 모델 사용 (빠른 추론, 경량) - 권장
# - kanana: Kanana Nano 모델 사용 (더 정확하지만 느림)
MODEL_TYPE=koelectra

# Base 모델 (Hugging Face 모델 이름)
# KoElectra 사용 시:
BASE_MODEL_NAME=skplanet/dialog-koelectra-small-discriminator
# Kanana 사용 시:
#BASE_MODEL_NAME=kakaocorp/kanana-nano-2.1b-instruct

# 학습된 LoRA 어댑터 경로 (server 폴더 기준 상대 경로)
# Base 모델만 사용하려면 비워두거나 주석 처리
#MODEL_PATH=models/kanana-lora-v1
MODEL_PATH=

# HuggingFace 캐시 디렉토리 (선택사항)
HF_HOME=/opt/harmful-expression-filter/server/models

# [PaddleOCR 설정] (GPU 사용 시)
# PADDLEOCR_USE_GPU=true   # GPU 가속 활성화 (기본값: false)
# PADDLEOCR_LANG=korean    # OCR 언어 설정 (기본값: korean)
```

```bash
# .env 파일 권한 설정 (보안)
chmod 600 .env
```

### 6. 데이터 디렉토리 및 모델 준비

#### 6.1. 디렉토리 생성

```bash
# 디렉토리 생성
mkdir -p /opt/harmful-expression-filter/server/models
mkdir -p /opt/harmful-expression-filter/server/data
mkdir -p /opt/harmful-expression-filter/server/logs
```

#### 6.2. 모델 준비

**방법 A: Hugging Face Hub에서 NLP 모델 다운로드**

서버 최초 시작 시 모델 다운로드로 인해 Systemd 타임아웃이 발생할 수 있으므로 미리 다운로드합니다.

```bash
# 가상환경 활성화 확인 (앞에 (venv312)이 보여야 함)
source venv312/bin/activate

# 디렉토리 생성
mkdir -p models logs

# KoElectra 모델 다운로드 (권장)
python -c "from transformers import AutoModelForSequenceClassification, AutoTokenizer; model_name='monologg/koelectra-base-v3-discriminator'; AutoTokenizer.from_pretrained(model_name); AutoModelForSequenceClassification.from_pretrained(model_name); print('✅ 모델 다운로드 완료')"

# 또는 .env에 설정된 모델 사용
# python -c "from transformers import AutoModelForSequenceClassification, AutoTokenizer; model_name='skplanet/dialog-koelectra-small-discriminator'; AutoTokenizer.from_pretrained(model_name); AutoModelForSequenceClassification.from_pretrained(model_name); print('✅ KoElectra 모델 다운로드 완료')"
```

**방법 B: PaddleOCR 모델 폴더 권한 설정 (GPU 사용 시)**

PaddleOCR은 모델을 `/var/www/.paddleocr` 또는 사용자 홈 디렉토리에 저장할 수 있습니다. www-data 사용자가 접근 가능하도록 권한을 설정합니다.

```bash
# PaddleOCR 모델 저장 폴더 생성
sudo mkdir -p /var/www/.paddleocr

# 소유권 변경 (www-data 사용자)
sudo chown -R www-data:www-data /var/www/.paddleocr

# 권한 설정
sudo chmod -R 755 /var/www/.paddleocr
```

**방법 B: 로컬 학습 모델 사용**

직접 학습한 모델을 사용하는 경우:

```bash
# 모델 폴더 구조 준비
# 예: /opt/harmful-expression-filter/server/models/your-custom-model/
mkdir -p /opt/harmful-expression-filter/server/models/your-custom-model

# 학습한 모델 파일 복사
# 필수 파일:
# - config.json
# - pytorch_model.bin (또는 model.safetensors)
# - tokenizer_config.json
# - vocab.txt
# - 기타 필요한 파일들

# .env 파일에 모델 경로 설정
# MODEL_PATH=models/your-custom-model
```

**모델 폴더 구조 예시**:
```
server/models/your-custom-model/
├── config.json
├── pytorch_model.bin (또는 model.safetensors)
├── tokenizer_config.json
├── vocab.txt
└── ... (기타 필요한 파일)
```

### 7. systemd 서비스 설정

```bash
# systemd 서비스 파일 생성
sudo nano /etc/systemd/system/harmful-filter-api.service
```

서비스 파일 내용:

```ini
[Unit]
Description=Harmful Expression Filter FastAPI Server
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/harmful-expression-filter/server
Environment="PATH=/opt/harmful-expression-filter/server/venv312/bin"
# .env 파일을 직접 로드하지 못할 경우 EnvironmentFile 사용 고려 또는 앱 내에서 로드
# 여기서는 앱 내 python-dotenv가 로드한다고 가정
ExecStart=/opt/harmful-expression-filter/server/venv312/bin/uvicorn \
    main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 4 \
    --log-level info

# WebSocket 사용 시 워커 수 주의: 
# 비동기 처리를 하므로 워커가 많지 않아도 되지만, 
# NLP 모델이 메모리를 많이 차지하므로 RAM 용량에 맞춰 워커 수 조절
# CPU 환경: 1~2개 권장
# GPU 환경: 4개 가능 (메모리 여유가 있을 때)

# 프로세스 관리 (죽으면 5초 뒤 자동 부활)
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=harmful-filter-api

# 리소스 제한 (선택사항)
LimitNOFILE=65536
# NLP 모델 사용 시 넉넉하게 설정
MemoryLimit=4G

[Install]
WantedBy=multi-user.target
```

```bash
# 권한 설정 수정 (www-data가 실행하므로)
sudo chown -R www-data:www-data /opt/harmful-expression-filter/server

# systemd 재로드 및 서비스 시작
sudo systemctl daemon-reload
sudo systemctl enable harmful-filter-api
sudo systemctl start harmful-filter-api

# 서비스 상태 확인
sudo systemctl status harmful-filter-api
```

### 8. Nginx 리버스 프록시 설정

```bash
# Nginx 설정 파일 생성
sudo nano /etc/nginx/sites-available/harmful-filter-api
```

Nginx 설정 내용:

```nginx
upstream fastapi_backend {
    server 127.0.0.1:8000;
    keepalive 32;
}

server {
    listen 80;
    # 아래 IP 주소를 본인 서버의 퍼블릭 IP로 변경하세요!
    server_name 13.62.175.113;  # 또는 도메인 이름

    # 로그 설정
    access_log /var/log/nginx/harmful-filter-api-access.log;
    error_log /var/log/nginx/harmful-filter-api-error.log;

    # 레거시 업로드 지원 (Task 35 이전 방식 호환용, WebSocket 사용 시 불필요하나 유지 권장)
    client_max_body_size 50M;

    # Task 35: 실시간 스트리밍을 위한 WebSocket 지원 (필수)
    location /ws/ {
        proxy_pass http://fastapi_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket 타임아웃 설정 (긴 오디오 세션 유지)
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # 일반 API 엔드포인트
    location / {
        proxy_pass http://fastapi_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 타임아웃 설정
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

```bash
# 심볼릭 링크 생성 및 Nginx 재시작
sudo ln -s /etc/nginx/sites-available/harmful-filter-api /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default  # 기본 설정 제거
sudo nginx -t  # 설정 검증
sudo systemctl restart nginx
```

### 9. SSL/TLS 설정 (Certbot)

```bash
# Certbot 설치
sudo apt install -y certbot python3-certbot-nginx

# SSL 인증서 발급
sudo certbot --nginx -d your-domain.com
```

### 10. 로깅 및 모니터링

```bash
# 로그 로테이션 설정
sudo nano /etc/logrotate.d/harmful-filter-api
```

내용:

```
/var/log/nginx/harmful-filter-api-*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 `cat /var/run/nginx.pid`
    endscript
}
```

## 프로덕션 실행 옵션: Gunicorn

대규모 트래픽 처리가 필요할 경우 Uvicorn 워커를 관리하는 Gunicorn을 사용합니다.

```bash
# Gunicorn 설치
pip install gunicorn

# 실행 테스트
gunicorn main:app \
    --workers 2 \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8000
```

> **주의**: NLP 모델(PyTorch/TensorFlow)을 사용하는 경우, 워커 수(`--workers`)를 늘리면 메모리 사용량이 급격히 증가합니다. (워커당 모델을 별도로 로드함). 메모리가 부족하다면 워커를 1\~2개로 제한하거나 `preload_app=True` 옵션(Gunicorn) 사용을 고려해야 하지만, PyTorch와 preload 옵션은 호환성 문제가 있을 수 있으므로 주의해야 합니다.

### 11. 서비스 확인 및 관리

#### 11.1. 서비스 상태 확인

```bash
# 서비스 상태 확인
sudo systemctl status harmful-filter-api

# 서비스 로그 실시간 확인 (Follow)
sudo journalctl -u harmful-filter-api -f

# 최근 로그 50줄만 보기
sudo journalctl -u harmful-filter-api -n 50 --no-pager

# 서비스 재시작
sudo systemctl restart harmful-filter-api

# 서비스 중지
sudo systemctl stop harmful-filter-api

# 서비스 시작
sudo systemctl start harmful-filter-api
```

#### 11.2. API 엔드포인트 테스트

```bash
# 헬스 체크 (로컬)
curl http://localhost:8000/health

# 헬스 체크 (외부 접근)
curl http://13.62.175.113/health

# API 문서 확인 (브라우저)
# http://13.62.175.113/docs
```

#### 11.3. Git 업데이트

```bash
# 프로젝트 폴더로 이동
cd /opt/harmful-expression-filter

# Git 설정 (필요 시)
git config --global --add safe.directory /opt/harmful-expression-filter

# 소유권 변경 (Git 작업용)
sudo chown -R ubuntu:ubuntu /opt/harmful-expression-filter

# 코드 업데이트
git pull origin main  # 또는 dev 브랜치

# 소유권 복원 (서비스 실행용)
sudo chown -R www-data:www-data /opt/harmful-expression-filter

# 서비스 재시작
sudo systemctl restart harmful-filter-api

# 로그 확인
sudo journalctl -u harmful-filter-api -f
```

#### 11.4. 가상환경 재생성 (필요 시)

```bash
# 프로젝트 폴더로 이동
cd /opt/harmful-expression-filter/server

# 기존 가상환경 삭제
rm -rf venv312

# Python 3.12로 가상환경 다시 생성
python3.12 -m venv venv312

# 가상환경 활성화
source venv312/bin/activate

# 필수 도구 업그레이드
pip install --upgrade pip setuptools wheel

# 의존성 재설치 (CPU 또는 GPU 버전 선택)
# CPU 버전:
# pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
# pip install -r requirements.txt

# GPU 버전:
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
pip install paddlepaddle-gpu==3.2.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/
pip install -r requirements-gpu.txt
pip install "numpy<2.0"

# 서비스 재시작
sudo systemctl restart harmful-filter-api
```

### 12. 문제 해결

#### 12.1. 서비스가 시작되지 않을 때

```bash
# 상세 로그 확인
sudo journalctl -u harmful-filter-api -n 100 --no-pager

# 가상환경 경로 확인
ls -la /opt/harmful-expression-filter/server/venv312/bin/uvicorn

# 권한 확인
ls -la /opt/harmful-expression-filter/server

# 환경 변수 확인
sudo cat /opt/harmful-expression-filter/server/.env
```

#### 12.2. GPU 인식 안 됨

```bash
# NVIDIA 드라이버 확인
nvidia-smi

# CUDA 버전 확인
nvidia-smi | grep "CUDA Version"

# Python에서 GPU 확인
source venv312/bin/activate
python -c "import torch; print(f'PyTorch CUDA: {torch.cuda.is_available()}')"
python -c "import paddle; print(f'PaddlePaddle CUDA: {paddle.device.is_compiled_with_cuda()}')"
```

#### 12.3. 포트 충돌

```bash
# 포트 8000 사용 확인
sudo lsof -i :8000

# Nginx 상태 확인
sudo systemctl status nginx
sudo nginx -t
```

#### 12.4. 모델 다운로드 실패

```bash
# HuggingFace 캐시 확인
ls -la /opt/harmful-expression-filter/server/models

# 모델 수동 다운로드
source venv312/bin/activate
python -c "from transformers import AutoModelForSequenceClassification, AutoTokenizer; model_name='skplanet/dialog-koelectra-small-discriminator'; AutoTokenizer.from_pretrained(model_name); AutoModelForSequenceClassification.from_pretrained(model_name); print('✅ 모델 다운로드 완료')"
```

#### 12.5. PaddleOCR 모델 폴더 권한 오류

```bash
# PaddleOCR 모델 폴더 권한 재설정
sudo mkdir -p /var/www/.paddleocr
sudo chown -R www-data:www-data /var/www/.paddleocr
sudo chmod -R 755 /var/www/.paddleocr
```

## 수락 기준

  - ✅ systemd 서비스를 통한 자동 시작 및 재시작 (Restart=always)
  - ✅ `/health` 엔드포인트 정상 응답
  - ✅ `/ws/audio` WebSocket 연결 및 Deepgram 중계 정상 작동
  - ✅ `/api/ocr` 및 `/api/ocr-and-analyze` 엔드포인트 정상 작동 (PaddleOCR)
  - ✅ Nginx 리버스 프록시 적용 및 WebSocket 헤더 처리 확인
  - ✅ 서버 재부팅 후 서비스 자동 복구 확인
  - ✅ GPU 사용 시 PaddleOCR GPU 가속 확인