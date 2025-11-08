type ROI = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ROIRect = ROI;

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
        onStatePush: (callback: (state: OverlayState) => void) => () => void;
      };
    };
  }
}

export {};

