/**
 * T26: 앱별 볼륨 제어 모듈
 * 
 * native-sound-mixer를 사용하여 앱별로 독립적으로 볼륨을 조절합니다.
 */

import soundMixer, { Device, DeviceType, AudioSession } from 'native-sound-mixer';

export interface AudioSessionInfo {
  id: string;
  name: string;      // 예: "chrome.exe", "Discord.exe"
  appName: string;   // 앱 이름
  volume: number;    // 0.0 ~ 1.0
  state: number;     // AudioSessionState
}

export class AppVolumeController {
  private originalVolumes: Map<string, number> = new Map();
  private defaultDevice: Device | null = null;
  private restoreTimer: NodeJS.Timeout | null = null;
  private readonly DEFAULT_RESTORE_DELAY_MS = 3000;
  
  constructor() {
    this.initializeDefaultDevice();
  }
  
  /**
   * 기본 출력 디바이스 초기화
   */
  private initializeDefaultDevice(): void {
    try {
      this.defaultDevice = soundMixer.getDefaultDevice(DeviceType.RENDER);
      
      if (this.defaultDevice) {
        console.log(`[AppVolumeController] ✅ Default audio device: ${this.defaultDevice.name}`);
        console.log(`[AppVolumeController] Initial sessions count: ${this.defaultDevice.sessions?.length || 0}`);
      } else {
        console.error('[AppVolumeController] ❌ No default output device found');
      }
    } catch (err) {
      console.error('[AppVolumeController] Failed to initialize default device:', err);
    }
  }
  
  /**
   * 현재 실행 중인 오디오 세션 조회
   */
  getAudioSessions(): AudioSessionInfo[] {
    if (!this.defaultDevice) {
      console.warn('[AppVolumeController] Default device not initialized');
      return [];
    }
    
    try {
      const sessions = this.defaultDevice.sessions;
      
      return sessions
        .filter(s => s.state === 1) // ACTIVE 상태만
        .map(s => ({
          id: s.name + '_' + s.appName, // 고유 ID 생성
          name: s.name,
          appName: s.appName,
          volume: s.volume,
          state: s.state
        }));
    } catch (err) {
      console.error('[AppVolumeController] Failed to get audio sessions:', err);
      return [];
    }
  }
  
  /**
   * 특정 앱의 볼륨 조절
   * @param appName - 앱 이름 (예: "chrome", "discord", "chrome.exe")
   * @param volumeLevel - 0~10 (0 = 음소거, 10 = 100%)
   * @param restoreDelayMs - 복원 대기 시간 (밀리초)
   */
  async setAppVolume(
    appName: string, 
    volumeLevel: number, 
    restoreDelayMs: number = this.DEFAULT_RESTORE_DELAY_MS
  ): Promise<boolean> {
    if (!this.defaultDevice) {
      console.warn('[AppVolumeController] Default device not initialized');
      return false;
    }
    
    const sessions = this.getAudioSessions();
    
    // 앱 이름으로 세션 찾기 (부분 매칭, 대소문자 무시)
    const targetSession = sessions.find(s => 
      s.name.toLowerCase().includes(appName.toLowerCase()) ||
      s.appName.toLowerCase().includes(appName.toLowerCase())
    );
    
    if (!targetSession) {
      console.warn(`[AppVolumeController] ⚠️ App not found in active sessions: ${appName}`);
      console.log(`[AppVolumeController] Available apps: ${sessions.map(s => s.name).join(', ')}`);
      return false;
    }
    
    // 실제 AudioSession 객체 찾기
    const deviceSessions = this.defaultDevice.sessions;
    const actualSession = deviceSessions.find(s => 
      s.name === targetSession.name && s.appName === targetSession.appName
    );
    
    if (!actualSession) {
      console.warn(`[AppVolumeController] ⚠️ Session object not found: ${targetSession.name}`);
      return false;
    }
    
    // 원래 볼륨 저장 (복원용)
    const sessionKey = targetSession.id;
    if (!this.originalVolumes.has(sessionKey)) {
      this.originalVolumes.set(sessionKey, actualSession.volume);
      console.log(`[AppVolumeController] 💾 Saved original volume for ${targetSession.name}: ${Math.round(actualSession.volume * 100)}%`);
    }
    
    // 볼륨 조절 (0~10 → 0.0~1.0 변환)
    const normalizedVolume = Math.max(0, Math.min(1, volumeLevel / 10));
    
    try {
      actualSession.volume = normalizedVolume;
      console.log(`[AppVolumeController] 🔊 ${targetSession.name}: ${Math.round(normalizedVolume * 100)}%`);
      
      // 기존 복원 타이머 취소
      if (this.restoreTimer) {
        clearTimeout(this.restoreTimer);
        this.restoreTimer = null;
      }
      
      // 자동 복원 타이머 설정
      if (restoreDelayMs > 0) {
        this.restoreTimer = setTimeout(() => {
          void this.restoreVolume(sessionKey, actualSession);
        }, restoreDelayMs);
      }
      
      return true;
    } catch (err) {
      console.error(`[AppVolumeController] Failed to set volume for ${targetSession.name}:`, err);
      return false;
    }
  }
  
  /**
   * 특정 앱 음소거
   */
  async muteApp(appName: string): Promise<boolean> {
    return this.setAppVolume(appName, 0, 0); // 복원 없이 음소거
  }
  
  /**
   * 모든 활성 앱 음소거 (폴백 방식)
   * @param restoreDelayMs - 복원 대기 시간 (밀리초), 0이면 자동 복원 안함
   */
  async muteAllApps(restoreDelayMs: number = this.DEFAULT_RESTORE_DELAY_MS): Promise<void> {
    if (!this.defaultDevice) {
      console.warn('[AppVolumeController] Default device not initialized');
      return;
    }
    
    // 디바이스 세션 새로고침 (최신 세션 목록 가져오기)
    try {
      // defaultDevice.sessions는 실시간으로 업데이트되므로 재조회
      this.defaultDevice = soundMixer.getDefaultDevice(DeviceType.RENDER);
      if (!this.defaultDevice) {
        console.error('[AppVolumeController] Failed to refresh default device');
        return;
      }
    } catch (err) {
      console.error('[AppVolumeController] Failed to refresh device:', err);
    }
    
    const sessions = this.getAudioSessions();
    
    if (sessions.length === 0) {
      console.warn('[AppVolumeController] No active audio sessions to mute');
      console.log('[AppVolumeController] Available sessions:', this.defaultDevice.sessions.map(s => `${s.name} (${s.appName}, state: ${s.state})`).join(', '));
      return;
    }
    
    console.log(`[AppVolumeController] 🔍 Found ${sessions.length} active audio sessions:`);
    sessions.forEach(s => {
      console.log(`   - ${s.name} (${s.appName}): ${Math.round(s.volume * 100)}%`);
    });
    
    // 기존 복원 타이머 취소 (새로운 mute 요청 시)
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
    
    const deviceSessions = this.defaultDevice.sessions;
    let mutedCount = 0;
    let failedCount = 0;
    
    sessions.forEach(sessionInfo => {
      const session = deviceSessions.find(s => 
        s.name === sessionInfo.name && s.appName === sessionInfo.appName
      );
      
      if (!session) {
        console.warn(`[AppVolumeController] ⚠️ Session object not found for ${sessionInfo.name}`);
        failedCount++;
        return;
      }
      
      const sessionKey = sessionInfo.id;
      const currentVolume = session.volume;
      
      // 이미 음소거된 상태면 스킵 (중복 mute 방지)
      if (currentVolume === 0) {
        console.log(`[AppVolumeController] ⏭️  ${sessionInfo.name} is already muted, skipping`);
        mutedCount++;
        // 원래 볼륨이 저장되지 않았으면 현재 볼륨(0)을 저장하지 않음
        // (이미 mute된 경우 원래 볼륨 정보가 없을 수 있음)
        return;
      }
      
      // 원래 볼륨 저장 (복원용) - mute 전에만 저장
      if (!this.originalVolumes.has(sessionKey)) {
        this.originalVolumes.set(sessionKey, currentVolume);
        console.log(`[AppVolumeController] 💾 Saved original volume for ${sessionInfo.name}: ${Math.round(currentVolume * 100)}%`);
      }
      
      try {
        // 볼륨을 0으로 설정
        session.volume = 0;
        
        // 설정 후 확인
        const newVolume = session.volume;
        if (newVolume === 0) {
          console.log(`[AppVolumeController] ✅ Muted ${sessionInfo.name}: ${Math.round(currentVolume * 100)}% → 0%`);
          mutedCount++;
        } else {
          console.warn(`[AppVolumeController] ⚠️ Volume setting may have failed for ${sessionInfo.name}: current volume is ${Math.round(newVolume * 100)}%`);
          failedCount++;
        }
      } catch (err) {
        console.error(`[AppVolumeController] ❌ Failed to mute ${sessionInfo.name}:`, err);
        failedCount++;
      }
    });
    
    console.log(`[AppVolumeController] 🔇 Muted ${mutedCount} apps (${failedCount} failed)`);
    
    // 자동 복원 타이머 설정
    if (restoreDelayMs > 0) {
      this.restoreTimer = setTimeout(() => {
        void this.restoreVolume();
        console.log(`[AppVolumeController] ✅ Auto-restored volumes after ${restoreDelayMs}ms`);
      }, restoreDelayMs);
    }
  }
  
  /**
   * 저장된 원래 볼륨으로 복원
   */
  async restoreVolume(sessionKey?: string, session?: AudioSession): Promise<void> {
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
    
    if (sessionKey && session) {
      // 특정 세션 복원
      const originalVolume = this.originalVolumes.get(sessionKey);
      if (originalVolume !== undefined) {
        try {
          session.volume = originalVolume;
          this.originalVolumes.delete(sessionKey);
          console.log(`[AppVolumeController] ✅ Restored volume for session: ${Math.round(originalVolume * 100)}%`);
        } catch (err) {
          console.error(`[AppVolumeController] Failed to restore volume:`, err);
        }
      }
      return;
    }
    
    // 모든 세션 복원
    if (this.originalVolumes.size === 0) {
      console.log('[AppVolumeController] No volumes to restore');
      return;
    }
    
    if (!this.defaultDevice) {
      console.warn('[AppVolumeController] Default device not initialized');
      return;
    }
    
    const deviceSessions = this.defaultDevice.sessions;
    let restoredCount = 0;
    
    this.originalVolumes.forEach((volume, key) => {
      // key는 "name_appName" 형식
      const [name, appName] = key.split('_');
      const session = deviceSessions.find(s => 
        s.name === name && s.appName === appName
      );
      
      if (session) {
        try {
          session.volume = volume;
          restoredCount++;
        } catch (err) {
          // 세션이 이미 종료된 경우 무시
          console.warn(`[AppVolumeController] Session ${key} no longer exists`);
        }
      }
    });
    
    this.originalVolumes.clear();
    console.log(`[AppVolumeController] ✅ Restored volumes for ${restoredCount} apps`);
  }
  
  /**
   * 특정 앱이 현재 실행 중인지 확인
   */
  isAppRunning(appName: string): boolean {
    const sessions = this.getAudioSessions();
    return sessions.some(s => 
      s.name.toLowerCase().includes(appName.toLowerCase()) ||
      s.appName.toLowerCase().includes(appName.toLowerCase())
    );
  }
}

