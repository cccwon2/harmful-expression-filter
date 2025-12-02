# 작업 49: 유해 표현 블라인드 처리 및 OCR 연속 감지

## 상태

✅ Phase 1, 2, 3 완료 (트레이 메뉴 블러 강도 설정 추가 완료, 테스트 필요)

## 📋 작업 개요

**목표**: 유해 텍스트를 사용자에게 가리면서도(Blind), OCR 엔진은 계속해서 그 뒤의 텍스트를 읽어 연속 감지가 가능하도록 구현

**핵심 문제**:
- 유해 표현을 가리기 위해 오버레이에 블러를 띄우면, 다음 OCR 캡처 시 블러된 화면이 찍혀서 글씨 인식이 안 되는 문제(Self-Blinding)
- 사용자는 유해 내용을 보지 못해야 하지만, OCR은 계속 원본 텍스트를 읽어야 함

**관련 작업**:
- T16 (서버 알림 및 블라인드 처리) ✅ - 기본 블라인드 로직 구현
- T48 (애플리케이션 성능 최적화) ✅ - GPU 가속 및 렌더링 최적화
- 현재 작업: OCR 연속 감지를 위한 기술적 해결책 구현

---

## 🎯 목표

1. **UX 개선**: 단순 어둡게 처리(Dimming)보다 세련된 블러 처리 방식 적용
2. **기술적 해결**: 오버레이 블러가 OCR 캡처에 영향을 주지 않도록 설정
3. **연속 감지**: 유해 표현이 사라지면 즉시 블러 해제하여 반응성 유지

---

## ✅ 완료된 작업 요약

### Phase 1: 윈도우 캡처 제외 설정 ✅
- `setContentProtection(true)` 적용 완료
- Windows에서만 동작하도록 플랫폼 체크
- OCR 캡처 시 오버레이가 제외되어 원본 화면만 캡처됨

### Phase 2: UX 개선 ✅
- 블러 오버레이에 아이콘 및 안내 메시지 추가
- 애니메이션 효과 추가 (페이드인 + 스케일)
- 스타일 개선 (중앙 정렬, 텍스트 그림자)

### Phase 3: 블러 강도 조정 ✅
- 설정 스키마에 `blurIntensity` 추가
- IPC로 설정 전달 및 동적 적용
- 사용자 설정에 따라 15px, 25px, 40px 중 선택 가능
- **트레이 메뉴에 블러 강도 설정 추가** (15px, 25px, 40px 선택 가능)
- 트레이 메뉴에서 설정 변경 시 즉시 오버레이에 반영
- "영역 재지정" 메뉴 제거 (기능 중복 제거)
- **트레이 메뉴에 블러 강도 설정 추가** (15px, 25px, 40px 선택 가능)
- 트레이 메뉴에서 설정 변경 시 즉시 오버레이에 반영

---

## 🔍 현재 구현 상태

### ✅ Phase 1 완료: 윈도우 캡처 제외 설정

```typescript
// electron/windows/createOverlayWindow.ts
// 🔥 [Task 49] Windows에서만 오버레이를 화면 캡처에서 제외
if (process.platform === 'win32') {
  try {
    overlayWindow.setContentProtection(true);
    console.log('[Overlay] ✅ Content protection enabled (OCR will ignore overlay)');
  } catch (error) {
    console.warn('[Overlay] ⚠️ Failed to enable content protection:', error);
  }
}
```

**효과**:
- OCR 캡처 시 오버레이가 무시되어 원본 화면만 캡처됨
- 사용자는 블러 처리된 화면을 보지만, OCR은 블러 뒤의 원본 텍스트를 계속 읽을 수 있음

### ✅ Phase 2 완료: 개선된 블러 오버레이 구현

```118:131:renderer/src/overlay/OverlayApp.tsx
// [Component] 유해 감지 블러 오버레이 (Task 49: UX 개선)
const BlurOverlay = React.memo(({ roi }: { roi: ROI }) => {
  return (
    <div
      style={{
        ...STYLES.blurOverlay,
        left: roi.x,
        top: roi.y,
        width: roi.width,
        height: roi.height,
      }}
    >
      <div style={STYLES.blurIcon}>⚠️</div>
      <div style={STYLES.blurMessage}>
        유해 표현이 감지되어 가려졌습니다
      </div>
    </div>
  );
});
```

**개선된 스타일**:
- `backdrop-filter: blur(40px)` - 강력한 블러 효과 (동적 조정 가능)
- `backgroundColor: rgba(0, 0, 0, 0.8)` - 어두운 배경
- GPU 가속 활성화 (`transform: translateZ(0)`, `will-change`)
- **중앙 정렬**: `display: flex`, `alignItems: center`, `justifyContent: center`
- **아이콘**: ⚠️ 경고 아이콘 추가
- **안내 메시지**: "유해 표현이 감지되어 가려졌습니다" 텍스트 추가
- **텍스트 스타일**: 그림자 효과, 중앙 정렬, 가독성 향상
- **애니메이션**: 페이드인 및 스케일 효과 (0.3s ease)
- **동적 블러 강도**: 사용자 설정에 따라 15px, 25px, 40px 중 선택 가능

---

## 💡 해결 방안

### 방법 A: 윈도우 캡처 제외 설정 (추천) ⭐

**원리**: Electron 오버레이 윈도우를 **스크린샷(OCR 캡처)에는 찍히지 않고, 사람 눈에만 보이게** 설정

**Windows API**: `SetWindowDisplayAffinity`를 사용하여 오버레이 윈도우를 캡처에서 제외

**결과**:
- **사용자 눈**: 오버레이의 블러 처리가 보여서 글씨가 안 보임
- **OCR 엔진**: 오버레이가 투명하게 취급되어 **블러 뒤의 원본 텍스트를 그대로 캡처**하고 계속 감시

**Electron 구현**:

```typescript
// electron/windows/createOverlayWindow.ts
export function createOverlayWindow(): BrowserWindow {
  const overlayWindow = new BrowserWindow({
    // ... 기존 옵션
  });

  // 🔥 [최적화] 오버레이 윈도우를 화면 캡처에서 제외
  // 이렇게 하면 OCR 캡처 시 오버레이가 무시되어 원본 화면만 캡처됨
  overlayWindow.setContentProtection(true);

  return overlayWindow;
}
```

**참고**: 
- `setContentProtection(true)`는 원래 DRM 콘텐츠 보호용이지만, Windows에서는 **이 윈도우를 화면 캡처에서 제외**하는 효과를 냅니다.
- 이를 적용하면 오버레이에 무엇을 그리든 OCR 엔진은 그 뒤의 게임 화면만 캡처합니다.

**장점**:
- 구현이 간단하고 깔끔함
- OCR 성능에 영향 없음
- 사용자 경험 유지

**단점**:
- Windows에서만 동작 (다른 OS에서는 다른 방법 필요)
- 일부 화면 캡처 도구에서도 오버레이가 보이지 않을 수 있음

---

### 방법 B: 좌표 기반 마스킹 (Bounding Box Masking)

**원리**: ROI 전체를 가리는 대신, **유해하다고 판단된 단어의 위치(좌표)에만** 검은 줄이나 블러를 씌우는 방식

**로직**:
1. OCR로 텍스트와 각 단어의 `BoundingRect`(좌표)를 얻는다
2. 서버 분석 결과 "바보"가 유해하다면, "바보"에 해당하는 좌표에만 `<div>`를 띄워 가린다
3. 나머지 문장은 계속 보인다

**장점**:
- 문맥을 파악하기 쉽고 가리는 영역이 최소화됨
- 부분적 가림으로 더 자연스러운 UX

**단점**:
- 구현 난이도가 높음 (좌표 매핑, 단어별 오버레이 관리)
- 방법 A를 쓰지 않으면 여전히 다음 캡처 때 가려진 단어를 인식 못 하는 문제가 남음
- Windows OCR API에서 단어별 좌표를 제공하는지 확인 필요

---

## 🎨 UX 개선 방안

### 1. 글래스모피즘 블러 (Glassmorphism Blur) - 현재 적용됨 ⭐

가장 현대적인 방식입니다. 유해 텍스트 위에 강력한 블러 효과를 주어 내용은 뭉개버리지만, 화면의 색감은 유지합니다.

**현재 구현**:
```typescript
blurOverlay: {
  backdropFilter: "blur(40px)",
  WebkitBackdropFilter: "blur(40px)",
  backgroundColor: "rgba(0, 0, 0, 0.8)",
  // ... 기타 스타일
}
```

**개선 제안**:
- 블러 강도 조정 가능: `blur(15px)` ~ `blur(40px)`
- 밝기 조정: `backdrop-filter: blur(15px) brightness(1.1)`
- 색상 톤 조정: 붉은 기운 추가 (`rgba(255, 50, 50, 0.1)`)

---

### 2. 픽셀 모자이크 (Pixelate)

게임 채팅창이라는 컨셉에 맞춰, 유해 텍스트를 픽셀 단위로 깨뜨려 보여줍니다.

**구현 방법**:
- Canvas API를 사용하여 이미지를 픽셀 단위로 처리
- CSS `image-rendering: pixelated` 활용 (제한적)
- WebGL을 사용한 고급 모자이크 효과

**장점**:
- 게임 오버레이와 이질감이 적음
- 8비트/레트로 게임 느낌

**단점**:
- 구현 복잡도 높음
- 성능 오버헤드 가능

---

### 3. 스포일러 커튼 (Spoiler Curtain)

Discord나 모바일 앱처럼 **"유해 내용 숨김 (클릭해서 보기)"**와 같은 버튼형 커버를 씌웁니다.

**구현 방법**:
```tsx
const SpoilerCurtain = ({ isHarmful, onReveal }) => {
  const [isRevealed, setIsRevealed] = useState(false);
  
  if (!isHarmful) return null;
  
  return (
    <div 
      style={{
        position: 'absolute',
        // ... ROI 좌표
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}
      onClick={() => setIsRevealed(!isRevealed)}
    >
      {!isRevealed ? (
        <div>
          <span>⚠️ 유해 내용 숨김</span>
          <div style={{ fontSize: '0.8em', marginTop: 8 }}>
            클릭하여 보기
          </div>
        </div>
      ) : (
        <div style={{ filter: 'blur(5px)' }}>
          {/* 원본 내용 (약간의 블러만) */}
        </div>
      )}
    </div>
  );
};
```

**장점**:
- 사용자가 원할 경우 클릭해서 내용을 확인할 수 있는 선택권 제공
- 명확한 UX (사용자가 의도적으로 보기로 선택)

**단점**:
- 클릭 인터랙션이 필요 (게임 중 방해 가능)
- 구현 복잡도 증가

---

## 🚀 추천 구현 계획

### Phase 1: 윈도우 캡처 제외 설정 (우선순위: 높음)

**목표**: `setContentProtection(true)`를 적용하여 OCR 연속 감지 문제 해결

**구현 위치**: `electron/windows/createOverlayWindow.ts`

**방법**:
1. 오버레이 윈도우 생성 시 `setContentProtection(true)` 호출
2. Windows에서만 동작하므로 플랫폼 체크 추가
3. 테스트: OCR 캡처 시 오버레이가 제외되는지 확인

**예상 효과**:
- OCR이 블러 뒤의 원본 텍스트를 계속 읽을 수 있음
- 사용자는 블러 처리된 화면을 보지만, OCR은 영향받지 않음

---

### Phase 2: UX 개선 (우선순위: 중간)

**목표**: 블러 오버레이에 아이콘 및 안내 메시지 추가

**구현 위치**: `renderer/src/overlay/OverlayApp.tsx`

**방법**:
```tsx
// [Component] 유해 감지 블러 오버레이 (개선 버전)
const BlurOverlay = React.memo(({ roi }: { roi: ROI }) => {
  return (
    <div
      style={{
        ...STYLES.blurOverlay,
        left: roi.x,
        top: roi.y,
        width: roi.width,
        height: roi.height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
      }}
    >
      <div style={{
        fontSize: '24px',
        marginBottom: '8px',
      }}>
        ⚠️
      </div>
      <div style={{
        color: 'white',
        fontWeight: 'bold',
        textShadow: '0 2px 4px rgba(0,0,0,0.5)',
        textAlign: 'center',
        fontSize: '14px',
      }}>
        유해 표현이 감지되어 가려졌습니다
      </div>
    </div>
  );
});
```

**구현 완료**:
- ✅ 아이콘 및 안내 메시지 추가 완료
- ✅ 애니메이션 효과 추가 완료 (페이드인 + 스케일)
- ✅ 동적 블러 강도 적용 완료

**효과**:
- 사용자가 왜 화면이 가려졌는지 명확히 알 수 있음
- 부드러운 애니메이션으로 더 세련된 UX 제공
- 사용자 설정에 따라 블러 강도 조정 가능 (15px, 25px, 40px)

---

### Phase 3: 블러 강도 조정 가능 (우선순위: 낮음) ✅

**목표**: 사용자 설정에서 블러 강도 조정 가능하도록

**구현 위치**: 
- 설정 저장: `electron/store.ts`
- UI: 트레이 메뉴 (✅ 완료)
- 적용: `renderer/src/overlay/OverlayApp.tsx`

**구현 완료**:
- ✅ 설정 스키마에 `blurIntensity` 추가 (`electron/store.ts`)
- ✅ `getBlurIntensity()`, `setBlurIntensity()` 함수 구현
- ✅ IPC로 설정 전달 (`OVERLAY_STATE_PUSH`에 포함)
- ✅ 동적 스타일 적용 (렌더러에서 `blurIntensity` 상태로 관리)
- ✅ **트레이 메뉴에 블러 강도 설정 추가** (15px, 25px, 40px 선택 가능)
- ⏳ 대시보드에 블러 강도 슬라이더 추가 (향후 구현)

**방법**:
- 설정 값: `blurIntensity: 15 | 25 | 40` (px), 기본값: 40
- `pushOverlayState`에서 자동으로 `blurIntensity` 포함하여 전송
- 렌더러에서 `onStatePush`로 받아서 상태 업데이트
- `BlurOverlay` 컴포넌트에서 동적으로 `backdrop-filter: blur(${blurIntensity}px)` 적용

---

## 📝 구현 계획

### Phase 1: 윈도우 캡처 제외 설정

- [x] `createOverlayWindow.ts`에 `setContentProtection(true)` 추가
- [x] 플랫폼 체크 (Windows에서만 적용)
- [ ] OCR 캡처 테스트 (오버레이가 제외되는지 확인) - 테스트 필요
- [x] 문서화 및 주석 추가

### Phase 2: UX 개선

- [x] 블러 오버레이에 아이콘 추가
- [x] 안내 메시지 추가
- [x] 스타일 개선 (중앙 정렬, 텍스트 그림자 등)
- [x] 애니메이션 효과 추가
  - 페이드인 효과 (opacity 0 → 1)
  - 스케일 효과 (scale 0.95 → 1)
  - `requestAnimationFrame`을 사용한 부드러운 전환

### Phase 3: 블러 강도 조정

- [x] 설정 스키마에 `blurIntensity` 추가 (`electron/store.ts`)
- [x] `getBlurIntensity()`, `setBlurIntensity()` 함수 구현
- [x] IPC로 설정 전달 (`OVERLAY_STATE_PUSH`에 포함)
- [x] 동적 스타일 적용 (렌더러에서 `blurIntensity` 상태로 관리)
- [x] **트레이 메뉴에 블러 강도 설정 추가** (`electron/tray.ts`)
  - 현재 블러 강도 표시
  - 서브메뉴로 15px, 25px, 40px 선택 가능
  - 라디오 버튼으로 현재 선택값 표시
  - 설정 변경 시 즉시 오버레이에 반영
- [ ] 대시보드에 블러 강도 슬라이더 추가 (향후 구현)

---

## 🔧 구체적인 구현 예시

### 1. 윈도우 캡처 제외 설정

```typescript
// electron/windows/createOverlayWindow.ts
import { app } from 'electron';

export function createOverlayWindow(): BrowserWindow {
  const overlayWindow = new BrowserWindow({
    // ... 기존 옵션
  });

  // 🔥 [최적화] Windows에서만 오버레이를 화면 캡처에서 제외
  // 이렇게 하면 OCR 캡처 시 오버레이가 무시되어 원본 화면만 캡처됨
  if (process.platform === 'win32') {
    try {
      overlayWindow.setContentProtection(true);
      console.log('[Overlay] Content protection enabled (OCR will ignore overlay)');
    } catch (error) {
      console.warn('[Overlay] Failed to enable content protection:', error);
    }
  }

  return overlayWindow;
}
```

### 2. 개선된 블러 오버레이 컴포넌트 (✅ 구현 완료)

```137:155:renderer/src/overlay/OverlayApp.tsx
// [Component] 유해 감지 블러 오버레이 (Task 49: UX 개선 + 애니메이션 + 동적 블러 강도)
const BlurOverlay = React.memo(({ roi, blurIntensity = 40 }: { roi: ROI; blurIntensity?: number }) => {
  const [isVisible, setIsVisible] = React.useState(false);

  // 🔥 [Task 49] 애니메이션: 마운트 시 부드러운 페이드인 효과
  React.useEffect(() => {
    const timer = requestAnimationFrame(() => {
      setIsVisible(true);
    });
    return () => cancelAnimationFrame(timer);
  }, []);

  // 🔥 [Task 49] 동적 블러 강도 적용
  const blurValue = `${blurIntensity}px`;

  return (
    <div
      style={{
        ...STYLES.blurOverlay,
        backdropFilter: `blur(${blurValue})`,
        WebkitBackdropFilter: `blur(${blurValue})`,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateZ(0) scale(1)" : "translateZ(0) scale(0.95)",
        // ... 기타 스타일
      }}
    >
      <div style={STYLES.blurIcon}>⚠️</div>
      <div style={STYLES.blurMessage}>
        유해 표현이 감지되어 가려졌습니다
      </div>
    </div>
  );
});
```

### 3. 블러 강도 설정 저장 및 전달 (✅ 구현 완료)

```typescript
// electron/store.ts
export interface StoreData {
  // ... 기존 필드
  blurIntensity?: number; // 15 | 25 | 40 (px), 기본값: 40
}

export function getBlurIntensity(): number {
  const data = loadData();
  const intensity = data.blurIntensity ?? 40;
  // 유효한 값만 허용 (15, 25, 40)
  if ([15, 25, 40].includes(intensity)) {
    return intensity;
  }
  return 40; // 기본값
}

export function setBlurIntensity(intensity: number): void {
  const data = loadData();
  if ([15, 25, 40].includes(intensity)) {
    data.blurIntensity = intensity;
    saveData(data);
  }
}
```

```typescript
// electron/main.ts
const pushOverlayState = (state: OverlayStatePayload) => {
  // 🔥 [Task 49] 블러 강도 설정 가져오기
  const { getBlurIntensity } = require("./store");
  const blurIntensity = getBlurIntensity();

  const safeState: OverlayStatePayload = {
    mode: state.mode,
    harmful: state.harmful === true,
    blurIntensity, // 🔥 [Task 49] 블러 강도 포함
    // ... 기타 필드
  };
  
  currentOverlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_PUSH, safeState);
};
```

### 4. 트레이 메뉴에 블러 강도 설정 추가 (✅ 구현 완료)

```typescript
// electron/tray.ts
import { getBlurIntensity, setBlurIntensity } from './store';
import { getOverlayWindow } from './state/editMode';

// 트레이 메뉴 생성 시
const currentBlurIntensity = getBlurIntensity();

const contextMenu = Menu.buildFromTemplate([
  // ... 기타 메뉴 항목
  {
    type: 'separator',
  },
  {
    label: '--- 블러 강도 설정 (Blur Intensity) ---',
    enabled: false,
  },
  {
    label: `현재 블러 강도: ${currentBlurIntensity}px`,
    enabled: false,
  },
  {
    label: '블러 강도 설정',
    submenu: [
      {
        label: '15px (약함)',
        type: 'radio',
        checked: currentBlurIntensity === 15,
        click: () => {
          setTrayBlurIntensity(15);
          updateContextMenu();
        },
      },
      {
        label: '25px (보통)',
        type: 'radio',
        checked: currentBlurIntensity === 25,
        click: () => {
          setTrayBlurIntensity(25);
          updateContextMenu();
        },
      },
      {
        label: '40px (강함)',
        type: 'radio',
        checked: currentBlurIntensity === 40,
        click: () => {
          setTrayBlurIntensity(40);
          updateContextMenu();
        },
      },
    ],
  },
  // ... 기타 메뉴 항목
]);

/**
 * 트레이 메뉴에서 블러 강도 설정 (Task 49)
 */
function setTrayBlurIntensity(intensity: number): void {
  try {
    // 설정 저장
    setBlurIntensity(intensity);
    console.log(`[Tray] Blur intensity set to: ${intensity}px`);

    // 🔥 [Task 49] 오버레이 윈도우에 새로운 블러 강도 전달
    const currentOverlayWindow = getOverlayWindow();
    if (currentOverlayWindow && !currentOverlayWindow.isDestroyed()) {
      const { getROI, getMode } = require('./store');
      const currentROI = getROI();
      const currentMode = getMode();
      
      try {
        // 현재 상태를 가져와서 blurIntensity 포함하여 전송
        const statePayload = {
          mode: currentMode,
          blurIntensity: intensity, // 🔥 [Task 49] 새로운 블러 강도
          ...(currentROI ? { roi: currentROI } : {}),
        };
        
        currentOverlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_PUSH, statePayload);
        console.log(`[Tray] ✅ 블러 강도 설정 전달: ${intensity}px`);
      } catch (err: any) {
        console.warn('[Tray] 블러 강도 설정 전달 실패:', err?.message || err);
      }
    }
  } catch (err) {
    console.error('[Tray] Failed to set blur intensity:', err);
  }
}
```

**구현 내용**:
- 트레이 메뉴에 "블러 강도 설정" 섹션 추가
- 현재 블러 강도 표시 (예: "현재 블러 강도: 40px")
- 서브메뉴로 3가지 옵션 제공: 15px (약함), 25px (보통), 40px (강함)
- 라디오 버튼으로 현재 선택된 값 표시
- 설정 변경 시 즉시 오버레이에 반영 (IPC 전송)

**추가 개선사항**:
- "영역 재지정" 메뉴 제거 (기능이 "영역 지정"과 동일하여 중복 제거)

---

## 📊 테스트 계획

### 1. OCR 연속 감지 테스트

**목적**: 오버레이 블러가 OCR 캡처에 영향을 주지 않는지 확인

**절차**:
1. OCR 모니터링 시작
2. 유해 표현 입력 → 블러 오버레이 표시
3. 유해 표현 제거 → 블러 해제 확인
4. OCR이 계속 원본 텍스트를 읽는지 확인

**기대 결과**:
- 블러 오버레이가 표시되어도 OCR은 원본 텍스트를 계속 읽음
- 유해 표현이 사라지면 즉시 블러 해제

---

### 2. 화면 캡처 도구 테스트

**목적**: `setContentProtection(true)`가 실제로 작동하는지 확인

**절차**:
1. Windows 기본 스크린샷 도구 (Win+Shift+S)로 테스트
2. OBS Studio 등 화면 캡처 소프트웨어로 테스트
3. OCR 캡처 API로 테스트

**기대 결과**:
- 일부 화면 캡처 도구에서는 오버레이가 보이지 않음
- OCR 캡처에서는 오버레이가 제외되어 원본 화면만 캡처됨

---

## ⚠️ 주의사항

1. **플랫폼 호환성**
   - `setContentProtection(true)`는 Windows에서만 동작
   - macOS/Linux에서는 다른 방법 필요 (향후 구현)

2. **화면 캡처 도구 호환성**
   - 일부 화면 캡처 도구에서도 오버레이가 보이지 않을 수 있음
   - 사용자가 스크린샷을 찍을 때 오버레이가 포함되지 않을 수 있음

3. **성능 영향**
   - `setContentProtection`은 성능에 큰 영향 없음
   - 블러 효과는 이미 GPU 가속으로 최적화됨 (Task 48)

4. **사용자 경험**
   - 블러 강도가 너무 강하면 사용자가 답답해할 수 있음
   - 적절한 밸런스 유지 필요

---

## 📚 참고 자료

- [Electron BrowserWindow.setContentProtection()](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable)
- [Windows SetWindowDisplayAffinity API](https://docs.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)
- [CSS backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter)
- [작업 16: 서버 알림 및 블라인드 처리](./16-server-alert-blind.md) ✅
- [작업 48: 애플리케이션 성능 최적화](./48-performance-optimization.md) ✅

---

## 관련 문서

- [작업 16: 서버 알림 및 블라인드 처리](./16-server-alert-blind.md) ✅
- [작업 34: Windows OCR 성능 최적화](./34-windows-ocr-optimization.md) ✅
- [작업 47: 메인 대시보드 구축 및 멀티 윈도우 관리](./47-main-dashboard-multi-window.md) ✅
- [작업 48: 애플리케이션 성능 최적화](./48-performance-optimization.md) ✅

