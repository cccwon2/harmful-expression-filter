import { BrowserWindow, app } from 'electron';
import * as path from 'path';
import axios from 'axios';

export function createMainWindow(): BrowserWindow {
  // preload 경로 설정 (절대 경로 사용)
  const preloadPath = path.resolve(__dirname, '../preload.js');
  console.log('[Main] Preload path:', preloadPath);
  console.log('[Main] __dirname:', __dirname);

  const mainWindow = new BrowserWindow({
    width: 400,
    height: 320,
    backgroundColor: '#0a0a0a',
    title: "OnVoice",
    show: true, // 대시보드를 기본으로 표시
    resizable: false, // 크기 조절 비활성화
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
    // ERR_CONNECTION_REFUSED는 waitForDevServer에서 처리 중이므로 무시
    if (errorCode === -102) {
      return;
    }
    // 메인 윈도우는 개발/디버깅용이므로 로드 실패를 조용히 처리
    // Vite 개발 서버가 실행되지 않은 경우를 대비
    if (errorCode === -105 || errorCode === -106) { // ERR_NAME_NOT_RESOLVED, ERR_INTERNET_DISCONNECTED
      // 개발 서버가 없으면 조용히 무시 (메인 윈도우는 선택적)
      return;
    }
    console.warn(`[Main] Window load failed (${errorCode}): ${errorDescription}`);
  });

  // 개발 모드와 프로덕션 모드 분기
  // 배포 모드(app.isPackaged)에서는 항상 프로덕션 모드로 처리
  if (!app.isPackaged && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV)) {
    // Vite 개발 서버가 준비될 때까지 대기 후 로드
    const waitForDevServer = async (retries = 30, delay = 500) => {
      for (let i = 0; i < retries; i++) {
        try {
          await axios.get('http://localhost:5173', { timeout: 1000 });
          // 서버가 준비되었으면 로드 시도
          console.log('[Main] ✅ Vite 개발 서버 준비 완료 - 윈도우 로드 중...');
          mainWindow.loadURL('http://localhost:5173').catch((err) => {
            if (err && typeof err === 'object' && 'code' in err && err.code === 'EPIPE') {
              return;
            }
            console.warn('[Main] Failed to load main window:', err);
          });
          return;
        } catch (error: any) {
          if (i === 0) {
            console.log('[Main] Vite 개발 서버 대기 중... (최대 15초)');
          }
          if (i < retries - 1) {
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            console.error('[Main] ⚠️ Vite 개발 서버가 시작되지 않았습니다 (15초 타임아웃).');
            console.error('[Main] 해결 방법: "npm run dev"로 전체 개발 환경을 시작하세요.');
            // 마지막 시도로 로드 시도 (서버가 방금 시작되었을 수 있음)
            mainWindow.loadURL('http://localhost:5173').catch((err) => {
              console.error('[Main] 최종 로드 시도 실패:', err);
            });
          }
        }
      }
    };
    waitForDevServer();
  } else {
    // 패키지 환경에서 __dirname 은 dist-electron/windows 이므로
    // Vite build 결과(dist-electron/renderer)를 그대로 바라본다
    const indexPath = path.join(__dirname, '../renderer/index.html');
    console.log('[Main] 🔍 배포 모드 - 메인 윈도우 로드 정보:');
    console.log('[Main]   - __dirname:', __dirname);
    console.log('[Main]   - indexPath:', indexPath);
    
    // 파일 존재 여부 확인
    const fs = require('fs');
    if (fs.existsSync(indexPath)) {
      console.log('[Main] ✅ index.html 파일 발견:', indexPath);
    } else {
      console.error('[Main] ❌ index.html 파일을 찾을 수 없음:', indexPath);
      console.error('[Main] 💡 빌드가 제대로 완료되었는지 확인하세요: npm run build:all');
    }
    
    mainWindow
      .loadFile(indexPath)
      .catch((err) => {
        // 프로덕션 모드에서도 실패 시 조용히 처리
        console.error('[Main] ❌ 메인 윈도우 로드 실패:', err);
      });
  }

  return mainWindow;
}

