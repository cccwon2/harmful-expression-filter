# 작업 문서 (Tasks Documentation)

이 폴더는 프로젝트의 모든 작업을 문서화하고 관리합니다.

## 📚 시작하기 전에

새로운 작업을 시작하기 전에 **반드시** 다음 문서들을 확인하세요:

1. **[PROJECT_SPEC.md](../PROJECT_SPEC.md)**: 전체 프로젝트 명세서 및 요구사항
2. **[INTERFACES.md](../INTERFACES.md)**: 핵심 인터페이스 및 연결부 코드 (⚠️ 매우 중요)

## 목차

1. [작업 개요](./00-overview.md) - 모든 작업의 상태 및 의존성 그래프
2. [기본 Electron 앱 설정](./01-electron-setup.md) - 프로젝트 구조 및 빌드 설정
3. [시스템 트레이](./02-system-tray.md) - 트레이 아이콘 및 메뉴
4. [투명 오버레이 창](./03-overlay-window.md) - 전체 화면 투명 오버레이
5. [ROI 선택 기능](./04-roi-selection.md) - 마우스 드래그로 ROI 선택
6. [Edit Mode 관리](./05-edit-mode.md) - Edit Mode 상태 관리
7. [상태 관리](./06-state-management.md) - 상태 머신 패턴
8. [IPC 통신](./07-ipc-communication.md) - 프로세스 간 통신
9. [개발자 도구 통합](./08-devtools-integration.md) - 디버깅 지원
10. [Preload API](./10-preload-api.md) - 안전한 API 노출
11. [상태 모델 정의](./11-state-model-definition.md) - 상태 모델 정의 (기본 구현 완료)
12. [트레이 메뉴 "영역 지정"](./12-tray-setup-mode-entry.md) - 설정 모드 진입
13. [설정 모드 ROI 선택](./13-setup-mode-roi-selection.md) - ROI 선택 및 감지 모드 전환
14. [감지 모드 HUD](./14-detect-mode-hud.md) - HUD 표시
15. [OCR/STT 파이프라인 스텁](./15-ocr-stt-stub.md) - OCR/STT 스텁 구현
16. [서버 알림 및 블라인드](./16-server-alert-blind.md) - 블라인드 표시
17. [ESC/트레이 재진입](./17-escape-tray-resetup.md) - 설정 모드 재진입
18. [ROI/모드 영속화](./18-persistence-boot-restore.md) - 부팅 시 복원
19. [Preload API 확장](./19-preload-api-extension.md) - API 확장

## 작업 문서 사용법

각 작업 문서는 다음 정보를 포함합니다:

- **상태**: 작업 완료 여부
- **개요**: 작업의 목적과 설명
- **완료된 기능**: 구현된 기능 목록
- **의존성**: 다른 작업과의 의존 관계
- **관련 파일**: 작업과 관련된 소스 파일
- **주요 코드**: 중요한 코드 예제
- **다음 작업**: 관련된 다음 작업들

## 작업 업데이트

작업을 완료하거나 수정할 때마다 해당 작업 문서를 업데이트하세요.

## 작업 추가

새로운 작업을 추가할 때:

1. 새로운 마크다운 파일 생성 (예: `11-new-task.md`)
2. [작업 개요](./00-overview.md)에 작업 추가
3. 의존성 관계 업데이트
4. 관련 작업 문서에 링크 추가

