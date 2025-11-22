import WebSocket from "ws";
import { onVoiceBridge } from "./onVoiceBridge";
import { VolumeController } from "../audio/volumeController";
import { getVolumeLevel } from "../store";

type TargetApp = "chrome" | "edge" | "discord";

interface AudioManagerStatus {
  isStreaming: boolean;
  target?: TargetApp;
  pid?: number;
  wsConnected: boolean;
}

class AudioManager {
  private static instance: AudioManager | null = null;
  private ws: WebSocket | null = null;
  private isInitialized = false;
  private isStreaming = false;
  private currentTarget: TargetApp | null = null;
  private currentPid: number | null = null;
  private wsUrl: string;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isReconnecting = false;
  private volumeController: VolumeController | null = null;
  private harmfulDetectionCount: number = 0;

  private constructor() {
    this.wsUrl = process.env.SERVER_WS_URL || "ws://localhost:8000/ws/audio";
    console.log(`[AudioManager] WebSocket URL: ${this.wsUrl}`);

    this.volumeController = new VolumeController();
    const savedLevel = getVolumeLevel();

    // 초기 볼륨 설정
    this.volumeController.setVolumeLevel(savedLevel).catch((err) => {
      console.error("[AudioManager] Failed to load saved volume level:", err);
    });
    console.log(`[AudioManager] VolumeController initialized with level ${savedLevel} (${savedLevel * 10}%)`);
  }

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  public async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    try {
      await onVoiceBridge.init((pcm: Buffer) => {
        this.handleAudioData(pcm);
      });
      this.isInitialized = true;
      console.log("[AudioManager] ✅ 초기화 완료");
    } catch (error) {
      console.error("[AudioManager] 초기화 실패:", error);
      throw error;
    }
  }

  private handleAudioData(pcm: Buffer): void {
    if (!this.isStreaming || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      this.ws.send(pcm);
    } catch (error) {
      console.error("[AudioManager] 오디오 데이터 전송 실패:", error);
      this.reconnectWebSocket().catch(console.error);
    }
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      if (this.ws) {
        this.ws.removeAllListeners();
        if (this.ws.readyState !== WebSocket.CLOSED) this.ws.close();
      }

      console.log(`[AudioManager] WebSocket 연결 시도: ${this.wsUrl}`);
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on("open", () => {
        console.log("[AudioManager] ✅ WebSocket 연결 성공");
        resolve();
      });

      // -------------------------------------------------------
      // [수정됨] 메시지 처리 로직
      // -------------------------------------------------------
      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const message = data.toString();
          // 로그가 너무 많으면 주석 처리
          // console.log("[AudioManager] 📝 전사 결과 수신:", message);

          try {
            const parsed = JSON.parse(message);

            if (parsed.status === "ok") {
              const text = parsed.text;
              // is_harmful이 1 또는 true인 경우 감지
              const isHarmful = parsed.is_harmful === 1 || parsed.is_harmful === true;
              const matchedKeywords = parsed.matched_keywords || [];

              // 텍스트 출력 (로그)
              if (text && text.trim()) {
                // 유해 표현이면 경고 로그, 아니면 일반 로그
                if (isHarmful) {
                  console.warn(`[AudioManager] 🚨 유해 표현 감지! "${text}" (키워드: ${matchedKeywords.join(", ")})`);
                  // ⚡️ 여기서 볼륨 조절 함수 호출
                  this.handleHarmfulExpressionDetected();
                } else {
                  console.log(`[AudioManager] [STT] ${text}`);
                }
              }
            }
          } catch (e) {
            // JSON 파싱 실패 시 무시하거나 로그
          }
        } catch (error) {
          console.error("[AudioManager] 메시지 처리 오류:", error);
        }
      });

      this.ws.on("error", (error) => {
        console.error("[AudioManager] WebSocket 오류:", error);
        reject(error);
      });

      this.ws.on("close", (code, reason) => {
        console.log(`[AudioManager] WebSocket 연결 종료`);
        const wasStreaming = this.isStreaming;
        this.ws = null;
        if (wasStreaming && !this.isReconnecting) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectWebSocket().catch(console.error);
          }, 2000);
        }
      });
    });
  }

  private async reconnectWebSocket(): Promise<void> {
    // (기존 코드와 동일 - 생략 가능하나 흐름상 유지)
    if (!this.isStreaming || this.isReconnecting) return;
    this.isReconnecting = true;
    try {
      await this.connectWebSocket();
      console.log("[AudioManager] WebSocket 재연결 성공");
    } catch (error) {
      if (this.isStreaming) {
        this.reconnectTimer = setTimeout(() => {
          this.isReconnecting = false;
          this.reconnectWebSocket().catch(console.error);
        }, 5000);
        return;
      }
    } finally {
      if (!this.isStreaming || this.ws?.readyState === WebSocket.OPEN) {
        this.isReconnecting = false;
      }
    }
  }

  // (startStream, stopStream, getStatus 등은 기존 코드 유지)
  public async startStream(target: TargetApp): Promise<void> {
    // ... (기존 코드와 동일)
    // 편의상 생략했으나 원본 코드를 그대로 사용하시면 됩니다.
    if (this.isStreaming) return;
    if (!this.isInitialized) await this.init();

    try {
      const pid = await onVoiceBridge.findProcess(target);
      await this.connectWebSocket();
      if (this.volumeController) this.volumeController.setTargetApp(target);
      await onVoiceBridge.startCapture(pid);

      this.isStreaming = true;
      this.currentTarget = target;
      this.currentPid = pid;
      console.log(`[AudioManager] ✅ 스트리밍 시작: ${target} (PID: ${pid})`);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  public async stopStream(): Promise<void> {
    // ... (기존 코드와 동일)
    if (!this.isStreaming) return;
    await onVoiceBridge.stopCapture();
    if (this.ws) this.ws.close();
    this.isStreaming = false;
    this.currentTarget = null;
    this.currentPid = null;
  }

  public setWebSocketUrl(url: string): void {
    this.wsUrl = url;
  }

  public getStatus(): AudioManagerStatus {
    return {
      isStreaming: this.isStreaming,
      target: this.currentTarget || undefined,
      pid: this.currentPid || undefined,
      wsConnected: this.ws !== null && this.ws.readyState === WebSocket.OPEN,
    };
  }

  /**
   * -------------------------------------------------------
   * 유해 표현 감지 시 설정된 볼륨 레벨로 조절
   * -------------------------------------------------------
   */
  private async handleHarmfulExpressionDetected(): Promise<void> {
    if (!this.volumeController) {
      console.warn("[AudioManager] VolumeController가 없습니다.");
      return;
    }

    try {
      this.harmfulDetectionCount++;

      // 저장소에서 설정된 볼륨 레벨 가져오기
      const savedVolumeLevel = getVolumeLevel();
      console.log(`[AudioManager] 🔊 유해 표현 감지! 볼륨 조절: ${savedVolumeLevel} (${savedVolumeLevel * 10}%)`);

      await this.volumeController.setVolumeLevel(savedVolumeLevel);
    } catch (error) {
      console.error("[AudioManager] 유해 표현 처리 중 오류:", error);
    }
  }
}

export default AudioManager;
