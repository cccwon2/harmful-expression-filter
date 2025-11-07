import { BrowserWindow, screen } from 'electron';
import * as path from 'path';

export function createOverlayWindow(): BrowserWindow {
  const displays = screen.getAllDisplays();
  const primaryDisplay = displays[0];
  const { width, height } = primaryDisplay.bounds;

  const overlayWindow = new BrowserWindow({
    width,
    height,
    x: primaryDisplay.bounds.x,
    y: primaryDisplay.bounds.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 초기에는 클릭-스루 비활성화 (ROI 선택 가능)
  overlayWindow.setIgnoreMouseEvents(false);

  // 초기에는 숨김 (트레이 메뉴에서 표시)
  overlayWindow.hide();

  // 개발 모드와 프로덕션 모드 분기
  if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
    overlayWindow.loadURL('http://localhost:5173/overlay.html');
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../../dist/renderer/overlay.html'));
  }

  return overlayWindow;
}

