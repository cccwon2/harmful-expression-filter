/**
 * T26: 앱별 볼륨 제어 모듈
 * 
 * C# Bridge (OnVoiceComBridge)를 사용하여 앱별로 독립적으로 볼륨을 조절합니다.
 * Task 39: native-sound-mixer에서 C# Bridge로 마이그레이션
 * 
 * ✅ Task 39: native-sound-mixer 의존성 제거, C# Bridge (NAudio) 기반으로 통합
 */

import { listAudioSessions, setVolumeByPid as setVolumeByPidBridge } from '../main/onVoiceBridge';
import type { BridgeAudioSession } from '../main/onVoiceBridge';

export interface AudioSessionInfo {
  id: string;
  name: string;      // 예: "chrome.exe", "Discord.exe"
  appName: string;   // 앱 이름
  pid: number;       // 프로세스 ID
  volume: number;    // 0.0 ~ 1.0
  state: number;     // AudioSessionState
}

export class AppVolumeController {
  private originalVolumes: Map<string, number> = new Map();
  private restoreTimers: Map<string, NodeJS.Timeout> = new Map(); // 세션별 복원 타이머
  private monitoringTimer: NodeJS.Timeout | null = null;
  private cachedSessions: AudioSessionInfo[] = [];
  private isRefreshingSessions = false;
  private readonly DEFAULT_RESTORE_DELAY_MS = 5000; // 5초 유해 표현 감지 후 볼륨을 원래 값으로 돌리는 데 걸리는 시간
  private readonly MONITORING_INTERVAL_MS = 1000; // 1초 기본 출력 디바이스와 오디오 세션 목록을 더 자주 갱신
  
  constructor() {
    this.startSessionMonitoring();
  }
  
  /**
   * 오디오 세션 모니터링 시작
   * 주기적으로 디바이스 정보를 갱신하여 캐싱
   */
  private startSessionMonitoring(): void {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }

    // 초기 실행
    void this.refreshSessions();

    this.monitoringTimer = setInterval(() => {
      void this.refreshSessions();
    }, this.MONITORING_INTERVAL_MS);
    
    console.log(`[AppVolumeController] 🔄 Started background session monitoring (${this.MONITORING_INTERVAL_MS}ms)`);
  }

  /**
   * 오디오 세션 모니터링 중지
   */
  stopSessionMonitoring(): void {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
      console.log('[AppVolumeController] ⏹️ Stopped background session monitoring');
    }
  }

  /**
   * 세션 정보 갱신 (내부용)
   */
  private async refreshSessions(): Promise<void> {
    if (this.isRefreshingSessions) return;
    this.isRefreshingSessions = true;
    try {
      await this.fetchSessionsFromBridge();
    } finally {
      this.isRefreshingSessions = false;
    }
  }
  
  /**
   * 현재 실행 중인 오디오 세션 조회 (캐시)
   */
  getAudioSessions(): AudioSessionInfo[] {
    return this.cachedSessions;
  }

  private async fetchSessionsFromBridge(): Promise<AudioSessionInfo[]> {
    try {
      const sessions = await listAudioSessions();
      const normalized = sessions
        .filter((session): session is BridgeAudioSession => typeof session.pid === 'number')
        .map((session, index) => ({
          id:
            session.id ||
            JSON.stringify({
              pid: session.pid,
              name: session.name,
              index,
            }),
          name: session.name || session.appName || `PID ${session.pid}`,
          appName: session.appName || session.name || `pid-${session.pid}`,
          pid: session.pid,
          volume: typeof session.volume === 'number' ? session.volume : 0,
          state: typeof session.state === 'number' ? session.state : 0,
        }))
        .filter((session) => session.state === 1);

      this.cachedSessions = normalized;
      return normalized;
    } catch (err) {
      console.error('[AppVolumeController] Failed to refresh audio sessions from C# bridge:', err);
      return this.cachedSessions;
    }
  }
  
  /**
   * 특정 PID 앱의 볼륨 조절 (C# Bridge 사용)
   * @param pid - 프로세스 ID
   * @param volumeLevel - 0~10 (0 = 음소거, 10 = 100%)
   * @param restoreDelayMs - 복원 대기 시간 (밀리초)
   */
  async setVolumeByPid(
    pid: number, 
    volumeLevel: number, 
    restoreDelayMs: number = this.DEFAULT_RESTORE_DELAY_MS,
    options?: { originalVolume?: number }
  ): Promise<boolean> {
    const startTime = Date.now();
    const normalizedVolume = Math.max(0, Math.min(1, volumeLevel / 10));
    
    console.log(`[AppVolumeController] 🎯 PID ${pid} 볼륨 조절: ${volumeLevel}/10 → ${normalizedVolume.toFixed(2)}`);
    
    const bridgeStartTime = Date.now();
    const success = await setVolumeByPidBridge(pid, normalizedVolume);
    const bridgeElapsed = Date.now() - bridgeStartTime;
    
    if (success) {
      const pidKey = this.getPidKey(pid);
      if (!this.originalVolumes.has(pidKey)) {
        const originalVolume = options?.originalVolume ?? 1.0;
        this.originalVolumes.set(pidKey, originalVolume);
        console.log(`[AppVolumeController] 💾 Saved original volume for PID ${pid}: ${Math.round(originalVolume * 100)}%`);
      }
      
      this.scheduleRestore(pidKey, pid, restoreDelayMs);
    }
    
    const totalElapsed = Date.now() - startTime;
    console.log(`[AppVolumeController] ⏱️ setVolumeByPid 완료 (C# Bridge: ${bridgeElapsed}ms, 총: ${totalElapsed}ms)`);
    
    return success;
  }
  
  private getPidKey(pid: number): string {
    return `pid:${pid}`;
  }

  private scheduleRestore(pidKey: string, pid: number, restoreDelayMs: number): void {
    const existingTimer = this.restoreTimers.get(pidKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.restoreTimers.delete(pidKey);
    }

    if (restoreDelayMs > 0) {
      const timer = setTimeout(() => {
        void this.restoreVolumeByPid(pid);
        this.restoreTimers.delete(pidKey);
      }, restoreDelayMs);
      this.restoreTimers.set(pidKey, timer);
    }
  }

  /**
   * PID로 볼륨 복원
   */
  private async restoreVolumeByPid(pid: number): Promise<void> {
    const pidKey = this.getPidKey(pid);
    const originalVolume = this.originalVolumes.get(pidKey);
    
    if (originalVolume !== undefined) {
      const success = await setVolumeByPidBridge(pid, originalVolume);
      if (success) {
        this.originalVolumes.delete(pidKey);
        console.log(`[AppVolumeController] ✅ Restored volume for PID ${pid}: ${Math.round(originalVolume * 100)}%`);
      }
    }
  }
  
  /**
   * 특정 앱의 볼륨 조절 (내부적으로 사용하거나 이름으로 직접 제어할 때 사용)
   * @param appName - 앱 이름 (예: "chrome", "discord", "chrome.exe", 또는 전체 경로)
   * @param volumeLevel - 0~10 (0 = 음소거, 10 = 100%)
   * @param restoreDelayMs - 복원 대기 시간 (밀리초)
   */
  async setAppVolume(
    appName: string, 
    volumeLevel: number, 
    restoreDelayMs: number = this.DEFAULT_RESTORE_DELAY_MS
  ): Promise<boolean> {
    const startTime = Date.now();
    
    const fetchSessionsStartTime = Date.now();
    const sessions = await this.fetchSessionsFromBridge();
    const fetchSessionsElapsed = Date.now() - fetchSessionsStartTime;
    
    const findSessionStartTime = Date.now();
    const targetSession = this.findSessionByName(sessions, appName);
    const findSessionElapsed = Date.now() - findSessionStartTime;
    
    if (!targetSession) {
      const totalElapsed = Date.now() - startTime;
      console.warn(`[AppVolumeController] ⚠️ App not found in active sessions: ${appName} (세션 조회: ${fetchSessionsElapsed}ms, 앱 찾기: ${findSessionElapsed}ms, 총: ${totalElapsed}ms)`);
      console.log(`[AppVolumeController] Available apps: ${sessions.map(s => s.name).join(', ')}`);
      return false;
    }

    if (!targetSession.pid || targetSession.pid <= 0) {
      const totalElapsed = Date.now() - startTime;
      console.warn(`[AppVolumeController] ⚠️ Session PID unavailable for ${targetSession.name} (${totalElapsed}ms)`);
      return false;
    }

    const setVolumeStartTime = Date.now();
    const success = await this.setVolumeByPid(
      targetSession.pid,
      volumeLevel,
      restoreDelayMs,
      { originalVolume: targetSession.volume },
    );
    const setVolumeElapsed = Date.now() - setVolumeStartTime;
    const totalElapsed = Date.now() - startTime;

    if (success) {
      const normalizedVolume = Math.max(0, Math.min(1, volumeLevel / 10));
      console.log(`[AppVolumeController] 🔊 ${targetSession.name}: ${Math.round(normalizedVolume * 100)}% (PID ${targetSession.pid}) - 세션 조회: ${fetchSessionsElapsed}ms, 앱 찾기: ${findSessionElapsed}ms, 볼륨 조절: ${setVolumeElapsed}ms, 총: ${totalElapsed}ms`);
    } else {
      console.warn(`[AppVolumeController] ⚠️ 볼륨 조절 실패 (${totalElapsed}ms)`);
    }

    return success;
  }
  
  /**
   * 특정 앱 음소거
   */
  async muteApp(appName: string): Promise<boolean> {
    return this.setAppVolume(appName, 0, 0); // 복원 없이 음소거
  }
  
  /**
   * 저장된 원래 볼륨으로 복원
   */
  async restoreVolume(): Promise<void> {
    if (this.originalVolumes.size === 0) return;
    
    // 모든 타이머 취소
    this.restoreTimers.forEach(timer => clearTimeout(timer));
    this.restoreTimers.clear();
    
    const pidKeys = Array.from(this.originalVolumes.keys());
    for (const pidKey of pidKeys) {
      const pid = this.extractPidFromKey(pidKey);
      if (pid !== null) {
        await this.restoreVolumeByPid(pid);
      } else {
        this.originalVolumes.delete(pidKey);
      }
    }
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

  private findSessionByName(sessions: AudioSessionInfo[], appName: string): AudioSessionInfo | undefined {
    const target = appName.toLowerCase();
    return sessions.find((session) => {
      const sessionAppName = session.appName.toLowerCase();
      const sessionName = session.name.toLowerCase();

      if (sessionAppName === target || sessionName === target) {
        return true;
      }

      if (sessionAppName.includes(target) || sessionName.includes(target)) {
        return true;
      }

      if (target.includes('\\')) {
        const targetFile = target.split('\\').pop()!;
        return sessionAppName.endsWith(targetFile) || sessionName.endsWith(targetFile);
      }

      return false;
    });
  }

  private extractPidFromKey(pidKey: string): number | null {
    if (!pidKey.startsWith('pid:')) return null;
    const parsed = Number(pidKey.slice(4));
    return Number.isNaN(parsed) ? null : parsed;
  }
}

