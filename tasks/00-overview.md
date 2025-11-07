# 작업 개요 (Tasks Overview)

이 문서는 프로젝트의 모든 작업 목록과 상태를 제공합니다.

## 📚 필수 참조 문서

작업을 시작하기 전에 다음 문서를 반드시 확인하세요:

- **[PROJECT_SPEC.md](../PROJECT_SPEC.md)**: 전체 프로젝트 명세서 및 요구사항
- **[INTERFACES.md](../INTERFACES.md)**: 핵심 인터페이스 및 연결부 코드 (⚠️ 매우 중요)

## 작업 목록

1. **[기본 Electron 앱 설정](./01-electron-setup.md)** ✅ 완료
2. **[시스템 트레이](./02-system-tray.md)** ✅ 완료
3. **[투명 오버레이 창](./03-overlay-window.md)** ✅ 완료
4. **[ROI 선택 기능](./04-roi-selection.md)** ✅ 완료
5. **[Edit Mode 관리](./05-edit-mode.md)** ✅ 완료
6. **[상태 관리 (State Machine)](./06-state-management.md)** ✅ 완료
7. **[IPC 통신](./07-ipc-communication.md)** ✅ 완료
8. **[개발자 도구 통합](./08-devtools-integration.md)** ✅ 완료
9. **[키보드 단축키](./09-keyboard-shortcuts.md)** ✅ 완료
10. **[Preload API](./10-preload-api.md)** ✅ 완료

## 작업 의존성 그래프

```
01-electron-setup
    ├─ 02-system-tray
    ├─ 03-overlay-window
    │   ├─ 04-roi-selection
    │   ├─ 05-edit-mode
    │   └─ 06-state-management
    ├─ 07-ipc-communication
    │   ├─ 04-roi-selection
    │   └─ 05-edit-mode
    ├─ 08-devtools-integration
    │   └─ 03-overlay-window
    ├─ 09-keyboard-shortcuts
    │   ├─ 03-overlay-window
    │   └─ 05-edit-mode
    └─ 10-preload-api
        └─ 07-ipc-communication
```

## 작업 상태

| 작업 | 상태 | 진행률 | 우선순위 |
|------|------|--------|----------|
| 기본 Electron 앱 설정 | ✅ 완료 | 100% | High |
| 시스템 트레이 | ✅ 완료 | 100% | High |
| 투명 오버레이 창 | ✅ 완료 | 100% | High |
| ROI 선택 기능 | ✅ 완료 | 100% | High |
| Edit Mode 관리 | ✅ 완료 | 100% | High |
| 상태 관리 | ✅ 완료 | 100% | High |
| IPC 통신 | ✅ 완료 | 100% | High |
| 개발자 도구 통합 | ✅ 완료 | 100% | Medium |
| 키보드 단축키 | ✅ 완료 | 100% | Medium |
| Preload API | ✅ 완료 | 100% | High |

## 다음 단계

프로젝트의 다음 개발 단계를 확인하려면 각 작업 문서를 참조하세요.

## 업데이트 히스토리

- 2024-01-XX: 초기 작업 문서 생성

