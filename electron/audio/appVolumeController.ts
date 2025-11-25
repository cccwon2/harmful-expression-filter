/**
 * T26: 앱별 볼륨 제어 모듈
 * 
 * C# Bridge (OnVoiceComBridge)를 사용하여 앱별로 독립적으로 볼륨을 조절합니다.
 * Task 39: native-sound-mixer에서 C# Bridge로 마이그레이션
 * 
 * ⚠️ 주의: getAudioSessions()와 setAppVolume()은 아직 native-sound-mixer를 사용합니다.
 * 향후 C# Bridge로 마이그레이션 예정입니다.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
// TODO: Task 39 후속 작업 - getAudioSessions와 setAppVolume을 C# Bridge로 마이그레이션
import soundMixer, { Device, DeviceType, AudioSession } from 'native-sound-mixer';
import { setVolumeByPid as setVolumeByPidBridge } from '../main/onVoiceBridge';

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
  private readonly DEFAULT_RESTORE_DELAY_MS = 5000; // 5초 유해 표현 감지 후 볼륨을 원래 값으로 돌리는 데 걸리는 시간
  private readonly MONITORING_INTERVAL_MS = 1000; // 1초 기본 출력 디바이스와 오디오 세션 목록을 더 자주 갱신
  
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
   * 특정 PID 앱의 볼륨 조절 (C# Bridge 사용)
   * @param pid - 프로세스 ID
   * @param volumeLevel - 0~10 (0 = 음소거, 10 = 100%)
   * @param restoreDelayMs - 복원 대기 시간 (밀리초)
   */
  async setVolumeByPid(
    pid: number, 
    volumeLevel: number, 
    restoreDelayMs: number = this.DEFAULT_RESTORE_DELAY_MS
  ): Promise<boolean> {
    // level (0~10) -> volume (0.0 ~ 1.0)
    const normalizedVolume = Math.max(0, Math.min(1, volumeLevel / 10));
    
    console.log(`[AppVolumeController] 🎯 PID ${pid} 볼륨 조절: ${volumeLevel}/10 → ${normalizedVolume.toFixed(2)}`);
    
    const success = await setVolumeByPidBridge(pid, normalizedVolume);
    
    if (success) {
      // 원래 볼륨 저장 및 복원 타이머 설정
      // PID를 키로 사용하여 원래 볼륨 저장
      const pidKey = `pid:${pid}`;
      
      // 현재 볼륨을 가져오기 위해 세션 정보 확인 (선택적)
      // C# Bridge에서 현재 볼륨을 반환하지 않으므로, 원래 볼륨은 나중에 복원 시 기본값(1.0)으로 설정
      if (!this.originalVolumes.has(pidKey)) {
        // 기본값으로 1.0 (100%) 저장 (실제로는 C# Bridge에서 현재 볼륨을 가져올 수 없음)
        this.originalVolumes.set(pidKey, 1.0);
        console.log(`[AppVolumeController] 💾 Saved original volume for PID ${pid}: 100% (기본값)`);
      }
      
      // 기존 복원 타이머 취소
      const existingTimer = this.restoreTimers.get(pidKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.restoreTimers.delete(pidKey);
      }
      
      // 자동 복원 타이머 설정
      if (restoreDelayMs > 0) {
        const timer = setTimeout(() => {
          void this.restoreVolumeByPid(pid);
          this.restoreTimers.delete(pidKey);
        }, restoreDelayMs);
        this.restoreTimers.set(pidKey, timer);
      }
    }
    
    return success;
  }
  
  /**
   * PID로 볼륨 복원
   */
  private async restoreVolumeByPid(pid: number): Promise<void> {
    const pidKey = `pid:${pid}`;
    const originalVolume = this.originalVolumes.get(pidKey);
    
    if (originalVolume !== undefined) {
      // 원래 볼륨으로 복원 (0.0~1.0 스케일)
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

