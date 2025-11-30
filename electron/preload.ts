import { contextBridge, ipcRenderer } from 'electron';
import type { ROI } from './ipc/roi';

// Preload 스크립트는 sandbox 환경에서 실행되므로 직접 import 대신 상수 정의
// IPC 채널 상수 (channels.ts와 동기화 필요)
const IPC_CHANNELS = {
  ROI_SELECTED: 'roi:selected',
  ROI_START_SELECTION: 'roi-start-selection',
  ROI_CANCEL_SELECTION: 'roi-cancel-selection',
  EXIT_EDIT_MODE: 'exit-edit-mode',
  HIDE_OVERLAY: 'hide-overlay',
  EXIT_EDIT_MODE_AND_HIDE: 'exit-edit-mode-and-hide',
  SET_CLICK_THROUGH: 'overlay:setClickThrough',
  OVERLAY_SET_MODE: 'overlay:setMode',
  OVERLAY_MODE_CHANGED: 'overlay:modeChanged', // 렌더러에서 메인 프로세스로 모드 변경 알림
  OVERLAY_STATE_PUSH: 'overlay:state',
  START_MONITORING: 'monitoring:start',
  STOP_MONITORING: 'monitoring:stop',
  OCR_START: 'ocr:start',
  OCR_STOP: 'ocr:stop',
  ALERT_FROM_SERVER: 'alert:server',
  AUDIO_STATUS: 'audio:status',
  AUDIO_HARMFUL_DETECTED: 'audio:harmful-detected',
} as const;

const SERVER_CHANNELS = {
  HEALTH_CHECK: 'server:health-check',
  ANALYZE_TEXT: 'server:analyze-text',
  GET_KEYWORDS: 'server:get-keywords',
  OCR_IMAGE: 'server:ocr-image',
  OCR_AND_ANALYZE: 'server:ocr-and-analyze',
} as const;

const AUDIO_CHANNELS = {
  START_MONITORING: 'audio:start-monitoring',
  STOP_MONITORING: 'audio:stop-monitoring',
  GET_STATUS: 'audio:get-status',
  SET_VOLUME_LEVEL: 'audio:set-volume-level',
  SET_BEEP_ENABLED: 'audio:set-beep-enabled',
} as const;

const ONVOICE_CHANNELS = {
  START_CAPTURE: 'onvoice:startCapture',
  STOP_CAPTURE: 'onvoice:stopCapture',
  GET_STATUS: 'onvoice:get-status',
} as const;

const DASHBOARD_CHANNELS = {
  SELECT_MODE: 'dashboard:select-mode',         // 모드 선택 (ocr | voice)
  TOGGLE_OCR: 'dashboard:toggle-ocr',
  TOGGLE_VOICE: 'dashboard:toggle-voice',
  GET_WINDOW_STATUS: 'dashboard:get-window-status',
  OCR_STATUS_CHANGE: 'dashboard:ocr-status-change',
} as const;

// OverlayMode 타입 정의 (preload에서 직접 정의)
type OverlayMode = 'setup' | 'detect' | 'alert';
type OverlayState = {
  mode: OverlayMode;
  roi?: ROI;
  harmful?: boolean;
};

type ServerHealthResponse = {
  status: string;
  keywords_loaded: number;
  stt_loaded: boolean;
  ai_model_loaded: boolean;
};

type ServerAnalyzeResponse = {
  has_violation: boolean;
  confidence: number;
  matched_keywords: string[];
  method: string;
  processing_time: number;
};

type ServerKeywordsResponse = {
  total: number;
  keywords: string[];
};

type ServerErrorResponse = {
  error: true;
  message: string;
  code?: string;
  status?: number;
};

type ServerAPI = {
  healthCheck: () => Promise<ServerHealthResponse | ServerErrorResponse>;
  analyzeText: (text: string) => Promise<ServerAnalyzeResponse | ServerErrorResponse>;
  getKeywords: () => Promise<ServerKeywordsResponse | ServerErrorResponse>;
  ocrImage: (imageBuffer: Buffer) => Promise<{ 
    success: boolean; 
    data?: { 
      texts: string[]; 
      processing_time: number; 
      text_count: number 
    }; 
    error?: string 
  }>;
  ocrAndAnalyze: (imageBuffer: Buffer) => Promise<{ 
    success: boolean; 
    data?: { 
      texts: string[]; 
      is_harmful: boolean; 
      harmful_words: string[]; 
      processing_time: { ocr: number; analysis: number; total: number } 
    }; 
    error?: string 
  }>;
};

// preload 스크립트 로드 확인 (메인 프로세스 콘솔에 출력)
console.log('[Preload] Preload script loaded');

// 안전한 API 노출
try {
  contextBridge.exposeInMainWorld('api', {
    appVersion: '1.0.0',
    getVersion: () => '1.0.0',
    // ROI 관련 IPC API
    roi: {
      sendSelected: (rect: ROI) => {
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
      sendROI: (roi: ROI) => {
        console.log('[Preload] overlay.sendROI() called with:', roi);
        try {
          ipcRenderer.send(IPC_CHANNELS.ROI_SELECTED, roi);
          console.log('[Preload] ROI_SELECTED IPC sent');
        } catch (error) {
          console.error('[Preload] Error sending ROI_SELECTED:', error);
        }
      },
      sendModeChange: (mode: OverlayMode) => {
        console.log('[Preload] overlay.sendModeChange() called with:', mode);
        try {
          ipcRenderer.send(IPC_CHANNELS.OVERLAY_MODE_CHANGED, mode);
          console.log('[Preload] OVERLAY_MODE_CHANGED IPC sent');
        } catch (error) {
          console.error('[Preload] Error sending OVERLAY_MODE_CHANGED:', error);
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
      onStatePush: (callback: (state: OverlayState) => void) => {
        console.log('[Preload] overlay.onStatePush() listener registered');
        const listener = (_event: unknown, state: OverlayState) => {
          // 유해 표현 감지 시에만 로그 출력
          if (state.harmful) {
            console.warn('[Preload] 🚨 State push received (harmful):', state);
          }
          callback(state);
        };
        ipcRenderer.on(IPC_CHANNELS.OVERLAY_STATE_PUSH, listener);
        return () => {
          console.log('[Preload] overlay.onStatePush() listener removed');
          ipcRenderer.removeListener(IPC_CHANNELS.OVERLAY_STATE_PUSH, listener);
        };
      },
      startMonitoring: () => {
        console.log('[Preload] overlay.startMonitoring() called');
        try {
          ipcRenderer.send(IPC_CHANNELS.START_MONITORING);
        } catch (error) {
          console.error('[Preload] Error sending START_MONITORING:', error);
        }
      },
      stopMonitoring: () => {
        console.log('[Preload] overlay.stopMonitoring() called');
        try {
          ipcRenderer.send(IPC_CHANNELS.STOP_MONITORING);
        } catch (error) {
          console.error('[Preload] Error sending STOP_MONITORING:', error);
        }
      },
      onStopMonitoring: (callback: () => void) => {
        console.log('[Preload] overlay.onStopMonitoring() listener registered');
        const listener = () => {
          console.log('[Preload] STOP_MONITORING received');
          callback();
        };
        ipcRenderer.on(IPC_CHANNELS.STOP_MONITORING, listener);
        return () => {
          console.log('[Preload] overlay.onStopMonitoring() listener removed');
          ipcRenderer.removeListener(IPC_CHANNELS.STOP_MONITORING, listener);
        };
      },
      onServerAlert: (callback: (harmful: boolean) => void) => {
        const listener = (_event: unknown, payload: { harmful: boolean }) => {
          // 유해 표현 감지 시에만 로그 출력
          if (payload.harmful) {
            console.warn('[Preload] 🚨 Harmful server alert received');
          }
          callback(payload.harmful);
        };
        ipcRenderer.on(IPC_CHANNELS.ALERT_FROM_SERVER, listener);
        return () => {
          ipcRenderer.removeListener(IPC_CHANNELS.ALERT_FROM_SERVER, listener);
        };
      },
    },
    server: {
      healthCheck: () => ipcRenderer.invoke(SERVER_CHANNELS.HEALTH_CHECK),
      analyzeText: (text: string) => ipcRenderer.invoke(SERVER_CHANNELS.ANALYZE_TEXT, text),
      getKeywords: () => ipcRenderer.invoke(SERVER_CHANNELS.GET_KEYWORDS),
      ocrImage: (imageBuffer: Buffer) => ipcRenderer.invoke(SERVER_CHANNELS.OCR_IMAGE, imageBuffer),
      ocrAndAnalyze: (imageBuffer: Buffer) => ipcRenderer.invoke(SERVER_CHANNELS.OCR_AND_ANALYZE, imageBuffer),
    } as ServerAPI,
    // 오디오 모니터링 API
    audio: {
      startMonitoring: () => ipcRenderer.invoke(AUDIO_CHANNELS.START_MONITORING),
      stopMonitoring: () => ipcRenderer.invoke(AUDIO_CHANNELS.STOP_MONITORING),
      getStatus: () => ipcRenderer.invoke(AUDIO_CHANNELS.GET_STATUS),
      setVolumeLevel: (level: number) => ipcRenderer.invoke(AUDIO_CHANNELS.SET_VOLUME_LEVEL, level),
      setBeepEnabled: (enabled: boolean) => ipcRenderer.invoke(AUDIO_CHANNELS.SET_BEEP_ENABLED, enabled),
      // 이벤트 리스너
      onStatusChange: (callback: (status: any) => void) => {
        ipcRenderer.on(IPC_CHANNELS.AUDIO_STATUS, (_, status) => callback(status));
      },
      onHarmfulDetected: (callback: (data: any) => void) => {
        ipcRenderer.on(IPC_CHANNELS.AUDIO_HARMFUL_DETECTED, (_, data) => callback(data));
      },
    },
    // OnVoice COM 브리지 API (프로세스별 오디오 캡처)
    onvoice: {
      startCapture: (target: 'edge' | 'chrome' | 'discord' | number) => 
        ipcRenderer.invoke(ONVOICE_CHANNELS.START_CAPTURE, { target }),
      stopCapture: () => ipcRenderer.invoke(ONVOICE_CHANNELS.STOP_CAPTURE),
      getStatus: () => ipcRenderer.invoke(ONVOICE_CHANNELS.GET_STATUS),
      onStatusChange: (callback: (status: any) => void) => {
        ipcRenderer.on(IPC_CHANNELS.AUDIO_STATUS, (_, status) => callback(status));
      },
      onHarmfulDetected: (callback: (data: any) => void) => {
        ipcRenderer.on(IPC_CHANNELS.AUDIO_HARMFUL_DETECTED, (_, data) => callback(data));
      },
    },
    // 대시보드 및 멀티 윈도우 관리 API
    dashboard: {
      selectMode: (mode: 'ocr' | 'voice') => {
        ipcRenderer.send(DASHBOARD_CHANNELS.SELECT_MODE, mode);
      },
      toggleOCR: (enabled: boolean) => {
        ipcRenderer.send(DASHBOARD_CHANNELS.TOGGLE_OCR, enabled);
      },
      toggleVoice: (enabled: boolean) => {
        ipcRenderer.send(DASHBOARD_CHANNELS.TOGGLE_VOICE, enabled);
      },
      getWindowStatus: () => ipcRenderer.invoke(DASHBOARD_CHANNELS.GET_WINDOW_STATUS),
      onOCRStatusChange: (callback: (status: 'start' | 'stop') => void) => {
        const listener = (_event: unknown, status: 'start' | 'stop') => {
          callback(status);
        };
        ipcRenderer.on(DASHBOARD_CHANNELS.OCR_STATUS_CHANGE, listener);
        return () => {
          ipcRenderer.removeListener(DASHBOARD_CHANNELS.OCR_STATUS_CHANGE, listener);
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
        sendSelected: (rect: ROI) => void;
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
        sendROI: (roi: ROI) => void;
        onModeChange: (callback: (mode: OverlayMode) => void) => () => void;
        onStatePush: (callback: (state: OverlayState) => void) => () => void;
        startMonitoring: () => void;
        stopMonitoring: () => void;
        onStopMonitoring: (callback: () => void) => () => void;
        onServerAlert: (callback: (harmful: boolean) => void) => () => void;
      };
      server: ServerAPI;
      audio: {
        startMonitoring: () => Promise<{ success: boolean; error?: string }>;
        stopMonitoring: () => Promise<{ success: boolean }>;
        getStatus: () => Promise<{
          isMonitoring: boolean;
          volumeLevel: number;
          beepEnabled: boolean;
        }>;
        setVolumeLevel: (level: number) => Promise<{ success: boolean }>;
        setBeepEnabled: (enabled: boolean) => Promise<{ success: boolean }>;
        onStatusChange: (callback: (status: any) => void) => void;
        onHarmfulDetected: (callback: (data: any) => void) => void;
      };
      onvoice: {
        startCapture: (target: 'edge' | 'chrome' | 'discord' | number) => Promise<{ success: boolean; error?: string }>;
        stopCapture: () => Promise<{ success: boolean }>;
        getStatus: () => Promise<{
          isMonitoring: boolean;
          targetPid: 'edge' | 'chrome' | 'discord' | number;
        }>;
        onStatusChange: (callback: (status: any) => void) => void;
        onHarmfulDetected: (callback: (data: any) => void) => void;
      };
      dashboard: {
        selectMode: (mode: 'ocr' | 'voice') => void;
        toggleOCR: (enabled: boolean) => void;
        toggleVoice: (enabled: boolean) => void;
        getWindowStatus: () => Promise<{
          isOcrEnabled: boolean;
          isVoiceEnabled: boolean;
          isOverlayVisible: boolean;
        }>;
        onOCRStatusChange: (callback: (status: 'start' | 'stop') => void) => () => void;
      };
    };
  }
}

export {};

