# 작업 22: IPC 서버 핸들러

## 상태
✅ 완료

## 개요
Electron 메인 프로세스가 FastAPI 서버와 통신하기 위한 IPC 핸들러를 설계하고 구현합니다. 텍스트 분석 요청을 전송하고, 응답을 렌더러로 전달하는 안정적이고 재시도 가능한 흐름을 마련합니다.

## 요구사항

### IPC 채널 설계
- [x] `SERVER_CHANNELS`에 헬스 체크/텍스트 분석/키워드 채널 정의
- [x] 핸들러 반환 타입에 오류 객체 포함
- [ ] 공용 타입 선언 파일 분리는 향후 진행

### 서버 통신
- [x] Electron 메인 프로세스에서 `axios`로 FastAPI 호출
- [x] 타임아웃/오류 로그/핸들러 별 컨텍스트 메시지 포함
- [ ] 재시도/백오프 로직은 다음 단계에서 보강

### 렌더러 전달
- [x] IPC 핸들러가 분석 결과/오류 응답을 그대로 반환
- [ ] 렌더러 알림/로딩 상태 연동은 Renderer 통합(Task 23)에서 구현

## 의존성
- `docs/21-text-analysis-api.md`
- `docs/07-ipc-communication.md`
- `electron/ipc/channels.ts`, `electron/main.ts`

## 관련 파일
- `electron/ipc/channels.ts`
- `electron/ipc/serverHandlers.ts`
- `electron/main.ts`
- `renderer/src/state/server.ts` (향후 연동)

## 구현 계획

### 핵심 구현
```typescript
// electron/ipc/channels.ts
export const SERVER_CHANNELS = {
  HEALTH_CHECK: 'server:health-check',
  ANALYZE_TEXT: 'server:analyze-text',
  GET_KEYWORDS: 'server:get-keywords',
} as const;

// electron/ipc/serverHandlers.ts
ipcMain.handle(SERVER_CHANNELS.ANALYZE_TEXT, async (_event, text: string) => {
  if (!text?.trim()) {
    return {
      has_violation: false,
      confidence: 0,
      matched_keywords: [],
      method: 'empty_text',
      processing_time: 0,
    };
  }

  const response = await axios.post(`${SERVER_URL}/analyze`, { text, use_ai: false }, { timeout: 5000 });
  return response.data;
});

// electron/main.ts
app.whenReady().then(async () => {
  registerServerHandlers();
  const serverReady = await checkServerConnection();
  if (!serverReady) {
    console.warn('[Main] FastAPI server가 실행 중이 아닙니다. `server` 폴더에서 `python main.py`를 실행하세요.');
  }
  // ...
});
```

## 수락 기준
- ✅ IPC 채널을 통해 FastAPI `/health`, `/analyze`, `/keywords` 호출 성공
- ✅ 오류 발생 시 표준화된 객체 반환
- ✅ 메인 프로세스 시작 시 서버 연결 여부 로그 출력
- ⚠️ 재시도/백오프 및 렌더러 알림 로직은 후속 작업(Tasks 23+)에서 처리

## 테스트 방법
1. FastAPI 서버 실행 후 `npm run build:main`으로 타입 검사
2. `npm run dev` 실행 시 콘솔에 서버 핸들러 등록/연결 로그 확인
3. 이후 Task 23에서 렌더러를 통해 IPC 호출 확인 예정

## 다음 작업
- [작업 23: Electron 통합](./23-electron-integration.md)
- 오류 알림 UI 및 로딩 상태 연동
- 서버 인증/토큰 기반 호출 설계

