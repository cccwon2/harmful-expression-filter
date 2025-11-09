import { app, BrowserWindow, Menu, ipcMain, globalShortcut, desktopCapturer, screen } from 'electron';
import { createOverlayWindow, setExitEditModeAndHideHandler } from './windows/createOverlayWindow';
import { createTray } from './tray';
import { setupROIHandlers, type ROI } from './ipc/roi';
import { IPC_CHANNELS } from './ipc/channels';
import { setOverlayWindow, setEditModeState, setTrayUpdateCallback } from './state/editMode';
import { getROI, setMode } from './store';
import { setupServerClientStub, stopServerClientStub } from './serverClient';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { createWorker, type Worker } from 'tesseract.js';

const CAPTURE_INTERVAL_MS = 4000;
const CAPTURE_FILE_NAME = 'captured.png';
const OCR_LANGUAGES = 'eng+kor';
const SERVER_ENDPOINT = process.env.MONITORING_ENDPOINT ?? 'YOUR_API_ENDPOINT';

let overlayWindow: BrowserWindow | null = null;
let tray: ReturnType<typeof createTray> | null = null;
let currentROI: ROI | null = null;
let captureInterval: NodeJS.Timeout | null = null;
let isMonitoring = false;
let isCaptureInProgress = false;
let ocrWorker: Worker | null = null;

type OverlayMode = 'setup' | 'detect' | 'alert';

type OverlayStatePayload = {
  mode: OverlayMode;
  roi?: ROI;
  harmful?: boolean;
};

// 헤드리스 실행: 메뉴 없음
Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  // 오버레이 창 생성 (초기에는 숨김, 기본 상태는 클릭스루)
  overlayWindow = createOverlayWindow();
  
  // Edit Mode 상태 관리에 오버레이 창 등록
  if (overlayWindow) {
    setOverlayWindow(overlayWindow);
  }
  
  const sendOverlayMode = (mode: OverlayMode) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      console.warn('[Main] Cannot send OVERLAY_SET_MODE - overlay window is unavailable');
      return;
    }
    overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_SET_MODE, mode);
    console.log('[Main] Sent OVERLAY_SET_MODE:', mode);
  };

  const pushOverlayState = (state: OverlayStatePayload) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      console.warn('[Main] Cannot push overlay state - overlay window is unavailable');
      return;
    }
    overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_PUSH, state);
    console.log('[Main] Sent OVERLAY_STATE_PUSH:', JSON.stringify(state));
  };

  const resetToSetupMode = () => {
    console.log('[Main] Reset to setup mode request received');
    enterSetupMode();
  };

  const broadcastStopMonitoring = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      return;
    }
    overlayWindow.webContents.send(IPC_CHANNELS.STOP_MONITORING);
    console.log('[Main] Sent STOP_MONITORING to renderer');
  };

  const initOCR = async (): Promise<Worker | null> => {
    if (ocrWorker) {
      return ocrWorker;
    }
    try {
      ocrWorker = await createWorker([], undefined, {
        logger: (message: { status: string; progress: number }) => {
          if (message.status === 'recognizing text') {
            console.log('[OCR]', message.status, `${Math.round((message.progress ?? 0) * 100)}%`);
          }
        },
      });
      await ocrWorker.load();
      await ocrWorker.reinitialize(OCR_LANGUAGES);
      console.log('[Main] OCR worker initialized with languages:', OCR_LANGUAGES);
      return ocrWorker;
    } catch (error) {
      console.error('[Main] Failed to initialize OCR worker:', error);
      ocrWorker = null;
      return null;
    }
  };

  const performOCR = async (imageBuffer: Buffer): Promise<string> => {
    try {
      const worker = await initOCR();
      if (!worker) {
        return '';
      }
      const {
        data: { text },
      } = await worker.recognize(imageBuffer);
      return text.trim();
    } catch (error) {
      console.error('[Main] OCR processing failed:', error);
      return '';
    }
  };

  const sendToServer = async (text: string, imageBuffer: Buffer) => {
    if (!SERVER_ENDPOINT || SERVER_ENDPOINT === 'YOUR_API_ENDPOINT') {
      console.warn('[Main] SERVER_ENDPOINT is not configured. Skipping server upload.');
      return;
    }
    try {
      const formData = new FormData();
      formData.append('text', text);
      formData.append('timestamp', new Date().toISOString());
      formData.append('image', imageBuffer, {
        filename: CAPTURE_FILE_NAME,
        contentType: 'image/png',
      });

      const response = await axios.post(SERVER_ENDPOINT, formData, {
        headers: formData.getHeaders(),
        timeout: 10000,
      });
      console.log('[Main] Server response:', response.data);
    } catch (error: any) {
      console.error('[Main] Failed to send data to server:', error?.message ?? error);
    }
  };

  const captureAndProcessROI = async () => {
    if (!isMonitoring || !currentROI) {
      return;
    }

    if (isCaptureInProgress) {
      console.log('[Main] Capture already in progress, skipping this interval');
      return;
    }

    isCaptureInProgress = true;
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: primaryDisplay.size,
      });

      if (!sources.length) {
        console.warn('[Main] No screen sources available for capture');
        return;
      }

      const screenshot = sources[0].thumbnail;
      if (screenshot.isEmpty()) {
        console.warn('[Main] Captured screenshot is empty');
        return;
      }

      const screenshotSize = screenshot.getSize();
      const cropX = Math.max(0, Math.floor(currentROI.x));
      const cropY = Math.max(0, Math.floor(currentROI.y));
      const cropWidth = Math.max(
        1,
        Math.floor(Math.min(currentROI.width, screenshotSize.width - cropX)),
      );
      const cropHeight = Math.max(
        1,
        Math.floor(Math.min(currentROI.height, screenshotSize.height - cropY)),
      );

      if (cropWidth <= 0 || cropHeight <= 0) {
        console.warn('[Main] Invalid crop dimensions calculated:', {
          cropX,
          cropY,
          cropWidth,
          cropHeight,
        });
        return;
      }

      const croppedImage = screenshot.crop({
        x: cropX,
        y: cropY,
        width: cropWidth,
        height: cropHeight,
      });

      const pngBuffer = croppedImage.toPNG();
      const outputPath = path.join(app.getPath('userData'), CAPTURE_FILE_NAME);
      fs.writeFileSync(outputPath, pngBuffer);
      console.log('[Main] Captured ROI frame saved to:', outputPath);

      const text = await performOCR(pngBuffer);
      console.log('[Main] OCR result:', text || '(empty)');

      await sendToServer(text, pngBuffer);
    } catch (error) {
      console.error('[Main] Error during captureAndProcessROI:', error);
    } finally {
      isCaptureInProgress = false;
    }
  };

  const stopMonitoring = (reason?: string) => {
    if (captureInterval) {
      clearInterval(captureInterval);
      captureInterval = null;
    }

    if (!isMonitoring && !currentROI) {
      return;
    }

    console.log('[Main] Stopping monitoring', reason ? `(${reason})` : '');

    isMonitoring = false;
    currentROI = null;
    isCaptureInProgress = false;

    broadcastStopMonitoring();
    sendOverlayMode('setup');
    setMode('setup');
    pushOverlayState({ mode: 'setup' });
    setEditModeState(true);
  };

  const startMonitoring = () => {
    if (!currentROI) {
      console.warn('[Main] Cannot start monitoring - ROI is not defined');
      return;
    }

    if (isMonitoring) {
      console.log('[Main] Monitoring already active');
      return;
    }

    console.log('[Main] Starting monitoring loop for ROI:', currentROI);
    isMonitoring = true;
    pushOverlayState({ mode: 'detect', roi: currentROI });
    captureInterval = setInterval(() => {
      captureAndProcessROI().catch((error) => {
        console.error('[Main] Monitoring interval error:', error);
      });
    }, CAPTURE_INTERVAL_MS);

    captureAndProcessROI().catch((error) => {
      console.error('[Main] Initial capture error:', error);
    });

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      try {
        overlayWindow.blur();
        console.log('[Main] Overlay window blurred to restore underlying app focus');
      } catch (error) {
        console.warn('[Main] Failed to blur overlay window:', error);
      }
    }
  };

  if (overlayWindow) {
    setupROIHandlers(overlayWindow, {
      onROISelected: (roi) => {
        currentROI = roi;
        console.log('[Main] Current ROI updated:', roi);
      },
      onROICancelled: () => {
        stopMonitoring('ROI selection cancelled');
      },
    });

    setupServerClientStub(overlayWindow);
  }

  const enterSetupMode = () => {
    const target = overlayWindow;
    if (!target || target.isDestroyed()) {
      console.warn('[Main] Cannot enter setup mode - overlay window is unavailable');
      return;
    }

    stopMonitoring('Entering setup mode');

    console.log('[Main] Entering overlay setup mode');

    if (!target.isVisible()) {
      target.show();
      target.setSkipTaskbar(false);
    } else {
      target.show();
      target.setSkipTaskbar(false);
    }

    setEditModeState(true);

    sendOverlayMode('setup');

    const storedROI = getROI();
    const statePayload: OverlayStatePayload = {
      mode: 'setup',
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

    if (tray && typeof (tray as any).updateContextMenu === 'function') {
      (tray as any).updateContextMenu();
    }
  };

  // Edit Mode 종료 핸들러
  ipcMain.on(IPC_CHANNELS.EXIT_EDIT_MODE, () => {
    console.log('[Main] Exit Edit Mode requested from overlay');
    setEditModeState(false);
  });
  
  // 오버레이 숨김 핸들러
  ipcMain.on(IPC_CHANNELS.HIDE_OVERLAY, () => {
    console.log('[Main] Hide overlay requested from overlay');
    if (overlayWindow) {
      overlayWindow.hide();
      overlayWindow.setSkipTaskbar(true);
      setEditModeState(false);
      stopMonitoring('Overlay hide request');
      // 트레이 메뉴 업데이트
      if (tray && typeof (tray as any).updateContextMenu === 'function') {
        (tray as any).updateContextMenu();
      }
    }
  });
  
  // Edit Mode 종료 및 오버레이 숨김 핸들러 (IPC용)
  ipcMain.on(IPC_CHANNELS.EXIT_EDIT_MODE_AND_HIDE, () => {
    console.log('[Main] Exit Edit Mode and hide overlay requested from overlay (IPC)');
    if (overlayWindow) {
      setEditModeState(false);
      overlayWindow.hide();
      overlayWindow.setSkipTaskbar(true);
      stopMonitoring('Exit edit mode and hide overlay request');
      // 트레이 메뉴 업데이트
      if (tray && typeof (tray as any).updateContextMenu === 'function') {
        (tray as any).updateContextMenu();
      }
    }
  });
  
  // 클릭-스루 설정 핸들러 (invoke)
  ipcMain.handle(IPC_CHANNELS.SET_CLICK_THROUGH, (_event, enabled: boolean) => {
    console.log('[Main] Set click-through requested:', enabled);
    if (overlayWindow) {
      overlayWindow.setIgnoreMouseEvents(enabled, { forward: true });
      console.log('[Main] Click-through set to:', enabled);
      return true;
    }
    return false;
  });

  ipcMain.on(IPC_CHANNELS.OVERLAY_SET_MODE, (_event, mode: OverlayMode) => {
    console.log('[Main] OVERLAY_SET_MODE requested by renderer:', mode);
    if (mode === 'setup') {
      stopMonitoring('Renderer requested setup mode');
    }
  });

  ipcMain.on(IPC_CHANNELS.START_MONITORING, () => {
    console.log('[Main] START_MONITORING request received');
    startMonitoring();
  });

  ipcMain.on(IPC_CHANNELS.STOP_MONITORING, () => {
    console.log('[Main] STOP_MONITORING request received');
    stopMonitoring('Renderer request');
  });
  
  // Edit Mode 종료 및 오버레이 숨김 함수 (메인 프로세스에서 직접 호출용)
  const handleExitEditModeAndHide = () => {
    console.log('[Main] Exit Edit Mode and hide overlay (direct call from main process)');
    if (overlayWindow) {
      setEditModeState(false);
      overlayWindow.hide();
      overlayWindow.setSkipTaskbar(true);
      stopMonitoring('Direct exit edit mode and hide');
      // 트레이 메뉴 업데이트
      if (tray && typeof (tray as any).updateContextMenu === 'function') {
        (tray as any).updateContextMenu();
      }
    }
  };
  
  // 오버레이 창에 Edit Mode 종료 핸들러 등록
  if (overlayWindow) {
    setExitEditModeAndHideHandler(handleExitEditModeAndHide);
    
    // 개발자 도구 단축키 등록 (오버레이 창용)
    // Ctrl+Shift+I 또는 F12로 개발자 도구 열기 (undocked 모드)
    const ret1 = globalShortcut.register('CommandOrControl+Shift+I', () => {
      if (overlayWindow && overlayWindow.isVisible()) {
        if (overlayWindow.webContents.isDevToolsOpened()) {
          overlayWindow.webContents.closeDevTools();
          // 개발자 도구가 닫히면 Edit Mode 상태에 따라 마우스 이벤트 설정
          setTimeout(() => {
            if (overlayWindow && overlayWindow.isVisible()) {
              const { getEditModeState } = require('./state/editMode');
              const isEditMode = getEditModeState();
              if (isEditMode) {
                overlayWindow.setIgnoreMouseEvents(false);
                console.log('[Main] Mouse events re-enabled after DevTools closed (Edit Mode active)');
              }
            }
          }, 100);
        } else {
          // detach 모드로 열어서 완전히 독립된 창으로 표시 (이동 가능)
          overlayWindow.webContents.openDevTools({ mode: 'detach' });
          console.log('[Main] DevTools opened in detach mode - window should be movable');
          
          // 개발자 도구가 열릴 때 오버레이 창의 키보드 포커스 해제
          // 개발자 도구가 키보드 입력을 받을 수 있도록
          overlayWindow.blur();
          
          // 개발자 도구가 열릴 때 renderer에 테스트 로그 출력 요청 (콘솔 확인용)
          setTimeout(() => {
            if (overlayWindow && overlayWindow.webContents.isDevToolsOpened()) {
              overlayWindow.webContents.executeJavaScript(`
                (function() {
                  console.log('%c[DevTools] DevTools opened successfully!', 'color: green; font-weight: bold; font-size: 16px;');
                  console.log('[DevTools] Console logging is working properly');
                  console.log('[DevTools] Overlay state available at window.__overlayState');
                  console.log('[DevTools] You can now type commands in the console');
                  if (window.__overlayState) {
                    console.log('[DevTools] Current overlay state:', window.__overlayState);
                  }
                  console.log('[DevTools] Test: 1 + 1 =', 1 + 1);
                })();
              `).catch((err) => {
                console.error('[Main] Error executing JavaScript in DevTools:', err);
              });
            }
          }, 500);
          
          // 개발자 도구가 열려 있을 때도 Edit Mode가 활성화되어 있으면 마우스 이벤트 유지
          // (ROI 선택을 시작할 수 있도록)
          const { getEditModeState } = require('./state/editMode');
          const isEditMode = getEditModeState();
          if (isEditMode) {
            // Edit Mode가 활성화되어 있으면 마우스 이벤트 유지
            // 개발자 도구 창은 detach 모드로 열려 있어서 독립적으로 이동 가능
            overlayWindow.setIgnoreMouseEvents(false);
            console.log('[Main] Mouse events kept enabled while DevTools is open (Edit Mode active)');
          } else {
            // Edit Mode가 비활성화되어 있으면 클릭-스루 활성화
            overlayWindow.setIgnoreMouseEvents(true, { forward: true });
            console.log('[Main] Click-through enabled while DevTools is open (Edit Mode inactive)');
          }
          // 개발자 도구 창이 닫히면 다시 마우스 이벤트 활성화
          overlayWindow.webContents.once('devtools-closed', () => {
            if (overlayWindow && overlayWindow.isVisible()) {
              const { getEditModeState } = require('./state/editMode');
              const isEditMode = getEditModeState();
              if (isEditMode) {
                overlayWindow.setIgnoreMouseEvents(false);
                console.log('[Main] Mouse events re-enabled after DevTools closed (Edit Mode active)');
              }
            }
          });
        }
        console.log('[Main] DevTools toggled for overlay window (Ctrl+Shift+I)');
      }
    });
    
    const ret2 = globalShortcut.register('F12', () => {
      if (overlayWindow && overlayWindow.isVisible()) {
        if (overlayWindow.webContents.isDevToolsOpened()) {
          overlayWindow.webContents.closeDevTools();
          // 개발자 도구가 닫히면 Edit Mode 상태에 따라 마우스 이벤트 설정
          setTimeout(() => {
            if (overlayWindow && overlayWindow.isVisible()) {
              const { getEditModeState } = require('./state/editMode');
              const isEditMode = getEditModeState();
              if (isEditMode) {
                overlayWindow.setIgnoreMouseEvents(false);
                console.log('[Main] Mouse events re-enabled after DevTools closed (Edit Mode active)');
              }
            }
          }, 100);
        } else {
          // detach 모드로 열어서 완전히 독립된 창으로 표시 (이동 가능)
          overlayWindow.webContents.openDevTools({ mode: 'detach' });
          console.log('[Main] DevTools opened in detach mode - window should be movable');
          
          // 개발자 도구가 열릴 때 오버레이 창의 키보드 포커스 해제
          // 개발자 도구가 키보드 입력을 받을 수 있도록
          overlayWindow.blur();
          
          // 개발자 도구가 열릴 때 renderer에 테스트 로그 출력 요청 (콘솔 확인용)
          setTimeout(() => {
            if (overlayWindow && overlayWindow.webContents.isDevToolsOpened()) {
              overlayWindow.webContents.executeJavaScript(`
                (function() {
                  console.log('%c[DevTools] DevTools opened successfully!', 'color: green; font-weight: bold; font-size: 16px;');
                  console.log('[DevTools] Console logging is working properly');
                  console.log('[DevTools] Overlay state available at window.__overlayState');
                  console.log('[DevTools] You can now type commands in the console');
                  if (window.__overlayState) {
                    console.log('[DevTools] Current overlay state:', window.__overlayState);
                  }
                  console.log('[DevTools] Test: 1 + 1 =', 1 + 1);
                })();
              `).catch((err) => {
                console.error('[Main] Error executing JavaScript in DevTools:', err);
              });
            }
          }, 500);
          
          // 개발자 도구가 열려 있을 때도 Edit Mode가 활성화되어 있으면 마우스 이벤트 유지
          // (ROI 선택을 시작할 수 있도록)
          const { getEditModeState } = require('./state/editMode');
          const isEditMode = getEditModeState();
          if (isEditMode) {
            // Edit Mode가 활성화되어 있으면 마우스 이벤트 유지
            // 개발자 도구 창은 detach 모드로 열려 있어서 독립적으로 이동 가능
            overlayWindow.setIgnoreMouseEvents(false);
            console.log('[Main] Mouse events kept enabled while DevTools is open (Edit Mode active)');
          } else {
            // Edit Mode가 비활성화되어 있으면 클릭-스루 활성화
            overlayWindow.setIgnoreMouseEvents(true, { forward: true });
            console.log('[Main] Click-through enabled while DevTools is open (Edit Mode inactive)');
          }
          // 개발자 도구 창이 닫히면 다시 마우스 이벤트 활성화
          overlayWindow.webContents.once('devtools-closed', () => {
            if (overlayWindow && overlayWindow.isVisible()) {
              const { getEditModeState } = require('./state/editMode');
              const isEditMode = getEditModeState();
              if (isEditMode) {
                overlayWindow.setIgnoreMouseEvents(false);
                console.log('[Main] Mouse events re-enabled after DevTools closed (Edit Mode active)');
              }
            }
          });
        }
        console.log('[Main] DevTools toggled for overlay window (F12)');
      }
    });
    
    if (!ret1) {
      console.log('[Main] Failed to register Ctrl+Shift+I shortcut for DevTools');
    }
    if (!ret2) {
      console.log('[Main] Failed to register F12 shortcut for DevTools');
    }
    
    // 개발 모드에서 오버레이 창 로드 완료 시 자동으로 개발자 도구 열기 (선택적)
    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      overlayWindow.webContents.once('did-finish-load', () => {
        // 개발자 도구를 자동으로 열지 않음 (수동으로 열도록)
        // overlayWindow.webContents.openDevTools();
      });
    }
  }
  
  // 시스템 트레이 생성 (오버레이 창 제어용)
  if (overlayWindow) {
    tray = createTray(overlayWindow, {
      enterSetupMode,
      resetToSetupMode,
    });
    // 트레이 메뉴 업데이트 콜백 등록
    const trayUpdateFn = () => {
      if (tray && typeof (tray as any).updateContextMenu === 'function') {
        (tray as any).updateContextMenu();
      }
    };
    setTrayUpdateCallback(trayUpdateFn);
    // 오버레이 창에서도 트레이 업데이트 콜백 사용 가능하도록 설정
    const { setOverlayTrayUpdateCallback } = require('./windows/createOverlayWindow');
    setOverlayTrayUpdateCallback(trayUpdateFn);
    
    // 오버레이 창이 로드 완료되면 자동으로 표시하고 설정 모드 진입
    overlayWindow.webContents.once('did-finish-load', () => {
      console.log('[Main] Overlay window loaded, showing and entering setup mode...');
      enterSetupMode();
      console.log('[Main] Setup mode enabled by default on app start');
    });
  }

  initOCR().catch((error) => {
    console.error('[Main] OCR initialization error during startup:', error);
  });

  app.on('before-quit', () => {
    stopMonitoring('Application quitting');
    stopServerClientStub();
    if (ocrWorker && typeof ocrWorker.terminate === 'function') {
      ocrWorker
        .terminate()
        .catch((error: unknown) => {
          console.error('[Main] Failed to terminate OCR worker gracefully:', error);
        });
      ocrWorker = null;
    }
  });

  app.on('activate', () => {
    // 헤드리스 모드에서는 activate 이벤트 무시
  });
});

app.on('window-all-closed', () => {
  // 헤드리스 모드: 모든 창이 닫혀도 앱 유지 (트레이에만 존재)
  // macOS는 기본 동작 유지하되, 헤드리스 모드에서는 무시
  if (process.platform !== 'darwin') {
    // Windows/Linux: 헤드리스 모드이므로 항상 트레이에 유지
  } else {
    // macOS: 헤드리스 모드이므로 앱 종료하지 않음
  }
});

