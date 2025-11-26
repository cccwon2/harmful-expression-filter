# 작업 37: Ubuntu 서버 FastAPI 배포

## 상태

🔄 진행 중

## 개요

FastAPI 백엔드 서버를 Ubuntu 서버에 프로덕션 환경으로 배포합니다. systemd를 통한 자동 시작, Nginx 리버스 프록시 설정, 로깅 및 모니터링 구성을 포함합니다.

> **참고**: [작업 34: Windows OCR 성능 최적화]에 따라 OCR 처리는 클라이언트(Electron/Windows)에서 수행됩니다. 따라서 이 서버는 주로 **실시간 STT 중계(Deepgram)** 및 **텍스트 유해성 분석(NLP)** 역할을 담당합니다.

## 요구사항

### 시스템 요구사항

  - Ubuntu 20.04 LTS 이상 (권장: Ubuntu 24.04 LTS)
  - Python 3.12 이상
  - **RAM**:
      - 최소 2GB (단순 STT 중계만 수행 시)
      - **권장 4GB** (KoELECTRA 등 NLP 모델 로드 및 유해성 분석 수행 시)
  - 최소 10GB 디스크 공간 (가상환경, 로그, 모델 캐시 포함)

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
  - [작업 20: FastAPI 기본 구조](https://www.google.com/search?q=./20-fastapi-setup.md)
  - [작업 24: 음성 STT API](https://www.google.com/search?q=./24-audio-stt-api.md)
  - [작업 35: Deepgram 실시간 스트리밍](https://www.google.com/search?q=./35-deepgram-realtime-streaming.md)

## 배포 단계

### 1. 시스템 패키지 설치

```bash
# 시스템 업데이트
sudo apt update && sudo apt upgrade -y

# 필수 패키지 설치
sudo apt install -y \
    python3.12 \
    python3.12-venv \
    python3-pip \
    git \
    build-essential \
    curl \
    wget

# Nginx 설치
sudo apt install -y nginx

# 방화벽 설정 (UFW 사용 시)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (Nginx)
sudo ufw allow 443/tcp   # HTTPS (Nginx)
# sudo ufw allow 8000/tcp  # FastAPI 직접 접근 필요 시에만 허용
sudo ufw enable
```

### 2. 프로젝트 배포

```bash
# 프로젝트 디렉토리 생성
sudo mkdir -p /opt/harmful-expression-filter
sudo chown $USER:$USER /opt/harmful-expression-filter

# Git 저장소 클론
cd /opt/harmful-expression-filter
git clone <repository-url> .

# 또는 로컬에서 전송
# scp -r server/ user@server:/opt/harmful-expression-filter/
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

```bash
# venv312 활성화 상태에서
cd /opt/harmful-expression-filter/server

# 시스템 의존성 (PyTorch/KoELECTRA 등 NLP 라이브러리 구동에 필요)
# 주의: OCR 관련 의존성은 제거되었으나, PyTorch가 BLAS/LAPACK을 사용할 수 있음
sudo apt install -y \
    libopenblas-dev \
    liblapack-dev \
    libatlas-base-dev \
    gfortran

# Python 의존성 설치
pip install -r requirements.txt

# 설치 확인
python -c "import fastapi; import uvicorn; import torch; print('✅ 설치 및 PyTorch 로드 완료')"
```

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

# 모델 타입 (koelectra, kanana 기본값)
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

#### 6.2. 모델 준비 (두 가지 방법 중 선택)

**방법 A: Hugging Face Hub에서 모델 다운로드**

NLP 모델을 사용하는 경우, 서버 최초 시작 시 모델 다운로드로 인해 Systemd 타임아웃이 발생할 수 있습니다. 미리 다운로드합니다.

```bash
# 가상환경 활성화
source venv312/bin/activate

# 유해 표현 감지 모델 사전 캐싱
# .env 파일의 MODEL_TYPE과 BASE_MODEL_NAME에 맞게 모델을 다운로드합니다
# KoElectra 사용 시:
python -c "from transformers import AutoModelForSequenceClassification, AutoTokenizer; model_name='skplanet/dialog-koelectra-small-discriminator'; AutoTokenizer.from_pretrained(model_name); AutoModelForSequenceClassification.from_pretrained(model_name); print('✅ KoElectra 모델 다운로드 완료')"

# Kanana 사용 시:
# python -c "from transformers import AutoModelForSequenceClassification, AutoTokenizer; model_name='kakaocorp/kanana-nano-2.1b-instruct'; AutoTokenizer.from_pretrained(model_name); AutoModelForSequenceClassification.from_pretrained(model_name, num_labels=2); print('✅ Kanana 모델 다운로드 완료')"
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
    --workers 2 \
    --log-level info \
    --access-log \
    --no-reload

# WebSocket 사용 시 워커 수 주의: 
# 비동기 처리를 하므로 워커가 많지 않아도 되지만, 
# NLP 모델이 메모리를 많이 차지하므로 RAM 용량에 맞춰 워커 수 조절 (보통 1~2개 권장)

# 프로세스 관리
Restart=always
RestartSec=10
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
    server_name your-domain.com;  # 또는 IP 주소

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

## 수락 기준

  - ✅ systemd 서비스를 통한 자동 시작 및 재시작 (Restart=always)
  - ✅ `/health` 엔드포인트 정상 응답
  - ✅ `/ws/audio` WebSocket 연결 및 Deepgram 중계 정상 작동
  - ✅ Nginx 리버스 프록시 적용 및 WebSocket 헤더 처리 확인
  - ✅ 서버 재부팅 후 서비스 자동 복구 확인