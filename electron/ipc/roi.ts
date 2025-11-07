import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from './channels';

export interface ROIRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function setupROIHandlers(mainWindow: BrowserWindow, overlayWindow: BrowserWindow) {
  ipcMain.on(IPC_CHANNELS.ROI_SELECTED, (_event, rect: ROIRect) => {
    console.log('ROI selected:', rect);
    
    // ROI 선택 완료 후 오버레이 창에 클릭-스루 활성화
    // forward: true 옵션으로 클릭 이벤트를 하위 창으로 전달
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    
    // 메인 윈도우에 ROI 좌표 전달
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.ROI_SELECTED, rect);
    }
  });

  ipcMain.on(IPC_CHANNELS.ROI_START_SELECTION, () => {
    console.log('ROI selection started');
    // ROI 선택 시작 시 클릭-스루 비활성화
    overlayWindow.setIgnoreMouseEvents(false);
  });

  ipcMain.on(IPC_CHANNELS.ROI_CANCEL_SELECTION, () => {
    console.log('ROI selection cancelled');
    // ROI 선택 취소 시에도 클릭-스루 비활성화 (다시 선택 가능하게)
    overlayWindow.setIgnoreMouseEvents(false);
  });
}

