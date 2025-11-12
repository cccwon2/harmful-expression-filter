type ROI = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type OverlayMode = 'setup' | 'detect' | 'alert';

type OverlayState = {
  mode: OverlayMode;
  roi?: ROI;
  harmful?: boolean;
};

interface ServerAPI {
  healthCheck: () => Promise<
    | {
        status: string;
        keywords_loaded: number;
        stt_loaded: boolean;
        ai_model_loaded: boolean;
      }
    | { error: true; message: string; code?: string; status?: number }
  >;
  analyzeText: (text: string) => Promise<
    | {
        has_violation: boolean;
        confidence: number;
        matched_keywords: string[];
        method: string;
        processing_time: number;
      }
    | { error: true; message: string; code?: string; status?: number }
  >;
  getKeywords: () => Promise<
    | {
        total: number;
        keywords: string[];
      }
    | { error: true; message: string; code?: string; status?: number }
  >;
}

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
    };
  }
}

export {};

