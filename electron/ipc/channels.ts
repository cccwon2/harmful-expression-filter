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
  // 오디오 모니터링 채널
  AUDIO_STATUS: 'audio:status',
  AUDIO_HARMFUL_DETECTED: 'audio:harmful-detected',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];

// 서버 통신 채널
export const SERVER_CHANNELS = {
  HEALTH_CHECK: 'server:health-check',
  ANALYZE_TEXT: 'server:analyze-text',
  GET_KEYWORDS: 'server:get-keywords',
  OCR_IMAGE: 'server:ocr-image',              // 🆕 OCR만
  OCR_AND_ANALYZE: 'server:ocr-and-analyze',  // 🆕 OCR + 분석
} as const;

export type ServerChannel = typeof SERVER_CHANNELS[keyof typeof SERVER_CHANNELS];

// 오디오 모니터링 IPC 채널
export const AUDIO_CHANNELS = {
  START_MONITORING: 'audio:start-monitoring',
  STOP_MONITORING: 'audio:stop-monitoring',
  GET_STATUS: 'audio:get-status',
  SET_VOLUME_LEVEL: 'audio:set-volume-level',     // 볼륨 레벨 설정 (0~10)
  SET_BEEP_ENABLED: 'audio:set-beep-enabled',     // 비프음 활성화
} as const;

export type AudioChannel = typeof AUDIO_CHANNELS[keyof typeof AUDIO_CHANNELS];

