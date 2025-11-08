import { BrowserWindow } from 'electron';

type EditModeOptions = {
  hideOverlay?: boolean;
};

let isEditMode = false;
let overlayWindow: BrowserWindow | null = null;
let trayUpdateCallback: (() => void) | null = null;

export function setOverlayWindow(window: BrowserWindow | null) {
  overlayWindow = window;
}

export function setTrayUpdateCallback(callback: (() => void) | null) {
  trayUpdateCallback = callback;
}

export function getEditModeState(): boolean {
  return isEditMode;
}

export function setEditModeState(value: boolean, options: EditModeOptions = {}) {
  isEditMode = value;
  if (overlayWindow) {
    if (value) {
      overlayWindow.setIgnoreMouseEvents(false);
      console.log('[EditMode] Edit Mode enabled - mouse events enabled');
    } else {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      console.log('[EditMode] Edit Mode disabled - click-through enabled');
      const shouldHideOverlay = options.hideOverlay !== false;
      if (shouldHideOverlay && overlayWindow.isVisible()) {
        overlayWindow.hide();
        overlayWindow.setSkipTaskbar(true);
        console.log('[EditMode] Overlay hidden because Edit Mode is disabled');
      }
    }
  }
  if (trayUpdateCallback) {
    trayUpdateCallback();
  }
}

