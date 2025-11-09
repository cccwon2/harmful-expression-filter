# 작업 19: 네이티브 Tesseract 통합

## 상태
🆕 미착수

## 개요
기존 `tesseract.js`(WASM) 기반 OCR 경로를 제거하고, Electron 메인 프로세스에서 네이티브 Tesseract 실행 파일을 직접 호출하여 OCR 성능을 향상합니다. 패키징 단계에서 플랫폼별 Tesseract 바이너리를 포함하거나, 설치 프로그램에 Tesseract 배포본을 동봉하도록 명시합니다.

## 요구사항

### 바이너리 준비
- [ ] Windows용 `tesseract.exe` 바이너리를 앱 패키지(`resources/bin`)에 포함
- [ ] macOS/Linux의 경우 패키지 번들 또는 설치 스크립트에서 바이너리를 배포
- [ ] `README.md` 및 설치 문서에 Tesseract 배포 방식과 라이선스 고지 추가

### 실행 래퍼
- [ ] `electron/main.ts` 또는 별도 서비스 모듈에서 `child_process.execFile` 기반 OCR 호출 유틸리티 작성
- [ ] ROI 이미지(스크린샷) 저장 경로를 전달해 `tesseract.exe <input> <output>` 형태로 실행
- [ ] 표준 출력/오류 스트림을 캡처해 로그 및 오류 처리 강화
- [ ] 동시 실행 시 큐잉 또는 실행 중복 방지 로직 추가

### 렌더러/IPC 연동
- [ ] 기존 `tesseract.js` 워커 초기화 및 호출 로직 제거
- [ ] `IPC_CHANNELS.OCR_START` 수신 시 네이티브 호출을 트리거하도록 메인 프로세스 수정
- [ ] `IPC_CHANNELS.OCR_RESULT` 응답 구조는 기존과 동일하게 유지하여 렌더러 수정 최소화
- [ ] 렌더러 측에서 WASM 로딩 대기 UI 제거 또는 단순화

### 의존성 정리
- [ ] `package.json`에서 `tesseract.js` 및 관련 타입/빌드 의존성 제거
- [ ] 네이티브 실행에 필요한 추가 패키지(`execa` 등) 사용 여부 검토 후 반영
- [ ] Electron 빌드 스크립트에 바이너리 복사 단계 추가 (예: `electron-builder` `extraResources`)

## 의존성
- [작업 15: OCR/STT 파이프라인 스텁](./15-ocr-stt-stub.md)
- [작업 18: ROI/모드 영속화 및 부팅 시 복원](./18-persistence-boot-restore.md)
- [PROJECT_SPEC.md](../PROJECT_SPEC.md)의 OCR 파이프라인 요구사항

## 관련 파일
- `electron/main.ts` – OCR 시작 IPC 처리 지점
- `electron/ipc/channels.ts` – `OCR_START`, `OCR_RESULT` 채널 정의
- `renderer/src/overlay/OverlayApp.tsx` – OCR 결과 렌더링 UI
- `package.json` – 의존성 및 빌드 스크립트
- `README.md` – 설치 및 라이선스 안내

## 구현 계획

### 1. 네이티브 실행 래퍼 작성
```typescript
// electron/services/tesseractRunner.ts (신규)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface TesseractRunOptions {
  binaryPath: string;
  inputPath: string;
  outputPath: string;
  args?: string[];
}

export async function runTesseract({ binaryPath, inputPath, outputPath, args = [] }: TesseractRunOptions) {
  const finalArgs = [inputPath, outputPath.replace(/\.txt$/, ''), ...args];
  const { stdout, stderr } = await execFileAsync(binaryPath, finalArgs, { windowsHide: true });
  return { stdout, stderr };
}
```

### 2. IPC 핸들러 교체
```typescript
// electron/main.ts (발췌)
ipcMain.on(IPC_CHANNELS.OCR_START, async (_event, roiPayload) => {
  try {
    const { textFile } = await runTesseractForROI(roiPayload);
    const text = await fs.promises.readFile(textFile, 'utf-8');
    mainWindow.webContents.send(IPC_CHANNELS.OCR_RESULT, { text, roi: roiPayload });
  } catch (error) {
    console.error('[OCR] Failed with native Tesseract:', error);
    mainWindow.webContents.send(IPC_CHANNELS.OCR_RESULT, { text: '', error: serializeError(error) });
  }
});
```

### 3. 빌드 스크립트 업데이트
- `electron-builder.yml` 또는 `package.json`의 `build` 섹션에 `extraResources`를 추가해 `resources/bin/tesseract.exe` 복사
- Git 저장소에는 바이너리 미포함 시 설치 스크립트(`scripts/install-tesseract.ps1`) 작성 후 배포 절차에 포함

### 4. 문서 및 설치 가이드 보완
- `README.md`에 Tesseract 설치/배포 방법과 버전 요구사항 명시
- 라이선스 고지(Leptonica 등) 추가
- 개발 환경에서 바이너리 경로를 `.env` 또는 설정 파일로 관리하는 방법 안내

## 산출물/수락 기준
- ✅ Electron 메인 프로세스에서 네이티브 Tesseract 실행 성공
- ✅ OCR 결과가 기존 IPC 채널을 통해 렌더러에 전달
- ✅ `tesseract.js` 의존성 제거 및 빌드 타임 경고 없음
- ✅ 바이너리 패키징/설치 전략이 문서화되어 있음

## 테스트 방법
1. ROI 선택 후 `OCR_START` 트리거
2. 네이티브 Tesseract 실행 기록이 콘솔/로그에 출력되는지 확인
3. OCR 결과가 기존 UI에 정상 표시되는지 확인
4. 오류 발생 시 재시도 및 오류 메시지 전파 확인
5. 패키징된 빌드에서 바이너리 경로가 올바르게 설정되어 있는지 검증

## 다음 작업
- 빌드시 플랫폼별 바이너리 다운로드 자동화 스크립트 추가 여부 검토
- 네이티브 OCR 결과 품질 개선(언어 데이터 관리, 옵션 튜닝)
- 장기적으로 GPU 가속 OCR 라이브러리 검토

## 참조
- [Tesseract OCR 공식 문서](https://tesseract-ocr.github.io/)
- [Electron `child_process.execFile` 문서](https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback)
- [PROJECT_SPEC.md](../PROJECT_SPEC.md)

