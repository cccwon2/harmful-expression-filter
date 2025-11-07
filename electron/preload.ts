import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './ipc/channels';
import type { ROIRect } from './ipc/roi';

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
          ipcRenderer.invoke(IPC_CHANNELS.SET_CLICK_THROUGH, enabled);
          console.log('[Preload] SET_CLICK_THROUGH IPC sent');
        } catch (error) {
          console.error('[Preload] Error sending SET_CLICK_THROUGH:', error);
        }
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
      };
    };
  }
}

