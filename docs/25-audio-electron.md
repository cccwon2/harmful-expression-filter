# 작업 25: 음성 Electron 연동

## 상태
🆕 미착수

## 개요
Electron 애플리케이션에서 음성 입력을 캡처하고 FastAPI STT API와 통신하여 결과를 UI에 반영하는 기능을 구현합니다. 마이크 권한, 오디오 스트림 관리, 사용자 피드백(UI) 등을 포괄합니다.

## 요구사항

### 오디오 캡처
- [ ] 렌더러에서 Web Audio/MediaRecorder API로 마이크 입력 수집
- [ ] 샘플레이트/인코딩 포맷을 서버와 사전 합의
- [ ] 녹음 시작/중지/취소 UX 정의

### IPC 및 서버 연동
- [ ] 녹음된 오디오를 메인 프로세스로 전달할 IPC 채널 정의
- [ ] `IPC_CHANNELS.SERVER_ANALYZE_AUDIO` 등 이름으로 FastAPI STT API 호출
- [ ] 전송 중 진행률/상태 업데이트

### UI/UX
- [ ] 녹음 상태 표시(아이콘, 애니메이션 등)
- [ ] 분석 결과 텍스트를 기존 HUD/오버레이에 통합
- [ ] 오류 및 네트워크 끊김 시 사용자 안내

## 의존성
- `docs/22-ipc-server-handlers.md`
- `docs/23-electron-integration.md`
- `docs/24-audio-stt-api.md`
- `renderer` 측 상태 관리/컴포넌트 구조

## 관련 파일
- `electron/preload.ts`
- `electron/main.ts`
- `renderer/src/hooks/useAudioRecorder.ts` (신규)
- `renderer/src/components/AudioCaptureButton.tsx`
- `renderer/src/state/audio.ts`

## 구현 계획

### 1. 오디오 녹음 훅
```typescript
// renderer/src/hooks/useAudioRecorder.ts
export function useAudioRecorder() {
  // TODO: MediaRecorder로 녹음 및 Blob 반환
}
```

### 2. IPC 호출
```typescript
// electron/preload.ts
contextBridge.exposeInMainWorld('audioApi', {
  analyze: (buffer) => ipcRenderer.invoke(IPC_CHANNELS.SERVER_ANALYZE_AUDIO, buffer),
});
```

### 3. UI 컴포넌트
```tsx
// renderer/src/components/AudioCaptureButton.tsx
export function AudioCaptureButton() {
  const { start, stop, status } = useAudioRecorder();
  // TODO: UI 렌더링
}
```

## 수락 기준
- ✅ Electron에서 녹음한 음성이 STT API로 전송되어 분석 결과 표시
- ✅ 사용자에게 녹음/전송/분석 상태가 명확히 전달
- ✅ 오류 발생 시 안전하게 복구 및 재시도 가능
- ✅ 문서/README에 권한 설정 및 사용 방법 안내

## 테스트 방법
1. 개발 모드에서 로컬 FastAPI STT API와 연동 테스트
2. 마이크 권한 거부 시 UX 확인
3. 네트워크 지연/오류 상황에서 재시도 시나리오 검증
4. 실제 데모 환경에서 오디오 캡처 → 분석 → 결과 표시 플로우 리허설

## 다음 작업
- 사용자 가이드/튜토리얼 작성
- 오프라인 캐시 또는 로컬 STT 엔진 도입 검토
- 배포 환경에서 마이크 권한 안내 팝업 개선

