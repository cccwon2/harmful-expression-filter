/**
 * Phase 3: 오디오 모니터링 IPC 핸들러
 * 
 * 렌더러 프로세스와 메인 프로세스 간 오디오 모니터링 통신을 처리합니다.
 * 전역적으로 하나의 AudioService 인스턴스를 사용하여 모든 윈도우에서 접근 가능합니다.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { AUDIO_CHANNELS, IPC_CHANNELS } from './channels';
import { AudioService } from '../audio/audioService';

let audioService: AudioService | null = null;
let registeredWindows: Set<BrowserWindow> = new Set();

/**
 * 오디오 핸들러 등록 (전역 단일 인스턴스)
 * 여러 윈도우에서 호출 가능하며, 첫 번째 윈도우로 AudioService를 초기화합니다.
 */
export function registerAudioHandlers(window: BrowserWindow) {
  // AudioService가 아직 초기화되지 않았으면 초기화
  if (!audioService) {
    // 첫 번째 윈도우로 초기화 (메인 윈도우 또는 오버레이 창)
    audioService = new AudioService(window);
    console.log('[AudioHandlers] AudioService initialized with window:', window.id);
    
    // IPC 핸들러 등록 (한 번만 등록)
    registerIpcHandlers();
  } else {
    // 이미 초기화된 경우, 새 윈도우를 AudioService에 등록
    audioService.addWindow(window);
    console.log('[AudioHandlers] Window added to AudioService:', window.id);
  }
  
  // 등록된 윈도우 추적
  registeredWindows.add(window);
  
  // 윈도우가 닫히면 등록 해제
  window.on('closed', () => {
    registeredWindows.delete(window);
    if (audioService) {
      audioService.removeWindow(window);
    }
    console.log('[AudioHandlers] Window removed from AudioService:', window.id);
  });
}

/**
 * IPC 핸들러 등록 (전역적으로 한 번만)
 */
function registerIpcHandlers() {
  if (!audioService) {
    console.error('[AudioHandlers] AudioService is not initialized');
    return;
  }
  
  // 이미 등록되었는지 확인 (중복 등록 방지)
  const handlers = ipcMain.listenerCount(AUDIO_CHANNELS.START_MONITORING);
  if (handlers > 0) {
    console.log('[AudioHandlers] IPC handlers already registered');
    return;
  }
  
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
  
  console.log('[AudioHandlers] IPC handlers registered');
}

/**
 * AudioService 인스턴스 가져오기 (디버깅용)
 */
export function getAudioService(): AudioService | null {
  return audioService;
}

