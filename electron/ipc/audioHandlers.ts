/**
 * Phase 3: 오디오 모니터링 IPC 핸들러
 * 
 * 렌더러 프로세스와 메인 프로세스 간 오디오 모니터링 통신을 처리합니다.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { AUDIO_CHANNELS } from './channels';
import { AudioService } from '../audio/audioService';

let audioService: AudioService | null = null;

export function registerAudioHandlers(mainWindow: BrowserWindow) {
  audioService = new AudioService(mainWindow);
  
  ipcMain.handle(AUDIO_CHANNELS.START_MONITORING, async () => {
    try {
      await audioService!.startMonitoring();
      return { success: true };
    } catch (err: any) {
      console.error('[AudioHandlers] Failed to start monitoring:', err);
      return { success: false, error: err.message };
    }
  });
  
  ipcMain.handle(AUDIO_CHANNELS.STOP_MONITORING, () => {
    audioService!.stopMonitoring();
    return { success: true };
  });
  
  ipcMain.handle(AUDIO_CHANNELS.GET_STATUS, () => {
    return audioService!.getStatus();
  });
  
  ipcMain.handle(AUDIO_CHANNELS.SET_VOLUME_LEVEL, (_, level: number) => {
    audioService!.setVolumeLevel(level);
    return { success: true };
  });
  
  ipcMain.handle(AUDIO_CHANNELS.SET_BEEP_ENABLED, (_, enabled: boolean) => {
    audioService!.setBeepEnabled(enabled);
    return { success: true };
  });
}

