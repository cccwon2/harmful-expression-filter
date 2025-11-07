export interface ROIRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionState {
  isSelecting: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

