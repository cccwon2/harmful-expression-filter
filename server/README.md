# Server - FastAPI Backend

FastAPI 기반 백엔드 서버입니다.

## ⚠️ 중요: 가상환경 관리

**server 폴더의 모든 Python 라이브러리는 `venv310` 가상환경에서만 관리합니다.**

다른 가상환경(예: `venv`)을 사용하지 마세요. 모든 의존성은 `venv310`에만 설치합니다.

## 환경 설정

### 가상환경 활성화

```bash
# Windows
venv310\Scripts\activate

# Linux/Mac
source venv310/bin/activate
```

### 의존성 설치

```bash
# venv310 활성화 후
.\venv310\Scripts\python.exe -m pip install -r requirements.txt

# 또는 활성화된 상태에서
pip install -r requirements.txt
```

### 서버 실행

```bash
# 방법 1: 가상환경 활성화 후 실행 (권장)
venv310\Scripts\activate
uvicorn main:app --reload

# 방법 2: 가상환경 Python 직접 사용 (Windows)
.\venv310\Scripts\python.exe -m uvicorn main:app --reload

# 방법 3: 가상환경 Python 직접 사용 (Linux/Mac)
venv310/bin/python -m uvicorn main:app --reload
```

## 환경 변수

`.env` 파일을 생성하여 다음 변수를 설정할 수 있습니다:

```env
# 서버 URL (Electron에서 사용)
SERVER_URL=http://127.0.0.1:8000

# Deepgram API Key (STT용)
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# 로컬 모델 경로 (선택사항)
# 설정하지 않으면 Hugging Face Hub에서 기본 모델을 다운로드합니다
# 상대 경로: models/your-custom-model
# 절대 경로: /path/to/your/model
MODEL_PATH=models/your-custom-model
```

### 로컬 모델 사용

직접 학습한 모델을 사용하려면:

1. **모델 폴더 구조 준비**:
   ```
   server/models/your-custom-model/
   ├── config.json
   ├── pytorch_model.bin (또는 model.safetensors)
   ├── tokenizer_config.json
   ├── vocab.txt
   └── ... (기타 필요한 파일)
   ```

2. **환경 변수 설정**:
   ```env
   MODEL_PATH=models/your-custom-model
   ```

3. **서버 재시작**: 모델은 서버 시작 시 로드됩니다.

**참고**: 
- `MODEL_PATH`가 설정되지 않으면 기본값으로 Hugging Face Hub의 `monologg/koelectra-base-v3-discriminator` 모델을 사용합니다.
- 로컬 모델 경로는 상대 경로(server 폴더 기준) 또는 절대 경로 모두 지원합니다.

## 주요 기능

- 텍스트 유해성 분석 API (`/analyze`)
- 음성 STT API (WebSocket: `/ws/audio`) - Deepgram 사용

## OCR 처리

**OCR은 Electron에서 Windows SDK OCR을 직접 사용합니다.**
- C# COM Bridge (`dotnet/OnVoiceComBridge/Startup.cs`)를 통해 Windows.Media.Ocr API 사용
- 서버의 `/api/ocr` 엔드포인트는 현재 사용되지 않음 (하위 호환성을 위해 유지)

## API 문서

서버 실행 후 다음 URL에서 API 문서를 확인할 수 있습니다:
- Swagger UI: http://127.0.0.1:8000/docs
- ReDoc: http://127.0.0.1:8000/redoc

