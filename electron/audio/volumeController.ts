/**
 * Phase 5: Windows 볼륨 제어 모듈
 *
 * 유해 표현 감지 시 특정 앱의 볼륨을 전체 볼륨 기준으로
 * 0(무소음) ~ 9(90%)까지 설정할 수 있습니다.
 * 기본값: 1(10%)
 * 
 * 감시 대상 앱(Chrome, Edge, Discord)의 볼륨만 조절합니다.
 */

import soundMixer, { Device, DeviceType, AudioSession } from 'native-sound-mixer';

const MIN_VOLUME_LEVEL = 0;  // 무소음
const MAX_VOLUME_LEVEL = 9;  // 90%
const DEFAULT_VOLUME_LEVEL = 1; // 10%

export class VolumeController {
  private defaultDevice: Device | null = null;
  private currentVolumeLevel: number = DEFAULT_VOLUME_LEVEL; // 0 ~ 9 (0% = 무소음, 9 = 90%)
  private targetAppName: string | null = null; // 대상 앱 이름 (예: "chrome", "edge", "discord")
  private targetAppSearchNames: string[] = []; // 검색할 앱 이름 목록 (Edge의 경우 ["edge", "msedge"] 등)

  constructor(targetAppName?: string) {
    this.targetAppName = targetAppName || null;
    this.initializeDefaultDevice();
  }

  /**
   * 기본 출력 디바이스 초기화
   */
  private initializeDefaultDevice(): void {
    try {
      this.defaultDevice = soundMixer.getDefaultDevice(DeviceType.RENDER);

      if (this.defaultDevice) {
        console.log(`[VolumeController] ✅ Default audio device: ${this.defaultDevice.name}`);
      } else {
        console.error('[VolumeController] ❌ No default output device found');
      }
    } catch (err) {
      console.error('[VolumeController] Failed to initialize default device:', err);
    }
  }

  /**
   * 볼륨 레벨을 퍼센트로 변환 (0~9 → 0%~90%)
   * 0 = 0% (무소음)
   * 1 = 10%
   * ...
   * 9 = 90%
   */
  private volumeLevelToPercent(level: number): number {
    const clampedLevel = Math.max(MIN_VOLUME_LEVEL, Math.min(MAX_VOLUME_LEVEL, Math.round(level)));
    return clampedLevel * 10; // 0~9 → 0%~90%
  }

  /**
   * 볼륨 레벨을 0.0~1.0 범위로 변환
   */
  private volumeLevelToNormalized(level: number): number {
    const percent = this.volumeLevelToPercent(level);
    return percent / 100; // 0.0 ~ 0.9
  }

  /**
   * 대상 앱 이름 설정
   */
  setTargetApp(targetApp: "chrome" | "edge" | "discord" | string | null): void {
    if (!targetApp) {
      this.targetAppName = null;
      return;
    }

    // Edge의 경우 msedge로도 찾을 수 있도록 매핑
    const appNameMap: Record<string, string[]> = {
      'chrome': ['chrome', 'chrome.exe'],
      'edge': ['edge', 'msedge', 'msedge.exe'],
      'discord': ['discord', 'discord.exe'],
    };

    const lowerTarget = targetApp.toLowerCase();
    // 매핑된 앱 이름들 중 하나로 찾거나, 직접 제공된 이름 사용
    const searchNames = appNameMap[lowerTarget] || [lowerTarget];
    
    // 첫 번째 이름을 기본으로 설정하고, 실제 찾을 때는 모든 이름을 확인
    this.targetAppName = searchNames[0];
    this.targetAppSearchNames = searchNames;
    
    console.log(`[VolumeController] Target app set to: ${this.targetAppName} (search: ${searchNames.join(', ')})`);
  }

  /**
   * 특정 앱의 볼륨 설정 (0.0 ~ 1.0)
   */
  private async setAppVolume(volume: number): Promise<boolean> {
    if (!this.defaultDevice) {
      console.warn('[VolumeController] Default device not initialized');
      return false;
    }

    if (!this.targetAppName) {
      console.warn('[VolumeController] Target app not set, cannot adjust volume');
      return false;
    }

    try {
      const sessions = this.defaultDevice.sessions || [];
      const activeSessions = sessions.filter(s => s.state === 1);

      if (activeSessions.length === 0) {
        console.warn('[VolumeController] No active sessions found');
        return false;
      }

      // 대상 앱 이름으로 세션 찾기 (부분 매칭, 대소문자 무시)
      const targetSessions = activeSessions.filter(session => {
        const name = (session.name || '').toLowerCase();
        const appName = (session.appName || '').toLowerCase();
        
        // 검색 이름 목록 중 하나라도 매칭되면 선택
        return this.targetAppSearchNames.some(searchName => 
          name.includes(searchName.toLowerCase()) || appName.includes(searchName.toLowerCase())
        );
      });

      if (targetSessions.length === 0) {
        console.warn(`[VolumeController] ⚠️ Target app "${this.targetAppName}" not found in active sessions`);
        console.log(`[VolumeController] Available apps: ${activeSessions.map(s => s.name || s.appName).join(', ')}`);
        return false;
      }

      // 대상 앱의 모든 세션 볼륨 조절
      let successCount = 0;
      targetSessions.forEach(session => {
        try {
          session.volume = volume;
          successCount++;
          console.log(`[VolumeController] 🔊 ${session.name || session.appName}: ${Math.round(volume * 100)}%`);
        } catch (err) {
          console.error(`[VolumeController] Failed to set volume for session ${session.name}:`, err);
        }
      });

      console.log(`[VolumeController] 🔊 Volume adjusted to: ${Math.round(volume * 100)}% for ${this.targetAppName} (${successCount} sessions)`);
      return successCount > 0;
    } catch (err) {
      console.error('[VolumeController] Failed to set app volume:', err);
      return false;
    }
  }

  /**
   * 볼륨 레벨 설정 (0~9: 0% = 무소음, 9 = 90%)
   */
  async setVolumeLevel(level: number): Promise<void> {
    // 레벨을 0~9 범위로 제한
    const clampedLevel = Math.max(MIN_VOLUME_LEVEL, Math.min(MAX_VOLUME_LEVEL, Math.round(level)));
    const targetVolume = this.volumeLevelToNormalized(clampedLevel); // 0.0 ~ 0.9

    this.currentVolumeLevel = clampedLevel;

    try {
      await this.setAppVolume(targetVolume);
      const percent = this.volumeLevelToPercent(clampedLevel);
      const appInfo = this.targetAppName ? ` for ${this.targetAppName}` : '';
      console.log(`[VolumeController] 🔊 Volume set to level ${clampedLevel} (${percent}%)${appInfo}`);
    } catch (error) {
      console.error('[VolumeController] Failed to set volume level:', error);
      throw error;
    }
  }

  /**
   * 현재 볼륨 레벨 반환 (0~9)
   */
  getCurrentVolumeLevel(): number {
    return this.currentVolumeLevel;
  }

  /**
   * 현재 볼륨 레벨을 퍼센트로 반환 (0%~90%)
   */
  getCurrentVolumePercent(): number {
    return this.volumeLevelToPercent(this.currentVolumeLevel);
  }
}

