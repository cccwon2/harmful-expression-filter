# 작업 37: Ubuntu 서버 FastAPI 배포

## 상태
🔄 진행 중

## 개요
FastAPI 백엔드 서버를 Ubuntu 서버에 프로덕션 환경으로 배포합니다. systemd를 통한 자동 시작, Nginx 리버스 프록시 설정, 로깅 및 모니터링 구성을 포함합니다.

## 요구사항

### 시스템 요구사항
- Ubuntu 20.04 LTS 이상 (권장: Ubuntu 22.04 LTS)
- Python 3.10 이상
- 최소 2GB RAM (KoELECTRA 모델 로드 시 4GB 권장)
- 최소 10GB 디스크 공간 (모델 파일 포함)

### 네트워크 요구사항
- 포트 8000 (FastAPI 서버, 내부용)
- 포트 80/443 (Nginx 리버스 프록시, 선택사항)
- Deepgram API 접근 가능 (아웃바운드 HTTPS)

## 의존성
- **Python 3.10+** (venv310 가상환경 사용 필수)
- FastAPI, Uvicorn
- systemd (서비스 관리)
- Nginx (리버스 프록시, 선택사항)
- [작업 20: FastAPI 기본 구조](./20-fastapi-setup.md)
- [작업 24: 음성 STT API](./24-audio-stt-api.md)
- [작업 35: Deepgram 실시간 스트리밍](./35-deepgram-realtime-streaming.md)

## 배포 단계

### 1. 시스템 패키지 설치

```bash
# 시스템 업데이트
sudo apt update && sudo apt upgrade -y

# 필수 패키지 설치
sudo apt install -y \
    python3.10 \
    python3.10-venv \
    python3-pip \
    git \
    build-essential \
    curl \
    wget

# Nginx 설치 (리버스 프록시 사용 시)
sudo apt install -y nginx

# 방화벽 설정 (UFW 사용 시)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (Nginx)
sudo ufw allow 443/tcp   # HTTPS (Nginx)
sudo ufw allow 8000/tcp  # FastAPI (내부용, 선택사항)
sudo ufw enable
```

### 2. 프로젝트 배포

```bash
# 프로젝트 디렉토리 생성
sudo mkdir -p /opt/harmful-expression-filter
sudo chown $USER:$USER /opt/harmful-expression-filter

# Git 저장소 클론 (또는 파일 업로드)
cd /opt/harmful-expression-filter
git clone <repository-url> .

# 또는 SCP를 통한 파일 전송
# scp -r server/ user@server:/opt/harmful-expression-filter/
```

### 3. 가상환경 설정

```bash
cd /opt/harmful-expression-filter/server

# Python 3.10 가상환경 생성
python3.10 -m venv venv310

# 가상환경 활성화
source venv310/bin/activate

# pip 업그레이드
pip install --upgrade pip setuptools wheel
```

### 4. 의존성 설치

```bash
# venv310 활성화 상태에서
cd /opt/harmful-expression-filter/server

# 시스템 의존성 (PyTorch 등 빌드에 필요)
sudo apt install -y \
    libopenblas-dev \
    liblapack-dev \
    libatlas-base-dev \
    gfortran

# Python 의존성 설치
pip install -r requirements.txt

# 설치 확인
python -c "import fastapi; import uvicorn; print('✅ 설치 완료')"
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

# 모델 경로 (선택사항)
MODEL_CACHE_DIR=/opt/harmful-expression-filter/server/models
```

```bash
# .env 파일 권한 설정 (보안)
chmod 600 .env
```

### 6. 데이터 디렉토리 준비

```bash
# 키워드 파일 확인
ls -la /opt/harmful-expression-filter/server/data/bad_words.json

# 모델 디렉토리 생성 (필요시)
mkdir -p /opt/harmful-expression-filter/server/models
mkdir -p /opt/harmful-expression-filter/server/audio
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
Environment="PATH=/opt/harmful-expression-filter/server/venv310/bin"
ExecStart=/opt/harmful-expression-filter/server/venv310/bin/uvicorn \
    main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 2 \
    --log-level info \
    --access-log \
    --no-reload

# 프로세스 관리
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=harmful-filter-api

# 리소스 제한 (선택사항)
LimitNOFILE=65536
MemoryLimit=4G

[Install]
WantedBy=multi-user.target
```

```bash
# systemd 재로드 및 서비스 시작
sudo systemctl daemon-reload
sudo systemctl enable harmful-filter-api
sudo systemctl start harmful-filter-api

# 서비스 상태 확인
sudo systemctl status harmful-filter-api

# 로그 확인
sudo journalctl -u harmful-filter-api -f
```

### 8. Nginx 리버스 프록시 설정 (선택사항)

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

    # 클라이언트 최대 바디 크기 (오디오 업로드용)
    client_max_body_size 50M;

    # WebSocket 지원
    location /ws/ {
        proxy_pass http://fastapi_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket 타임아웃 설정
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
sudo nginx -t  # 설정 검증
sudo systemctl restart nginx
```

### 9. SSL/TLS 설정 (Let's Encrypt, 선택사항)

```bash
# Certbot 설치
sudo apt install -y certbot python3-certbot-nginx

# SSL 인증서 발급
sudo certbot --nginx -d your-domain.com

# 자동 갱신 테스트
sudo certbot renew --dry-run
```

### 10. 로깅 및 모니터링 설정

```bash
# 로그 로테이션 설정
sudo nano /etc/logrotate.d/harmful-filter-api
```

로그 로테이션 설정:
```
/var/log/harmful-filter-api/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        systemctl reload harmful-filter-api > /dev/null 2>&1 || true
    endscript
}
```

## 프로덕션 실행 옵션

### Uvicorn 워커 설정

프로덕션 환경에서는 여러 워커를 사용하여 성능을 향상시킬 수 있습니다:

```bash
# CPU 코어 수 확인
nproc

# 워커 수 설정 (일반적으로 CPU 코어 수 * 2 + 1)
# 예: 4코어 → 9 워커
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 9
```

### Gunicorn + Uvicorn Workers (고성능 옵션)

```bash
# Gunicorn 설치
pip install gunicorn

# Gunicorn으로 실행 (Uvicorn 워커 사용)
gunicorn main:app \
    --workers 4 \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8000 \
    --access-logfile - \
    --error-logfile - \
    --log-level info
```

systemd 서비스 파일에서 Gunicorn 사용 시:
```ini
ExecStart=/opt/harmful-expression-filter/server/venv310/bin/gunicorn \
    main:app \
    --workers 4 \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8000 \
    --access-logfile /var/log/harmful-filter-api/access.log \
    --error-logfile /var/log/harmful-filter-api/error.log \
    --log-level info
```

## 보안 고려사항

### 1. 방화벽 설정
```bash
# UFW 방화벽 활성화
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### 2. CORS 설정 (프로덕션)

`server/main.py`에서 CORS 설정을 프로덕션 환경에 맞게 수정:

```python
# 개발 환경
# allow_origins=["*"]

# 프로덕션 환경
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://your-domain.com",
        "https://app.your-domain.com",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
```

### 3. API 키 보안
- `.env` 파일 권한: `chmod 600 .env`
- 환경 변수는 systemd 서비스 파일에서 직접 설정 가능:
  ```ini
  Environment="DEEPGRAM_API_KEY=your_key_here"
  ```

### 4. 사용자 권한
```bash
# 전용 사용자 생성 (선택사항)
sudo useradd -r -s /bin/false harmful-filter
sudo chown -R harmful-filter:harmful-filter /opt/harmful-expression-filter
```

## 테스트 방법

### 1. 서비스 상태 확인
```bash
# systemd 서비스 상태
sudo systemctl status harmful-filter-api

# 포트 리스닝 확인
sudo netstat -tlnp | grep 8000
# 또는
sudo ss -tlnp | grep 8000
```

### 2. 헬스 체크
```bash
# 로컬에서 테스트
curl http://localhost:8000/health

# 외부에서 테스트 (Nginx 사용 시)
curl http://your-domain.com/health
```

### 3. API 엔드포인트 테스트
```bash
# 키워드 목록 조회
curl http://localhost:8000/keywords

# 텍스트 분석
curl -X POST http://localhost:8000/analyze \
    -H "Content-Type: application/json" \
    -d '{"text": "테스트 텍스트"}'
```

### 4. WebSocket 연결 테스트
```bash
# wscat 설치
npm install -g wscat

# WebSocket 연결 테스트
wscat -c ws://localhost:8000/ws/audio
```

## 모니터링 및 유지보수

### 로그 확인
```bash
# systemd 로그
sudo journalctl -u harmful-filter-api -f

# Nginx 로그
sudo tail -f /var/log/nginx/harmful-filter-api-access.log
sudo tail -f /var/log/nginx/harmful-filter-api-error.log
```

### 서비스 관리
```bash
# 서비스 시작
sudo systemctl start harmful-filter-api

# 서비스 중지
sudo systemctl stop harmful-filter-api

# 서비스 재시작
sudo systemctl restart harmful-filter-api

# 서비스 상태 확인
sudo systemctl status harmful-filter-api

# 서비스 비활성화 (부팅 시 자동 시작 안 함)
sudo systemctl disable harmful-filter-api
```

### 성능 모니터링
```bash
# CPU/메모리 사용량 확인
top -p $(pgrep -f "uvicorn main:app")

# 또는 htop 사용
sudo apt install htop
htop
```

## 트러블슈팅

### 문제: 서비스가 시작되지 않음
```bash
# 로그 확인
sudo journalctl -u harmful-filter-api -n 50

# 일반적인 원인:
# 1. .env 파일 누락 또는 잘못된 경로
# 2. 포트 8000이 이미 사용 중
# 3. 가상환경 경로 오류
# 4. 의존성 설치 누락
```

### 문제: WebSocket 연결 실패
- Nginx 설정에서 WebSocket 프록시 설정 확인
- 방화벽에서 포트 8000 허용 확인
- Deepgram API 키 확인

### 문제: 모델 로드 실패
```bash
# 모델 디렉토리 권한 확인
ls -la /opt/harmful-expression-filter/server/models

# 디스크 공간 확인
df -h

# 메모리 확인
free -h
```

## 수락 기준
- ✅ systemd 서비스를 통한 자동 시작 및 재시작
- ✅ `/health` 엔드포인트가 정상 응답
- ✅ WebSocket 연결이 정상 작동
- ✅ Nginx 리버스 프록시 설정 (선택사항)
- ✅ 로그가 정상적으로 기록됨
- ✅ 서버 재부팅 후 자동 시작 확인

## 다음 작업
- [작업 38: 모니터링 대시보드 구축](./38-monitoring-dashboard.md) (예정)
- [작업 39: 백업 및 복구 전략](./39-backup-recovery.md) (예정)
- Docker 컨테이너화 (선택사항)
- Kubernetes 배포 (선택사항)

## 참고 자료
- [FastAPI 공식 문서 - 배포](https://fastapi.tiangolo.com/deployment/)
- [Uvicorn 설정 가이드](https://www.uvicorn.org/settings/)
- [systemd 서비스 관리](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [Nginx 리버스 프록시](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)

