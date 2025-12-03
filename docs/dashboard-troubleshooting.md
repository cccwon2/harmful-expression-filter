# 대시보드 데이터 로드 문제 해결 가이드

## 문제 상황

대시보드(https://admin-dashboard-pi-seven-83.vercel.app/)에서 데이터를 가져오지 못하는 경우

## 가능한 원인

### 1. 서버가 실행 중이지 않음
- **확인 방법**: `http://127.0.0.1:8000/health` 접속
- **해결**: 서버를 실행하세요

### 2. 서버가 로컬호스트에서만 실행 중
- **문제**: Vercel에 배포된 대시보드는 로컬호스트에 접근할 수 없음
- **해결**: 서버를 공개적으로 접근 가능한 URL로 배포하거나, 대시보드의 내부 API route가 올바른 서버 URL을 사용하는지 확인

### 3. 대시보드의 내부 API route 문제
- **확인**: 대시보드의 Next.js API route (`/api/*`)가 올바른 서버 URL을 사용하는지 확인
- **환경 변수**: `NEXT_PUBLIC_API_URL`이 올바르게 설정되었는지 확인

### 4. CORS 문제
- **현재 설정**: `allow_origins=["*"]` (모든 도메인 허용)
- **확인**: 서버 로그에서 CORS 관련 에러 확인

## 디버깅 방법

### 1. 서버 로그 확인

서버를 실행하고 대시보드를 열면 다음과 같은 로그가 출력됩니다:

```
[Admin/Logs] 📥 요청 수신: limit=20, offset=0, only_harmful=False
[Admin/Logs] 📋 요청 헤더: {...}
[Admin/Logs] 📋 Origin: https://admin-dashboard-pi-seven-83.vercel.app
[Admin/Logs] 🔍 DB 쿼리 실행 중...
[Admin/Logs] ✅ 로그 조회 성공: X개 로그 반환
```

**로그가 없다면**: 대시보드의 내부 API route가 서버에 요청을 보내지 못하고 있음

### 2. 서버 엔드포인트 직접 테스트

```bash
# 서버가 실행 중인지 확인
curl http://127.0.0.1:8000/health

# 로그 엔드포인트 테스트
curl "http://127.0.0.1:8000/admin/logs?limit=10&offset=0"
```

### 3. 대시보드 브라우저 콘솔 확인

대시보드를 열고 브라우저 개발자 도구(F12)에서:
- **Console 탭**: JavaScript 에러 확인
- **Network 탭**: API 요청이 실패하는지 확인
  - 요청 URL 확인
  - 응답 상태 코드 확인
  - CORS 에러 확인

### 4. 대시보드의 내부 API route 확인

대시보드가 Next.js API route를 사용한다면:
- `/api/logs` 같은 route가 FastAPI 서버로 프록시 요청을 보내는지 확인
- 환경 변수 `NEXT_PUBLIC_API_URL`이 올바른지 확인

## 해결 방법

### 방법 1: 서버를 공개적으로 접근 가능하게 배포

서버를 공개 URL로 배포 (예: Railway, Render, AWS 등)

### 방법 2: 대시보드의 내부 API route 수정

대시보드의 Next.js API route에서 올바른 서버 URL을 사용하도록 수정

### 방법 3: 로컬 개발 환경 설정

로컬에서 개발할 때는:
- 서버: `http://127.0.0.1:8000`
- 대시보드: `http://localhost:3000`
- 환경 변수: `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000`

## 현재 서버 설정

- **CORS**: 모든 도메인 허용 (`allow_origins=["*"]`)
- **엔드포인트**: `/admin/logs` (인증 없음)
- **로깅**: 요청 정보 자동 로깅

## 다음 단계

1. 서버를 실행하고 로그 확인
2. 대시보드를 열고 브라우저 콘솔 확인
3. 서버 로그에서 요청이 오는지 확인
4. 요청이 없다면 대시보드의 내부 API route 확인

