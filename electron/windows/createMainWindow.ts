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

  // preload 오류 확인 (에러를 조용히 처리)
  mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
    // 메인 윈도우는 개발/디버깅용이므로 에러를 조용히 처리
    // EPIPE 오류는 무시 (파이프가 끊어진 경우)
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EPIPE') {
      return; // EPIPE 오류는 무시
    }
    console.error('[Main] Preload error:', preloadPath, error);
  });

  // 로드 실패 처리
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    // 메인 윈도우는 개발/디버깅용이므로 로드 실패를 조용히 처리
    // Vite 개발 서버가 실행되지 않은 경우를 대비
    if (errorCode === -105 || errorCode === -106) { // ERR_NAME_NOT_RESOLVED, ERR_INTERNET_DISCONNECTED
      // 개발 서버가 없으면 조용히 무시 (메인 윈도우는 선택적)
      return;
    }
    console.warn(`[Main] Window load failed (${errorCode}): ${errorDescription}`);
  });

  // 개발 모드와 프로덕션 모드 분기
  if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
    // Vite 개발 서버가 실행 중일 때만 로드 시도
    // 실패하면 조용히 무시 (메인 윈도우는 개발/디버깅용)
    mainWindow.loadURL('http://localhost:5173').catch((err) => {
      // EPIPE 오류는 무시 (파이프가 끊어진 경우)
      if (err && typeof err === 'object' && 'code' in err && err.code === 'EPIPE') {
        return;
      }
      // 다른 오류는 경고만 출력 (조용히 처리)
      if (err && typeof err === 'object' && 'code' in err && err.code !== 'ERR_CONNECTION_REFUSED') {
        console.warn('[Main] Failed to load main window (development server may not be running):', err);
      }
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/renderer/index.html')).catch((err) => {
      // 프로덕션 모드에서도 실패 시 조용히 처리
      console.warn('[Main] Failed to load main window:', err);
    });
  }

  return mainWindow;
}

