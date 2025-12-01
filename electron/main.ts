// ⚠️ 반드시 파일의 최상단(import 문보다 위)에 작성해야 합니다.
import "./env";

import { app, BrowserWindow, Menu, ipcMain, globalShortcut, desktopCapturer, screen } from "electron";
import { createOverlayWindow, setExitEditModeAndHideHandler } from "./windows/createOverlayWindow";
import { createMainWindow } from "./windows/createMainWindow";
import { createTray } from "./tray";
import { setupROIHandlers, type ROI } from "./ipc/roi";
import { IPC_CHANNELS } from "./ipc/channels";
import { SERVER_CHANNELS } from "./ipc/channels";
import { setOverlayWindow, getOverlayWindow, setEditModeState, setTrayUpdateCallback } from "./state/editMode";
import { getROI, getMode, setMode, getThreshold, setThreshold } from "./store";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { registerServerHandlers, checkServerConnection } from "./ipc/serverHandlers";
import { registerAudioHandlers, getAudioService } from "./ipc/audioHandlers";
import { registerOnVoiceHandlers } from "./ipc/onVoiceHandlers";
import { registerDashboardHandlers, setWindows } from "./ipc/dashboardHandlers";
import { setTrayAudioUpdateCallback } from "./tray";
import AudioManager from "./main/AudioManager";
// 🔥 중요: onVoiceBridge를 최상단에서 정적 import 하여 중복 로드 방지
import { onVoiceBridge } from "./main/onVoiceBridge";
import { registerComDll, checkComDllRegistered } from "./main/registerComDll";

// 🧩 패키지 환경에서 NODE_ENV 보정
// electron-builder로 생성된 exe는 NODE_ENV가 비어 있는 경우가 많아서
// dev URL(http://localhost:5173)을 보려고 하다가 오버레이가 안 뜨는 문제가 생길 수 있음
if (app.isPackaged && process.env.NODE_ENV !== "production") {
  process.env.NODE_ENV = "production";
}

const CAPTURE_INTERVAL_MS = 500; // 0.5초 간격

// 콘솔 로그 필터링: 반복되는 COM 객체 로그 제거
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

// 필터링할 로그 패턴
const FILTERED_PATTERNS = [
  /\[COnVoiceCapture\] OnAudioData/i,
  /\[COnVoiceCapture\] Fire_OnAudioData/i,
  /\[conn \d+\] GIT CopyTo/i,
  /\[conn \d+\] Invoke/i,
];

// 로그 필터링 함수
function shouldFilterLog(message: string): boolean {
  return FILTERED_PATTERNS.some((pattern) => pattern.test(message));
}

// console.log 오버라이드
console.log = function (...args: any[]) {
  const message = args.map((arg) => String(arg)).join(" ");
  if (!shouldFilterLog(message)) {
    originalConsoleLog.apply(console, args);
  }
};

// console.warn 오버라이드 (필요시)
console.warn = function (...args: any[]) {
  const message = args.map((arg) => String(arg)).join(" ");
  if (!shouldFilterLog(message)) {
    originalConsoleWarn.apply(console, args);
  }
};

// console.error는 필터링하지 않음 (중요한 오류는 항상 표시)

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: ReturnType<typeof createTray> | null = null;

// 트레이를 외부에서 설정할 수 있도록 export
export function setTrayInstance(trayInstance: ReturnType<typeof createTray> | null) {
  tray = trayInstance;
}
let currentROI: ROI | null = null;

// currentROI를 외부에서 업데이트할 수 있도록 export
export function setCurrentROI(roi: ROI | null) {
  currentROI = roi;
  console.log("[Main] currentROI 업데이트:", roi);
}

// overlayWindow를 외부에서 업데이트할 수 있도록 export
export function setOverlayWindowInstance(window: BrowserWindow | null) {
  overlayWindow = window;
  console.log("[Main] overlayWindow 업데이트:", window ? "설정됨" : "null");
}
let monitoringInterval: NodeJS.Timeout | null = null;
let isMonitoring = false;
let isCaptureInProgress = false;
let lastExtractedText = ""; // 중복 텍스트 필터링을 위한 변수
let emptyTextCount = 0; // 연속으로 빈 텍스트가 나온 횟수

// startMonitoring과 stopMonitoring 함수를 export하기 위한 전역 변수
export let startMonitoring: (() => void) | null = null;
export let stopMonitoring: ((reason?: string) => void) | null = null;

// enterSetupMode와 resetToSetupMode 함수를 export하기 위한 전역 변수
export let enterSetupMode: (() => void) | null = null;
export let resetToSetupMode: (() => void) | null = null;

type OverlayMode = "setup" | "detect" | "alert";

type OverlayStatePayload = {
  mode: OverlayMode;
  roi?: ROI;
  harmful?: boolean;
};

// 🔒 단일 인스턴스만 실행되도록 보장
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 이미 다른 인스턴스가 실행 중이면 종료
  console.log("[Main] 다른 인스턴스가 이미 실행 중입니다. 종료합니다.");
  app.quit();
  process.exit(0);
} else {
  // 두 번째 인스턴스가 실행되려고 할 때 기존 인스턴스에 포커스
  app.on("second-instance", () => {
    console.log("[Main] 두 번째 인스턴스 실행 시도 - 기존 인스턴스에 포커스");
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      if (overlayWindow.isMinimized()) overlayWindow.restore();
      overlayWindow.focus();
    }
  });
}

// 헤드리스 실행: 메뉴 없음
Menu.setApplicationMenu(null);

app.whenReady().then(async () => {
  // 배포 모드 디버깅 정보 출력
  console.log(`[Main] 🔍 배포 모드 정보:`);
  console.log(`[Main]   - app.isPackaged: ${app.isPackaged}`);
  console.log(`[Main]   - process.env.NODE_ENV: ${process.env.NODE_ENV || "(설정 안 됨)"}`);
  console.log(`[Main]   - process.resourcesPath: ${process.resourcesPath || "(없음)"}`);
  console.log(`[Main]   - __dirname: ${__dirname}`);

  // .env 파일 로드
  // 🔍 배포 환경(.exe)에서는 process.resourcesPath 사용
  // 🔍 개발 환경에서는 프로젝트 루트 사용
  const envPath = app.isPackaged
    ? path.join(process.resourcesPath, ".env") // ✅ 배포: resources/.env
    : path.join(__dirname, "../.env"); // 🛠️ 개발: 루트 .env

  const envResult = dotenv.config({ path: envPath });
  console.log(`[Main] .env 파일 로드 시도 (경로: ${envPath})`);
  if (envResult.error) {
    console.warn(`[Main] .env 로드 실패 (경로: ${envPath}):`, envResult.error);
    console.warn("[Main] 기본 SERVER_URL을 사용합니다: http://localhost:8000");
  } else {
    console.log(`[Main] .env 로드 성공 (경로: ${envPath})`);
    if (envResult.parsed) {
      console.log("[Main] .env 파일 내용:", Object.keys(envResult.parsed));
    }
  }
  console.log("[Main] SERVER_URL:", process.env.SERVER_URL || "http://localhost:8000 (기본값)");
  console.log("[Main] NODE_ENV:", process.env.NODE_ENV || "(설정 안 됨)");

  registerServerHandlers();

  // 대시보드 IPC 핸들러 등록
  registerDashboardHandlers();

  // COM DLL 등록 확인 및 자동 등록 시도 (Registration-Free COM 또는 레지스트리 등록 방식 지원)
  console.log("[Main] 🔍 COM DLL 등록 상태 확인 중...");
  if (app.isPackaged) {
    console.log(`[Main]   - 배포 모드: process.resourcesPath = ${process.resourcesPath || "(없음)"}`);
    if (process.resourcesPath) {
      const dllPath = path.join(process.resourcesPath, "native", "OnVoiceAudioBridge.dll");
      const fs = require("fs");
      const dllExists = fs.existsSync(dllPath);
      console.log(`[Main]   - COM DLL 파일 존재: ${dllExists} (${dllPath})`);
      if (!dllExists) {
        console.error(`[Main] ❌ COM DLL 파일을 찾을 수 없습니다: ${dllPath}`);
        console.error(`[Main] 💡 빌드가 제대로 완료되었는지 확인하세요: npm run build:all`);
      }

      // 매니페스트 파일도 확인
      const manifestPath = path.join(process.resourcesPath, "native", "OnVoiceAudioBridge.dll.manifest");
      const manifestExists = fs.existsSync(manifestPath);
      console.log(`[Main]   - DLL 매니페스트 파일 존재: ${manifestExists} (${manifestPath})`);

      const appManifestPath = path.join(process.resourcesPath, "..", "OnVoice.exe.manifest");
      const appManifestExists = fs.existsSync(appManifestPath);
      console.log(`[Main]   - 앱 매니페스트 파일 존재: ${appManifestExists} (${appManifestPath})`);
    }
  }

  const isRegistered = await checkComDllRegistered();
  console.log(`[Main]   - COM DLL 등록 상태: ${isRegistered ? "등록됨" : "미등록"}`);

  if (!isRegistered) {
    console.log("[Main] COM DLL이 등록되어 있지 않습니다. 자동 등록을 시도합니다...");
    const registered = await registerComDll();
    if (registered) {
      // 등록 후 다시 확인
      const isNowRegistered = await checkComDllRegistered();
      if (isNowRegistered) {
        console.log("[Main] ✅ COM DLL 등록 완료");
      } else {
        console.warn("[Main] ⚠️ COM DLL 자동 등록에 실패했습니다.");
        console.warn(
          "[Main] 💡 Registration-Free COM 매니페스트 파일이 있는지 확인하거나, 관리자 권한으로 실행하거나 수동 등록이 필요할 수 있습니다."
        );
        const dllPath = app.isPackaged
          ? path.join(process.resourcesPath || "", "native", "OnVoiceAudioBridge.dll")
          : path.join(__dirname, "../native/OnVoiceAudioBridge.dll");
        console.warn(`[Main] 💡 수동 등록: regsvr32.exe "${dllPath}"`);
        console.warn(`[Main] 💡 또는 관리자 권한으로 앱을 실행하세요.`);
      }
    } else {
      console.warn("[Main] ⚠️ COM DLL 등록 시도 실패");
    }
  } else {
    console.log("[Main] ✅ COM DLL이 이미 등록되어 있습니다 (Registration-Free COM 또는 레지스트리 등록).");
  }

  const serverReady = await checkServerConnection();
  if (!serverReady) {
    console.warn("[Main] FastAPI server가 실행 중이 아닙니다. `server` 폴더에서 `python main.py`를 실행하세요.");
  } else {
    console.log("[Main] FastAPI server 연결이 확인되었습니다.");

    // 서버에서 초기 threshold 값 가져와서 로컬 스토어에 저장 (없는 경우에만)
    try {
      const axios = (await import("axios")).default;
      const serverUrl = process.env.SERVER_URL || "http://127.0.0.1:8000";
      const response = await axios.get(`${serverUrl}/health`, { timeout: 3000 });
      const serverThreshold = response.data?.threshold;

      if (serverThreshold !== undefined && serverThreshold !== null) {
        // 로컬 스토어에 threshold가 없으면 서버 값 저장
        const localThreshold = getThreshold();
        if (localThreshold === null) {
          setThreshold(serverThreshold);
          console.log(`[Main] 서버에서 threshold 값 가져와서 저장: ${serverThreshold}`);
        } else {
          console.log(`[Main] 로컬 threshold 값 사용: ${localThreshold} (서버: ${serverThreshold})`);
        }
      }
    } catch (error: any) {
      console.warn("[Main] 서버에서 threshold 가져오기 실패 (무시):", error?.message || error);
    }
  }

  // AudioManager 초기화
  try {
    const audioManager = AudioManager.getInstance();
    await audioManager.init();
    console.log("[Main] AudioManager 초기화 완료");
  } catch (error) {
    console.error("[Main] AudioManager 초기화 실패:", error);
  }

  // 메인 윈도우 생성 (모드 선택 화면 - 기본으로 표시)
  try {
    mainWindow = createMainWindow();
    mainWindow.show(); // 모드 선택 화면을 기본으로 표시
    console.log("[Main] 모드 선택 윈도우 표시됨");
  } catch (err) {
    console.warn("[Main] Failed to create main window (non-critical):", err);
    mainWindow = null;
  }

  // 오버레이 창은 사용자가 OCR 모드를 선택할 때 생성됨 (미리 생성하지 않음)
  overlayWindow = null;
  console.log("[Main] 오버레이 윈도우는 모드 선택 시 생성됩니다");

  // 대시보드 핸들러에 윈도우 참조 설정
  setWindows(overlayWindow, mainWindow);

  // 오디오 핸들러 등록 (메인 윈도우만)
  try {
    if (mainWindow) {
      registerAudioHandlers(mainWindow);
      console.log("[Main] Audio handlers registered on main window");
    }
    // 오버레이 윈도우는 모드 선택 시 생성되므로 여기서는 등록하지 않음
  } catch (err) {
    console.warn("[Main] Failed to register audio handlers (non-critical):", err);
  }

  // OnVoice 핸들러 등록 (메인 윈도우만)
  try {
    if (mainWindow) {
      registerOnVoiceHandlers(mainWindow);
      console.log("[Main] OnVoice handlers registered on main window");
    }
    // 오버레이 윈도우는 모드 선택 시 생성되므로 여기서는 등록하지 않음
  } catch (err) {
    console.warn("[Main] Failed to register OnVoice handlers (non-critical):", err);
  }

  const sendOverlayMode = (mode: OverlayMode) => {
    // overlayWindow는 state/editMode.ts에서 가져오기 (dashboardHandlers에서 생성한 윈도우도 포함)
    const currentOverlayWindow = overlayWindow || getOverlayWindow();
    if (!currentOverlayWindow || currentOverlayWindow.isDestroyed()) {
      console.warn("[Main] Cannot send OVERLAY_SET_MODE - overlay window is unavailable");
      return;
    }
    currentOverlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_SET_MODE, mode);
    console.log("[Main] Sent OVERLAY_SET_MODE:", mode);
  };

  const pushOverlayState = (state: OverlayStatePayload) => {
    // overlayWindow는 state/editMode.ts에서 가져오기 (dashboardHandlers에서 생성한 윈도우도 포함)
    const currentOverlayWindow = overlayWindow || getOverlayWindow();
    if (!currentOverlayWindow || currentOverlayWindow.isDestroyed()) {
      console.warn("[Main] Cannot push overlay state - overlay window is unavailable");
      console.warn("[Main] main.ts overlayWindow:", overlayWindow ? "존재" : "null");
      console.warn("[Main] state/editMode overlayWindow:", getOverlayWindow() ? "존재" : "null");
      return;
    }
    try {
      // 안전하게 직렬화 가능한 형태로 변환
      const safeState: OverlayStatePayload = {
        mode: state.mode,
        harmful: state.harmful === true,
        ...(state.roi && {
          roi: {
            x: Number(state.roi.x) || 0,
            y: Number(state.roi.y) || 0,
            width: Number(state.roi.width) || 0,
            height: Number(state.roi.height) || 0,
          },
        }),
      };
      currentOverlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_PUSH, safeState);
      // 유해 표현 감지 시에만 로그 출력
      if (state.harmful === true) {
        console.warn("[Main] 🚨 Sent OVERLAY_STATE_PUSH (harmful):", JSON.stringify(safeState));
      }
    } catch (error: any) {
      console.error("[Main] pushOverlayState 실패:", error?.message || error);
      console.error("[Main] state 객체:", state);
    }
  };

  resetToSetupMode = () => {
    console.log("[Main] Reset to setup mode request received");
    if (enterSetupMode) {
      enterSetupMode();
    }
  };

  const broadcastStopMonitoring = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      return;
    }
    overlayWindow.webContents.send(IPC_CHANNELS.STOP_MONITORING);
    console.log("[Main] Sent STOP_MONITORING to renderer");
  };

  /**
   * Windows OCR을 사용하여 이미지에서 텍스트 추출 및 유해성 분석
   */
  const sendImageToServer = async (
    imageBuffer: Buffer
  ): Promise<{
    success: boolean;
    data?: {
      texts: string[];
      is_harmful: boolean;
      harmful_words: string[];
      processing_time: { ocr: number; analysis: number; total: number };
    };
    error?: string;
  }> => {
    try {
      // 🔥 동적 import 제거하고 상단 정적 import 사용
      const roi = currentROI;

      const requestStartTime = Date.now();

      // Windows OCR + 분석 수행 (ROI 정보 포함)
      const result = roi
        ? await onVoiceBridge.performOCRAndAnalyze(imageBuffer, {
            x: roi.x,
            y: roi.y,
            width: roi.width,
            height: roi.height,
          })
        : await onVoiceBridge.performOCR(imageBuffer);

      const requestTime = Date.now() - requestStartTime;

      if (!result.ok) {
        console.error(`[OCR] Windows OCR 실패 (${requestTime}ms): ${result.error}`);
        return {
          success: false,
          error: result.error || "OCR 처리 실패",
        };
      }

      // 결과를 서버 응답 형식으로 변환
      const rawText = result.text || "";
      const texts = rawText ? rawText.split(/\r?\n/).filter((line) => line.trim().length > 0) : [];

      // OCR 결과 로그는 유해 표현 감지 시에만 출력 (중복 텍스트는 제외)
      // 로그는 captureAndProcessROI에서 유해 표현 감지 시에만 출력

      return {
        success: true,
        data: {
          texts: texts,
          is_harmful: result.isHarmful || false,
          harmful_words: result.matchedKeywords || [],
          processing_time: {
            ocr: 0,
            analysis: 0,
            total: requestTime / 1000,
          },
        },
      };
    } catch (error: any) {
      const errorMessage = error?.message ?? "Unknown error";
      console.error("[OCR] Windows OCR 요청 실패:", errorMessage);
      // 타임아웃 에러일 경우 명확히 표시
      if (errorMessage === "BRIDGE_TIMEOUT") {
        console.error("[OCR] ⚠️ C# Bridge 응답 시간 초과. 루프는 계속됩니다.");
      } else {
        console.error(`[OCR] 전체 에러 객체:`, JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  };

  /**
   * ROI 영역 캡처 및 서버 OCR 수행
   */
  const captureAndProcessROI = async (): Promise<void> => {
    const roi = currentROI;
    if (!isMonitoring || !roi) {
      if (!isMonitoring) console.log("[OCR] 모니터링이 비활성화되어 있습니다.");
      if (!roi) console.log("[OCR] ROI가 설정되지 않았습니다.");
      return;
    }

    if (isCaptureInProgress) {
      return;
    }

    isCaptureInProgress = true;
    try {
      // 1. 화면 캡처 (ROI 영역보다 약간 큰 크기만 캡처하여 성능 최적화)
      const primaryDisplay = screen.getPrimaryDisplay();
      const displaySize = primaryDisplay.size;
      
      // DPI 스케일링 팩터 가져오기 (고해상도 디스플레이 지원)
      const scaleFactor = primaryDisplay.scaleFactor;

      // ROI 영역을 기준으로 캡처 영역 계산 (ROI보다 20% 큰 영역만 캡처)
      const captureMargin = 0.2; // 20% 여유
      const captureX = Math.max(0, Math.floor(roi.x - roi.width * captureMargin));
      const captureY = Math.max(0, Math.floor(roi.y - roi.height * captureMargin));
      const captureWidth = Math.min(displaySize.width - captureX, Math.floor(roi.width * (1 + captureMargin * 2)));
      const captureHeight = Math.min(displaySize.height - captureY, Math.floor(roi.height * (1 + captureMargin * 2)));

      // 최적화된 썸네일 크기 (ROI 영역보다 약간 큰 크기만)
      // ⚠️ 중요: thumbnailSize는 반드시 정수(Integer)여야 합니다.
      // 소수점 값이 전달되면 Electron의 C++ 바인딩에서 크래시가 발생합니다.
      let optimizedThumbnailSize = {
        width: Math.round(Math.min(displaySize.width, Math.max(roi.width * 1.5, 800)) * scaleFactor),
        height: Math.round(Math.min(displaySize.height, Math.max(roi.height * 1.5, 600)) * scaleFactor),
      };
      
      // 최소값 1 보장 (안전장치)
      if (optimizedThumbnailSize.width === 0) optimizedThumbnailSize.width = 1;
      if (optimizedThumbnailSize.height === 0) optimizedThumbnailSize.height = 1;

      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: optimizedThumbnailSize,
      });

      if (sources.length === 0) {
        console.error("[OCR] 화면 소스를 찾을 수 없음");
        isCaptureInProgress = false;
        return;
      }

      const screenshot = sources[0].thumbnail;
      if (screenshot.isEmpty()) {
        console.warn("[OCR] 캡처된 스크린샷이 비어있음");
        isCaptureInProgress = false;
        return;
      }

      // 2. ROI 영역만 크롭 (썸네일 크기에 맞춰 좌표 조정)
      const screenshotSize = screenshot.getSize();
      const scaleX = screenshotSize.width / displaySize.width;
      const scaleY = screenshotSize.height / displaySize.height;

      // ROI 좌표를 썸네일 크기에 맞게 스케일링
      const cropX = Math.max(0, Math.floor(roi.x * scaleX));
      const cropY = Math.max(0, Math.floor(roi.y * scaleY));
      const cropWidth = Math.max(1, Math.floor(Math.min(roi.width * scaleX, screenshotSize.width - cropX)));
      const cropHeight = Math.max(1, Math.floor(Math.min(roi.height * scaleY, screenshotSize.height - cropY)));

      if (cropWidth <= 0 || cropHeight <= 0) {
        console.warn("[OCR] 잘못된 크롭 크기:", { cropX, cropY, cropWidth, cropHeight });
        isCaptureInProgress = false;
        return;
      }

      const croppedImage = screenshot.crop({
        x: cropX,
        y: cropY,
        width: cropWidth,
        height: cropHeight,
      });

      // 3. PNG Buffer로 변환
      const imageBuffer = croppedImage.toPNG();

      // 4. 서버로 OCR + 분석 요청
      const ocrStartTime = Date.now();
      const result = await sendImageToServer(imageBuffer);
      const ocrElapsed = Date.now() - ocrStartTime;

      // OCR 결과 처리
      if (result.success && result.data) {
        const { texts, is_harmful } = result.data;
        const extractedText = texts && texts.length > 0 ? texts.join(" ") : "";

        // 텍스트가 없는 경우 처리
        if (!extractedText || extractedText.trim().length === 0) {
          emptyTextCount++;
          // 연속으로 빈 텍스트가 5번 이상 나오면 로그를 줄임
          if (emptyTextCount <= 5) {
            // 처음 몇 번은 로그 출력 (디버깅용)
          } else if (emptyTextCount % 10 === 0) {
            // 이후에는 10번마다 한 번씩만 로그 출력
            console.log(`[OCR] 텍스트 없음 (연속 ${emptyTextCount}회)`);
          }
          // 빈 텍스트는 유해하지 않은 것으로 간주하고 상태 업데이트는 건너뜀
          // (중복 상태 업데이트 방지)
          return;
        }

        // 텍스트가 있으면 빈 텍스트 카운터 리셋
        emptyTextCount = 0;

        // 중복 텍스트 필터링: 같은 텍스트가 연속으로 나오면 건너뜀
        if (extractedText === lastExtractedText) {
          // 중복 텍스트는 건너뛰되, 유해 표현은 항상 처리
          if (!is_harmful) {
            return;
          }
        } else {
          lastExtractedText = extractedText;
        }

        // 5. 유해성 감지 시 알림 (서버 AI 모델 기반)
        // overlayWindow는 state/editMode.ts에서 가져오기 (dashboardHandlers에서 생성한 윈도우도 포함)
        const currentOverlayWindow = overlayWindow || getOverlayWindow();
        if (currentOverlayWindow && !currentOverlayWindow.isDestroyed()) {
          // is_harmful이 true인지 명확히 확인 (boolean 값)
          const isHarmful = is_harmful === true;

          if (isHarmful) {
            // 유해 표현 감지 시에만 상세 로그 출력
            console.warn(
              `[OCR] 🚨 유해 표현 감지 (${ocrElapsed}ms): "${extractedText.substring(0, 100)}${
                extractedText.length > 100 ? "..." : ""
              }"`
            );
            try {
              currentOverlayWindow.webContents.send(IPC_CHANNELS.ALERT_FROM_SERVER, {
                harmful: true,
                words: [], // 서버 AI 모델 기반으로만 동작하므로 키워드는 사용하지 않음
              });
            } catch (sendError: any) {
              console.error("[OCR] ALERT_FROM_SERVER 전송 실패:", sendError?.message || sendError);
            }
          } else {
            // harmful=false는 조용히 전송 (로그 없음)
            try {
              currentOverlayWindow.webContents.send(IPC_CHANNELS.ALERT_FROM_SERVER, {
                harmful: false,
                words: [],
              });
            } catch (sendError: any) {
              // 조용히 실패 (로그 없음)
            }
          }
        }

        if (!isMonitoring || !currentROI) {
          console.log("[OCR] 모니터링이 중지되었습니다. 상태 업데이트를 건너뜁니다.");
          return;
        }

        // 상태 업데이트
        const nextMode: OverlayMode = is_harmful ? "alert" : "detect";
        try {
          pushOverlayState({
            mode: nextMode,
            roi: currentROI,
            harmful: is_harmful,
          });
        } catch (pushError: any) {
          console.error("[OCR] pushOverlayState 실패:", pushError?.message || pushError);
        }
      } else {
        console.error(`[OCR] 서버 요청 실패 (${ocrElapsed}ms):`, result.error);
      }
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      const errorStack = error?.stack || "";
      console.error("[OCR] 캡처/처리 오류:", errorMessage);
      if (errorStack) {
        console.error("[OCR] 오류 스택:", errorStack);
      }
      // 전체 오류 객체 출력 (순환 참조 방지)
      try {
        console.error("[OCR] 오류 상세:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      } catch (e) {
        console.error("[OCR] 오류 객체 직렬화 실패:", e);
      }
    } finally {
      // 🔥 중요: finally 블록에서 플래그를 해제하여 다음 주기가 실행될 수 있도록 보장
      isCaptureInProgress = false;
    }
  };

  // startMonitoring과 stopMonitoring 함수를 export하여 dashboardHandlers에서 사용 가능하도록
  stopMonitoring = (reason?: string) => {
    if (monitoringInterval) {
      clearTimeout(monitoringInterval);
      monitoringInterval = null;
    }

    // 모니터링이 활성화되어 있거나 ROI가 설정되어 있으면 중지
    const wasMonitoring = isMonitoring || currentROI !== null;

    if (!wasMonitoring) {
      // 모니터링이 없어도 setup 모드로 전환하고 Edit Mode 활성화 (ESC 키 등)
      console.log("[OCR] Setup 모드로 전환 (모니터링 없음)", reason ? `(${reason})` : "");
      setEditModeState(true);
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setIgnoreMouseEvents(false);
        console.log("[Main] Mouse events enabled for setup mode");
      }
      return;
    }

    console.log("[OCR] OCR 모니터링 중지", reason ? `(${reason})` : "");

    isMonitoring = false;
    currentROI = null;
    isCaptureInProgress = false;
    lastExtractedText = ""; // 모니터링 중지 시 텍스트 초기화
    emptyTextCount = 0; // 빈 텍스트 카운터 초기화

    broadcastStopMonitoring();
    sendOverlayMode("setup");
    setMode("setup");
    pushOverlayState({ mode: "setup" });
    setEditModeState(true);

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      try {
        overlayWindow.setIgnoreMouseEvents(false);
        console.log("[Main] Mouse events re-enabled during stopMonitoring");
      } catch (error) {
        console.warn("[Main] Failed to disable click-through during stopMonitoring:", error);
      }
    }
  };

  startMonitoring = () => {
    // 스토어에서 ROI 가져오기 (currentROI가 없을 경우)
    if (!currentROI) {
      const storedROI = getROI();
      if (storedROI) {
        currentROI = storedROI;
        console.log("[OCR] 스토어에서 ROI 복원:", storedROI);
      }
    }

    if (!currentROI) {
      console.warn("[OCR] 모니터링을 시작할 수 없습니다 - ROI가 정의되지 않음");
      return;
    }

    if (isMonitoring) {
      console.log("[OCR] 모니터링이 이미 활성화되어 있습니다");
      return;
    }

    isMonitoring = true;
    pushOverlayState({ mode: "detect", roi: currentROI });

    // 재귀적으로 캡처 실행 (비동기 처리로 지연 최소화)
    const scheduleNextCapture = async () => {
      if (!isMonitoring || !currentROI) {
        monitoringInterval = null;
        return;
      }

      // 다음 캡처를 먼저 스케줄링하여 간격 보장
      if (isMonitoring && currentROI) {
        monitoringInterval = setTimeout(scheduleNextCapture, CAPTURE_INTERVAL_MS) as any;
      }

      // 현재 캡처는 비동기로 실행 (다음 스케줄링을 막지 않음)
      captureAndProcessROI().catch((error: any) => {
        const errorMessage = error?.message || String(error);
        // 유해 표현 감지 관련이 아닌 경우에만 에러 로그 출력
        if (!errorMessage.includes("timeout") && !errorMessage.includes("ECONNABORTED")) {
          console.error(`[OCR] 캡처 루프 오류:`, errorMessage);
        }
      });
    };

    // 즉시 한 번 실행 후 스케줄링 시작
    scheduleNextCapture();

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      try {
        overlayWindow.blur();
        console.log("[Main] Overlay window blurred to restore underlying app focus");
      } catch (error) {
        console.warn("[Main] Failed to blur overlay window:", error);
      }
    }
  };

  // ROI 핸들러는 오버레이 윈도우가 생성될 때 설정됨 (dashboardHandlers.ts에서)
  // 여기서는 설정하지 않음

  enterSetupMode = () => {
    const target = overlayWindow;
    if (!target || target.isDestroyed()) {
      console.warn("[Main] Cannot enter setup mode - overlay window is unavailable");
      return;
    }

    if (stopMonitoring) {
      stopMonitoring("Entering setup mode");
    }

    console.log("[Main] Entering overlay setup mode");

    if (!target.isVisible()) {
      target.show();
      target.setSkipTaskbar(false);
    } else {
      target.show();
      target.setSkipTaskbar(false);
    }

    setEditModeState(true);

    sendOverlayMode("setup");

    const storedROI = getROI();
    const statePayload: OverlayStatePayload = {
      mode: "setup",
      harmful: false,
      ...(storedROI ? { roi: storedROI } : {}),
    };
    pushOverlayState(statePayload);

    target.focus();
    setTimeout(() => {
      if (target && !target.isDestroyed() && target.isVisible()) {
        target.focus();
        target.setIgnoreMouseEvents(false);
      }
    }, 100);

    if (tray && typeof (tray as any).updateContextMenu === "function") {
      (tray as any).updateContextMenu();
    }
  };

  // Edit Mode 종료 핸들러
  ipcMain.on(IPC_CHANNELS.EXIT_EDIT_MODE, () => {
    console.log("[Main] Exit Edit Mode requested from overlay");
    setEditModeState(false);
  });

  // 오버레이 숨김 핸들러
  ipcMain.on(IPC_CHANNELS.HIDE_OVERLAY, () => {
    console.log("[Main] Hide overlay requested from overlay");
    if (overlayWindow) {
      overlayWindow.hide();
      overlayWindow.setSkipTaskbar(true);
      setEditModeState(false);
      if (stopMonitoring) {
        stopMonitoring("Overlay hide request");
      }
      // 트레이 메뉴 업데이트
      if (tray && typeof (tray as any).updateContextMenu === "function") {
        (tray as any).updateContextMenu();
      }
    }
  });

  // Edit Mode 종료 및 오버레이 숨김 핸들러 (IPC용)
  ipcMain.on(IPC_CHANNELS.EXIT_EDIT_MODE_AND_HIDE, () => {
    console.log("[Main] Exit Edit Mode and hide overlay requested from overlay (IPC)");
    if (overlayWindow) {
      setEditModeState(false);
      overlayWindow.hide();
      overlayWindow.setSkipTaskbar(true);
      if (stopMonitoring) {
        stopMonitoring("Exit edit mode and hide overlay request");
      }
      // 트레이 메뉴 업데이트
      if (tray && typeof (tray as any).updateContextMenu === "function") {
        (tray as any).updateContextMenu();
      }
    }
  });

  // 클릭-스루 설정 핸들러 (invoke)
  ipcMain.handle(IPC_CHANNELS.SET_CLICK_THROUGH, (_event, enabled: boolean) => {
    console.log("[Main] Set click-through requested:", enabled);
    if (overlayWindow) {
      overlayWindow.setIgnoreMouseEvents(enabled, { forward: true });
      console.log("[Main] Click-through set to:", enabled);
      return true;
    }
    return false;
  });

  ipcMain.on(IPC_CHANNELS.OVERLAY_SET_MODE, (_event, mode: OverlayMode) => {
    console.log("[Main] OVERLAY_SET_MODE requested by renderer:", mode);
    if (mode === "setup" && stopMonitoring) {
      stopMonitoring("Renderer requested setup mode");
    }
  });

  // 렌더러에서 메인 프로세스로 모드 변경 알림
  ipcMain.on(IPC_CHANNELS.OVERLAY_MODE_CHANGED, (_event, mode: OverlayMode) => {
    console.log("[Main] OVERLAY_MODE_CHANGED received from renderer:", mode);
    if (mode === "setup") {
      // setup 모드로 전환 시 모니터링 중지
      if (stopMonitoring) {
        stopMonitoring("Renderer changed mode to setup");
      }

      // Edit Mode 활성화 및 마우스 이벤트 활성화 (stopMonitoring이 early return하는 경우를 대비)
      setEditModeState(true);
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setIgnoreMouseEvents(false);
        console.log("[Main] Edit Mode 활성화 및 마우스 이벤트 활성화됨 (ESC 키로 setup 모드 전환)");

        // 오버레이에 setup 모드 신호 전송
        overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_SET_MODE, "setup");
        const storedROI = getROI();
        const statePayload = {
          mode: "setup" as const,
          harmful: false,
          ...(storedROI ? { roi: storedROI } : {}),
        };
        overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_PUSH, statePayload);

        // 포커스 설정
        overlayWindow.focus();
      }
    }
  });

  ipcMain.on(IPC_CHANNELS.OCR_START, () => {
    console.log("[OCR] OCR 모니터링 시작 요청");
    if (startMonitoring) {
      startMonitoring();
    }
  });

  ipcMain.on(IPC_CHANNELS.OCR_STOP, () => {
    console.log("[OCR] OCR 모니터링 중지 요청");
    if (stopMonitoring) {
      stopMonitoring("Renderer request");
    }
  });

  ipcMain.on(IPC_CHANNELS.START_MONITORING, () => {
    console.log("[Main] START_MONITORING request received");
    if (startMonitoring) {
      startMonitoring();
    }
  });

  ipcMain.on(IPC_CHANNELS.STOP_MONITORING, () => {
    console.log("[Main] STOP_MONITORING request received");
    if (stopMonitoring) {
      stopMonitoring("Renderer request");
    }
  });

  // Edit Mode 종료 및 오버레이 숨김 함수 (메인 프로세스에서 직접 호출용)
  const handleExitEditModeAndHide = () => {
    console.log("[Main] Exit Edit Mode and hide overlay (direct call from main process)");
    if (overlayWindow) {
      setEditModeState(false);
      overlayWindow.hide();
      overlayWindow.setSkipTaskbar(true);
      if (stopMonitoring) {
        stopMonitoring("Direct exit edit mode and hide");
      }
      // 트레이 메뉴 업데이트
      if (tray && typeof (tray as any).updateContextMenu === "function") {
        (tray as any).updateContextMenu();
      }
    }
  };

  // 오버레이 창에 Edit Mode 종료 핸들러 등록
  if (overlayWindow) {
    setExitEditModeAndHideHandler(handleExitEditModeAndHide);

    // 개발자 도구 단축키 등록 (오버레이 창용)
    const ret1 = globalShortcut.register("CommandOrControl+Shift+I", () => {
      if (overlayWindow && overlayWindow.isVisible()) {
        if (overlayWindow.webContents.isDevToolsOpened()) {
          overlayWindow.webContents.closeDevTools();
          setTimeout(() => {
            if (overlayWindow && overlayWindow.isVisible()) {
              const { getEditModeState } = require("./state/editMode");
              const isEditMode = getEditModeState();
              if (isEditMode) {
                overlayWindow.setIgnoreMouseEvents(false);
                console.log("[Main] Mouse events re-enabled after DevTools closed (Edit Mode active)");
              }
            }
          }, 100);
        } else {
          overlayWindow.webContents.openDevTools({ mode: "detach" });
          overlayWindow.blur();

          // 개발자 도구 상태 체크 로직 (기존 유지)
          setTimeout(() => {
            if (overlayWindow && overlayWindow.webContents.isDevToolsOpened()) {
              // ... executeJavaScript logic ...
            }
          }, 500);

          const { getEditModeState } = require("./state/editMode");
          const isEditMode = getEditModeState();
          if (isEditMode) {
            overlayWindow.setIgnoreMouseEvents(false);
          } else {
            overlayWindow.setIgnoreMouseEvents(true, { forward: true });
          }
          overlayWindow.webContents.once("devtools-closed", () => {
            if (overlayWindow && overlayWindow.isVisible()) {
              const { getEditModeState } = require("./state/editMode");
              const isEditMode = getEditModeState();
              if (isEditMode) {
                overlayWindow.setIgnoreMouseEvents(false);
              }
            }
          });
        }
      }
    });

    const ret2 = globalShortcut.register("F12", () => {
      if (overlayWindow && overlayWindow.isVisible()) {
        if (overlayWindow.webContents.isDevToolsOpened()) {
          overlayWindow.webContents.closeDevTools();
          setTimeout(() => {
            if (overlayWindow && overlayWindow.isVisible()) {
              const { getEditModeState } = require("./state/editMode");
              const isEditMode = getEditModeState();
              if (isEditMode) {
                overlayWindow.setIgnoreMouseEvents(false);
              }
            }
          }, 100);
        } else {
          overlayWindow.webContents.openDevTools({ mode: "detach" });
          overlayWindow.blur();
          const { getEditModeState } = require("./state/editMode");
          const isEditMode = getEditModeState();
          if (isEditMode) {
            overlayWindow.setIgnoreMouseEvents(false);
          } else {
            overlayWindow.setIgnoreMouseEvents(true, { forward: true });
          }
          overlayWindow.webContents.once("devtools-closed", () => {
            if (overlayWindow && overlayWindow.isVisible()) {
              const { getEditModeState } = require("./state/editMode");
              const isEditMode = getEditModeState();
              if (isEditMode) {
                overlayWindow.setIgnoreMouseEvents(false);
              }
            }
          });
        }
      }
    });

    if (!ret1) console.log("[Main] Failed to register Ctrl+Shift+I shortcut for DevTools");
    if (!ret2) console.log("[Main] Failed to register F12 shortcut for DevTools");
  }

  // 시스템 트레이 생성 (오버레이 창 제어용)
  if (overlayWindow) {
    tray = createTray(overlayWindow, {
      enterSetupMode,
      resetToSetupMode,
    });
    const trayUpdateFn = () => {
      if (tray && typeof (tray as any).updateContextMenu === "function") {
        (tray as any).updateContextMenu();
      }
    };
    setTrayUpdateCallback(trayUpdateFn);
    const { setOverlayTrayUpdateCallback } = require("./windows/createOverlayWindow");
    setOverlayTrayUpdateCallback(trayUpdateFn);
    setTrayAudioUpdateCallback(trayUpdateFn);

    // 오버레이 로드 완료 시 저장된 상태 복원 (하지만 자동으로 표시하지 않음)
    // overlayWindow는 이미 null 체크를 통과했으므로 BrowserWindow 타입임
    const currentOverlayWindow: BrowserWindow = overlayWindow;
    if (!currentOverlayWindow.isDestroyed()) {
      currentOverlayWindow.webContents.once("did-finish-load", () => {
        const savedROI = getROI();
        const savedMode = getMode();

        if (savedROI && savedMode && savedMode !== "setup") {
          console.log("[Main] 저장된 상태 복원:", { savedROI, savedMode });
          currentROI = savedROI;
          setMode("detect");
          setEditModeState(false, { hideOverlay: true }); // 오버레이 숨김 유지

          // 오버레이는 사용자가 대시보드에서 활성화할 때까지 숨김 상태 유지
          // 상태만 복원하고 표시하지 않음
          console.log("[Main] 오버레이 상태 복원 완료 (사용자 활성화 대기 중)");
        } else {
          console.log("[Main] 저장된 상태 없음 - 대시보드에서 설정 필요");
        }
      });
    }
  }

  app.on("before-quit", () => {
    if (stopMonitoring) {
      stopMonitoring("Application quitting");
    }

    const { getAudioService } = require("./ipc/audioHandlers");
    const audioService = getAudioService();
    if (audioService) audioService.stopMonitoring();

    const { getOnVoiceService } = require("./audio/onVoiceService");
    const onVoiceService = getOnVoiceService();
    if (onVoiceService) onVoiceService.stopMonitoring();

    const audioManager = AudioManager.getInstance();
    if (audioManager.getStatus().isStreaming) {
      audioManager.stopStream().catch((err) => console.error(err));
    }
  });

  app.on("activate", () => {});
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
  }
});
