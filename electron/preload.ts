import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './ipc/channels';
import type { ROIRect } from './ipc/roi';

// OverlayMode 타입 정의 (preload에서 직접 정의)
type OverlayMode = 'setup' | 'detect' | 'alert';

// preload 스크립트 로드 확인 (메인 프로세스 콘솔에 출력)
console.log('[Preload] Preload script loaded');

// 안전한 API 노출
try {
  contextBridge.exposeInMainWorld('api', {
    appVersion: '1.0.0',
    getVersion: () => '1.0.0',
    // ROI 관련 IPC API
    roi: {
      sendSelected: (rect: ROIRect) => {
        ipcRenderer.send(IPC_CHANNELS.ROI_SELECTED, rect);
      },
      sendStartSelection: () => {
        ipcRenderer.send(IPC_CHANNELS.ROI_START_SELECTION);
      },
      sendCancelSelection: () => {
        ipcRenderer.send(IPC_CHANNELS.ROI_CANCEL_SELECTION);
      },
    },
    // Edit Mode 관련 IPC API
    editMode: {
      exit: () => {
        console.log('[Preload] editMode.exit() called');
        try {
          ipcRenderer.send(IPC_CHANNELS.EXIT_EDIT_MODE);
          console.log('[Preload] EXIT_EDIT_MODE IPC sent');
        } catch (error) {
          console.error('[Preload] Error sending EXIT_EDIT_MODE:', error);
        }
      },
      exitAndHide: () => {
        console.log('[Preload] editMode.exitAndHide() called');
        try {
          ipcRenderer.send(IPC_CHANNELS.EXIT_EDIT_MODE_AND_HIDE);
          console.log('[Preload] EXIT_EDIT_MODE_AND_HIDE IPC sent');
        } catch (error) {
          console.error('[Preload] Error sending EXIT_EDIT_MODE_AND_HIDE:', error);
        }
      },
    },
    // 오버레이 관련 IPC API
    overlay: {
      hide: () => {
        console.log('[Preload] overlay.hide() called');
        try {
          ipcRenderer.send(IPC_CHANNELS.HIDE_OVERLAY);
          console.log('[Preload] HIDE_OVERLAY IPC sent');
        } catch (error) {
          console.error('[Preload] Error sending HIDE_OVERLAY:', error);
        }
      },
      setClickThrough: (enabled: boolean) => {
        console.log('[Preload] overlay.setClickThrough() called with:', enabled);
        try {
          return ipcRenderer.invoke(IPC_CHANNELS.SET_CLICK_THROUGH, enabled);
        } catch (error) {
          console.error('[Preload] Error sending SET_CLICK_THROUGH:', error);
          return Promise.reject(error);
        }
      },
      sendROI: (roi: ROIRect) => {
        console.log('[Preload] overlay.sendROI() called with:', roi);
        try {
          ipcRenderer.send(IPC_CHANNELS.ROI_SELECTED, roi);
          console.log('[Preload] ROI_SELECTED IPC sent');
        } catch (error) {
          console.error('[Preload] Error sending ROI_SELECTED:', error);
        }
      },
      onModeChange: (callback: (mode: OverlayMode) => void) => {
        console.log('[Preload] overlay.onModeChange() listener registered');
        const listener = (_event: unknown, mode: OverlayMode) => {
          console.log('[Preload] Mode change received:', mode);
          callback(mode);
        };
        ipcRenderer.on(IPC_CHANNELS.OVERLAY_SET_MODE, listener);
        return () => {
          console.log('[Preload] overlay.onModeChange() listener removed');
          ipcRenderer.removeListener(IPC_CHANNELS.OVERLAY_SET_MODE, listener);
        };
      },
    },
  });
  
  console.log('[Preload] api exposed successfully');
} catch (error) {
  console.error('[Preload] Failed to expose api:', error);
}

// TypeScript 타입 정의를 위한 전역 타입 선언
declare global {
  interface Window {
    api: {
      appVersion: string;
      getVersion: () => string;
      roi: {
        sendSelected: (rect: ROIRect) => void;
        sendStartSelection: () => void;
        sendCancelSelection: () => void;
      };
      editMode: {
        exit: () => void;
        exitAndHide: () => void;
      };
      overlay: {
        hide: () => void;
        setClickThrough: (enabled: boolean) => Promise<void>;
        sendROI: (roi: ROIRect) => void;
        onModeChange: (callback: (mode: OverlayMode) => void) => () => void;
      };
    };
  }
}

