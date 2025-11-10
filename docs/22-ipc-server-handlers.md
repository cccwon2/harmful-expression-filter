# 작업 22: IPC 서버 핸들러

## 상태
🆕 미착수

## 개요
Electron 메인 프로세스가 FastAPI 서버와 통신하기 위한 IPC 핸들러를 설계하고 구현합니다. 텍스트 분석 요청을 전송하고, 응답을 렌더러로 전달하는 안정적이고 재시도 가능한 흐름을 마련합니다.

## 요구사항

### IPC 채널 설계
- [ ] `IPC_CHANNELS.SERVER_ANALYZE_TEXT` 등 명확한 채널 정의
- [ ] 요청/응답 페이로드 타입을 `electron/ipc/types.ts` 등에 명시
- [ ] 오류 코드/메시지를 표준화하여 렌더러에서 처리 가능하도록 설계

### 서버 통신
- [ ] Electron 메인 프로세스에서 `fetch` 또는 `axios`로 FastAPI 호출
- [ ] 비동기 요청 큐 또는 동시 실행 제한 고려
- [ ] 타임아웃/재시도/백오프 로직 포함

### 렌더러 전달
- [ ] 분석 결과를 `IPC_CHANNELS.OCR_RESULT` 혹은 신규 채널로 전파
- [ ] 오류 발생 시 사용자 알림 UI와 연계될 수 있는 데이터 구조 전달
- [ ] 진행 상태(로딩 등)를 렌더러에 브로드캐스트

## 의존성
- `docs/21-text-analysis-api.md`
- `docs/07-ipc-communication.md`
- `electron/ipc/channels.ts`, `electron/main.ts`

## 관련 파일
- `electron/ipc/channels.ts`
- `electron/ipc/serverHandlers.ts` (신규)
- `electron/main.ts`
- `renderer/src/state/server.ts`

## 구현 계획

### 1. 채널 및 타입 정의
```typescript
// electron/ipc/channels.ts
export const IPC_CHANNELS = {
  SERVER_ANALYZE_TEXT: 'server:analyze-text',
  SERVER_ANALYZE_RESULT: 'server:analyze-result',
  // ...
} as const;
```

### 2. 메인 프로세스 핸들러
```typescript
// electron/ipc/serverHandlers.ts
import { ipcMain } from 'electron';
import { requestTextAnalysis } from '../services/serverClient';

ipcMain.handle(IPC_CHANNELS.SERVER_ANALYZE_TEXT, async (_event, payload) => {
  return await requestTextAnalysis(payload);
});
```

### 3. 서버 클라이언트 유틸
```typescript
// electron/services/serverClient.ts
import fetch from 'node-fetch';

export async function requestTextAnalysis(payload) {
  const response = await fetch(`${API_BASE_URL}/api/v1/analyze/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    // TODO: 오류 변환 로직
  }
  return response.json();
}
```

## 수락 기준
- ✅ IPC 채널을 통해 FastAPI 호출이 정상 수행
- ✅ 응답/오류 데이터가 렌더러에서 처리 가능한 형태로 전달
- ✅ 타임아웃/재시도 로직이 기본 적용
- ✅ 단위 또는 통합 테스트로 주요 흐름 검증

## 테스트 방법
1. Electron 메인 프로세스 단위 테스트(예: `spectron`, `vitest` + `electron-mock-ipc`)로 핸들러 검증
2. 개발 모드에서 FastAPI 서버를 띄우고 렌더러에서 샘플 요청 실행
3. 서버가 꺼져 있을 때 오류 처리/재시도 동작 확인

## 다음 작업
- [작업 23: Electron 통합](./23-electron-integration.md)
- 오류 알림 UI 설계
- 서버 엔드포인트 인증/보안 강화 계획 수립

