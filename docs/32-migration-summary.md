# electron-edge-js 마이그레이션 완료 요약

## 완료된 작업

### 1. 빌드 시스템 ✅
- `.NET 8` 프로젝트 생성 (`dotnet/OnVoiceComBridge/`)
- DLL 자동 복사 스크립트 (`scripts/copy-dll.js`)
- 통합 빌드 명령어 (`npm run build:all`)

### 2. C# COM Bridge ✅
- `Startup.cs` - electron-edge-js 엔트리포인트
- Windows 플랫폼 특성 적용
- 경고 없이 빌드 성공

### 3. Electron Bridge ✅
- `electron/main/onvoiceBridge.ts` - electron-edge-js 래퍼
- `electron/main/ipc/onvoiceIpc.ts` - IPC skeleton
- `electron/audio/onvoiceBridgeAdapter.ts` - 기존 인터페이스 호환 어댑터

### 4. 코드 마이그레이션 ✅
- `electron/audio/onvoiceService.ts` - 새 bridge adapter 사용
- `electron/utils/processFinder.ts` - 프로세스 자동 검색 유틸리티
- 기존 인터페이스 호환성 유지

## 현재 상태

### 작동하는 부분 ✅
1. **빌드 시스템**: 전체 빌드 가능 (`npm run build:all`)
2. **프로세스 검색**: Chrome, Edge, Discord 프로세스 자동 검색
3. **코드 통합**: 기존 코드가 새 bridge를 사용하도록 마이그레이션 완료

### TODO (필수) ⚠️
1. **COM 이벤트 구독 구현** (`dotnet/OnVoiceComBridge/Startup.cs`)
   - `SubscribeComEvents()` 메서드 구현 필요
   - 실제 COM 인터페이스에 맞게 이벤트 구독 코드 작성
   - `OnAudioData()` 메서드 시그니처 확인 및 수정

### TODO (선택) 📝
1. **프로세스 검색 개선**: node-process-list 같은 패키지 사용 고려
2. **에러 처리 개선**: COM 초기화 실패 시 재시도 로직
3. **테스트**: 실제 COM 객체와 통합 테스트

## 사용 방법

### 빌드
```bash
# 전체 빌드 (C# DLL + 복사 + TypeScript)
npm run build:all

# 개별 빌드
npm run build:dotnet  # C# DLL만
npm run copy:dll      # DLL 복사
npm run build:main    # TypeScript만
```

### 실행
```bash
npm start
# 또는
npm run dev
```

### 코드 사용
기존 코드는 변경 없이 사용 가능합니다:
```typescript
// electron/audio/onvoiceService.ts에서 이미 마이그레이션됨
const service = new OnVoiceService(window, {
  deepgramApiKey: process.env.DEEPGRAM_API_KEY,
  serverWebSocketUrl: 'ws://127.0.0.1:8000/ws/audio',
});

// Chrome 프로세스 자동 검색 및 캡처 시작
await service.startMonitoring('chrome');
```

## 다음 단계

### 1. COM 이벤트 구독 구현 (필수)
`dotnet/OnVoiceComBridge/Startup.cs`의 `SubscribeComEvents()` 메서드를 구현해야 합니다:

1. COM 인터페이스 정의 확인
   - TLB 파일 또는 문서 확인
   - 이벤트 이름 및 시그니처 확인

2. 구현 방법 선택
   - COM Interop 어셈블리 사용 (권장)
   - Reflection 사용
   - IConnectionPoint 직접 사용

3. `docs/31-com-event-implementation-guide.md` 참고

### 2. 테스트
```bash
# 테스트 스크립트 실행 (PID는 실제 프로세스 ID로 변경)
TEST_PID=12345 npx tsx electron/test/test_onvoice_bridge.ts
```

### 3. 실제 통합 테스트
1. Electron 앱 실행
2. OnVoice 서비스 시작
3. 오디오 데이터 수신 확인

## 파일 구조

```
dotnet/
  OnVoiceComBridge/
    OnVoiceComBridge.csproj    # .NET 8 프로젝트
    Startup.cs                  # electron-edge-js 엔트리포인트 + COM 래퍼

electron/
  main/
    onvoiceBridge.ts            # electron-edge-js 래퍼
    ipc/
      onvoiceIpc.ts             # IPC skeleton
  audio/
    onvoiceBridgeAdapter.ts     # 기존 인터페이스 호환 어댑터
    onvoiceService.ts           # ✅ 마이그레이션 완료
  utils/
    processFinder.ts            # 프로세스 검색 유틸리티

scripts/
  copy-dll.js                   # DLL 복사 스크립트

dist-electron/
  dotnet/
    OnVoiceComBridge.dll        # 빌드된 DLL (자동 복사됨)
```

## 문제 해결

### DLL을 찾을 수 없음
```bash
npm run copy:dll
```

### COM 객체 생성 실패
1. COM 객체가 등록되어 있는지 확인:
   ```cmd
   reg query "HKEY_CLASSES_ROOT\OnVoiceAudioBridge.OnVoiceCapture"
   ```
2. ProgID 확인 (`dotnet/OnVoiceComBridge/Startup.cs`)

### 프로세스를 찾을 수 없음
- PowerShell이 실행 가능한지 확인
- 프로세스가 실제로 실행 중인지 확인
- PID를 직접 지정: `service.startMonitoring(12345)`

## 참고 자료

- [마이그레이션 가이드](./30-electron-edge-js-migration.md)
- [COM 이벤트 구현 가이드](./31-com-event-implementation-guide.md)
- [OnVoice COM Bridge 통합](./29-onvoice-com-bridge-integration.md)

