# 작업 47: 메인 대시보드 구축 및 멀티 윈도우 관리

## 상태

📝 계획 단계 (To Do)

## 개요

앱 실행 시 즉시 오버레이(OCR)를 띄우던 기존 방식을 변경하여, **메인 대시보드(Home)**를 먼저 띄우고 사용자가 **음성 필터링**과 **OCR 필터링**을 선택적으로 켜고 끌 수 있는 구조로 개편합니다.

## 배경

### 사용자 경험(UX) 개선

- 앱 시작과 동시에 화면 전체를 가리는 오버레이는 사용자에게 강제적인 느낌을 줌
- 게임 화면을 가리지 않고 음성 채팅만 필터링하고 싶은 니즈를 충족시키지 못함
- 사용자가 원할 때만 OCR 기능을 활성화할 수 있어야 함

### 리소스 효율성

- OCR은 화면 캡처와 이미지 분석으로 리소스를 소모함
- 음성 필터링만 필요한 경우 OCR 프로세스를 비활성화하여 시스템 부하를 줄여야 함
- 불필요한 리소스 사용을 방지하여 배터리 수명 및 성능 향상

### 확장성

- 추후 통계 확인, 설정 변경 등을 위한 공간(대시보드)이 필요함
- 멀티 윈도우 관리 구조로 향후 기능 추가가 용이함

## 의존성

- [작업 42: Electron 앱 배포](./42-electron-app-deployment.md) ✅ - 윈도우 생성 로직 (`createOverlayWindow.ts`)
- [작업 45: Spawn 방식 Bridge 마이그레이션](./45-spawn-bridge-migration.md) ✅ - 음성 필터링 제어 연동
- [작업 46: Supabase 관리자 DB](./46-supabase-admin-db.md) - 로그 데이터 연동 (선택사항)

## 아키텍처 변경

### 기존 (Single Window Flow)

```
앱 실행 ➔ OverlayWindow 생성 (투명, 전체화면) ➔ 즉시 OCR 작동
```

### 변경 후 (Multi-Window Management)

```
앱 실행 ➔ MainWindow (Dashboard) 생성
         ➔ OverlayWindow 생성 (숨김 상태)
         
사용자 인터랙션:
  - 음성 필터링 ON/OFF ➔ C# Bridge 프로세스 제어
  - OCR 필터링 ON/OFF ➔ OverlayWindow 표시/숨김 & 캡처 루프 제어
```

## 구현 계획

### 1. Electron Main Process 수정

#### 1.1 윈도우 관리자 구현

**MainWindow (Dashboard)**:
- 일반적인 OS 윈도우 (프레임 있음, 크기 조절 가능)
- 앱 실행 시 기본으로 표시
- 대시보드 UI 표시

**OverlayWindow**:
- 투명, 클릭 투루(Click-through) 가능한 전체 화면 윈도우
- 앱 시작 시 생성하되 숨겨둠(`show: false`)으로 반응 속도를 확보
- 사용자가 OCR 필터링을 활성화할 때만 표시

#### 1.2 IPC 핸들러 구현

- `toggle-ocr`: OCR 필터링 ON/OFF 제어
- `toggle-voice`: 음성 필터링 ON/OFF 제어
- `get-window-status`: 현재 윈도우 상태 조회

### 2. Frontend 구현

#### 2.1 대시보드 UI

- **Status Cards**: 현재 서버 연결 상태, 마이크 감지 상태 표시
- **Feature Toggles**:
  - 🎙️ **Voice Filter**: ON/OFF 스위치
  - 👁️ **Screen (OCR) Filter**: ON/OFF 스위치
- **Logs Preview**: 최근 차단된 로그 3~5개 요약 표시 (Task 46 연동 준비)

#### 2.2 오버레이 최적화

- 오버레이가 숨겨졌을 때 불필요한 연산(캡처 루프) 중단
- CPU/GPU 리소스 절약

## 상세 구현 가이드

### 1. Electron Main Process 수정 (`electron/main.ts`)

#### 윈도우 관리자 구현

```typescript
// electron/main.ts
let dashboardWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;

async function createDashboardWindow() {
  dashboardWindow = new BrowserWindow({
    width: 900,
    height: 600,
    title: "OnVoice Dashboard",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // index.html 로드
  if (process.env.NODE_ENV === "development") {
    dashboardWindow.loadURL("http://localhost:5173/");
  } else {
    dashboardWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

async function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    transparent: true,
    frame: false,
    fullscreen: true,
    show: false, // 🔥 핵심: 초기에는 숨김
    skipTaskbar: true, // 작업표시줄에 표시 안 함
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // overlay.html 로드
  if (process.env.NODE_ENV === "development") {
    overlayWindow.loadURL("http://localhost:5173/overlay.html");
  } else {
    overlayWindow.loadFile(path.join(__dirname, "../renderer/overlay.html"));
  }
}

app.whenReady().then(async () => {
  await createDashboardWindow();
  await createOverlayWindow(); // 백그라운드에서 미리 로드
});
```

#### IPC 핸들러 구현

```typescript
// OCR 필터링 토글
ipcMain.on("toggle-ocr", (event, isEnabled: boolean) => {
  if (!overlayWindow) return;

  if (isEnabled) {
    overlayWindow.show();
    overlayWindow.setIgnoreMouseEvents(true, { forward: true }); // 클릭 투루
    overlayWindow.webContents.send("ocr-status-change", "start"); // 캡처 시작 신호
  } else {
    overlayWindow.hide();
    overlayWindow.webContents.send("ocr-status-change", "stop"); // 캡처 중지 신호
  }
});

// 음성 필터링 토글 (Task 45 연동)
ipcMain.on("toggle-voice", (event, isEnabled: boolean) => {
  // C# Bridge에 신호 전달 or 프로세스 관리
  // bridge.sendCommand({ type: "set-filter-active", value: isEnabled });
});
```

### 2. Frontend 구현

#### 2.1 대시보드 UI (`renderer/src/App.tsx` 또는 `renderer/src/pages/Dashboard.tsx`)

```typescript
// renderer/src/pages/Dashboard.tsx
import { useState, useEffect } from "react";

export default function Dashboard() {
  const [isOcrEnabled, setIsOcrEnabled] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);

  const toggleOCR = (enabled: boolean) => {
    window.electron.ipcRenderer.send("toggle-ocr", enabled);
    setIsOcrEnabled(enabled);
  };

  const toggleVoice = (enabled: boolean) => {
    window.electron.ipcRenderer.send("toggle-voice", enabled);
    setIsVoiceEnabled(enabled);
  };

  return (
    <div className="dashboard">
      <h1>OnVoice Dashboard</h1>
      
      <div className="status-cards">
        {/* 서버 연결 상태, 마이크 감지 상태 표시 */}
      </div>

      <div className="feature-toggles">
        <div className="toggle-item">
          <label>🎙️ Voice Filter</label>
          <input
            type="checkbox"
            checked={isVoiceEnabled}
            onChange={(e) => toggleVoice(e.target.checked)}
          />
        </div>
        
        <div className="toggle-item">
          <label>👁️ Screen (OCR) Filter</label>
          <input
            type="checkbox"
            checked={isOcrEnabled}
            onChange={(e) => toggleOCR(e.target.checked)}
          />
        </div>
      </div>

      <div className="logs-preview">
        {/* 최근 차단된 로그 3~5개 요약 표시 */}
      </div>
    </div>
  );
}
```

#### 2.2 오버레이 최적화 (`renderer/src/overlay/OverlayApp.tsx`)

```typescript
// renderer/src/overlay/OverlayApp.tsx
import { useEffect, useRef } from "react";

export default function OverlayApp() {
  const captureLoopRef = useRef<number | null>(null);

  useEffect(() => {
    // 메인 프로세스로부터 상태 변경 신호 수신
    const removeListener = window.electron.ipcRenderer.on(
      "ocr-status-change",
      (status: string) => {
        if (status === "start") {
          startCaptureLoop();
        } else {
          stopCaptureLoop(); // requestAnimationFrame 중단 -> CPU 절약
        }
      }
    );

    return () => {
      removeListener();
      stopCaptureLoop();
    };
  }, []);

  const startCaptureLoop = () => {
    // 캡처 루프 시작
    const loop = () => {
      // OCR 캡처 로직
      captureLoopRef.current = requestAnimationFrame(loop);
    };
    captureLoopRef.current = requestAnimationFrame(loop);
  };

  const stopCaptureLoop = () => {
    if (captureLoopRef.current) {
      cancelAnimationFrame(captureLoopRef.current);
      captureLoopRef.current = null;
    }
  };

  return <div className="overlay">...</div>;
}
```

## 검증 체크리스트

### 기능 검증

- [ ] 앱 실행 시 오버레이 대신 **대시보드 윈도우**가 뜨는가?
- [ ] 'OCR 필터링' 스위치를 켰을 때 오버레이가 정상적으로 화면에 덮이는가?
- [ ] 'OCR 필터링' 스위치를 껐을 때 오버레이가 사라지는가?
- [ ] '음성 필터링' 스위치가 C# Bridge 동작(로그 확인)과 연동되는가?

### 리소스 검증 (작업 관리자 확인)

- [ ] OCR 필터링을 껐을 때, Electron 프로세스의 CPU/GPU 점유율이 현저히 떨어지는가? (캡처 루프 중단 확인)

### 배포 검증 (Task 42 연계)

- [ ] `npm run build` 후 생성된 `OnVoice.exe`에서도 대시보드와 오버레이 전환이 정상 작동하는가?

## 파일 변경 예상 목록

1. `electron/main.ts`: 윈도우 관리 로직 전면 수정 (createDashboard, createOverlay)
2. `electron/preload/index.ts`: IPC 채널 추가 (`toggle-ocr`, `toggle-voice`)
3. `renderer/src/App.tsx`: 대시보드 UI 구현
4. `renderer/src/overlay/OverlayApp.tsx`: 캡처 루프 제어 로직 추가
5. `electron/ipc/channels.ts`: IPC 채널 정의 추가
6. `electron/ipc/dashboardHandlers.ts`: 대시보드 관련 IPC 핸들러 (신규)

## 다음 작업

- [ ] 대시보드 UI 디자인 및 구현
- [ ] IPC 통신 구현
- [ ] 윈도우 관리 로직 구현
- [ ] 오버레이 최적화 구현
- [ ] 테스트 및 검증

## 참고 자료

- [작업 42: Electron 앱 배포](./42-electron-app-deployment.md)
- [작업 45: Spawn 방식 Bridge 마이그레이션](./45-spawn-bridge-migration.md)
- [작업 46: Supabase 관리자 DB](./46-supabase-admin-db.md)

