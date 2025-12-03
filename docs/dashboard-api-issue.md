# 대시보드 API 요청 문제 진단

## 문제 상황

브라우저에서 대시보드 링크는 열리지만, 서버 로그에 요청이 찍히지 않음

## 가능한 원인

### 1. 서버가 로컬호스트에서만 실행 중 ⚠️ (가장 가능성 높음)

**문제**: 
- 서버가 `http://127.0.0.1:8000` 또는 `http://localhost:8000`에서만 실행 중
- Vercel에 배포된 대시보드(`https://admin-dashboard-pi-seven-83.vercel.app/`)는 로컬호스트에 접근할 수 없음

**확인 방법**:
```bash
# 서버가 어떤 주소에서 실행 중인지 확인
netstat -ano | findstr :8000
# 또는
netstat -ano | findstr LISTENING
```

**해결 방법**:
1. 서버를 공개적으로 접근 가능한 URL로 배포 (Railway, Render, AWS 등)
2. 또는 로컬 개발 시 ngrok 같은 터널링 도구 사용

### 2. 대시보드의 내부 API route가 서버 URL을 잘못 설정

**확인 사항**:
- 대시보드의 Next.js API route (`/api/*`)가 올바른 서버 URL을 사용하는지
- 환경 변수 `NEXT_PUBLIC_API_URL`이 올바르게 설정되었는지

**Vercel 환경 변수 확인**:
- Vercel 대시보드 → 프로젝트 → Settings → Environment Variables
- `NEXT_PUBLIC_API_URL`이 설정되어 있는지 확인

### 3. 대시보드의 내부 API route가 아직 구현되지 않음

대시보드가 클라이언트에서 직접 FastAPI 서버를 호출하는 대신, Next.js API route를 통해 프록시하는 경우:
- `/api/logs` 같은 route가 구현되어 있는지 확인
- 해당 route가 FastAPI 서버로 요청을 보내는지 확인

### 4. 네트워크/방화벽 문제

- 서버 방화벽에서 외부 접근을 차단하고 있는지 확인
- 서버가 0.0.0.0이 아닌 127.0.0.1에서만 리스닝하고 있는지 확인

## 진단 방법

### 1. 서버 로그 확인

서버를 실행하고 대시보드를 열어보세요. 다음 로그가 출력되어야 합니다:

```
[Health] 📥 요청 수신
[Health] 📋 요청 URL: http://...
[Health] 📋 Origin: https://admin-dashboard-pi-seven-83.vercel.app

[Admin/Logs] 📥 요청 수신: limit=20, offset=0, only_harmful=False
[Admin/Logs] 📋 요청 URL: http://...
```

**로그가 없다면**: 대시보드의 내부 API route가 서버에 요청을 보내지 못하고 있음

### 2. 브라우저 개발자 도구 확인

대시보드를 열고 F12를 눌러 개발자 도구를 엽니다:

1. **Network 탭**:
   - `/api/logs` 또는 `/admin/logs` 요청이 있는지 확인
   - 요청 URL 확인
   - 응답 상태 코드 확인 (404, 500, CORS 에러 등)

2. **Console 탭**:
   - JavaScript 에러 확인
   - API 호출 관련 에러 메시지 확인

### 3. 서버 엔드포인트 직접 테스트

브라우저에서 직접 접근해보세요:

```
http://127.0.0.1:8000/health
http://127.0.0.1:8000/admin/logs?limit=10
```

**로컬에서 접근 가능하지만 Vercel에서 접근 불가능하다면**: 서버가 로컬호스트에서만 실행 중

## 해결 방법

### 방법 1: 서버를 공개적으로 접근 가능하게 배포 (권장)

서버를 Railway, Render, AWS 등에 배포하여 공개 URL 제공

### 방법 2: 로컬 개발 시 ngrok 사용

```bash
# ngrok 설치 후
ngrok http 8000
# 생성된 공개 URL을 대시보드 환경 변수에 설정
```

### 방법 3: 대시보드의 내부 API route 확인

대시보드 코드에서:
- `/api/logs` route가 FastAPI 서버로 요청을 보내는지 확인
- 올바른 서버 URL을 사용하는지 확인

## 현재 서버 설정

- **CORS**: 모든 도메인 허용 (`allow_origins=["*"]`)
- **로깅**: 모든 엔드포인트에 요청 로깅 추가됨
- **엔드포인트**: `/health`, `/admin/logs` 등

## 다음 단계

1. 서버를 실행하고 로그 확인
2. 브라우저 개발자 도구에서 Network 탭 확인
3. 서버가 로컬호스트에서만 실행 중인지 확인
4. 필요시 서버를 공개적으로 접근 가능하게 배포

