# 서버 재시작 가이드

## 문제 상황

서버 로그에서 Whisper STT 초기화가 실패했습니다:
```
WARNING: [WARN] Whisper STT 초기화 실패: openai-whisper 패키지가 설치되어 있지 않습니다.
```

하지만 실제로는 venv에 whisper가 설치되어 있습니다.

## 해결 방법

서버를 재시작하면 해결될 것입니다. 서버가 올바른 venv를 사용하도록 해야 합니다.

### 방법 1: venv 활성화 후 서버 시작 (권장)

```powershell
cd server
.\venv\Scripts\Activate.ps1
python -m uvicorn main:app --reload
```

### 방법 2: venv Python 직접 사용

```powershell
cd server
.\venv\Scripts\python.exe -m uvicorn main:app --reload
```

## 확인 사항

서버 시작 후 다음 로그가 나타나야 합니다:

```
[INFO] ✅ Whisper STT Service initialized successfully
[INFO] STT Service: ✅ Loaded
```

만약 여전히 실패한다면:
1. venv에 whisper가 설치되어 있는지 확인:
   ```powershell
   .\venv\Scripts\pip.exe list | Select-String whisper
   ```

2. whisper 모델 로드 테스트:
   ```powershell
   .\venv\Scripts\python.exe -c "import whisper; model = whisper.load_model('base'); print('OK')"
   ```

