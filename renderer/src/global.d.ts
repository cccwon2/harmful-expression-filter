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
        onStopMonitoring: (callback: () => void) => () => void;
        removeAllListeners: (channel: string) => void;
      };
    };
  }
}

export {};

