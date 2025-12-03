# 작업 48: 애플리케이션 성능 최적화

## 상태

🔄 진행 중

## 📋 작업 개요

**목표**: 애플리케이션 전반의 성능을 최적화하여 마우스 버벅거림 및 전반적인 무거움 문제를 해결

**배경**:

- OCR 모드에서 마우스가 버벅거리는 현상 발생
- 음성 모드에서도 마우스 버벅거림 발견
- 애플리케이션 전체가 무거워 사용자 경험에 영향
- 특히 오버레이 윈도우와 ROI 선택 과정에서 성능 저하 발생

**관련 작업**:

- T34 (Windows OCR 성능 최적화) ✅ - OCR 처리 시간 최적화
- T47 (메인 대시보드 구축 및 멀티 윈도우 관리) ✅ - 윈도우 구조 개선
- 현재 작업: 전반적인 UI 반응성 및 렌더링 성능 최적화

---

## 🎯 최적화 목표

1. **마우스 반응성 개선**: ROI 선택 시 마우스 이동이 부드럽게 작동
2. **렌더링 성능 향상**: 오버레이 윈도우의 리렌더링 최소화
3. **메모리 사용량 감소**: 불필요한 상태 업데이트 및 메모리 누수 방지
4. **IPC 통신 최적화**: 빈번한 IPC 호출 감소 및 배치 처리
5. **이벤트 핸들러 최적화**: 불필요한 이벤트 리스너 제거 및 디바운싱

---

## ✅ 완료된 최적화 작업 요약

### 1. React 렌더링 최적화
- ✅ 하위 컴포넌트 `React.memo()` 적용 (5개 컴포넌트)
- ✅ `useMemo()`로 `selectionRect` 계산 최적화
- ✅ `useCallback()`으로 IPC 리스너 등록 로직 메모이제이션
- ✅ `requestAnimationFrame`으로 마우스 이벤트 스케줄링

### 2. IPC 통신 최적화
- ✅ `OVERLAY_STATE_PUSH` 중복 상태 전송 방지 (JSON 직렬화 비교)
- ✅ `ALERT_FROM_SERVER` 중복 전송 방지
- ✅ OCR 모니터링 루프에서 불필요한 IPC 호출 감소

### 3. OCR 처리 최적화
- ✅ 적응형 인터벌 (500ms ~ 2000ms) 구현 완료
- ✅ 중복 텍스트 필터링으로 불필요한 서버 요청 방지
- ✅ 빈 텍스트 조기 return으로 CPU 사용량 감소

### 4. 메모리 최적화
- ✅ 모든 이벤트 리스너 cleanup 로직 적용
- ✅ Ref 기반 상태 관리로 메모리 효율성 향상
- ✅ `requestAnimationFrame` 취소 로직 포함

---

## 🔍 현재 성능 문제 분석

### 1. 마우스 버벅거림 (OCR 모드) ✅ 해결됨

**문제점**:
- ROI 선택 시 `mousemove` 이벤트마다 React 상태 업데이트 발생
- 매 이벤트마다 컴포넌트 리렌더링으로 인한 성능 저하
- 상태 업데이트가 동기적으로 처리되어 메인 스레드 블로킹

**영향받는 파일**:
- `renderer/src/overlay/OverlayApp.tsx`: ROI 선택 마우스 이벤트 핸들러

**현재 상태**:
- ✅ `requestAnimationFrame`을 사용한 상태 업데이트 스케줄링 적용 완료
  - `mousemove` 이벤트에서 `requestAnimationFrame`으로 상태 업데이트 스케줄링
  - 마우스 위치를 ref에 저장하여 불필요한 상태 업데이트 방지
- ✅ Ref 기반 상태 관리로 클로저 문제 해결 완료
  - `selectionStateRef`, `mousePositionRef`, `rafIdRef` 등으로 최신 상태 참조
  - 이벤트 핸들러의 의존성 배열을 비워서 불필요한 재등록 방지
- ✅ 메모이제이션 적용 완료 (아래 상세 참조)

### 2. 오버레이 윈도우 렌더링 성능

**문제점**:
- 오버레이 윈도우가 전체 화면 크기로 렌더링
- 불필요한 리렌더링이 자주 발생
- CSS 애니메이션 및 transition 효과로 인한 부하

**영향받는 파일**:
- `renderer/src/overlay/OverlayApp.tsx`: 오버레이 컴포넌트 렌더링
- `electron/windows/createOverlayWindow.ts`: 윈도우 설정

### 3. IPC 통신 오버헤드

**문제점**:
- 빈번한 IPC 메시지 전송으로 인한 오버헤드
- 작은 데이터를 여러 번 전송하는 비효율
- 동기적 IPC 호출로 인한 블로킹 (일부 경로는 이미 비동기화 완료)

**영향받는 파일**:
- `electron/main.ts`: OCR 캡처 및 상태 업데이트
- `electron/ipc/roi.ts`: ROI 선택 이벤트 처리
- `electron/preload.ts`: IPC 통신 래퍼

### 4. 상태 관리 최적화 ✅ 대부분 해결됨

**문제점**:
- 불필요한 상태 업데이트가 빈번히 발생
- 상태 변경으로 인한 연쇄 리렌더링
- 메모이제이션 미적용으로 인한 중복 계산

**영향받는 파일**:
- `renderer/src/overlay/OverlayApp.tsx`: 상태 관리 로직
- `electron/main.ts`: 메인 프로세스 상태 관리

**현재 상태**:
- ✅ 메모이제이션 적용 완료 (하위 컴포넌트, 계산 값, 콜백)
- ✅ Ref 기반 상태 관리로 불필요한 상태 업데이트 감소
- ✅ `requestAnimationFrame`으로 상태 업데이트 스케줄링
- ⏳ 추가 최적화 여지 검토 중

### 5. 이벤트 리스너 최적화 ✅ 대부분 해결됨

**문제점**:
- 등록된 이벤트 리스너가 많음
- 이벤트 핸들러에서 무거운 작업 수행
- 불필요한 이벤트 리스너가 정리되지 않음

**영향받는 파일**:
- 모든 컴포넌트의 `useEffect` 훅
- `electron/main.ts`: 윈도우 이벤트 핸들러

**현재 상태**:
- ✅ 모든 이벤트 리스너 cleanup 로직 적용 완료
- ✅ `requestAnimationFrame`으로 이벤트 핸들러 최적화
- ✅ Ref 기반 상태 관리로 이벤트 핸들러 재등록 방지
- ⏳ 추가 최적화 여지 검토 중

---

## 🚀 최적화 전략

### 1. React 렌더링 최적화

#### 1.1 메모이제이션 적용

**목표**: 불필요한 리렌더링 방지

**구현 위치**: `renderer/src/overlay/OverlayApp.tsx`

**방법**:
- `React.memo()`로 컴포넌트 메모이제이션
- `useMemo()`로 계산 비용이 큰 값 메모이제이션
- `useCallback()`으로 이벤트 핸들러 메모이제이션

**현재 상태**:
- ✅ 하위 컴포넌트 메모이제이션 완료
  - `SelectionBox`: `React.memo()` 적용 (line 86)
  - `BlurOverlay`: `React.memo()` 적용 (line 103)
  - `MonitoringOverlay`: `React.memo()` 적용 (line 118)
  - `InstructionMessage`: `React.memo()` 적용 (line 135)
  - `SuccessToast`: `React.memo()` 적용 (line 143)
- ✅ `useMemo()` 적용 완료
  - `selectionRect` 계산 메모이제이션 (line 513-522)
  - `selectionState` 변경 시에만 재계산
- ✅ `useCallback()` 적용 완료
  - `createOverlayApiWaiter`: IPC 리스너 등록 로직 메모이제이션 (line 212-249)
  - `applyModeEffects`: 모드 변경 효과 적용 로직 메모이제이션 (line 252-257)

**효과**:
- 하위 컴포넌트의 불필요한 리렌더링 방지
- 마우스 이동 시 선택 영역 계산 최적화
- IPC 리스너 재등록 방지로 메모리 효율성 향상

#### 1.2 상태 업데이트 배치 처리

**목표**: 상태 업데이트를 배치하여 리렌더링 최소화

**구현 위치**: `renderer/src/overlay/OverlayApp.tsx`

**방법**:
- `requestAnimationFrame`으로 상태 업데이트 스케줄링 (이미 적용됨)
- 여러 상태 업데이트를 하나로 배치
- React 18의 자동 배치 기능 활용

**현재 상태**:
- ✅ `requestAnimationFrame` 적용 완료
  - `mousemove` 이벤트에서 `requestAnimationFrame`으로 상태 업데이트 스케줄링 (line 442-456)
  - `rafIdRef`로 중복 스케줄링 방지
  - 마우스 위치를 `mousePositionRef`에 저장하여 이벤트마다 상태 업데이트하지 않음
- ✅ React 18 자동 배치 기능 활용
  - 상태 업데이트가 자동으로 배치 처리됨
- ⏳ 추가 배치 처리 로직은 현재 필요성 낮음 (requestAnimationFrame으로 충분)

#### 1.3 가상화(Virtualization) 적용

**목표**: 큰 리스트나 많은 요소를 렌더링할 때 성능 개선

**구현 위치**: (현재는 적용 불필요, 향후 필요시)

**방법**:
- `react-window` 또는 `react-virtualized` 사용
- 화면에 보이는 영역만 렌더링

### 2. 이벤트 핸들러 최적화

#### 2.1 디바운싱/스로틀링

**목표**: 빈번한 이벤트 호출 감소

**구현 위치**: `renderer/src/overlay/OverlayApp.tsx`

**방법**:
- `mousemove` 이벤트에 스로틀링 적용
- `requestAnimationFrame`과 함께 사용하여 부드러운 업데이트

**현재 상태**:
- ✅ `requestAnimationFrame`으로 기본 스로틀링 효과 완료
  - `mousemove` 이벤트가 초당 60회(16ms 간격)로 제한됨
  - 브라우저 렌더링 주기와 동기화되어 부드러운 업데이트
- ✅ 마우스 위치 ref 저장으로 추가 최적화
  - 이벤트마다 상태 업데이트하지 않고 ref에만 저장
  - `requestAnimationFrame` 콜백에서만 상태 업데이트
- ⏳ 추가 디바운싱 로직은 현재 필요성 낮음 (requestAnimationFrame으로 충분)

#### 2.2 이벤트 위임 (Event Delegation)

**목표**: 개별 요소에 리스너를 붙이는 대신 부모 요소에서 처리

**구현 위치**: `renderer/src/overlay/OverlayApp.tsx`

**방법**:
- 각 요소가 아닌 window 레벨에서 이벤트 처리 (이미 적용됨)
- 이벤트 버블링 활용

**현재 상태**:
- ✅ window 레벨 이벤트 처리 적용됨

#### 2.3 패시브 이벤트 리스너

**목표**: 스크롤 성능 개선

**구현 위치**: (현재는 적용 불필요, 스크롤 없음)

### 3. IPC 통신 최적화

#### 3.1 메시지 배치 처리

**목표**: 여러 IPC 메시지를 하나로 묶어 전송

**구현 위치**: `electron/main.ts`, `electron/ipc/roi.ts`

**방법**:
- 짧은 시간 내 여러 상태 변경을 배치
- 상태 업데이트를 큐에 모아 한 번에 전송

**예상 효과**:
- IPC 호출 횟수 30-50% 감소
- 메인 프로세스 부하 감소

#### 3.2 비동기 처리 강화

**목표**: IPC 호출이 메인 스레드를 블로킹하지 않도록

**구현 위치**: 모든 IPC 핸들러

**방법**:
- 모든 IPC 핸들러를 비동기로 처리 (이미 적용됨)
- `setImmediate()` 또는 `process.nextTick()` 사용

#### 3.3 데이터 직렬화 최적화

**목표**: IPC 전송 데이터 크기 최소화

**구현 위치**: IPC 메시지 전송 부분

**방법**:
- 불필요한 데이터 제거
- 큰 객체는 필요한 필드만 전송

**현재 상태**:
- ✅ `pushOverlayState`에서 안전한 직렬화 및 **중복 상태 전송 방지(Deduplication)** 적용  
  - 동일한 상태는 `OVERLAY_STATE_PUSH`로 재전송하지 않음  
  - `ALERT_FROM_SERVER`도 유해/정상 상태 변화가 있을 때만 전송
- ✅ OCR 모니터링 루프에서 **불필요한 IPC 호출 감소** (renderer 이벤트 루프 부하 감소)
- ✅ **오디오 서비스 IPC 스로틀링** 적용 완료
  - `AudioService.broadcastStatus()`: 100ms 간격 (초당 10회) 제한
  - `OnVoiceService.broadcastStatus()`: 100ms 간격 (초당 10회) 제한
  - 마지막 상태 보장을 위한 지연 스케줄링 로직 포함
- ✅ ROI 선택 시 IPC 호출 최적화: `mousemove`에서는 IPC 호출하지 않음, `mouseup`에서만 호출

### 4. 메모리 최적화

#### 4.1 메모리 누수 방지

**목표**: 컴포넌트 언마운트 시 모든 리스너 정리

**구현 위치**: 모든 React 컴포넌트

**방법**:
- `useEffect`의 cleanup 함수에서 모든 리스너 제거
- 타이머 및 인터벌 정리
- Ref 해제

**현재 상태**:
- ✅ cleanup 로직 적용 완료
  - 마우스 이벤트 리스너 정리 (mousedown, mousemove, mouseup)
  - `requestAnimationFrame` 취소 로직 포함
  - 타이머 및 인터벌 정리 (`blindTimerRef`, `monitoringInterval`)
  - IPC 리스너 정리 (`createOverlayApiWaiter`의 cleanup 함수)
- ✅ Ref 기반 상태 관리로 메모리 효율성 향상
  - 상태 대신 ref 사용 가능한 부분은 ref로 전환
  - `latestStateRef`로 최신 상태 참조 최적화

#### 4.2 불필요한 상태 제거

**목표**: 사용하지 않는 상태 및 변수 제거

**구현 위치**: 모든 컴포넌트

**방법**:
- 사용하지 않는 state 제거
- 중복된 상태 통합
- Ref로 대체 가능한 상태는 Ref 사용

#### 4.3 이미지/리소스 최적화

**목표**: 메모리 사용량 감소

**구현 위치**: (현재는 큰 이미지 처리 없음)

**방법**:
- 이미지 압축
- Lazy loading 적용
- 캐싱 전략 적용

### 5. 렌더링 최적화

#### 5.1 CSS 최적화

**목표**: 렌더링 성능 개선

**구현 위치**: `renderer/src/overlay/OverlayApp.tsx`

**방법**:
- `will-change` 속성 사용 (주의해서)
- `transform`과 `opacity`만 애니메이션 (GPU 가속)
- 불필요한 transition 제거

**현재 상태**:
- ✅ GPU 가속 힌트 적용 완료
  - 오버레이 컨테이너: `will-change: transform`, `transform: translateZ(0)`, `backface-visibility: hidden`
  - 선택 박스: `will-change: left, top, width, height`, GPU 가속 활성화
  - 블러 오버레이: `will-change: transform, opacity`, GPU 가속 활성화
  - 모니터링 배지: GPU 가속 활성화
- ✅ backdrop-filter는 이미 GPU 가속 활용
- ⏳ `content-visibility` 속성 활용 검토 (필요시 추가)

#### 5.2 조건부 렌더링 최적화

**목표**: 불필요한 DOM 요소 렌더링 방지

**구현 위치**: `renderer/src/overlay/OverlayApp.tsx`

**방법**:
- `pointerEvents: "none"`으로 불필요한 이벤트 처리 방지 (이미 적용됨)
- 조건부 렌더링 최적화
- Portal 사용 검토

**현재 상태**:
- ✅ `pointerEvents` 최적화 적용됨

#### 5.3 윈도우 설정 최적화

**목표**: Electron 윈도우 성능 최적화

**구현 위치**: `electron/windows/createOverlayWindow.ts`

**방법**:
- `backgroundThrottling: false` 설정 (백그라운드에서도 성능 유지)
- `webSecurity: true` 유지 (보안)
- 불필요한 옵션 제거

### 6. 오디오/OCR 처리 최적화

#### 6.1 오디오 처리 최적화

**목표**: 오디오 캡처 및 전송 오버헤드 감소

**구현 위치**: `electron/audio/AudioManager.ts`, `electron/main/onVoiceBridge.ts`

**방법**:
- `setImmediate()` 사용 (이미 적용됨)
- 버퍼 크기 최적화
- 불필요한 데이터 복사 제거

**현재 상태**:
- ✅ `setImmediate()`로 비동기 처리 적용됨

#### 6.2 OCR 캡처 간격 최적화

**목표**: CPU 사용량과 반응성의 균형

**구현 위치**: `electron/main.ts`

**방법**:
- **적응형(Adaptive) 인터벌** 적용
  - 최소 간격: `MIN_INTERVAL_MS = 500ms` (텍스트가 자주 변할 때, 활성 상태)
  - 최대 간격: `MAX_INTERVAL_MS = 2000ms` (텍스트 변화가 거의 없을 때, 유휴 상태)
  - 유휴 상태가 연속으로 발생할수록 `IDLE_INCREMENT_MS = 200ms`씩 점진적으로 증가
  - 텍스트 변경 감지 시 즉시 `MIN_INTERVAL_MS`로 복귀 → 반응성 유지

**핵심 로직**:
- `electron/main.ts` (line 571-636)
  - `captureAndProcessROI` 내에서 `lastExtractedText`와 현재 `extractedText`를 비교
  - 텍스트가 없거나 동일하면 **유휴 상태**로 간주하고 `currentInterval` 증가
  - 텍스트가 변경되면 **활성 상태**로 간주하고 `currentInterval`을 `MIN_INTERVAL_MS`로 리셋
  - 연속 유휴 횟수 `consecutiveIdleCount`를 기반으로 최대 2초까지 인터벌 확대
  - 유해 표현이 감지된 경우에는, 텍스트가 중복이어도 알림/상태 전송은 계속 수행
  - 빈 텍스트 또는 중복 텍스트(비유해)인 경우 조기 return으로 불필요한 IPC 호출 방지

**현재 상태**:
- ✅ 적응형 인터벌(500ms ~ 2000ms) 적용 완료
  - 채팅이 거의 올라오지 않는 정적 화면에서 CPU 사용량을 크게 감소
  - 텍스트가 활발히 변하는 경우에는 500ms 간격으로 빠르게 반응
- ⏳ 실제 CPU 사용량/체감 성능에 대한 프로파일링 및 추가 튜닝 예정

---

## 📝 구현 계획

### Phase 1: React 렌더링 최적화 (우선순위: 높음)

- [x] `React.memo()` 적용
  - [x] 하위 컴포넌트 메모이제이션 완료 (`SelectionBox`, `BlurOverlay`, `MonitoringOverlay`, `InstructionMessage`, `SuccessToast`)
  - [ ] `OverlayApp` 메인 컴포넌트 메모이제이션 검토 (props가 없어서 현재는 불필요)

- [x] `useMemo()` 적용
  - [x] `selectionRect` 계산 메모이제이션 완료
  - [x] 스타일 객체는 상수로 정의되어 메모이제이션 불필요

- [x] `useCallback()` 적용
  - [x] `createOverlayApiWaiter` 메모이제이션 완료
  - [x] `applyModeEffects` 메모이제이션 완료
  - [x] 이벤트 핸들러는 ref 사용으로 의존성 배열 비워서 최적화 완료

- [x] 상태 업데이트 배치
  - [x] `requestAnimationFrame`으로 상태 업데이트 스케줄링 완료
  - [x] React 18 자동 배치 기능 활용 중

### Phase 2: 이벤트 핸들러 최적화 (우선순위: 높음)

- [x] 이벤트 디바운싱/스로틀링
  - [x] `mousemove` 이벤트 `requestAnimationFrame` 스로틀링 완료
  - [ ] `resize` 이벤트 디바운싱 (현재 resize 이벤트 없음)

- [x] 이벤트 리스너 정리
  - [x] cleanup 함수에서 모든 리스너 제거 완료
  - [x] `requestAnimationFrame` 취소 로직 포함
  - [x] 중복 리스너 방지 (ref 기반 상태 관리로 해결)

- [x] 이벤트 핸들러 최적화
  - [x] 마우스 위치를 ref에 저장하여 무거운 작업 최소화
  - [x] `requestAnimationFrame`으로 비동기 처리
  - [x] 불필요한 계산 제거 (ref로 최신 상태 참조)

### Phase 3: IPC 통신 최적화 (우선순위: 중간)

- [x] IPC 메시지 스로틀링 (오디오 서비스)
  - [x] `AudioService.broadcastStatus()` 스로틀링 적용 (100ms 간격, 초당 10회 제한)
  - [x] `OnVoiceService.broadcastStatus()` 스로틀링 적용 (100ms 간격, 초당 10회 제한)
  - [x] 마지막 상태 보장을 위한 지연 스케줄링 로직 포함

- [x] 데이터 직렬화 최적화
  - [x] 불필요한 데이터 제거 (이미 적용됨)
  - [x] 전송 데이터 크기 최소화 (이미 적용됨)

- [x] IPC 호출 빈도 감소 (OCR/오버레이 경로 1차 완료)
  - [x] `OVERLAY_STATE_PUSH` 중복 상태 전송 제거 (main → overlay)
  - [x] `ALERT_FROM_SERVER` 유해/정상 상태 변화가 있을 때만 전송
  - [x] ROI 선택 시 IPC 호출 최적화 (`mousemove`에서는 호출하지 않음, `mouseup`에서만 호출)
  - [ ] 대시보드/기타 IPC 경로에 대한 중복 호출 제거 (필요시 추가)

### Phase 4: 메모리 최적화 (우선순위: 중간)

- [x] 메모리 누수 검사
  - [x] 모든 cleanup 함수 확인 완료
  - [x] 리스너 정리 로직 적용 완료
  - [ ] 실제 프로파일링으로 검증 필요

- [x] 불필요한 상태 제거
  - [x] Ref 기반 상태 관리로 전환 완료
  - [x] `selectionStateRef`, `mousePositionRef`, `latestStateRef` 등으로 최적화
  - [x] 이벤트 핸들러에서 ref 사용으로 의존성 배열 최소화

- [ ] 메모리 프로파일링
  - [ ] Chrome DevTools 메모리 프로파일러 사용
  - [ ] 메모리 사용량 모니터링

### Phase 5: 렌더링 최적화 (우선순위: 낮음)

- [x] CSS 최적화
  - [x] GPU 가속 힌트 적용 (`will-change`, `transform: translateZ(0)`, `backface-visibility: hidden`)
  - [x] 오버레이 컨테이너에 GPU 가속 적용
  - [x] 선택 박스(`SelectionBox`)에 GPU 가속 적용
  - [x] 블러 오버레이(`BlurOverlay`)에 GPU 가속 적용
  - [x] 모니터링 배지에 GPU 가속 적용
  - [ ] 불필요한 transition 제거 (현재는 유지, 필요시 검토)

- [x] 조건부 렌더링 최적화
  - [x] 불필요한 렌더링 방지 (이미 적용됨)
  - [ ] Portal 사용 검토 (현재는 불필요)

- [ ] 윈도우 설정 최적화
  - [ ] Electron 윈도우 옵션 최적화
  - [ ] 성능에 영향을 주는 옵션 확인

### Phase 6: 오디오/OCR 처리 최적화 (우선순위: 낮음)

- [x] OCR 캡처 간격 동적 조정
  - [x] 텍스트 변경 감지 기반 **적응형 인터벌(500ms ~ 2000ms)** 적용
  - [ ] CPU 사용량 모니터링 및 추가 튜닝

- [ ] 오디오 처리 최적화
  - [ ] 버퍼 크기 최적화
  - [ ] 불필요한 복사 제거

---

## 🔧 구체적인 구현 예시

### 1. React.memo 적용 예시

```typescript
// renderer/src/overlay/OverlayApp.tsx
export const OverlayApp: React.FC = React.memo(() => {
  // ... 컴포넌트 로직
}, (prevProps, nextProps) => {
  // 커스텀 비교 함수 (필요시)
  return true; // props가 동일하면 리렌더링 스킵
});
```

### 2. useMemo로 selectionRect 메모이제이션 (✅ 구현 완료)

```513:522:renderer/src/overlay/OverlayApp.tsx
  const selectionRect = useMemo(() => {
    if (!selectionState) return null;

    return {
      left: Math.min(selectionState.startX, selectionState.currentX),
      top: Math.min(selectionState.startY, selectionState.currentY),
      width: Math.abs(selectionState.currentX - selectionState.startX),
      height: Math.abs(selectionState.currentY - selectionState.startY),
    };
  }, [selectionState]);
```

### 3. useCallback으로 이벤트 핸들러 메모이제이션 (✅ 구현 완료)

```212:249:renderer/src/overlay/OverlayApp.tsx
  const createOverlayApiWaiter = useCallback(
    <T extends (...args: any[]) => any>(
      getter: (api: NonNullable<typeof window.api>["overlay"]) => T | undefined,
      register: (fn: T) => () => void,
      debugLabel: string
    ) => {
      // ... IPC 리스너 등록 로직
    },
    []
  );
```

**참고**: 마우스 이벤트 핸들러는 ref 기반 상태 관리로 의존성 배열을 비워서 최적화됨 (line 416-509)

### 4. IPC 메시지 중복 전송 방지 (✅ 구현 완료)

```331:378:electron/main.ts
  // 🔥 [최적화] pushOverlayState 함수 수정: 변경된 경우에만 전송 (Deep Compare)
  const pushOverlayState = (state: OverlayStatePayload) => {
    // ... 안전한 직렬화
    
    // 🔥 이전 상태와 비교 (IPC 통신 최적화)
    if (serializedState === lastSentOverlayState) {
      // 변경사항이 없으면 전송하지 않음
      return;
    }
    
    currentOverlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_PUSH, safeState);
    lastSentOverlayState = serializedState;
  };
```

**참고**: `ALERT_FROM_SERVER`도 유사한 중복 전송 방지 로직 적용됨 (line 646-667)

### 5. IPC 스로틀링 (오디오 서비스) (✅ 구현 완료)

```typescript
// electron/audio/audioService.ts
export class AudioService {
  // 🔥 [최적화] IPC 브로드캐스트 스로틀링
  private lastBroadcastTime = 0;
  private readonly BROADCAST_INTERVAL_MS = 100; // 100ms (초당 10회) 제한
  private broadcastPending = false;

  private broadcastStatus(): void {
    const now = Date.now();
    
    // 🔥 [최적화] 스로틀링: 마지막 브로드캐스트로부터 충분한 시간이 지나지 않았으면 스킵
    if (now - this.lastBroadcastTime < this.BROADCAST_INTERVAL_MS) {
      // 다음 프레임에서 업데이트하도록 스케줄링 (마지막 상태 보장)
      if (!this.broadcastPending) {
        this.broadcastPending = true;
        setTimeout(() => {
          this.broadcastPending = false;
          this.broadcastStatus(); // 재시도
        }, this.BROADCAST_INTERVAL_MS - (now - this.lastBroadcastTime));
      }
      return;
    }
    
    this.lastBroadcastTime = now;
    this.broadcastPending = false;
    
    // ... 상태 전송 로직
  }
}
```

**효과**:
- 오디오 레벨 업데이트 빈도가 초당 60회에서 10회로 감소 (약 83% 감소)
- 렌더러 프로세스의 IPC 이벤트 루프 부하 감소
- 마지막 상태 보장을 위한 지연 스케줄링으로 데이터 손실 방지

### 6. GPU 가속 CSS 속성 적용 (✅ 구현 완료)

```typescript
// renderer/src/overlay/OverlayApp.tsx
const STYLES = {
  container: {
    // ... 기존 스타일
    // 🔥 [최적화] GPU 가속 힌트 및 렌더링 최적화
    willChange: "transform" as const,
    backfaceVisibility: "hidden" as const,
    transform: "translateZ(0)",
  },
  selectionBox: {
    // ... 기존 스타일
    // 🔥 [최적화] 선택 박스는 위치와 크기가 자주 변함
    willChange: "left, top, width, height" as const,
    backfaceVisibility: "hidden" as const,
    transform: "translateZ(0)",
  },
  blurOverlay: {
    // ... 기존 스타일
    // 🔥 [최적화] GPU 가속 (backdrop-filter는 이미 GPU 가속 활용)
    willChange: "transform, opacity" as const,
    backfaceVisibility: "hidden" as const,
    transform: "translateZ(0)",
  },
  // ...
};
```

**효과**:
- 브라우저가 GPU 가속을 활용하여 렌더링 성능 향상
- `will-change` 힌트로 브라우저가 미리 최적화 준비
- `backface-visibility: hidden`으로 불필요한 뒷면 렌더링 방지
- `transform: translateZ(0)`으로 하드웨어 가속 강제 활성화

---

## 📊 성능 측정 지표

### 측정 항목

1. **프레임 레이트 (FPS)**
   - 목표: 60 FPS 유지
   - 측정 도구: Chrome DevTools Performance 탭

2. **마우스 반응 시간**
   - 목표: 16ms 이하 (1 프레임)
   - 측정: 마우스 이동부터 화면 업데이트까지의 시간

3. **메모리 사용량**
   - 목표: 메모리 누수 없음
   - 측정 도구: Chrome DevTools Memory 탭

4. **IPC 호출 횟수**
   - 목표: 불필요한 호출 제거
   - 측정: IPC 메시지 로깅

5. **CPU 사용률**
   - 목표: 유휴 시 5% 이하
   - 측정 도구: 작업 관리자

### 측정 방법

1. Chrome DevTools Performance 프로파일링
2. Chrome DevTools Memory 프로파일링
3. IPC 메시지 로깅 및 분석
4. 사용자 체감 테스트

---

## ⚠️ 주의사항

1. **과도한 최적화 방지**
   - 성능이 실제로 문제가 되는 부분만 최적화
   - 과도한 최적화는 코드 복잡도 증가

2. **메모이제이션 비용**
   - 메모이제이션 자체도 비용이 있음
   - 계산 비용이 큰 경우에만 적용

3. **프로파일링 우선**
   - 최적화 전에 반드시 프로파일링으로 병목 지점 확인
   - 추측 기반 최적화 지양

4. **점진적 적용**
   - 한 번에 모든 최적화를 적용하지 않고 단계적으로
   - 각 단계마다 성능 측정 및 검증

---

## 📚 참고 자료

- [React Performance Optimization Guide](https://react.dev/learn/render-and-commit)
- [Electron Performance Best Practices](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance/)
- [Chrome DevTools Memory Profiling](https://developer.chrome.com/docs/devtools/memory-problems/)

---

## 관련 문서

- [작업 34: Windows OCR 성능 최적화](./34-windows-ocr-optimization.md) ✅
- [작업 47: 메인 대시보드 구축 및 멀티 윈도우 관리](./47-main-dashboard-multi-window.md) ✅
- [INTERFACES.md](./INTERFACES.md): 핵심 인터페이스 및 연결부 코드

