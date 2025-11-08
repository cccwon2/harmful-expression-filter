export type ROI = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export interface SelectionState {
  isSelecting: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

// 오버레이 모드 타입
export type OverlayMode = 'setup' | 'detect' | 'alert';

// 오버레이 상태 타입
export type OverlayState = {
  mode: OverlayMode;
  roi?: ROI;
  harmful?: boolean;
};

