/**
 * T26: 앱별 볼륨 제어 모듈
 * 
 * native-sound-mixer를 사용하여 앱별로 독립적으로 볼륨을 조절합니다.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import soundMixer, { Device, DeviceType, AudioSession } from 'native-sound-mixer';

const execAsync = promisify(exec);

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
  private restoreTimers: Map<string, NodeJS.Timeout> = new Map(); // 세션별 복원 타이머
  private monitoringTimer: NodeJS.Timeout | null = null;
  private readonly DEFAULT_RESTORE_DELAY_MS = 3000;
  private readonly MONITORING_INTERVAL_MS = 1000;
  
  constructor() {
    this.initializeDefaultDevice();
    this.startSessionMonitoring();
  }
  
  /**
   * 기본 출력 디바이스 초기화
   */
  private initializeDefaultDevice(): void {
    this.refreshDevice();
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
    this.refreshDevice();

    this.monitoringTimer = setInterval(() => {
      this.refreshDevice();
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
   * 디바이스 정보 갱신 (내부용)
   */
  private refreshDevice(): void {
    try {
      const device = soundMixer.getDefaultDevice(DeviceType.RENDER);
      if (device) {
        this.defaultDevice = device;
        // 로그가 너무 많아질 수 있으므로 디버그 레벨로 조정하거나 변경시에만 로그를 찍는 것이 좋음
        // 현재는 간단히 유지
      } else {
        // console.warn('[AppVolumeController] ⚠️ No default output device found during refresh');
      }
    } catch (err) {
      console.error('[AppVolumeController] Failed to refresh default device:', err);
    }
  }
  
  /**
   * 현재 실행 중인 오디오 세션 조회
   */
  getAudioSessions(): AudioSessionInfo[] {
    if (!this.defaultDevice) {
      // console.warn('[AppVolumeController] Default device not initialized');
      return [];
    }
    
    try {
      const sessions = this.defaultDevice.sessions;
      
      return sessions
        .filter(s => s.state === 1) // ACTIVE 상태만
        .map(s => ({
          id: JSON.stringify({ name: s.name, appName: s.appName }), // 고유 ID 생성 (JSON으로 안전하게)
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
   * PID로 프로세스 경로 조회 (Windows 전용)
   *
   * NOTE:
   *  - wmic은 최신 Windows에서 deprecated 상태입니다.
   *  - 현재는 PoC 용도로 사용하고, 추후 PowerShell(Get-Process) 또는
   *    C# 브리지 메서드로 대체하는 것이 좋습니다.
   */
  private async getProcessPathByPid(pid: number): Promise<string | null> {
    try {
      // wmic process where processid=<pid> get ExecutablePath
      const { stdout } = await execAsync(`wmic process where processid=${pid} get ExecutablePath`);
      
      const lines = stdout.trim().split('\n');
      if (lines.length < 2) return null;
      
      const path = lines[1].trim();
      return path || null;
    } catch (err) {
      console.error(`[AppVolumeController] Failed to resolve PID ${pid} to path:`, err);
      return null;
    }
  }
  
  /**
   * 특정 PID 앱의 볼륨 조절
   * @param pid - 프로세스 ID
   * @param volumeLevel - 0~10 (0 = 음소거, 10 = 100%)
   * @param restoreDelayMs - 복원 대기 시간 (밀리초)
   */
  async setVolumeByPid(
    pid: number, 
    volumeLevel: number, 
    restoreDelayMs: number = this.DEFAULT_RESTORE_DELAY_MS
  ): Promise<boolean> {
    const processPath = await this.getProcessPathByPid(pid);
    
    if (!processPath) {
      console.warn(`[AppVolumeController] ⚠️ Could not resolve PID ${pid} to executable path`);
      return false;
    }
    
    console.log(`[AppVolumeController] 🎯 PID ${pid} resolved to: ${processPath}`);
    
    // 경로로 볼륨 조절
    return this.setAppVolume(processPath, volumeLevel, restoreDelayMs);
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
    if (!this.defaultDevice) {
      console.warn('[AppVolumeController] Default device not initialized');
      return false;
    }
    
    const sessions = this.getAudioSessions();
    
    // 앱 이름으로 세션 찾기 (부분 매칭, 대소문자 무시)
    const targetSession = sessions.find(s => {
      const sAppName = s.appName.toLowerCase();
      const sName = s.name.toLowerCase();
      const target = appName.toLowerCase();
      
      return sAppName === target || 
             sName === target || 
             sAppName.includes(target) ||
             (target.includes('\\') && sAppName.endsWith(target.split('\\').pop()!));
    });
    
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
      
      // 기존 복원 타이머 취소 (해당 세션의 타이머만)
      const existingTimer = this.restoreTimers.get(sessionKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.restoreTimers.delete(sessionKey);
      }
      
      // 자동 복원 타이머 설정 (세션별로 관리)
      if (restoreDelayMs > 0) {
        const timer = setTimeout(() => {
          void this.restoreVolume(sessionKey, actualSession);
          this.restoreTimers.delete(sessionKey);
        }, restoreDelayMs);
        this.restoreTimers.set(sessionKey, timer);
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
   * 저장된 원래 볼륨으로 복원
   */
  async restoreVolume(sessionKey?: string, session?: AudioSession): Promise<void> {
    if (sessionKey && session) {
      // 특정 세션 복원
      const existingTimer = this.restoreTimers.get(sessionKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.restoreTimers.delete(sessionKey);
      }
      
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
    
    // 모든 세션 복원 (fallback)
    if (this.originalVolumes.size === 0) return;
    
    // 모든 타이머 취소
    this.restoreTimers.forEach(timer => clearTimeout(timer));
    this.restoreTimers.clear();
    
    if (!this.defaultDevice) return;
    
    const deviceSessions = this.defaultDevice.sessions;
    let restoredCount = 0;
    
    this.originalVolumes.forEach((volume, key) => {
      // key는 JSON.stringify({ name, appName }) 형식
      try {
        const { name, appName } = JSON.parse(key);
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
      } catch (err) {
        console.warn(`[AppVolumeController] Failed to parse session key: ${key}`);
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

