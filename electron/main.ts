import { app, BrowserWindow, Menu, ipcMain, globalShortcut, desktopCapturer, screen } from 'electron';
import { createOverlayWindow, setExitEditModeAndHideHandler } from './windows/createOverlayWindow';
import { createMainWindow } from './windows/createMainWindow';
import { createTray } from './tray';
import { setupROIHandlers, type ROI } from './ipc/roi';
import { IPC_CHANNELS } from './ipc/channels';
import { SERVER_CHANNELS } from './ipc/channels';
import { setOverlayWindow, setEditModeState, setTrayUpdateCallback } from './state/editMode';
import { getROI, getMode, setMode } from './store';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { registerServerHandlers, checkServerConnection } from './ipc/serverHandlers';
import { registerAudioHandlers, getAudioService } from './ipc/audioHandlers';
import { setTrayAudioUpdateCallback } from './tray';

const CAPTURE_INTERVAL_MS = 2000; // 2초 간격 (서버 OCR 처리 시간 고려)

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: ReturnType<typeof createTray> | null = null;
let currentROI: ROI | null = null;
let monitoringInterval: NodeJS.Timeout | null = null;
let isMonitoring = false;
let isCaptureInProgress = false;

type OverlayMode = 'setup' | 'detect' | 'alert';

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
  const envPath = process.env.NODE_ENV === 'production' 
    ? path.join(app.getAppPath(), '.env')
    : path.join(__dirname, '../.env');
  dotenv.config({ path: envPath });
  console.log('[Main] .env 파일 로드 시도:', envPath);
  console.log('[Main] SERVER_URL:', process.env.SERVER_URL || 'http://127.0.0.1:8000 (기본값)');

  registerServerHandlers();

  const serverReady = await checkServerConnection();
  if (!serverReady) {
    console.warn('[Main] FastAPI server가 실행 중이 아닙니다. `server` 폴더에서 `python main.py`를 실행하세요.');
  } else {
    console.log('[Main] FastAPI server 연결이 확인되었습니다.');
  }

  // 메인 윈도우 생성 (AudioMonitor UI용 - 개발/디버깅 목적으로만 사용, 기본적으로 숨김)
  // 메인 윈도우는 Vite 개발 서버가 실행 중일 때만 유용하므로,
  // 오류가 발생해도 앱이 계속 실행되도록 처리
  try {
    mainWindow = createMainWindow();
    // 메인 윈도우는 기본적으로 숨김 (오버레이 창이 메인 UI)
    // 개발 시 필요하면 트레이 메뉴에서 "Show Main Window"로 표시 가능
  } catch (err) {
    // 메인 윈도우 생성 실패 시 조용히 처리 (선택적 기능)
    console.warn('[Main] Failed to create main window (non-critical):', err);
    mainWindow = null;
  }
  
  // 오버레이 창 생성 (초기에는 숨김, 로드 완료 후 설정 모드로 표시)
  overlayWindow = createOverlayWindow();
  
  // Edit Mode 상태 관리에 오버레이 창 등록
  if (overlayWindow) {
    setOverlayWindow(overlayWindow);
  }
  
  // 오디오 핸들러 등록 (전역 단일 인스턴스)
  // 메인 윈도우와 오버레이 창 모두에 등록하여 어느 윈도우에서든 오디오 모니터링 가능
  try {
    if (mainWindow) {
      registerAudioHandlers(mainWindow);
      console.log('[Main] Audio handlers registered on main window');
    }
    if (overlayWindow) {
      registerAudioHandlers(overlayWindow);
      console.log('[Main] Audio handlers registered on overlay window');
    }
  } catch (err) {
    console.warn('[Main] Failed to register audio handlers (non-critical):', err);
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

  /**
   * 이미지를 서버로 전송하여 OCR + 분석 수행
   */
  const sendImageToServer = async (imageBuffer: Buffer): Promise<{
    success: boolean;
    data?: {
      texts: string[];
      is_harmful: boolean;
      harmful_words: string[];
      processing_time: { ocr: number; analysis: number; total: number };
    };
    error?: string;
  }> => {
    const axios = require('axios');
    const FormData = require('form-data');
    const SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:8000';
    const REQUEST_TIMEOUT = 5000;

    try {
      const formData = new FormData();
      formData.append('file', imageBuffer, {
        filename: 'screenshot.png',
        contentType: 'image/png',
      });

      const response = await axios.post(`${SERVER_URL}/api/ocr-and-analyze`, formData, {
        headers: formData.getHeaders(),
        timeout: REQUEST_TIMEOUT,
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error: any) {
      console.error('[Main] 서버 OCR 요청 실패:', error?.message ?? error);
      return {
        success: false,
        error: error?.message ?? 'Unknown error',
      };
    }
  };

  /**
   * ROI 영역 캡처 및 서버 OCR 수행
   */
  const captureAndProcessROI = async (): Promise<void> => {
    const roi = currentROI;
    if (!isMonitoring || !roi) {
      return;
    }

    if (isCaptureInProgress) {
      console.log('[OCR] 캡처가 이미 진행 중입니다. 이번 간격을 건너뜁니다.');
      return;
    }

    isCaptureInProgress = true;
    try {
      // 1. 화면 캡처
      const primaryDisplay = screen.getPrimaryDisplay();
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: primaryDisplay.size,
      });

      if (sources.length === 0) {
        console.error('[OCR] 화면 소스를 찾을 수 없음');
        return;
      }

      const screenshot = sources[0].thumbnail;
      if (screenshot.isEmpty()) {
        console.warn('[OCR] 캡처된 스크린샷이 비어있음');
        return;
      }

      // 2. ROI 영역만 크롭
      const screenshotSize = screenshot.getSize();
      const cropX = Math.max(0, Math.floor(roi.x));
      const cropY = Math.max(0, Math.floor(roi.y));
      const cropWidth = Math.max(
        1,
        Math.floor(Math.min(roi.width, screenshotSize.width - cropX)),
      );
      const cropHeight = Math.max(
        1,
        Math.floor(Math.min(roi.height, screenshotSize.height - cropY)),
      );

      if (cropWidth <= 0 || cropHeight <= 0) {
        console.warn('[OCR] 잘못된 크롭 크기:', {
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

      // 3. PNG Buffer로 변환
      const imageBuffer = croppedImage.toPNG();

      // 4. 서버로 OCR + 분석 요청
      console.log(`[OCR] 서버로 이미지 전송 중... (크기: ${imageBuffer.length} bytes)`);
      const result = await sendImageToServer(imageBuffer);

      if (result.success && result.data) {
        const { texts, is_harmful, harmful_words, processing_time } = result.data;
        
        console.log(`[OCR] 추출 완료: ${texts.length}개 텍스트, 총 ${processing_time.total.toFixed(3)}초 (OCR: ${processing_time.ocr.toFixed(3)}초, 분석: ${processing_time.analysis.toFixed(3)}초)`);
        console.log(`[OCR] 텍스트: ${texts.join(' ')}`);
        
        // 5. 유해성 감지 시 알림
        if (is_harmful) {
          console.warn(`[OCR] 🚨 유해 표현 감지: ${harmful_words.join(', ')}`);
          
          // 오버레이에 알림 전송
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send(IPC_CHANNELS.ALERT_FROM_SERVER, {
              harmful: true,
              words: harmful_words,
            });
          }
        } else {
          console.log('[OCR] ✅ 유해 표현 없음');
        }

        if (!isMonitoring || !currentROI) {
          console.log('[OCR] 모니터링이 중지되었습니다. 상태 업데이트를 건너뜁니다.');
          return;
        }

        // 상태 업데이트
        const nextMode: OverlayMode = is_harmful ? 'alert' : 'detect';
        pushOverlayState({
          mode: nextMode,
          roi: currentROI,
          harmful: is_harmful,
        });
      } else {
        console.error('[OCR] 서버 요청 실패:', result.error);
      }
    } catch (error) {
      console.error('[OCR] 캡처/처리 오류:', error);
    } finally {
      isCaptureInProgress = false;
    }
  };

  const stopMonitoring = (reason?: string) => {
    if (monitoringInterval) {
      clearInterval(monitoringInterval);
      monitoringInterval = null;
    }

    if (!isMonitoring && !currentROI) {
      return;
    }

    console.log('[OCR] OCR 모니터링 중지', reason ? `(${reason})` : '');

    isMonitoring = false;
    currentROI = null;
    isCaptureInProgress = false;

    broadcastStopMonitoring();
    sendOverlayMode('setup');
    setMode('setup');
    pushOverlayState({ mode: 'setup' });
    setEditModeState(true);

    // 오디오 모니터링은 ROI와 독립적으로 동작하므로 OCR 모니터링 중지 시 오디오 모니터링은 중지하지 않음
    // 사용자가 트레이 메뉴나 UI에서 직접 시작/중지 가능

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      try {
        overlayWindow.setIgnoreMouseEvents(false);
        console.log('[Main] Mouse events re-enabled during stopMonitoring');
      } catch (error) {
        console.warn('[Main] Failed to disable click-through during stopMonitoring:', error);
      }
    }
  };

  const startMonitoring = () => {
    if (!currentROI) {
      console.warn('[OCR] 모니터링을 시작할 수 없습니다 - ROI가 정의되지 않음');
      return;
    }

    if (isMonitoring) {
      console.log('[OCR] 모니터링이 이미 활성화되어 있습니다');
      return;
    }

    console.log('[OCR] ROI 모니터링 시작:', currentROI);
    isMonitoring = true;
    pushOverlayState({ mode: 'detect', roi: currentROI });
    
    // 즉시 한 번 실행
    captureAndProcessROI().catch((error) => {
      console.error('[OCR] 초기 캡처 오류:', error);
    });

    // 2초마다 반복 실행
    monitoringInterval = setInterval(() => {
      captureAndProcessROI().catch((error) => {
        console.error('[OCR] 모니터링 간격 오류:', error);
      });
    }, CAPTURE_INTERVAL_MS);

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
        
        // ROI 선택 후 OCR 모니터링 시작 (오디오 모니터링과 독립적)
        startMonitoring();
        
        // 오디오 모니터링은 ROI와 독립적으로 동작하므로 여기서 시작하지 않음
        // 사용자가 트레이 메뉴나 UI에서 직접 시작/중지 가능
      },
      onROICancelled: () => {
        // OCR 모니터링만 중지 (오디오 모니터링은 유지)
        stopMonitoring('ROI selection cancelled');
        
        // 오디오 모니터링은 ROI와 독립적이므로 중지하지 않음
        // 사용자가 트레이 메뉴나 UI에서 직접 시작/중지 가능
      },
    });
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

  ipcMain.on(IPC_CHANNELS.OCR_START, () => {
    console.log('[OCR] OCR 모니터링 시작 요청');
    startMonitoring();
  });

  ipcMain.on(IPC_CHANNELS.OCR_STOP, () => {
    console.log('[OCR] OCR 모니터링 중지 요청');
    stopMonitoring('Renderer request');
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
    
    // 오디오 모니터링 상태 변경 시 트레이 메뉴 업데이트 콜백 등록
    setTrayAudioUpdateCallback(trayUpdateFn);
    
    // 오버레이 창이 로드 완료되면 저장된 상태를 복원하거나 설정 모드 진입
    overlayWindow.webContents.once('did-finish-load', () => {
      const savedROI = getROI();
      const savedMode = getMode();

      if (savedROI && savedMode && savedMode !== 'setup') {
        console.log('[Main] Restoring saved state:', { savedROI, savedMode });
        currentROI = savedROI;
        setMode('detect');
        setEditModeState(false, { hideOverlay: false });

        const target = overlayWindow;
        if (!target || target.isDestroyed()) {
          console.warn('[Main] Cannot restore state - overlay window unavailable');
          enterSetupMode();
          return;
        }

        target.show();
        target.setSkipTaskbar(false);
        target.setIgnoreMouseEvents(true, { forward: true });

        sendOverlayMode('detect');
        pushOverlayState({
          mode: 'detect',
          roi: savedROI,
          harmful: false,
        });

        // OCR 모니터링 시작 (오디오 모니터링과 독립적)
        startMonitoring();
        
        // 오디오 모니터링은 ROI와 독립적으로 동작하므로 여기서 자동 시작하지 않음
        // 사용자가 트레이 메뉴나 UI에서 직접 시작/중지 가능
      } else {
        console.log('[Main] Starting in setup mode (no saved state)');
        enterSetupMode();
      }
    });
  }

  app.on('before-quit', () => {
    // OCR 모니터링 중지
    stopMonitoring('Application quitting');
    
    // 오디오 모니터링도 중지 (앱 종료 시)
    const { getAudioService } = require('./ipc/audioHandlers');
    const audioService = getAudioService();
    if (audioService) {
      audioService.stopMonitoring();
      console.log('[Main] Audio monitoring stopped (app quitting)');
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

