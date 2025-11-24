/**
 * Phase 5: Windows 볼륨 제어 모듈
 *
 * 유해 표현 감지 시 특정 앱의 볼륨을 전체 볼륨 기준으로
 * 1(10%) ~ 9(90%)까지 설정할 수 있습니다.
 * 기본값: 1(10%)
 * 
 * 감시 대상 앱(Chrome, Edge, Discord)의 볼륨만 조절합니다.
 * 
 * AppVolumeController를 사용하여 디바이스/세션 관리를 중앙화합니다.
 */

import { AppVolumeController } from './appVolumeController';

const MIN_VOLUME_LEVEL = 1;  // 10% (무소음 제외)
const MAX_VOLUME_LEVEL = 9;  // 90%
const DEFAULT_VOLUME_LEVEL = 1; // 10%

export class VolumeController {
  private appVolumeController: AppVolumeController;
  private currentVolumeLevel: number = DEFAULT_VOLUME_LEVEL; // 1 ~ 9 (1 = 10%, 9 = 90%)
  private targetAppName: string | null = null; // 대상 앱 이름 (예: "chrome", "edge", "discord")
  private targetAppSearchNames: string[] = []; // 검색할 앱 이름 목록 (Edge의 경우 ["edge", "msedge"] 등)

  constructor(appVolumeController: AppVolumeController, targetAppName?: string) {
    this.appVolumeController = appVolumeController;
    if (targetAppName) {
      this.setTargetApp(targetAppName);
    }
  }

  /**
   * 볼륨 레벨(1~9)을 AppVolumeController의 스케일(0~10)로 변환
   * 1 → 1, 9 → 9 (직접 매핑)
   * 필요시 1~9를 0~10 범위로 선형 변환할 수도 있음
   */
  private level1to9To0to10(level: number): number {
    const clamped = Math.max(MIN_VOLUME_LEVEL, Math.min(MAX_VOLUME_LEVEL, Math.round(level)));
    // 1~9를 0~10으로 선형 변환: 1→1.11..., 9→10
    // 또는 단순히 1→1, 9→9로 매핑 (현재는 단순 매핑 사용)
    return clamped; // 1~9를 그대로 1~9로 사용 (10은 별도 처리 필요시 확장)
  }

  /**
   * 볼륨 레벨을 퍼센트로 변환 (1~9 → 10%~90%)
   * 1 = 10%
   * 2 = 20%
   * ...
   * 9 = 90%
   */
  private volumeLevelToPercent(level: number): number {
    const clampedLevel = Math.max(MIN_VOLUME_LEVEL, Math.min(MAX_VOLUME_LEVEL, Math.round(level)));
    return clampedLevel * 10; // 1~9 → 10%~90%
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
   * 특정 앱의 볼륨 설정
   * AppVolumeController를 통해 볼륨을 조절합니다.
   */
  private async setAppVolume(volumeLevel0to10: number): Promise<boolean> {
    if (!this.targetAppName) {
      console.warn('[VolumeController] Target app not set, cannot adjust volume');
      return false;
    }

    // 검색 이름 목록이 비어있으면 targetAppName을 사용
    const searchNames = this.targetAppSearchNames.length > 0
      ? this.targetAppSearchNames
      : (this.targetAppName ? [this.targetAppName] : []);

    if (searchNames.length === 0) {
      console.warn('[VolumeController] No search names available');
      return false;
    }

    // 첫 번째 검색 이름으로 볼륨 설정 (AppVolumeController가 내부적으로 매칭 처리)
    // 복원 지연은 기본값 사용 (필요시 파라미터로 받을 수 있음)
    return await this.appVolumeController.setAppVolume(
      searchNames[0],
      volumeLevel0to10,
      3000 // 기본 복원 지연 시간 (ms)
    );
  }

  /**
   * 볼륨 레벨 설정 (1~9: 1 = 10%, 9 = 90%)
   */
  async setVolumeLevel(level: number): Promise<void> {
    // 레벨을 1~9 범위로 제한 (무소음 제외)
    const clampedLevel = Math.max(MIN_VOLUME_LEVEL, Math.min(MAX_VOLUME_LEVEL, Math.round(level)));
    const targetVolume0to10 = this.level1to9To0to10(clampedLevel); // 1~9 → 0~10 스케일로 변환

    this.currentVolumeLevel = clampedLevel;

    try {
      await this.setAppVolume(targetVolume0to10);
      const percent = this.volumeLevelToPercent(clampedLevel);
      const appInfo = this.targetAppName ? ` for ${this.targetAppName}` : '';
      console.log(`[VolumeController] 🔊 Volume set to level ${clampedLevel} (${percent}%)${appInfo}`);
    } catch (error) {
      console.error('[VolumeController] Failed to set volume level:', error);
      throw error;
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

