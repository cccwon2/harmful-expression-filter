/**
 * Phase 5: Windows 볼륨 제어 모듈
 *
 * 유해 표현 감지 시 시스템 볼륨을 전체 볼륨 기준으로
 * 0(무소음) ~ 9(90%)까지 설정할 수 있습니다.
 * 기본값: 1(10%)
 */

import soundMixer, { Device, DeviceType } from 'native-sound-mixer';

const MIN_VOLUME_LEVEL = 0;  // 무소음
const MAX_VOLUME_LEVEL = 9;  // 90%
const DEFAULT_VOLUME_LEVEL = 1; // 10%

export class VolumeController {
  private defaultDevice: Device | null = null;
  private currentVolumeLevel: number = DEFAULT_VOLUME_LEVEL; // 0 ~ 9 (0% = 무소음, 9 = 90%)

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
   * 시스템 볼륨 설정 (0.0 ~ 1.0)
   */
  private async setSystemVolume(volume: number): Promise<boolean> {
    if (!this.defaultDevice) {
      console.warn('[VolumeController] Default device not initialized');
      return false;
    }

    try {
      // 모든 활성 세션의 볼륨을 조절
      const sessions = this.defaultDevice.sessions || [];
      const activeSessions = sessions.filter(s => s.state === 1);

      if (activeSessions.length === 0) {
        // 활성 세션이 없으면 디바이스 볼륨을 직접 설정 시도
        // @ts-ignore - volume 속성이 있을 수 있음
        if (typeof this.defaultDevice.volume !== 'undefined') {
          // @ts-ignore
          this.defaultDevice.volume = volume;
          console.log(`[VolumeController] 🔊 System volume set to: ${Math.round(volume * 100)}%`);
          return true;
        }
        console.warn('[VolumeController] No active sessions to control');
        return false;
      }

      // 모든 활성 세션의 볼륨 조절
      let successCount = 0;
      activeSessions.forEach(session => {
        try {
          session.volume = volume;
          successCount++;
        } catch (err) {
          console.error(`[VolumeController] Failed to set volume for session ${session.name}:`, err);
        }
      });

      console.log(`[VolumeController] 🔊 Volume adjusted to: ${Math.round(volume * 100)}% (${successCount} sessions)`);
      return successCount > 0;
    } catch (err) {
      console.error('[VolumeController] Failed to set system volume:', err);
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
      await this.setSystemVolume(targetVolume);
      const percent = this.volumeLevelToPercent(clampedLevel);
      console.log(`[VolumeController] 🔊 Volume set to level ${clampedLevel} (${percent}%)`);
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

