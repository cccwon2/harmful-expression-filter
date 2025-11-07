import { app, BrowserWindow, Menu, ipcMain, globalShortcut } from 'electron';
import { createOverlayWindow, setExitEditModeAndHideHandler } from './windows/createOverlayWindow';
import { createTray } from './tray';
import { setupROIHandlers } from './ipc/roi';
import { IPC_CHANNELS } from './ipc/channels';
import { setOverlayWindow, setEditModeState, setTrayUpdateCallback } from './state/editMode';

let overlayWindow: BrowserWindow | null = null;
let tray: ReturnType<typeof createTray> | null = null;

// 헤드리스 실행: 메뉴 없음
Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  // 오버레이 창 생성 (초기에는 숨김, 기본 상태는 클릭스루)
  overlayWindow = createOverlayWindow();
  
  // Edit Mode 상태 관리에 오버레이 창 등록
  if (overlayWindow) {
    setOverlayWindow(overlayWindow);
  }
  
  // ROI 핸들러 설정
  if (overlayWindow) {
    setupROIHandlers(overlayWindow);
  }
  
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
  
  // Edit Mode 종료 및 오버레이 숨김 함수 (메인 프로세스에서 직접 호출용)
  const handleExitEditModeAndHide = () => {
    console.log('[Main] Exit Edit Mode and hide overlay (direct call from main process)');
    if (overlayWindow) {
      setEditModeState(false);
      overlayWindow.hide();
      overlayWindow.setSkipTaskbar(true);
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
    tray = createTray(overlayWindow);
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
    
    // 오버레이 창이 로드 완료되면 자동으로 표시하고 Edit Mode 활성화
    overlayWindow.webContents.once('did-finish-load', () => {
      console.log('[Main] Overlay window loaded, showing and enabling Edit Mode...');
      if (overlayWindow) {
        // 오버레이 창 표시
        overlayWindow.show();
        overlayWindow.setSkipTaskbar(false);
        // Edit Mode 활성화
        setEditModeState(true);
        // 마우스 이벤트 활성화
        overlayWindow.setIgnoreMouseEvents(false);
        // 키보드 포커스 설정
        overlayWindow.focus();
        // Windows에서 포커스를 보장하기 위해 약간의 지연 후 다시 포커스
        setTimeout(() => {
          if (overlayWindow && overlayWindow.isVisible()) {
            overlayWindow.focus();
            overlayWindow.setIgnoreMouseEvents(false);
            console.log('[Main] Overlay focus and mouse events enabled after timeout');
            // 트레이 메뉴 업데이트
            if (tray && typeof (tray as any).updateContextMenu === 'function') {
              (tray as any).updateContextMenu();
            }
          }
        }, 100);
        console.log('[Main] Edit Mode enabled by default on app start');
      }
    });
  }

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

