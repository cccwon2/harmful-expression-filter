export const IPC_CHANNELS = {
  ROI_SELECTED: 'roi:selected',
  ROI_START_SELECTION: 'roi-start-selection',
  ROI_CANCEL_SELECTION: 'roi-cancel-selection',
  EXIT_EDIT_MODE: 'exit-edit-mode',
  HIDE_OVERLAY: 'hide-overlay',
  EXIT_EDIT_MODE_AND_HIDE: 'exit-edit-mode-and-hide',
  // 새로운 채널들
  SET_CLICK_THROUGH: 'overlay:setClickThrough',
  OVERLAY_SET_MODE: 'overlay:setMode',
  OVERLAY_STATE_PUSH: 'overlay:state',
  START_MONITORING: 'monitoring:start',
  STOP_MONITORING: 'monitoring:stop',
  OCR_START: 'ocr:start',
  OCR_STOP: 'ocr:stop',
  ALERT_FROM_SERVER: 'alert:server',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];

