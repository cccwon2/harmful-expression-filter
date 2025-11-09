# Harmful Expression Filter

라이브 플랫폼 유해 표현 필터링, 블라인드, 비프음, 볼륨 조절 Electron 애플리케이션

## 📚 시작하기

### 필수 문서
새로운 작업을 시작하기 전에 **반드시** 다음 문서를 확인하세요:

1. **[PROJECT_SPEC.md](./PROJECT_SPEC.md)**: 전체 프로젝트 명세서 및 요구사항
2. **[INTERFACES.md](./INTERFACES.md)**: 핵심 인터페이스 및 연결부 코드 (⚠️ 매우 중요)
3. **[docs/TASK_WORKFLOW.md](./docs/TASK_WORKFLOW.md)**: 작업 워크플로우 가이드

### 작업 문서
각 작업의 상세 내용은 [docs/](./docs/) 폴더를 참조하세요.

## 🚀 빠른 시작

```bash
# 개발 모드
npm run dev

# 메인 프로세스 빌드
npm run build:main

# 타입 체크
npm run typecheck

# 프로덕션 실행
npm start
```

## 📖 프로젝트 구조

```
harmful-expression-filter/
├── PROJECT_SPEC.md          # 마스터 플랜 (전체 프로젝트 명세서)
├── INTERFACES.md            # 핵심 인터페이스 및 연결부 코드
├── docs/                    # 작업/문서 모음
│   ├── README.md           # 작업 문서 개요
│   ├── TASK_WORKFLOW.md    # 작업 워크플로우 가이드
│   ├── 00-overview.md      # 작업 개요
│   └── ...
├── electron/                # Electron 메인 프로세스
│   ├── ipc/                # IPC 통신
│   ├── state/              # 상태 관리
│   └── windows/            # 창 관리
└── renderer/               # React 렌더러 프로세스
    └── src/
        └── overlay/        # 오버레이 UI
```

## 🔗 핵심 파일

작업 시 반드시 참조해야 할 핵심 연결부 파일들:

- `electron/ipc/channels.ts` - IPC 채널 정의
- `renderer/src/overlay/roiTypes.ts` - 타입 정의
- `electron/preload.ts` - Preload API 구현
- `renderer/src/global.d.ts` - Preload API 타입
- `electron/windows/createOverlayWindow.ts` - 오버레이 창
- `electron/state/editMode.ts` - Edit Mode 상태 관리

자세한 내용은 [INTERFACES.md](./INTERFACES.md)를 참조하세요.

## 📝 작업 추가하기

새로운 작업을 추가할 때는 [docs/TASK_WORKFLOW.md](./docs/TASK_WORKFLOW.md)의 워크플로우를 따르세요.

## 📄 라이선스

MIT
