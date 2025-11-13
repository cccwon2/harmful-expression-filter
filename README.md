# Harmful Expression Filter

라이브 플랫폼 유해 표현 필터링, 블라인드, 비프음, 볼륨 조절 Electron 애플리케이션. FastAPI 백엔드와 연동해 텍스트 분석과 알림 흐름을 처리합니다.

## 📚 시작하기

### 필수 문서
새로운 작업을 시작하기 전에 **반드시** 다음 문서를 확인하세요:

1. **[docs/PROJECT_SPEC.md](./docs/PROJECT_SPEC.md)**: 전체 프로젝트 명세서 및 요구사항
2. **[docs/INTERFACES.md](./docs/INTERFACES.md)**: 핵심 인터페이스 및 연결부 코드 (⚠️ 매우 중요)
3. **[docs/TASK_WORKFLOW.md](./docs/TASK_WORKFLOW.md)**: 작업 워크플로우 가이드
4. **[docs/00-overview.md](./docs/00-overview.md)**: 현재 작업 현황 및 상태 요약

### 작업 문서
각 작업의 상세 내용은 [docs/](./docs/) 폴더를 참조하세요. Task 20~23까지 FastAPI 서버 및 Electron IPC/Preload 통합 작업이 완료되어 있으며, 이어서 STT/음성 연동 작업이 예정되어 있습니다.

## 🚀 빠른 시작

```bash
# FastAPI 백엔드 (터미널 1)
cd server
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload

# Electron 앱 (터미널 2)
npm install
npm run dev
```

### 주요 스크립트
```bash
# 메인 프로세스 타입 체크 및 빌드
npm run typecheck
npm run build:main

# 프로덕션 실행
npm start
```

## 📖 프로젝트 구조

```
harmful-expression-filter/
├── README.md                # 프로젝트 개요 및 빠른 시작 가이드
├── docs/                    # 작업/문서 모음 (Task 00~26)
│   ├── PROJECT_SPEC.md      # 마스터 플랜 (전체 프로젝트 명세서)
│   ├── INTERFACES.md        # 핵심 인터페이스 및 연결부 코드
│   └── ...                  # 각 작업 문서 (01~26)
├── electron/                # Electron 메인 프로세스 (IPC, 창, 상태)
└── renderer/                # React 렌더러 프로세스 (오버레이/UI)
```

## 🔗 핵심 파일

작업 시 반드시 참조해야 할 핵심 연결부 파일들:

- `electron/ipc/channels.ts` – IPC 채널 정의 (SERVER_CHANNELS 포함)
- `electron/ipc/serverHandlers.ts` – FastAPI 연동 IPC 핸들러
- `electron/preload.ts` – Preload API 구현 및 서버 브리지
- `renderer/src/global.d.ts` – Preload API 타입 정의
- `renderer/src/components/ServerTest.tsx` – 서버 테스트용 개발 UI
- `electron/windows/createOverlayWindow.ts` – 오버레이 창 생성
- `electron/state/editMode.ts` – Edit Mode 상태 관리

자세한 내용은 [docs/INTERFACES.md](./docs/INTERFACES.md)와 각 Task 문서를 참조하세요.

## 📝 작업 추가하기

새로운 작업을 추가할 때는 [docs/TASK_WORKFLOW.md](./docs/TASK_WORKFLOW.md)의 워크플로우를 따르고, 관련 Task 문서를 업데이트해 주세요.

## 📄 라이선스

MIT
