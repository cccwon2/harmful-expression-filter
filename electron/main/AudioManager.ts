import WebSocket from "ws";
import { onVoiceBridge, analyzeTextLocally } from "./onVoiceBridge";
import { VolumeController } from "../audio/volumeController";
import { getVolumeLevel } from "../store";
import { LocalSttService } from "../audio/LocalSttService";

type TargetApp = "chrome" | "edge" | "discord";

interface AudioManagerStatus {
  isStreaming: boolean;
  target?: TargetApp;
  pid?: number;
  wsConnected: boolean;
  isFallbackMode?: boolean;
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
  private localSttService: LocalSttService;
  private isFallbackMode: boolean = false;
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
      // LocalSttService 초기화 (폴백용, 모델은 나중에 필요할 때 로딩)
      this.localSttService = LocalSttService.getInstance();
      
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

    // 폴백 모드: 로컬 STT 사용
    if (this.isFallbackMode) {
      this.localSttService.processAudio(pcm).then((text) => {
        if (text && text.trim()) {
          console.log(`[AudioManager] [로컬 STT] ${text}`);
          
          // 로컬 유해성 분석
          const analysis = analyzeTextLocally(text);
          if (analysis.isHarmful) {
            console.warn(
              `[AudioManager] 🚨 유해 표현 감지! "${text}" (키워드: ${analysis.matched.join(", ")})`
            );
            this.handleHarmfulExpressionDetected();
          }
        }
      }).catch((error) => {
        console.error("[AudioManager] 로컬 STT 처리 실패:", error);
      });
      return;
    }

    // 정상 모드: WebSocket 전송
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(pcm);
      } catch (error) {
        console.error("[AudioManager] 오디오 데이터 전송 실패:", error);
        this.reconnectWebSocket().catch(console.error);
      }
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
        // 연결 성공 시 재연결 시도 횟수 초기화 및 폴백 모드 해제
        this.reconnectAttempts = 0;
        if (this.isFallbackMode) {
          console.log("[AudioManager] 정상 모드로 복구되었습니다.");
          this.isFallbackMode = false;
        }
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
        this.reconnectAttempts++;
        
        // 3회 이상 실패 시 폴백 모드로 전환
        if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS && !this.isFallbackMode) {
          this.switchToFallbackMode().catch(console.error);
        }
        
        reject(error);
      });

      this.ws.on("close", (code, reason) => {
        console.log(`[AudioManager] WebSocket 연결 종료`);
        const wasStreaming = this.isStreaming;
        this.ws = null;
        if (wasStreaming && !this.isReconnecting) {
          this.reconnectAttempts++;
          
          // 3회 이상 실패 시 폴백 모드로 전환
          if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS && !this.isFallbackMode) {
            this.switchToFallbackMode().catch(console.error);
          } else {
            // 재연결 시도
            this.reconnectTimer = setTimeout(() => {
              this.reconnectWebSocket().catch(console.error);
            }, 2000);
          }
        }
      });
    });
  }

  private async reconnectWebSocket(): Promise<void> {
    if (!this.isStreaming || this.isReconnecting || this.isFallbackMode) return;
    this.isReconnecting = true;
    try {
      await this.connectWebSocket();
      console.log("[AudioManager] WebSocket 재연결 성공");
      this.reconnectAttempts = 0; // 재연결 성공 시 초기화
    } catch (error) {
      if (this.isStreaming && !this.isFallbackMode) {
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

  /**
   * 폴백 모드로 전환 (로컬 Whisper 사용)
   */
  private async switchToFallbackMode(): Promise<void> {
    if (this.isFallbackMode) {
      return; // 이미 폴백 모드
    }

    console.warn("[AudioManager] 🚨 서버 응답 없음. 로컬 Whisper 모드로 전환합니다.");
    this.isFallbackMode = true;

    // WebSocket 연결 종료
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // 재연결 타이머 취소
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // LocalSttService 초기화 (모델 로딩)
    try {
      await this.localSttService.init();
      console.log("[AudioManager] ✅ 로컬 Whisper 모델 로딩 완료");
    } catch (error) {
      console.error("[AudioManager] 로컬 Whisper 모델 로딩 실패:", error);
      // 모델 로딩 실패 시에도 폴백 모드 유지 (재시도 가능)
    }
  }

  // (startStream, stopStream, getStatus 등은 기존 코드 유지)
  public async startStream(target: TargetApp): Promise<void> {
    if (this.isStreaming) return;
    if (!this.isInitialized) await this.init();

    try {
      const pid = await onVoiceBridge.findProcess(target);
      
      // 폴백 모드가 아니면 WebSocket 연결 시도
      if (!this.isFallbackMode) {
        try {
          await this.connectWebSocket();
        } catch (error) {
          // 연결 실패 시 폴백 모드로 전환
          console.error("[AudioManager] WebSocket 연결 실패, 폴백 모드로 전환:", error);
          await this.switchToFallbackMode();
        }
      }
      
      if (this.volumeController) this.volumeController.setTargetApp(target);
      await onVoiceBridge.startCapture(pid);

      this.isStreaming = true;
      this.currentTarget = target;
      this.currentPid = pid;
      console.log(`[AudioManager] ✅ 스트리밍 시작: ${target} (PID: ${pid})${this.isFallbackMode ? " [로컬 Whisper 모드]" : ""}`);
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
      isFallbackMode: this.isFallbackMode,
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
