# 작업 워크플로우 (Task Workflow)

이 문서는 새로운 작업을 시작하거나 기존 작업을 수정할 때 따라야 할 워크플로우를 설명합니다.

## 🎯 AI에게 작업 지시할 때 사용하는 템플릿

### 기본 템플릿

```
작업: [작업 이름 및 번호]

1. **마스터 플랜 확인**
   - @PROJECT_SPEC.md에서 [작업 번호] 요구사항을 다시 확인해.

2. **핵심 연결부 파일 참조 (반드시 사용해야 할 파일들)**
   - @electron/ipc/channels.ts (IPC 채널 목록)
   - @renderer/src/overlay/roiTypes.ts (타입 정의)
   - @electron/preload.ts (Preload API 구현)
   - @renderer/src/global.d.ts (Preload API 타입)
   - @electron/windows/createOverlayWindow.ts (오버레이 창)
   - @electron/state/editMode.ts (Edit Mode 상태 관리)
   - [기타 작업과 관련된 핵심 파일들]

3. **작업 지시**
   - [구체적인 작업 내용 및 요구사항]
   - [예상되는 출력 파일 또는 수정 파일]
   - [테스트 방법]
```

### 실제 예시: T11 (OCR 서비스) 작업 시작

```
작업: T11 - OCR 서비스 구현

1. **마스터 플랜 확인**
   - @PROJECT_SPEC.md에서 T11 (OCR 서비스) 요구사항을 다시 확인해.

2. **핵심 연결부 파일 참조 (반드시 사용해야 할 파일들)**
   - @electron/ipc/channels.ts (OCR_START, OCR_STOP 채널 확인)
   - @renderer/src/overlay/roiTypes.ts (ROI 타입 확인)
   - @electron/windows/createOverlayWindow.ts (오버레이 창에서 ROI 영역 캡처)
   - @renderer/src/overlay/OverlayApp.tsx (상태 머신 및 ROI 상태 확인)
   - @electron/state/editMode.ts (Edit Mode 상태 확인)

3. **작업 지시**
   - electron/modules/ocrService.ts 파일을 새로 만들어줘.
   - T2에서 만든 createOverlayWindow가 캡처한 ROI 영역 이미지를 받아서,
   - channels.ts의 OCR_START 채널로 OCR 텍스트를 전송하는 로직을 구현해줘.
   - OCR_STOP 채널도 처리해야 해.
   - ROI 선택이 완료된 후 (mode가 'detect'일 때) OCR을 자동으로 시작하도록 해줘.
```

## 📋 작업 시작 전 체크리스트

- [ ] PROJECT_SPEC.md에서 작업 요구사항 확인
- [ ] INTERFACES.md에서 관련 핵심 파일 확인
- [ ] 관련 작업 문서 확인 (docs/XX-task-name.md)
- [ ] 핵심 연결부 파일들(@) 확인
- [ ] 작업 의존성 확인 (다른 작업과의 관계)

## 🔗 작업 간 연결 방법

### 1. IPC 채널 사용
- 새로운 IPC 통신이 필요하면: `electron/ipc/channels.ts`에 채널 추가
- 기존 IPC 채널 사용: `channels.ts`에서 채널 이름 확인 후 사용

### 2. 타입 사용
- 새로운 타입 추가: `renderer/src/overlay/roiTypes.ts`에 타입 추가
- 기존 타입 사용: `roiTypes.ts`에서 타입 import

### 3. Preload API 사용
- 새로운 API 추가: `electron/preload.ts`와 `renderer/src/global.d.ts` 모두 업데이트
- 기존 API 사용: `window.api.xxx` 형태로 사용

### 4. 상태 관리
- Edit Mode 상태: `electron/state/editMode.ts`의 함수 사용
- 오버레이 상태: `renderer/src/overlay/OverlayApp.tsx`의 상태 머신 사용

## ⚠️ 주의사항

1. **기능 섬 만들지 않기**
   - 새로운 기능을 추가할 때 기존 인터페이스를 재사용
   - 새로운 IPC 채널이나 타입을 만들기 전에 기존 것들을 확인

2. **연결부 파일 무단 수정 금지**
   - `channels.ts`, `roiTypes.ts`, `preload.ts` 등은 신중하게 수정
   - 수정 전에 관련 작업 문서와 INTERFACES.md 확인

3. **타입 안전성 유지**
   - 모든 IPC 통신과 API 호출에서 타입 사용
   - 타입 정의는 `roiTypes.ts`나 `global.d.ts`에 중앙화

## 📝 작업 완료 후 체크리스트

- [ ] 관련 파일 업데이트 (소스 코드)
- [ ] 작업 문서 업데이트 (docs/XX-task-name.md)
- [ ] INTERFACES.md 업데이트 (새로운 인터페이스 추가 시)
- [ ] PROJECT_SPEC.md 업데이트 (요구사항 변경 시)
- [ ] 의존성 문서 업데이트 (docs/00-overview.md)

## 🔄 작업 수정 시

기존 작업을 수정할 때:

1. 해당 작업 문서 확인
2. INTERFACES.md에서 관련 핵심 파일 확인
3. 영향을 받는 다른 작업 확인 (의존성 그래프)
4. 수정 사항 반영
5. 관련 문서 업데이트

## 예시 시나리오

### 시나리오 1: 새로운 IPC 채널 추가

```
작업: OCR 결과 전송 IPC 채널 추가

1. @electron/ipc/channels.ts 확인
2. OCR_RESULT 채널 추가
3. @electron/preload.ts에 API 추가
4. @renderer/src/global.d.ts에 타입 추가
5. INTERFACES.md 업데이트
```

### 시나리오 2: 새로운 타입 추가

```
작업: OCR 결과 타입 추가

1. @renderer/src/overlay/roiTypes.ts 확인
2. OCRResult 타입 추가
3. 관련 파일에서 타입 사용
4. INTERFACES.md 업데이트
```

## 관련 문서

- [PROJECT_SPEC.md](../PROJECT_SPEC.md): 전체 프로젝트 명세서
- [INTERFACES.md](../INTERFACES.md): 핵심 인터페이스 및 연결부 코드
- [docs/00-overview.md](./00-overview.md): 작업 개요

