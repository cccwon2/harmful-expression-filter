# 작업 23: Electron 통합

## 상태
🆕 미착수

## 개요
Electron 메인/렌더러 프로세스와 FastAPI 서버 간의 데이터 흐름을 연결하여 end-to-end 파이프라인을 완성합니다. OCR → 서버 분석 → UI 반영으로 이어지는 전체 시나리오를 검증 가능한 상태로 만듭니다.

## 요구사항

### 데이터 흐름
- [ ] OCR/STT 결과를 IPC를 통해 서버 분석 요청으로 전달
- [ ] FastAPI 응답을 렌더러 상태 관리 스토어에 반영
- [ ] 로딩/결과/오류 상태 전환을 UI 컴포넌트와 연계

### 환경 구성
- [ ] 개발 모드에서 FastAPI 서버 주소를 `.env` 또는 설정 파일로 관리
- [ ] 패키징 시 서버 호스트 설정(로컬/원격)에 대한 전략 문서화
- [ ] 서버 미가용 시 폴백 전략(메시지 표시, 재시도 버튼 등) 마련

### 개발/디버깅 편의
- [ ] Electron 개발자 도구에서 서버 로그와 연계 가능한 링크/단축키 제공
- [ ] API 호출 관련 로깅을 메인/렌더러 콘솔에 명확히 표기
- [ ] 목업 서버 또는 샘플 응답 데이터를 통한 빠른 테스트 경로 확보

## 의존성
- `docs/14-monitoring-ocr.md`
- `docs/21-text-analysis-api.md`
- `docs/22-ipc-server-handlers.md`

## 관련 파일
- `electron/main.ts`
- `electron/preload.ts`
- `renderer/src/state/server.ts`
- `renderer/src/overlay/OverlayApp.tsx`
- `renderer/src/components/AlertPanel.tsx`

## 구현 계획

### 1. 환경 변수 및 설정
```env
# .env.development
FASTAPI_BASE_URL=http://localhost:8000
```

### 2. Preload 브리지 업데이트
```typescript
// electron/preload.ts
contextBridge.exposeInMainWorld('serverApi', {
  analyzeText: (payload) => ipcRenderer.invoke(IPC_CHANNELS.SERVER_ANALYZE_TEXT, payload),
});
```

### 3. 렌더러 상태 업데이트
```typescript
// renderer/src/state/server.ts
export async function requestAnalysis(text) {
  set({ status: 'loading' });
  try {
    const result = await window.serverApi.analyzeText({ text });
    set({ status: 'success', result });
  } catch (error) {
    set({ status: 'error', error });
  }
}
```

## 수락 기준
- ✅ OCR 결과가 서버 분석을 거쳐 UI에 반영되는 전체 플로우가 작동
- ✅ 서버 미가용 시 사용자에게 명확한 안내 메시지 제공
- ✅ 개발/패키징 모드 모두 환경 설정으로 서버 주소 제어 가능
- ✅ 로그/디버깅 방법이 문서화되어 있음

## 테스트 방법
1. 개발 모드에서 OCR 결과를 수동으로 입력해 분석 요청이 정상 수행되는지 확인
2. FastAPI 서버를 의도적으로 중단해 오류 UI가 표시되는지 확인
3. 패키징된 앱에서 서버 주소 설정이 올바르게 반영되는지 검증
4. 목업 응답을 사용해 렌더러 상태 전환을 빠르게 테스트

## 다음 작업
- [작업 24: 음성 STT API](./24-audio-stt-api.md)
- 네트워크 오류 재시도 UX 개선
- 서버 인증/보안 토큰 통합

