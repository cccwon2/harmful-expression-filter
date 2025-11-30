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

## 🔍 현재 성능 문제 분석

### 1. 마우스 버벅거림 (OCR 모드)

**문제점**:
- ROI 선택 시 `mousemove` 이벤트마다 React 상태 업데이트 발생
- 매 이벤트마다 컴포넌트 리렌더링으로 인한 성능 저하
- 상태 업데이트가 동기적으로 처리되어 메인 스레드 블로킹

**영향받는 파일**:
- `renderer/src/overlay/OverlayApp.tsx`: ROI 선택 마우스 이벤트 핸들러

**현재 상태**:
- ✅ `requestAnimationFrame`을 사용한 상태 업데이트 스케줄링 적용 (부분적 완료)
- ✅ Ref 기반 상태 관리로 클로저 문제 해결
- ⏳ 추가 최적화 필요: 디바운싱, 메모이제이션 등

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
- 동기적 IPC 호출로 인한 블로킹

**영향받는 파일**:
- `electron/main.ts`: OCR 캡처 및 상태 업데이트
- `electron/ipc/roi.ts`: ROI 선택 이벤트 처리
- `electron/preload.ts`: IPC 통신 래퍼

### 4. 상태 관리 최적화 부족

**문제점**:
- 불필요한 상태 업데이트가 빈번히 발생
- 상태 변경으로 인한 연쇄 리렌더링
- 메모이제이션 미적용으로 인한 중복 계산

**영향받는 파일**:
- `renderer/src/overlay/OverlayApp.tsx`: 상태 관리 로직
- `electron/main.ts`: 메인 프로세스 상태 관리

### 5. 이벤트 리스너 최적화 부족

**문제점**:
- 등록된 이벤트 리스너가 많음
- 이벤트 핸들러에서 무거운 작업 수행
- 불필요한 이벤트 리스너가 정리되지 않음

**영향받는 파일**:
- 모든 컴포넌트의 `useEffect` 훅
- `electron/main.ts`: 윈도우 이벤트 핸들러

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

**예상 효과**:
- 리렌더링 횟수 50% 이상 감소
- 마우스 이동 시 프레임 드롭 감소

#### 1.2 상태 업데이트 배치 처리

**목표**: 상태 업데이트를 배치하여 리렌더링 최소화

**구현 위치**: `renderer/src/overlay/OverlayApp.tsx`

**방법**:
- `requestAnimationFrame`으로 상태 업데이트 스케줄링 (이미 적용됨)
- 여러 상태 업데이트를 하나로 배치
- React 18의 자동 배치 기능 활용

**현재 상태**:
- ✅ `requestAnimationFrame` 적용 완료
- ⏳ 상태 업데이트 배치 처리 추가 필요

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
- ✅ `requestAnimationFrame`으로 기본 스로틀링 효과
- ⏳ 추가 디바운싱 로직 검토 필요

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
- ✅ `pushOverlayState`에서 안전한 직렬화 적용
- ⏳ 추가 최적화 검토 필요

### 4. 메모리 최적화

#### 4.1 메모리 누수 방지

**목표**: 컴포넌트 언마운트 시 모든 리스너 정리

**구현 위치**: 모든 React 컴포넌트

**방법**:
- `useEffect`의 cleanup 함수에서 모든 리스너 제거
- 타이머 및 인터벌 정리
- Ref 해제

**현재 상태**:
- ✅ 대부분의 cleanup 로직 적용됨
- ⏳ 누락된 부분 검토 필요

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
- ✅ backdrop-filter는 GPU 가속 활용
- ⏳ 추가 CSS 최적화 검토 필요

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
- 캡처 간격을 상황에 따라 조정 (정적: 800ms)
- 동적 간격 조정 검토 (텍스트 변경 시 더 자주, 동일 시 덜 자주)

**현재 상태**:
- ✅ 800ms 간격 적용 (이전 500ms에서 증가)
- ⏳ 동적 간격 조정 검토 필요

---

## 📝 구현 계획

### Phase 1: React 렌더링 최적화 (우선순위: 높음)

- [ ] `React.memo()` 적용
  - [ ] `OverlayApp` 컴포넌트 메모이제이션
  - [ ] 하위 컴포넌트 메모이제이션 검토

- [ ] `useMemo()` 적용
  - [ ] `selectionRect` 계산 메모이제이션
  - [ ] 스타일 객체 메모이제이션

- [ ] `useCallback()` 적용
  - [ ] 이벤트 핸들러 메모이제이션
  - [ ] 콜백 함수 메모이제이션

- [ ] 상태 업데이트 배치
  - [ ] 관련 상태 변경을 하나로 묶기
  - [ ] React 18 자동 배치 활용

### Phase 2: 이벤트 핸들러 최적화 (우선순위: 높음)

- [ ] 이벤트 디바운싱/스로틀링
  - [ ] `mousemove` 이벤트 추가 스로틀링 검토
  - [ ] `resize` 이벤트 디바운싱

- [ ] 이벤트 리스너 정리
  - [ ] 사용하지 않는 리스너 제거
  - [ ] 중복 리스너 제거

- [ ] 이벤트 핸들러 최적화
  - [ ] 무거운 작업을 비동기로 이동
  - [ ] 불필요한 계산 제거

### Phase 3: IPC 통신 최적화 (우선순위: 중간)

- [ ] IPC 메시지 배치
  - [ ] 상태 업데이트 배치 로직 구현
  - [ ] 큐 기반 메시지 전송

- [ ] 데이터 직렬화 최적화
  - [ ] 불필요한 데이터 제거
  - [ ] 전송 데이터 크기 최소화

- [ ] IPC 호출 빈도 감소
  - [ ] 중복 호출 제거
  - [ ] 필요한 경우에만 전송

### Phase 4: 메모리 최적화 (우선순위: 중간)

- [ ] 메모리 누수 검사
  - [ ] 모든 cleanup 함수 확인
  - [ ] 리스너 누수 확인

- [ ] 불필요한 상태 제거
  - [ ] 사용하지 않는 state 제거
  - [ ] Ref로 대체 가능한 상태 변경

- [ ] 메모리 프로파일링
  - [ ] Chrome DevTools 메모리 프로파일러 사용
  - [ ] 메모리 사용량 모니터링

### Phase 5: 렌더링 최적화 (우선순위: 낮음)

- [ ] CSS 최적화
  - [ ] 불필요한 transition 제거
  - [ ] GPU 가속 활용 최적화

- [ ] 조건부 렌더링 최적화
  - [ ] 불필요한 렌더링 방지
  - [ ] Portal 사용 검토

- [ ] 윈도우 설정 최적화
  - [ ] Electron 윈도우 옵션 최적화
  - [ ] 성능에 영향을 주는 옵션 확인

### Phase 6: 오디오/OCR 처리 최적화 (우선순위: 낮음)

- [ ] OCR 캡처 간격 동적 조정
  - [ ] 텍스트 변경 감지 기반 간격 조정
  - [ ] CPU 사용량 모니터링

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

### 2. useMemo로 selectionRect 메모이제이션

```typescript
const selectionRect = useMemo(() => {
  if (!selectionStateRef.current) return null;
  
  const state = selectionStateRef.current;
  return {
    left: Math.min(state.startX, state.currentX),
    top: Math.min(state.startY, state.currentY),
    width: Math.abs(state.currentX - state.startX),
    height: Math.abs(state.currentY - state.startY),
  };
}, [selectionState]); // selectionState 변경 시에만 재계산
```

### 3. useCallback으로 이벤트 핸들러 메모이제이션

```typescript
const handleMouseDown = useCallback((e: MouseEvent) => {
  // ... 핸들러 로직
}, []); // 의존성 배열 비어있음 (ref 사용으로 클로저 문제 없음)
```

### 4. IPC 메시지 배치 처리

```typescript
// electron/main.ts
let stateUpdateQueue: OverlayStatePayload[] = [];
let stateUpdateTimer: NodeJS.Timeout | null = null;

const queueStateUpdate = (state: OverlayStatePayload) => {
  stateUpdateQueue.push(state);
  
  if (!stateUpdateTimer) {
    stateUpdateTimer = setTimeout(() => {
      // 큐의 마지막 상태만 전송 (중간 상태는 무시)
      const latestState = stateUpdateQueue[stateUpdateQueue.length - 1];
      pushOverlayState(latestState);
      
      stateUpdateQueue = [];
      stateUpdateTimer = null;
    }, 16); // 한 프레임(16ms) 내의 모든 업데이트를 배치
  }
};
```

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

