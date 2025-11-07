import { app, BrowserWindow, Menu } from 'electron';
import { createMainWindow } from './windows/createMainWindow';
import { createTray } from './tray';

let mainWindow: BrowserWindow | null = null;
let tray: ReturnType<typeof createTray> | null = null;

// 개발 모드에서만 메뉴 표시 (Ctrl+Shift+I로 DevTools 열기)
const createMenu = () => {
  if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'View',
        submenu: [
          { 
            role: 'toggleDevTools',
            label: 'Toggle Developer Tools',
            accelerator: process.platform === 'darwin' ? 'Cmd+Option+I' : 'Ctrl+Shift+I',
          },
          { type: 'separator' },
          { role: 'reload', label: 'Reload' },
          { role: 'forceReload', label: 'Force Reload' },
        ],
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  } else {
    // 프로덕션에서는 메뉴 숨김
    Menu.setApplicationMenu(null);
  }
};

app.whenReady().then(() => {
  createMenu();
  mainWindow = createMainWindow();
  
  // 시스템 트레이 생성
  if (mainWindow) {
    tray = createTray(mainWindow);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      if (mainWindow) {
        tray = createTray(mainWindow);
      }
    }
  });
});

app.on('window-all-closed', () => {
  // 모든 OS에서 창이 닫혀도 트레이만 남기고 앱 유지 (트레이에서 Quit 선택 시 종료)
  // macOS는 기본 동작 유지
  if (process.platform !== 'darwin') {
    // Windows/Linux: 창을 닫아도 앱은 계속 실행 (트레이에 있음)
    // 실제 종료는 트레이 메뉴의 "Quit" 또는 app.quit() 호출 시에만
  }
});

