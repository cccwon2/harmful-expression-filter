import { BrowserWindow, app } from 'electron';
import * as path from 'path';

export function createMainWindow(): BrowserWindow {
  // preload 경로 설정 (절대 경로 사용)
  const preloadPath = path.resolve(__dirname, '../preload.js');
  console.log('[Main] Preload path:', preloadPath);
  console.log('[Main] __dirname:', __dirname);

  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    backgroundColor: '#121212',
    show: false, // 기본적으로 숨김 (오버레이 창이 메인)
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // preload 로드 확인 및 디버깅
  mainWindow.webContents.once('dom-ready', () => {
    console.log('[Main] DOM ready, checking preload...');
    // 렌더러 컨텍스트에서 window.api 확인
    setTimeout(() => {
      mainWindow.webContents.executeJavaScript(`
        console.log('[Renderer] window.api:', typeof window.api !== 'undefined' ? window.api : 'undefined');
        console.log('[Renderer] window.electronAPI:', typeof window.electronAPI !== 'undefined' ? window.electronAPI : 'undefined');
        console.log('[Renderer] window keys:', Object.keys(window).filter(k => k.includes('api') || k.includes('electron')));
      `).catch((err) => {
        console.error('[Main] ExecuteJavaScript error:', err);
      });
    }, 100);
  });

  // preload 로드 확인
  mainWindow.webContents.once('did-finish-load', () => {
    console.log('[Main] Window loaded completely');
  });

  // preload 오류 확인
  mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
    console.error('[Main] Preload error:', preloadPath, error);
  });

  // 개발 모드와 프로덕션 모드 분기
  if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }

  return mainWindow;
}

