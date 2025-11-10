# 작업 23: Electron 통합

## 상태
✅ 완료 (Preload API & 렌더러 테스트 UI 구성)

## 개요
Electron 메인/렌더러 프로세스와 FastAPI 서버 간의 데이터 흐름을 연결하여 end-to-end 파이프라인을 완성합니다. OCR → 서버 분석 → UI 반영으로 이어지는 전체 시나리오를 검증 가능한 상태로 만듭니다.

## 요구사항

### 데이터 흐름
- [ ] OCR/STT 결과를 IPC를 통해 서버 분석 요청으로 전달 (Task 24 이후 완료 예정)
- [x] 렌더러에서 서버 API 호출을 직접 검증할 수 있는 개발용 테스트 UI 추가
- [ ] 로딩/결과/오류 상태 전환을 UI 컴포넌트와 연계 (Renderer 통합 단계에서 확장)

### 환경 구성
- [ ] 개발 모드에서 FastAPI 서버 주소를 `.env` 또는 설정 파일로 관리
- [ ] 패키징 시 서버 호스트 설정(로컬/원격)에 대한 전략 문서화
- [ ] 서버 미가용 시 폴백 전략(메시지 표시, 재시도 버튼 등) 마련

### 개발/디버깅 편의
- [x] Preload에서 서버 API 래퍼 노출 및 로깅 보강
- [x] Renderer 테스트 패널에서 IPC 호출 결과를 즉시 확인 가능
- [ ] 목업 서버 또는 샘플 응답 데이터를 통한 빠른 테스트 경로 확보

## 의존성
- `docs/14-monitoring-ocr.md`
- `docs/21-text-analysis-api.md`
- `docs/22-ipc-server-handlers.md`

## 관련 파일
- `electron/preload.ts`
- `renderer/src/global.d.ts`
- `renderer/src/components/ServerTest.tsx`
- `renderer/src/App.tsx`

## 구현 계획

### 1. Preload API 확장
```typescript
// electron/preload.ts
contextBridge.exposeInMainWorld('api', {
  // ... 기존 API ...
  server: {
    healthCheck: () => ipcRenderer.invoke(SERVER_CHANNELS.HEALTH_CHECK),
    analyzeText: (text: string) => ipcRenderer.invoke(SERVER_CHANNELS.ANALYZE_TEXT, text),
    getKeywords: () => ipcRenderer.invoke(SERVER_CHANNELS.GET_KEYWORDS),
  },
});
```

### 2. 글로벌 타입 정의
```typescript
// renderer/src/global.d.ts
interface ServerAPI {
  healthCheck: () => Promise<ServerHealthResponse | ServerErrorResponse>;
  analyzeText: (text: string) => Promise<ServerAnalyzeResponse | ServerErrorResponse>;
  getKeywords: () => Promise<ServerKeywordsResponse | ServerErrorResponse>;
}

declare global {
  interface Window {
    api: {
      // ... 기존 API ...
      server: ServerAPI;
    };
  }
}
```

### 3. 서버 테스트 컴포넌트
```typescript
// renderer/src/components/ServerTest.tsx
export const ServerTest: React.FC = () => {
  const [healthStatus, setHealthStatus] = useState('');
  const [testText, setTestText] = useState('');
  const [analyzeResult, setAnalyzeResult] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);

  const handleHealthCheck = async () => {
    const result = await window.api.server.healthCheck();
    // ... 결과 처리 ...
  };

  const handleAnalyze = async () => {
    const result = await window.api.server.analyzeText(testText);
    // ... 결과 처리 ...
  };

  const handleGetKeywords = async () => {
    const result = await window.api.server.getKeywords();
    // ... 결과 처리 ...
  };

  return (
    <div>
      {/* 헬스 체크, 텍스트 분석, 키워드 조회 UI */}
    </div>
  );
};
```

### 4. App 통합
```typescript
// renderer/src/App.tsx
import { ServerTest } from './components/ServerTest';

export const App: React.FC = () => {
  return (
    <div>
      {/* 기존 헤더 */}
      <ServerTest />
    </div>
  );
};
```

## 수락 기준
- ✅ 렌더러에서 서버 API(헬스 체크, 텍스트 분석, 키워드 조회)를 호출해 결과를 확인할 수 있음
- ✅ Preload에서 서버 IPC 채널을 노출하고 타입을 통해 안전하게 접근
- ✅ `npm run typecheck`, `npm run build:main` 통과
- ⚠️ OCR→서버→UI 자동 플로우는 Task 24 이후 연동 예정

## 테스트 방법
1. FastAPI 서버 실행 후 `npm run typecheck` / `npm run build:main`으로 타입 및 빌드 검증
2. `npm run dev` 실행 후 Renderer에서 `ServerTest` 패널 확인
3. 버튼을 통해 헬스 체크, 텍스트 분석, 키워드 조회가 정상 동작하는지 확인
4. 콘솔에서 IPC 로그(`서버 헬스 체크 성공`, `텍스트 분석 완료`, `키워드 로드 완료`) 확인

## 다음 작업
- [작업 24: 음성 STT API](./24-audio-stt-api.md)
- 렌더러 UI에 로딩/오류 표시와 툴팁 적용
- 서버 주소 환경변수 및 패키징 전략 정리

