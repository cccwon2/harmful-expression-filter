import { app, BrowserWindow, Menu, ipcMain, globalShortcut, desktopCapturer, screen } from "electron";
import { createOverlayWindow, setExitEditModeAndHideHandler } from "./windows/createOverlayWindow";
import { createMainWindow } from "./windows/createMainWindow";
import { createTray } from "./tray";
import { setupROIHandlers, type ROI } from "./ipc/roi";
import { IPC_CHANNELS } from "./ipc/channels";
import { SERVER_CHANNELS } from "./ipc/channels";
import { setOverlayWindow, setEditModeState, setTrayUpdateCallback } from "./state/editMode";
import { getROI, getMode, setMode } from "./store";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { registerServerHandlers, checkServerConnection } from "./ipc/serverHandlers";
import { registerAudioHandlers, getAudioService } from "./ipc/audioHandlers";
import { registerOnVoiceHandlers } from "./ipc/onVoiceHandlers";
import { setTrayAudioUpdateCallback } from "./tray";
import AudioManager from "./main/AudioManager";
// 🔥 중요: onVoiceBridge를 최상단에서 정적 import 하여 중복 로드 방지
import { onVoiceBridge } from "./main/onVoiceBridge";

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
let currentROI: ROI | null = null;
let monitoringInterval: NodeJS.Timeout | null = null;
let isMonitoring = false;
let isCaptureInProgress = false;

type OverlayMode = "setup" | "detect" | "alert";

type OverlayStatePayload = {
  mode: OverlayMode;
  roi?: ROI;
  harmful?: boolean;
};

// 헤드리스 실행: 메뉴 없음
Menu.setApplicationMenu(null);

app.whenReady().then(async () => {
  // .env 파일 로드 (프로젝트 루트에서)
  // 개발 모드: 프로젝트 루트, 프로덕션 모드: app.getAppPath()
  const envPath =
    process.env.NODE_ENV === "production" ? path.join(app.getAppPath(), ".env") : path.join(__dirname, "../.env");
  const envResult = dotenv.config({ path: envPath });
  console.log("[Main] .env 파일 로드 시도:", envPath);
  if (envResult.error) {
    console.warn("[Main] .env 파일 로드 실패:", envResult.error.message);
    console.warn("[Main] 기본 SERVER_URL을 사용합니다: http://localhost:8000");
  } else {
    console.log("[Main] .env 파일 로드 성공");
    if (envResult.parsed) {
      console.log("[Main] .env 파일 내용:", Object.keys(envResult.parsed));
    }
  }
  console.log("[Main] SERVER_URL:", process.env.SERVER_URL || "http://localhost:8000 (기본값)");
  console.log("[Main] NODE_ENV:", process.env.NODE_ENV || "(설정 안 됨)");

  registerServerHandlers();

  const serverReady = await checkServerConnection();
  if (!serverReady) {
    console.warn("[Main] FastAPI server가 실행 중이 아닙니다. `server` 폴더에서 `python main.py`를 실행하세요.");
  } else {
    console.log("[Main] FastAPI server 연결이 확인되었습니다.");
  }

  // AudioManager 초기화
  try {
    const audioManager = AudioManager.getInstance();
    await audioManager.init();
    console.log("[Main] AudioManager 초기화 완료");
  } catch (error) {
    console.error("[Main] AudioManager 초기화 실패:", error);
  }

  // 메인 윈도우 생성 (AudioMonitor UI용 - 개발/디버깅 목적으로만 사용, 기본적으로 숨김)
  try {
    mainWindow = createMainWindow();
  } catch (err) {
    console.warn("[Main] Failed to create main window (non-critical):", err);
    mainWindow = null;
  }

  // 오버레이 창 생성
  overlayWindow = createOverlayWindow();

  // Edit Mode 상태 관리에 오버레이 창 등록
  if (overlayWindow) {
    setOverlayWindow(overlayWindow);
  }

  // 오디오 핸들러 등록
  try {
    if (mainWindow) {
      registerAudioHandlers(mainWindow);
      console.log("[Main] Audio handlers registered on main window");
    }
    if (overlayWindow) {
      registerAudioHandlers(overlayWindow);
      console.log("[Main] Audio handlers registered on overlay window");
    }
  } catch (err) {
    console.warn("[Main] Failed to register audio handlers (non-critical):", err);
  }

  // OnVoice 핸들러 등록
  try {
    if (mainWindow) {
      registerOnVoiceHandlers(mainWindow);
      console.log("[Main] OnVoice handlers registered on main window");
    }
    if (overlayWindow) {
      registerOnVoiceHandlers(overlayWindow);
      console.log("[Main] OnVoice handlers registered on overlay window");
    }
  } catch (err) {
    console.warn("[Main] Failed to register OnVoice handlers (non-critical):", err);
  }

  const sendOverlayMode = (mode: OverlayMode) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      console.warn("[Main] Cannot send OVERLAY_SET_MODE - overlay window is unavailable");
      return;
    }
    overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_SET_MODE, mode);
    console.log("[Main] Sent OVERLAY_SET_MODE:", mode);
  };

  const pushOverlayState = (state: OverlayStatePayload) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      console.warn("[Main] Cannot push overlay state - overlay window is unavailable");
      return;
    }
    overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_PUSH, state);
    console.log("[Main] Sent OVERLAY_STATE_PUSH:", JSON.stringify(state));
  };

  const resetToSetupMode = () => {
    console.log("[Main] Reset to setup mode request received");
    enterSetupMode();
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

      // OCR 결과 로그 (항상 출력하여 디버깅 가능하도록)
      if (texts.length === 0 && rawText.length === 0) {
        console.log(`[OCR] Windows OCR 완료 (${requestTime}ms): 텍스트 없음`);
      } else if (texts.length === 0 && rawText.length > 0) {
        console.log(
          `[OCR] Windows OCR 완료 (${requestTime}ms): 원본 텍스트는 있으나 유효한 라인 없음 - "${rawText.substring(
            0,
            50
          )}..."`
        );
      } else {
        console.log(`[OCR] Windows OCR 완료 (${requestTime}ms): ${texts.length}개 텍스트 추출`);
      }

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
      // 1. 화면 캡처
      const primaryDisplay = screen.getPrimaryDisplay();
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: primaryDisplay.size,
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

      // 2. ROI 영역만 크롭
      const screenshotSize = screenshot.getSize();
      const cropX = Math.max(0, Math.floor(roi.x));
      const cropY = Math.max(0, Math.floor(roi.y));
      const cropWidth = Math.max(1, Math.floor(Math.min(roi.width, screenshotSize.width - cropX)));
      const cropHeight = Math.max(1, Math.floor(Math.min(roi.height, screenshotSize.height - cropY)));

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

      // OCR 결과 항상 로그 출력
      if (result.success && result.data) {
        const { texts, is_harmful, harmful_words } = result.data;

        // 추출된 텍스트 로그 출력
        if (texts && texts.length > 0) {
          console.log(`[OCR] 추출 텍스트 (${ocrElapsed}ms): ${texts.join(" ")}`);
        } else {
          console.log(`[OCR] 텍스트 추출 없음 (${ocrElapsed}ms)`);
        }

        // 5. 유해성 감지 시 알림
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          if (is_harmful) {
            console.warn(`[OCR] 🚨 유해 표현 감지: ${harmful_words.join(", ")}`);
            overlayWindow.webContents.send(IPC_CHANNELS.ALERT_FROM_SERVER, {
              harmful: true,
              words: harmful_words,
            });
          } else {
            // harmful=false도 전송하여 블라인드 해제 타이머 시작
            overlayWindow.webContents.send(IPC_CHANNELS.ALERT_FROM_SERVER, {
              harmful: false,
              words: [],
            });
          }
        }

        if (!isMonitoring || !currentROI) {
          console.log("[OCR] 모니터링이 중지되었습니다. 상태 업데이트를 건너뜁니다.");
          return;
        }

        // 상태 업데이트
        const nextMode: OverlayMode = is_harmful ? "alert" : "detect";
        pushOverlayState({
          mode: nextMode,
          roi: currentROI,
          harmful: is_harmful,
        });
      } else {
        console.error(`[OCR] 서버 요청 실패 (${ocrElapsed}ms):`, result.error);
      }
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      console.error("[OCR] 캡처/처리 오류:", errorMessage);
    } finally {
      // 🔥 중요: finally 블록에서 플래그를 해제하여 다음 주기가 실행될 수 있도록 보장
      isCaptureInProgress = false;
    }
  };

  const stopMonitoring = (reason?: string) => {
    if (monitoringInterval) {
      clearTimeout(monitoringInterval);
      monitoringInterval = null;
    }

    if (!isMonitoring && !currentROI) {
      return;
    }

    console.log("[OCR] OCR 모니터링 중지", reason ? `(${reason})` : "");

    isMonitoring = false;
    currentROI = null;
    isCaptureInProgress = false;

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

  const startMonitoring = () => {
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

    // 재귀적으로 캡처 실행 (이전 작업 완료 후에만 다음 작업 시작)
    const scheduleNextCapture = async () => {
      if (!isMonitoring || !currentROI) {
        monitoringInterval = null;
        return;
      }

      const captureStartTime = Date.now();
      try {
        await captureAndProcessROI();
        const captureElapsed = Date.now() - captureStartTime;

        if (captureElapsed > CAPTURE_INTERVAL_MS) {
          // console.warn(`[OCR] 캡처 처리 시간 (${captureElapsed}ms)이 간격 (${CAPTURE_INTERVAL_MS}ms)보다 깁니다.`);
        }
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        console.error(`[OCR] 캡처 루프 오류 (${Date.now() - captureStartTime}ms):`, errorMessage);
      } finally {
        // 에러 발생(타임아웃 등) 여부와 관계없이 다음 캡처 스케줄링 보장
        if (isMonitoring && currentROI) {
          monitoringInterval = setTimeout(scheduleNextCapture, CAPTURE_INTERVAL_MS) as any;
        } else {
          monitoringInterval = null;
        }
      }
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

  if (overlayWindow) {
    setupROIHandlers(overlayWindow, {
      onROISelected: (roi) => {
        currentROI = roi;
        console.log("[Main] Current ROI updated:", roi);
        startMonitoring();
      },
      onROICancelled: () => {
        stopMonitoring("ROI selection cancelled");
      },
    });
  }

  const enterSetupMode = () => {
    const target = overlayWindow;
    if (!target || target.isDestroyed()) {
      console.warn("[Main] Cannot enter setup mode - overlay window is unavailable");
      return;
    }

    stopMonitoring("Entering setup mode");

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
      stopMonitoring("Overlay hide request");
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
      stopMonitoring("Exit edit mode and hide overlay request");
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
    if (mode === "setup") {
      stopMonitoring("Renderer requested setup mode");
    }
  });

  ipcMain.on(IPC_CHANNELS.OCR_START, () => {
    console.log("[OCR] OCR 모니터링 시작 요청");
    startMonitoring();
  });

  ipcMain.on(IPC_CHANNELS.OCR_STOP, () => {
    console.log("[OCR] OCR 모니터링 중지 요청");
    stopMonitoring("Renderer request");
  });

  ipcMain.on(IPC_CHANNELS.START_MONITORING, () => {
    console.log("[Main] START_MONITORING request received");
    startMonitoring();
  });

  ipcMain.on(IPC_CHANNELS.STOP_MONITORING, () => {
    console.log("[Main] STOP_MONITORING request received");
    stopMonitoring("Renderer request");
  });

  // Edit Mode 종료 및 오버레이 숨김 함수 (메인 프로세스에서 직접 호출용)
  const handleExitEditModeAndHide = () => {
    console.log("[Main] Exit Edit Mode and hide overlay (direct call from main process)");
    if (overlayWindow) {
      setEditModeState(false);
      overlayWindow.hide();
      overlayWindow.setSkipTaskbar(true);
      stopMonitoring("Direct exit edit mode and hide");
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

    overlayWindow.webContents.once("did-finish-load", () => {
      const savedROI = getROI();
      const savedMode = getMode();

      if (savedROI && savedMode && savedMode !== "setup") {
        console.log("[Main] Restoring saved state:", { savedROI, savedMode });
        currentROI = savedROI;
        setMode("detect");
        setEditModeState(false, { hideOverlay: false });

        const target = overlayWindow;
        if (!target || target.isDestroyed()) {
          enterSetupMode();
          return;
        }

        target.show();
        target.setSkipTaskbar(false);
        target.setIgnoreMouseEvents(true, { forward: true });

        sendOverlayMode("detect");
        pushOverlayState({
          mode: "detect",
          roi: savedROI,
          harmful: false,
        });

        startMonitoring();
      } else {
        console.log("[Main] Starting in setup mode (no saved state)");
        enterSetupMode();
      }
    });
  }

  app.on("before-quit", () => {
    stopMonitoring("Application quitting");

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
