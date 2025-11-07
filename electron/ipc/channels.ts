export const IPC_CHANNELS = {
  ROI_SELECTED: 'roi-selected',
  ROI_START_SELECTION: 'roi-start-selection',
  ROI_CANCEL_SELECTION: 'roi-cancel-selection',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];

