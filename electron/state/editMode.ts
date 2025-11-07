import { BrowserWindow } from 'electron';

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

export function setEditModeState(value: boolean) {
  isEditMode = value;
  if (overlayWindow) {
    if (value) {
      // Edit Mode 활성화: 마우스 이벤트 활성화
      overlayWindow.setIgnoreMouseEvents(false);
      console.log('[EditMode] Edit Mode enabled - mouse events enabled');
    } else {
      // Edit Mode 비활성화: 클릭스루 활성화 (다른 창 클릭 가능)
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      console.log('[EditMode] Edit Mode disabled - click-through enabled');
      // Edit Mode가 비활성화되면 오버레이도 숨김 (다른 창을 방해하지 않도록)
      // 단, 오버레이 창이 이미 숨겨져 있으면 숨기지 않음 (초기 로딩 중일 수 있음)
      if (overlayWindow.isVisible()) {
        overlayWindow.hide();
        overlayWindow.setSkipTaskbar(true);
        console.log('[EditMode] Overlay hidden because Edit Mode is disabled');
      }
    }
  }
  // 트레이 메뉴 업데이트
  if (trayUpdateCallback) {
    trayUpdateCallback();
  }
}

