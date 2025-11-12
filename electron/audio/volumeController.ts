/**
 * Phase 5: Windows 볼륨 제어 모듈
 *
 * 유해 표현 감지 시 시스템 볼륨을 1단계로 낮추고
 * 일정 시간이 지난 후 원래 상태로 복원합니다.
 */

import loudness from 'loudness';

const LEVEL_MIN = 0;
const LEVEL_MAX = 10;
const LEVEL_TO_PERCENT = 10;
const DEFAULT_RESTORE_DELAY_MS = 3000;

export class VolumeController {
  private originalVolume: number | null = null;
  private restoreTimer: NodeJS.Timeout | null = null;

  private clampLevel(level: number): number {
    if (Number.isNaN(level)) {
      return LEVEL_MIN;
    }
    return Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.round(level)));
  }

  async adjustVolume(level: number, restoreDelayMs: number = DEFAULT_RESTORE_DELAY_MS): Promise<void> {
    const safeLevel = this.clampLevel(level);
    const targetVolume = safeLevel * LEVEL_TO_PERCENT;

    try {
      const currentVolume = await loudness.getVolume();

      if (this.originalVolume === null) {
        this.originalVolume = currentVolume;
        console.log(`[VolumeController] 📊 Current volume saved: ${this.originalVolume}`);
      }

      if (this.restoreTimer) {
        clearTimeout(this.restoreTimer);
        this.restoreTimer = null;
      }

      await loudness.setVolume(targetVolume);
      console.log(`[VolumeController] 🔊 Volume adjusted to: ${targetVolume}`);

      this.restoreTimer = setTimeout(() => {
        void this.restoreVolume();
      }, restoreDelayMs);
    } catch (error) {
      console.error('[VolumeController] Failed to adjust volume:', error);
    }
  }

  async restoreVolume(): Promise<void> {
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }

    if (this.originalVolume === null) {
      return;
    }

    try {
      await loudness.setVolume(this.originalVolume);
      console.log(`[VolumeController] 🔊 Volume restored to: ${this.originalVolume}`);
    } catch (error) {
      console.error('[VolumeController] Failed to restore volume:', error);
    } finally {
      this.originalVolume = null;
    }
  }
}

