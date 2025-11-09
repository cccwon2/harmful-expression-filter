import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from './ipc/channels';

let alertInterval: NodeJS.Timeout | null = null;
let isHarmful = false;

export function setupServerClientStub(overlayWindow: BrowserWindow) {
  if (alertInterval) {
    return;
  }

  console.log('[Server] Stub started');
  alertInterval = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      console.warn('[Server] Overlay window unavailable, skipping alert');
      return;
    }

    isHarmful = !isHarmful;
    overlayWindow.webContents.send(IPC_CHANNELS.ALERT_FROM_SERVER, {
      harmful: isHarmful,
    });
    console.log('[Server] Alert signal:', isHarmful ? 1 : 0);
  }, 3000);
}

export function stopServerClientStub() {
  if (alertInterval) {
    clearInterval(alertInterval);
    alertInterval = null;
    console.log('[Server] Stub stopped');
  }
  isHarmful = false;
}
