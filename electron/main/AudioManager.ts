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
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;

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
    if (!this.isStreaming) {
      return;
    }

    // 비동기로 처리하여 COM 이벤트 스레드가 블로킹되지 않도록 함
    setImmediate(() => {
      // 서버 STT로만 동작: WebSocket 전송
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          // WebSocket.send는 동기적으로 버퍼를 복사하므로 빠르게 처리됨
          this.ws.send(pcm);
        } catch (error) {
          console.error("[AudioManager] 오디오 데이터 전송 실패:", error);
          // 재연결은 별도로 처리 (블로킹 방지)
          setImmediate(() => {
            this.reconnectWebSocket().catch(console.error);
          });
        }
      }
    });
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
      
      // 연결 타임아웃 설정 (10초)
      const timeout = setTimeout(() => {
        if (this.ws) {
          console.error("[AudioManager] WebSocket 연결 타임아웃 (10초)");
          this.ws.removeAllListeners();
          this.ws.close();
          this.ws = null;
        }
        reject(new Error("WebSocket connection timeout"));
      }, 10000);

      this.ws = new WebSocket(this.wsUrl);

      this.ws.on("open", () => {
        clearTimeout(timeout);
        console.log("[AudioManager] ✅ WebSocket 연결 성공");
        // 연결 성공 시 재연결 시도 횟수 초기화
        this.reconnectAttempts = 0;
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

              // 텍스트 출력 (로그) - 모든 STT 결과를 명확하게 표시
              if (text && text.trim()) {
                // 모든 텍스트를 먼저 표시 (유해/비유해 구분 없이)
                const confidenceInfo = parsed.confidence 
                  ? ` (신뢰도: ${(parsed.confidence * 100).toFixed(1)}%)`
                  : "";
                console.log(`[AudioManager] [STT] "${text}"${confidenceInfo}`);
                
                // 유해 표현인 경우 추가 경고 표시
                if (isHarmful) {
                  // 🔇 키워드 표시 완전 제거 - AI 모델만 사용
                  // matchedKeywords는 서버에서 보내는 정보이지만, 키워드 기반이 아닌 AI 감지 결과임
                  const aiInfo = parsed.ai_checked 
                    ? `(Kanana-AI 모델 감지, 신뢰도: ${(parsed.confidence * 100).toFixed(1)}%)`
                    : "(AI 모델 감지)";
                  console.warn(`[AudioManager] 🚨 유해 표현 감지! "${text}" ${aiInfo}`);
                  // ⚡️ 여기서 볼륨 조절 함수 호출
                  this.handleHarmfulExpressionDetected();
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
        clearTimeout(timeout);
        console.error("[AudioManager] WebSocket 오류:", error);
        this.reconnectAttempts++;
        if (this.ws) {
          this.ws.removeAllListeners();
          this.ws = null;
        }
        reject(error);
      });

      this.ws.on("close", (code, reason) => {
        clearTimeout(timeout);
        console.log(`[AudioManager] WebSocket 연결 종료 (code: ${code}, reason: ${reason || 'none'})`);
        const wasStreaming = this.isStreaming;
        const wsInstance = this.ws;
        this.ws = null;
        
        if (wasStreaming && !this.isReconnecting) {
          this.reconnectAttempts++;
          
          // 재연결 시도
          this.reconnectTimer = setTimeout(() => {
            this.reconnectWebSocket().catch(console.error);
          }, 2000);
        }
      });
    });
  }

  private async reconnectWebSocket(): Promise<void> {
    if (!this.isStreaming || this.isReconnecting) return;
    this.isReconnecting = true;
    try {
      await this.connectWebSocket();
      console.log("[AudioManager] WebSocket 재연결 성공");
      this.reconnectAttempts = 0; // 재연결 성공 시 초기화
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
    if (this.isStreaming) return;
    if (!this.isInitialized) await this.init();

    try {
      const pid = await onVoiceBridge.findProcess(target);
      
      // WebSocket 연결 시도 (타임아웃 10초)
      try {
        await Promise.race([
          this.connectWebSocket(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Connection timeout")), 10000)
          )
        ]);
        console.log("[AudioManager] WebSocket 연결 완료");
      } catch (error) {
        console.error("[AudioManager] WebSocket 연결 실패:", error);
        // 연결 실패해도 스트리밍은 시작 (재연결 시도)
        // 비동기로 재연결 시도
        setImmediate(() => {
          this.reconnectWebSocket().catch((err) => {
            console.error("[AudioManager] 초기 재연결 실패:", err);
          });
        });
      }
      
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
    if (!this.isStreaming) return;
    await onVoiceBridge.stopCapture();
    if (this.ws) this.ws.close();
    this.isStreaming = false;
    this.currentTarget = null;
    this.currentPid = null;
    // 재연결 시도 횟수 초기화 (다음 스트리밍 시도 시)
    this.reconnectAttempts = 0;
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
   * 유해 표현 감지 시 저장된 볼륨 레벨 확인 및 적용
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
