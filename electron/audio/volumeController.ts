/**
 * Phase 5: Windows 볼륨 제어 모듈 (PID-aware via AppVolumeController)
 *
 * 유해 표현 감지 시 특정 앱의 볼륨을 전체 볼륨 기준으로
 * 1(10%) ~ 9(90%)까지 설정할 수 있습니다.
 * 기본값: 1(10%)
 *
 * 감시 대상 앱(Chrome, Edge, Discord)의 볼륨만 조절합니다.
 * 실제 볼륨 제어는 AppVolumeController가 담당하고,
 * 이 모듈은 "레벨(1~9)" 추상화 + 타깃 앱 관리 역할만 합니다.
 */

import { AppVolumeController } from './appVolumeController';

const MIN_VOLUME_LEVEL = 1;   // 10% (무소음 제외)
const MAX_VOLUME_LEVEL = 9;   // 90%
const DEFAULT_VOLUME_LEVEL = 1; // 10%

/**
 * VolumeController
 *
 * - 1~9 레벨을 퍼센트(10%~90%)로 매핑
 * - 이름 기반 타깃 앱 설정 (chrome / edge / discord)
 * - 내부적으로 AppVolumeController를 통해 실제 볼륨 제어 수행
 */
export class VolumeController {
  private readonly appVolumeController: AppVolumeController;

  // 1 ~ 9 (1 = 10%, 9 = 90%)
  private currentVolumeLevel: number = DEFAULT_VOLUME_LEVEL;

  // 사용자가 지정한 앱 키 (chrome / edge / discord / 기타)
  private targetAppKey: string | null = null;

  // AppVolumeController에 넘길 실제 식별자 (예: chrome.exe, msedge.exe, Discord.exe)
  private targetAppIdentifier: string | null = null;

  constructor(appVolumeController: AppVolumeController, targetAppName?: string | null) {
    this.appVolumeController = appVolumeController;
    if (targetAppName) {
      this.setTargetApp(targetAppName);
    }
  }

  /**
   * 레벨(1~9)을 10%~90% 퍼센트로 변환
   */
  private volumeLevelToPercent(level: number): number {
    const clampedLevel = this.clampLevel(level);
    return clampedLevel * 10; // 1~9 → 10%~90%
  }

  /**
   * 레벨(1~9)을 AppVolumeController에서 사용하는 0~10 스케일로 변환
   * 여기서는 "최대 90%" 정책을 유지하기 위해 1~9를 그대로 1~9로 사용 (10은 사용 안 함)
   */
  private volumeLevelToControllerLevel(level: number): number {
    return this.clampLevel(level); // 1~9 유지 (AppVolumeController: 0~10 → 0%~100%)
  }

  /**
   * 레벨 범위 보정 (1~9)
   */
  private clampLevel(level: number): number {
    return Math.max(MIN_VOLUME_LEVEL, Math.min(MAX_VOLUME_LEVEL, Math.round(level)));
  }

  /**
   * 대상 앱 이름 설정
   *
   * - "chrome" → "chrome.exe"
   * - "edge"   → "msedge.exe"
   * - "discord" → "Discord.exe"
   * - 그 외에는 입력값 그대로 사용
   */
  setTargetApp(targetApp: 'chrome' | 'edge' | 'discord' | string | null): void {
    if (!targetApp) {
      this.targetAppKey = null;
      this.targetAppIdentifier = null;
      console.log('[VolumeController] Target app cleared');
      return;
    }

    const lower = targetApp.toLowerCase();

    const appNameMap: Record<string, string> = {
      chrome: 'chrome.exe',
      edge: 'msedge.exe',
      discord: 'Discord.exe',
    };

    this.targetAppKey = lower;
    this.targetAppIdentifier = appNameMap[lower] ?? targetApp;

    console.log(
      `[VolumeController] Target app set to: ${this.targetAppIdentifier} (key: ${this.targetAppKey})`,
    );
  }

  /**
   * 현재 설정된 타깃 앱의 볼륨을 레벨 기준으로 설정 (1~9)
   *
   * @param level 1~9 (1 = 10%, 9 = 90%)
   * @param options.restoreDelayMs - 복원 대기 시간(ms). 미지정 시 AppVolumeController 기본값 사용.
   */
  async setVolumeLevel(
    level: number,
    options?: { restoreDelayMs?: number },
  ): Promise<void> {
    const startTime = Date.now();
    const clampedLevel = this.clampLevel(level);
    this.currentVolumeLevel = clampedLevel;

    if (!this.targetAppIdentifier) {
      console.warn(
        '[VolumeController] Target app not set, cannot adjust volume by name',
      );
      return;
    }

    const controllerLevel = this.volumeLevelToControllerLevel(clampedLevel); // 1~9

    const restoreDelay = options?.restoreDelayMs;

    try {
      const appVolumeStartTime = Date.now();
      const ok = await this.appVolumeController.setAppVolume(
        this.targetAppIdentifier,
        controllerLevel,
        restoreDelay,
      );
      const appVolumeElapsed = Date.now() - appVolumeStartTime;

      const percent = this.volumeLevelToPercent(clampedLevel);
      const totalElapsed = Date.now() - startTime;

      if (ok) {
        console.log(
          `[VolumeController] 🔊 Volume set to level ${clampedLevel} (${percent}%) for ${this.targetAppIdentifier} (AppVolumeController: ${appVolumeElapsed}ms, 총: ${totalElapsed}ms)`,
        );
      } else {
        console.warn(
          `[VolumeController] ⚠️ Failed to set volume for ${this.targetAppIdentifier} (${totalElapsed}ms)`,
        );
      }
    } catch (err) {
      const totalElapsed = Date.now() - startTime;
      console.error(`[VolumeController] Failed to set volume level (${totalElapsed}ms):`, err);
      throw err;
    }
  }

  /**
   * PID 기반 볼륨 제어
   *
   * @param pid        - 대상 프로세스 ID
   * @param level      - 1~9 (생략 시 현재 레벨 사용)
   * @param options.restoreDelayMs - 복원 대기 시간(ms). 미지정 시 AppVolumeController 기본값 사용.
   *
   * 반환값: 실제로 볼륨 변경에 성공했는지 여부
   */
  async setVolumeByPid(
    pid: number,
    level?: number,
    options?: { restoreDelayMs?: number },
  ): Promise<boolean> {
    const effectiveLevel = level ?? this.currentVolumeLevel ?? DEFAULT_VOLUME_LEVEL;
    const clampedLevel = this.clampLevel(effectiveLevel);
    this.currentVolumeLevel = clampedLevel;

    const controllerLevel = this.volumeLevelToControllerLevel(clampedLevel); // 1~9

    const restoreDelay = options?.restoreDelayMs;

    try {
      const ok = await this.appVolumeController.setVolumeByPid(
        pid,
        controllerLevel,
        restoreDelay,
      );

      const percent = this.volumeLevelToPercent(clampedLevel);

      if (ok) {
        console.log(
          `[VolumeController] 🔊 Volume set to level ${clampedLevel} (${percent}%) for PID=${pid}`,
        );
      } else {
        console.warn(
          `[VolumeController] ⚠️ Failed to set volume for PID=${pid}`,
        );
      }

      return ok;
    } catch (err) {
      console.error('[VolumeController] Failed to set volume by PID:', err);
      return false;
    }
  }

  /**
   * 현재 볼륨 레벨 반환 (1~9)
   */
  getCurrentVolumeLevel(): number {
    return this.currentVolumeLevel;
  }

  /**
   * 현재 볼륨 레벨을 퍼센트로 반환 (10%~90%)
   */
  getCurrentVolumePercent(): number {
    return this.volumeLevelToPercent(this.currentVolumeLevel);
  }
}
