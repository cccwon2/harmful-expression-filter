import { BrowserWindow } from 'electron';
import * as path from 'path';
import { getEditModeState, setEditModeState } from '../state/editMode';

let overlayTrayUpdateCallback: (() => void) | null = null;

export function setOverlayTrayUpdateCallback(callback: (() => void) | null) {
  overlayTrayUpdateCallback = callback;
}

// Edit Mode 종료 및 오버레이 숨김 핸들러를 외부에서 설정할 수 있도록
let exitEditModeAndHideHandler: (() => void) | null = null;

export function setExitEditModeAndHideHandler(handler: (() => void) | null) {
  exitEditModeAndHideHandler = handler;
}

export function createOverlayWindow(): BrowserWindow {
  console.log('[Overlay] Creating overlay window...');
  
  const overlayWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    alwaysOnTop: true,
    type: process.platform === 'linux' ? 'panel' : undefined, // Linux에서 더 나은 오버레이 지원
    show: false, // 초기에는 숨김, 로드 완료 후 표시
    webPreferences: {
      preload: path.resolve(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 개발자 도구에서 콘솔 로그가 제대로 표시되도록 설정
      devTools: true,
    },
  });

  console.log('[Overlay] Overlay window created');

  // 로드 실패 감지 (개발 단계에서 서버 미기동 등 문제 추적)
  overlayWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[Overlay] did-fail-load:', { errorCode, errorDescription, validatedURL });
    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      console.log('[Overlay] Retrying overlay load after failure...');
      setTimeout(() => {
        overlayWindow.loadURL('http://localhost:5173/overlay.html').catch((err) => {
          console.error('[Overlay] Retry loadURL failed:', err);
        });
      }, 500);
    }
  });

  overlayWindow.webContents.on('did-fail-provisional-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[Overlay] did-fail-provisional-load:', { errorCode, errorDescription, validatedURL });
  });

  // 기본 상태: 클릭-스루 활성화 (마우스 이벤트가 아래 앱으로 전달됨)
  // Edit Mode에서만 클릭-스루가 해제되어 ROI 선택 가능
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  console.log('[Overlay] Click-through enabled by default');

  // 오버레이 창이 로드 완료되면 설정 (main.ts에서 did-finish-load 처리하므로 여기서는 alwaysOnTop만 설정)
  overlayWindow.webContents.once('did-finish-load', () => {
    console.log('[Overlay] Overlay window loaded in createOverlayWindow');
    
    // Windows에서 더 강한 alwaysOnTop 설정
    if (process.platform === 'win32') {
      try {
        // 'screen-saver' 레벨은 가장 높은 우선순위
        overlayWindow.setAlwaysOnTop(true, 'screen-saver');
        console.log('[Overlay] Set to screen-saver level');
      } catch (error) {
        // screen-saver가 지원되지 않는 경우 일반 alwaysOnTop 사용
        console.warn('[Overlay] screen-saver level not supported, using default:', error);
        overlayWindow.setAlwaysOnTop(true);
      }
    } else {
      overlayWindow.setAlwaysOnTop(true);
    }
    
    console.log('[Overlay] Overlay window configured, alwaysOnTop:', overlayWindow.isAlwaysOnTop());
  });

  // DOM 준비 완료 확인
  overlayWindow.webContents.once('dom-ready', () => {
    console.log('[Overlay] DOM ready');
  });
  
  // 개발자 도구 상태 모니터링을 위한 주기적 체크 (백업)
  // devtools-closed 이벤트가 발생하지 않는 경우를 대비
  let devToolsCheckInterval: NodeJS.Timeout | null = null;
  let wasDevToolsOpen = false;
  
  const checkDevToolsState = () => {
    if (!overlayWindow) return;
    
    const isDevToolsOpen = overlayWindow.webContents.isDevToolsOpened();
    const { getEditModeState } = require('../state/editMode');
    const isEditMode = getEditModeState();
    
    // 개발자 도구가 닫혔고, 이전에 열려 있었으면 마우스 이벤트 활성화
    if (!isDevToolsOpen && wasDevToolsOpen && isEditMode) {
      overlayWindow.setIgnoreMouseEvents(false);
      console.log('[Overlay] DevTools closed detected via polling - mouse events re-enabled');
    }
    
    wasDevToolsOpen = isDevToolsOpen;
  };
  
  // 개발자 도구 상태 체크 시작 (1초마다)
  devToolsCheckInterval = setInterval(checkDevToolsState, 1000);
  
  // 오버레이 창이 닫히면 체크 중지
  overlayWindow.on('closed', () => {
    if (devToolsCheckInterval) {
      clearInterval(devToolsCheckInterval);
      devToolsCheckInterval = null;
    }
  });
  
  // 키보드 이벤트 처리 - 메인 프로세스에서 Ctrl+E/Q 처리
  overlayWindow.webContents.on('before-input-event', (event, input) => {
    // Ctrl+Shift+I 또는 F12: 개발자 도구 토글 (undocked 모드로 열어서 다른 창 클릭 가능)
    if (
      (input.control || input.meta) && 
      input.shift && 
      input.key.toLowerCase() === 'i'
    ) {
      console.log('[Overlay] Ctrl+Shift+I detected - opening DevTools');
      if (overlayWindow.webContents.isDevToolsOpened()) {
        overlayWindow.webContents.closeDevTools();
        // 개발자 도구가 닫히면 Edit Mode 상태에 따라 마우스 이벤트 설정
        wasDevToolsOpen = false; // 개발자 도구 상태 추적 업데이트
        setTimeout(() => {
          if (overlayWindow && overlayWindow.isVisible()) {
            const { getEditModeState } = require('../state/editMode');
            const isEditMode = getEditModeState();
            if (isEditMode) {
              overlayWindow.setIgnoreMouseEvents(false);
              console.log('[Overlay] Mouse events re-enabled after DevTools closed (Edit Mode active)');
            }
          }
        }, 100);
      } else {
        // detach 모드로 열어서 완전히 독립된 창으로 표시 (이동 가능)
        // detach는 undocked보다 더 독립적인 모드
        overlayWindow.webContents.openDevTools({ mode: 'detach' });
        console.log('[Overlay] DevTools opened in detach mode - window should be movable');
        
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
              console.error('[Overlay] Error executing JavaScript in DevTools:', err);
            });
          }
        }, 500);
        
        // 개발자 도구가 열려 있을 때도 Edit Mode가 활성화되어 있으면 마우스 이벤트 유지
        // (ROI 선택을 시작할 수 있도록)
        const { getEditModeState } = require('../state/editMode');
        const isEditMode = getEditModeState();
        wasDevToolsOpen = true; // 개발자 도구 상태 추적 업데이트
        if (isEditMode) {
          // Edit Mode가 활성화되어 있으면 마우스 이벤트 유지
          // 개발자 도구 창은 detach 모드로 열려 있어서 독립적으로 이동 가능
          overlayWindow.setIgnoreMouseEvents(false);
          console.log('[Overlay] Mouse events kept enabled while DevTools is open (Edit Mode active)');
        } else {
          // Edit Mode가 비활성화되어 있으면 클릭-스루 활성화
          overlayWindow.setIgnoreMouseEvents(true, { forward: true });
          console.log('[Overlay] Click-through enabled while DevTools is open (Edit Mode inactive)');
        }
        // 개발자 도구 창이 닫히면 다시 마우스 이벤트 활성화
        overlayWindow.webContents.once('devtools-closed', () => {
          if (overlayWindow && overlayWindow.isVisible()) {
            const { getEditModeState } = require('../state/editMode');
            const isEditMode = getEditModeState();
            if (isEditMode) {
              overlayWindow.setIgnoreMouseEvents(false);
              wasDevToolsOpen = false;
              console.log('[Overlay] Mouse events re-enabled after DevTools closed (Edit Mode active)');
            }
          }
        });
      }
      event.preventDefault();
      return;
    }
    
    if (input.key === 'F12') {
      console.log('[Overlay] F12 detected - opening DevTools');
      if (overlayWindow.webContents.isDevToolsOpened()) {
        overlayWindow.webContents.closeDevTools();
        // 개발자 도구가 닫히면 Edit Mode 상태에 따라 마우스 이벤트 설정
        wasDevToolsOpen = false; // 개발자 도구 상태 추적 업데이트
        setTimeout(() => {
          if (overlayWindow && overlayWindow.isVisible()) {
            const { getEditModeState } = require('../state/editMode');
            const isEditMode = getEditModeState();
            if (isEditMode) {
              overlayWindow.setIgnoreMouseEvents(false);
              console.log('[Overlay] Mouse events re-enabled after DevTools closed (Edit Mode active)');
            }
          }
        }, 100);
      } else {
        // detach 모드로 열어서 완전히 독립된 창으로 표시 (이동 가능)
        // detach는 undocked보다 더 독립적인 모드
        overlayWindow.webContents.openDevTools({ mode: 'detach' });
        console.log('[Overlay] DevTools opened in detach mode - window should be movable');
        
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
              console.error('[Overlay] Error executing JavaScript in DevTools:', err);
            });
          }
        }, 500);
        
        // 개발자 도구가 열려 있을 때도 Edit Mode가 활성화되어 있으면 마우스 이벤트 유지
        // (ROI 선택을 시작할 수 있도록)
        const { getEditModeState } = require('../state/editMode');
        const isEditMode = getEditModeState();
        wasDevToolsOpen = true; // 개발자 도구 상태 추적 업데이트
        if (isEditMode) {
          // Edit Mode가 활성화되어 있으면 마우스 이벤트 유지
          // 개발자 도구 창은 detach 모드로 열려 있어서 독립적으로 이동 가능
          overlayWindow.setIgnoreMouseEvents(false);
          console.log('[Overlay] Mouse events kept enabled while DevTools is open (Edit Mode active)');
        } else {
          // Edit Mode가 비활성화되어 있으면 클릭-스루 활성화
          overlayWindow.setIgnoreMouseEvents(true, { forward: true });
          console.log('[Overlay] Click-through enabled while DevTools is open (Edit Mode inactive)');
        }
        // 개발자 도구 창이 닫히면 다시 마우스 이벤트 활성화
        overlayWindow.webContents.once('devtools-closed', () => {
          if (overlayWindow && overlayWindow.isVisible()) {
            const { getEditModeState } = require('../state/editMode');
            const isEditMode = getEditModeState();
            if (isEditMode) {
              overlayWindow.setIgnoreMouseEvents(false);
              wasDevToolsOpen = false;
              console.log('[Overlay] Mouse events re-enabled after DevTools closed (Edit Mode active)');
            }
          }
        });
      }
      event.preventDefault();
      return;
    }
    
    // Ctrl+E 또는 Ctrl+Q: Edit Mode 종료 + 오버레이 숨김
    if ((input.control || input.meta) && (input.key.toLowerCase() === 'e' || input.key.toLowerCase() === 'q')) {
      console.log('[Overlay] Ctrl+E/Q detected in main process');
      event.preventDefault();
      if (exitEditModeAndHideHandler) {
        exitEditModeAndHideHandler();
      }
      return;
    }
    
    // ESC 키는 renderer에서 처리하도록 전달
    if (input.key === 'Escape') {
      // renderer에서 처리하도록 이벤트 전달 (차단하지 않음)
      console.log('[Overlay] ESC key detected in main process, allowing renderer to handle');
    }
  });

  // 개발자 도구 콘솔 로그 연결 확인
  overlayWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console ${level}] ${message} (${sourceId}:${line})`);
  });
  
  // 개발자 도구가 열릴 때마다 테스트 로그 출력 및 키보드 포커스 해제
  overlayWindow.webContents.on('devtools-opened', () => {
    console.log('[Overlay] DevTools opened event fired');
    // 오버레이 창의 키보드 포커스 해제 (개발자 도구가 키보드 입력을 받을 수 있도록)
    overlayWindow.blur();
    setTimeout(() => {
      if (overlayWindow && overlayWindow.webContents.isDevToolsOpened()) {
        overlayWindow.webContents.executeJavaScript(`
          (function() {
            console.log('%c[DevTools] DevTools opened event received!', 'color: blue; font-weight: bold; font-size: 16px;');
            console.log('[DevTools] All console logs should appear here');
            console.log('[DevTools] You can type commands in the console now');
            if (window.__overlayState) {
              console.log('[DevTools] Overlay state:', window.__overlayState);
            } else {
              console.warn('[DevTools] Overlay state not available yet');
            }
          })();
        `).catch((err) => {
          console.error('[Overlay] Error executing JavaScript in DevTools (devtools-opened):', err);
        });
      }
    }, 200);
  });

  // 개발 모드와 프로덕션 모드 분기
  if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
    overlayWindow.loadURL('http://localhost:5173/overlay.html');
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../../dist/renderer/overlay.html'));
  }

  return overlayWindow;
}

