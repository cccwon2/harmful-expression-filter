/**
 * Phase 3: 오디오 모니터링 서비스 (메인 프로세스)
 *
 * 오디오 캡처, 처리, WebSocket 통신을 통합 관리합니다.
 */

import { BrowserWindow } from "electron";
import { AudioProcessor } from "./audioProcessor";
import { AudioStreamClient, AudioStreamResponse } from "./audioStreamClient";
import { IPC_CHANNELS } from "../ipc/channels";
import { AppVolumeController } from "./appVolumeController";

export class AudioService {
  private isMonitoring = false;
  private audioIn: any = null;
  private processor: AudioProcessor;
  private streamClient: AudioStreamClient;
  private volumeLevel = 1; // 0~10, 기본값 1 (1단계 볼륨)
  private beepEnabled = false;
  private volumeController: AppVolumeController;
  private targetAppName: string | null = "chrome"; // 모니터링할 앱 이름 (기본값: chrome, null이면 모든 앱)
  private windows: Set<BrowserWindow> = new Set(); // 여러 윈도우 지원

  constructor(initialWindow: BrowserWindow | null) {
    // AudioProcessor는 startMonitoring에서 실제 디바이스 샘플 레이트로 초기화됨
    // 임시로 48000으로 초기화 (실제로는 startMonitoring에서 재설정됨)
    this.processor = new AudioProcessor(48000, 16000);
    const wsUrl = process.env.SERVER_WS_URL || "ws://127.0.0.1:8000/ws/audio";
    this.streamClient = new AudioStreamClient(wsUrl);
    this.volumeController = new AppVolumeController();

    if (initialWindow) {
      this.windows.add(initialWindow);
    }

    // 서버 응답 리스너
    this.streamClient.on("response", (response: AudioStreamResponse) => {
      void this.handleServerResponse(response);
    });

    this.streamClient.on("error", (err) => {
      console.error("[AudioService] WebSocket error:", err);
    });

    this.streamClient.on("close", () => {
      console.log("[AudioService] WebSocket connection closed");
      if (this.isMonitoring) {
        // 재연결 시도
        console.log("[AudioService] Attempting to reconnect...");
        setTimeout(() => {
          this.streamClient.connect().catch(console.error);
        }, 1000);
      }
    });
  }

  /**
   * 윈도우 추가 (여러 윈도우에서 오디오 상태 수신 가능)
   */
  addWindow(window: BrowserWindow): void {
    this.windows.add(window);
    console.log(`[AudioService] Window added (total: ${this.windows.size})`);

    // 현재 상태를 새 윈도우에 전송
    this.broadcastStatus();
  }

  /**
   * 윈도우 제거
   */
  removeWindow(window: BrowserWindow): void {
    this.windows.delete(window);
    console.log(`[AudioService] Window removed (total: ${this.windows.size})`);
  }

  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      console.log("[AudioService] Audio monitoring already started");
      return;
    }

    // naudiodon2가 제거되었으므로 오디오 캡처 기능 비활성화
    console.warn("[AudioService] ⚠️ Audio monitoring is disabled: naudiodon2 has been removed");
    console.warn("[AudioService] ⚠️ Please use OnVoice service for audio capture instead");
    throw new Error("Audio monitoring with naudiodon2 is no longer supported. Please use OnVoice service instead.");
  }

  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    // 오디오 캡처 중지
    if (this.audioIn) {
      try {
        this.audioIn.quit();
      } catch (err) {
        console.error("[AudioService] Error stopping audio capture:", err);
      }
      this.audioIn = null;
    }

    // WebSocket 연결 정상 종료
    try {
      this.streamClient.disconnect();
    } catch (err) {
      console.error("[AudioService] Error disconnecting WebSocket:", err);
    }

    this.isMonitoring = false;
    console.log("[AudioService] ✅ Audio monitoring stopped");

    void this.volumeController.restoreVolume();
    this.broadcastStatus();
  }

  /**
   * 모니터링할 앱 설정 (null이면 모든 앱)
   */
  setTargetApp(appName: string | null): void {
    this.targetAppName = appName;
    console.log(`[AudioService] Target app set to: ${appName || "all apps"}`);
  }

  /**
   * 현재 실행 중인 오디오 세션 조회
   */
  getAudioSessions() {
    return this.volumeController.getAudioSessions();
  }

  private async handleServerResponse(response: AudioStreamResponse): Promise<void> {
    console.log("[AudioService] Server response:", response);

    const isHarmful = response.is_harmful === true || response.is_harmful === 1;
    if (!isHarmful) {
      return;
    }

    console.log(`[AudioService] ⚠️ HARMFUL AUDIO DETECTED: ${response.text}`);

    // 등록된 모든 윈도우에 유해 감지 알림 전송
    const harmfulData = {
      text: response.text,
      confidence: response.confidence || 0,
      timestamp: response.timestamp || Date.now(),
    };

    this.windows.forEach((window) => {
      if (!window.isDestroyed()) {
        try {
          window.webContents.send(IPC_CHANNELS.AUDIO_HARMFUL_DETECTED, harmfulData);
          console.log(`[AudioService] Harmful detection sent to window ${window.id}`);
        } catch (err) {
          console.error(`[AudioService] Failed to send harmful detection to window ${window.id}:`, err);
        }
      }
    });

    if (this.beepEnabled) {
      this.playBeep();
      return;
    }

    await this.adjustVolume(this.volumeLevel);
  }

  private async adjustVolume(level: number): Promise<void> {
    try {
      // 유해 표현 감지 시 볼륨 조절
      if (this.targetAppName) {
        // 특정 앱만 음소거 (예: Chrome)
        console.log(`[AudioService] 🔇 Muting specific app: ${this.targetAppName} (no auto-restore)`);
        const success = await this.volumeController.muteApp(this.targetAppName);
        if (success) {
          console.log(`[AudioService] ✅ Successfully muted ${this.targetAppName}`);
        } else {
          console.warn(`[AudioService] ⚠️ Failed to mute ${this.targetAppName}, falling back to mute all apps`);
          // 폴백: 특정 앱을 찾을 수 없으면 모든 앱 음소거
          await this.volumeController.muteAllApps(0);
        }
      } else {
        // 모든 앱 음소거 (폴백 방식)
        console.log(`[AudioService] 🔇 Muting all apps due to harmful content (no auto-restore)`);
        await this.volumeController.muteAllApps(0); // 자동 복원 없음 (0 = 복원 안함)
      }
    } catch (error) {
      console.error("[AudioService] Failed to mute apps:", error);
    }
  }

  private playBeep(): void {
    // TODO: 비프음 재생 (Phase 5에서 구현)
    console.log("[AudioService] 🔔 Playing beep sound");
  }

  setVolumeLevel(level: number): void {
    this.volumeLevel = Math.max(0, Math.min(10, level));
    console.log(`[AudioService] Volume level set to: ${this.volumeLevel}`);
    this.broadcastStatus();
  }

  setBeepEnabled(enabled: boolean): void {
    this.beepEnabled = enabled;
    console.log(`[AudioService] Beep enabled: ${this.beepEnabled}`);
    this.broadcastStatus();
  }

  getStatus() {
    return {
      isMonitoring: this.isMonitoring,
      volumeLevel: this.volumeLevel,
      beepEnabled: this.beepEnabled,
      targetAppName: this.targetAppName,
      audioSessions: this.getAudioSessions(),
    };
  }

  private broadcastStatus(): void {
    const status = this.getStatus();

    // 등록된 모든 윈도우에 상태 전송
    this.windows.forEach((window) => {
      if (!window.isDestroyed()) {
        try {
          window.webContents.send(IPC_CHANNELS.AUDIO_STATUS, status);
        } catch (err) {
          console.error(`[AudioService] Failed to broadcast status to window ${window.id}:`, err);
        }
      }
    });

    // 트레이 메뉴 업데이트는 main.ts에서 주기적으로 처리 (순환 의존성 방지)
    // 또는 getTrayAudioUpdateCallback을 통해 간접적으로 호출
    try {
      const { getTrayAudioUpdateCallback } = require("../tray");
      const trayUpdateCallback = getTrayAudioUpdateCallback();
      if (trayUpdateCallback && typeof trayUpdateCallback === "function") {
        trayUpdateCallback();
      }
    } catch (err) {
      // 트레이 업데이트 실패는 치명적이지 않음 (순환 의존성 방지)
      // console.error('[AudioService] Failed to update tray menu:', err);
    }
  }
}
