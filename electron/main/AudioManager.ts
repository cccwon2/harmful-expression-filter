/**
 * AudioManager - Singleton 클래스
 *
 * OnVoice Bridge를 통해 오디오를 캡처하고 Python FastAPI 백엔드로 WebSocket을 통해 스트리밍합니다.
 */

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
  private harmfulDetectionCount: number = 0; // 유해 표현 감지 횟수 추적

  private constructor() {
    // 환경 변수에서 WebSocket URL 가져오기 (기본값: ws://localhost:8000/ws/audio)
    this.wsUrl = process.env.SERVER_WS_URL || "ws://localhost:8000/ws/audio";
    console.log(`[AudioManager] WebSocket URL: ${this.wsUrl}`);

    // 볼륨 컨트롤러 초기화
    this.volumeController = new VolumeController();
    // 저장된 볼륨 레벨 로드 및 설정
    const savedLevel = getVolumeLevel();
    this.volumeController.setVolumeLevel(savedLevel).catch((err) => {
      console.error("[AudioManager] Failed to load saved volume level:", err);
    });
    console.log(`[AudioManager] VolumeController initialized with level ${savedLevel} (${savedLevel * 10}%)`);
  }

  /**
   * Singleton 인스턴스 가져오기
   */
  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  /**
   * 초기화 - onVoiceBridge 초기화 및 오디오 데이터 리스너 설정
   */
  public async init(): Promise<void> {
    if (this.isInitialized) {
      console.log("[AudioManager] 이미 초기화되었습니다.");
      return;
    }

    try {
      // onVoiceBridge 초기화 (오디오 데이터 콜백 등록)
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

  /**
   * 오디오 데이터 처리 - WebSocket이 열려있으면 전송
   */
  private handleAudioData(pcm: Buffer): void {
    if (!this.isStreaming || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // 스트리밍 중이 아니거나 WebSocket이 열려있지 않으면 무시
      return;
    }

    try {
      // WebSocket이 열려있으면 PCM 버퍼를 그대로 전송
      this.ws.send(pcm);
    } catch (error) {
      console.error("[AudioManager] 오디오 데이터 전송 실패:", error);
      // 전송 실패 시 WebSocket 재연결 시도 (비동기로 처리)
      this.reconnectWebSocket().catch((err) => {
        console.error("[AudioManager] 재연결 시도 중 오류:", err);
      });
    }
  }

  /**
   * WebSocket 연결 열기
   */
  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log("[AudioManager] WebSocket이 이미 연결되어 있습니다.");
        resolve();
        return;
      }

      // 기존 연결이 있으면 닫기
      if (this.ws) {
        this.ws.removeAllListeners();
        if (this.ws.readyState !== WebSocket.CLOSED) {
          this.ws.close();
        }
      }

      console.log(`[AudioManager] WebSocket 연결 시도: ${this.wsUrl}`);
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on("open", () => {
        console.log("[AudioManager] ✅ WebSocket 연결 성공");
        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          // Python 서버로부터 전사 결과 수신
          const message = data.toString();
          console.log("[AudioManager] 📝 전사 결과 수신:", message);

          // JSON 파싱 시도 (서버가 JSON으로 보낼 경우)
          try {
            const parsed = JSON.parse(message);
            
            // 서버 응답 형식: status="ok", text, is_harmful, confidence 등
            if (parsed.status === "ok" && parsed.text) {
              const text = parsed.text;
              const isHarmful = parsed.is_harmful === 1 || parsed.is_harmful === true;
              const confidence = parsed.confidence || 0;
              const matchedKeywords = parsed.matched_keywords || [];

              if (text && text.trim()) {
                console.log(`[AudioManager] [STT] ${text} (confidence: ${confidence.toFixed(2)})`);

                if (isHarmful) {
                  console.warn(
                    `[AudioManager] 🚨 유해 표현 감지 (confidence: ${confidence.toFixed(2)}): ${matchedKeywords.join(", ")}`
                  );
                  this.handleHarmfulExpressionDetected();
                }
              }
            } else if (parsed.text) {
              // 단순 텍스트만 있는 경우
              console.log("[AudioManager] 전사 텍스트:", parsed.text);
            }
          } catch {
            // JSON이 아니면 그대로 출력
            console.log("[AudioManager] 전사 텍스트:", message);
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
        console.log(`[AudioManager] WebSocket 연결 종료: ${code} - ${reason.toString()}`);
        const wasStreaming = this.isStreaming;
        this.ws = null;

        // 스트리밍 중이면 재연결 시도
        if (wasStreaming && !this.isReconnecting) {
          console.log("[AudioManager] 스트리밍 중이므로 재연결 시도...");
          this.reconnectTimer = setTimeout(() => {
            this.reconnectWebSocket().catch((err) => {
              console.error("[AudioManager] 재연결 시도 중 오류:", err);
            });
          }, 2000);
        }
      });
    });
  }

  /**
   * WebSocket 재연결 시도
   */
  private async reconnectWebSocket(): Promise<void> {
    if (!this.isStreaming) {
      return; // 스트리밍 중이 아니면 재연결하지 않음
    }

    // 이미 재연결 중이면 중복 시도 방지
    if (this.isReconnecting) {
      console.log("[AudioManager] 이미 재연결 시도 중입니다.");
      return;
    }

    this.isReconnecting = true;

    try {
      await this.connectWebSocket();
      console.log("[AudioManager] WebSocket 재연결 성공");
    } catch (error) {
      console.error("[AudioManager] WebSocket 재연결 실패:", error);
      // 재연결 실패 시 일정 시간 후 다시 시도
      if (this.isStreaming) {
        this.reconnectTimer = setTimeout(() => {
          this.isReconnecting = false;
          this.reconnectWebSocket().catch((err) => {
            console.error("[AudioManager] 재연결 재시도 중 오류:", err);
          });
        }, 5000);
        return; // 타이머가 재시도하므로 여기서는 플래그를 유지
      }
    } finally {
      // 성공한 경우에만 플래그 해제 (실패 시 타이머가 재시도하므로 유지)
      if (!this.isStreaming || this.ws?.readyState === WebSocket.OPEN) {
        this.isReconnecting = false;
      }
    }
  }

  /**
   * 스트리밍 시작
   * @param target 대상 앱 ('chrome' | 'edge' | 'discord')
   */
  public async startStream(target: TargetApp): Promise<void> {
    if (this.isStreaming) {
      console.log("[AudioManager] 이미 스트리밍 중입니다. 먼저 stopStream()을 호출하세요.");
      return;
    }

    // 초기화 확인
    if (!this.isInitialized) {
      await this.init();
    }

    try {
      // 1. 프로세스 찾기
      console.log(`[AudioManager] 프로세스 찾는 중: ${target}...`);
      const pid = await onVoiceBridge.findProcess(target);

      if (pid <= 0) {
        const error = new Error(`프로세스를 찾을 수 없습니다: ${target}`);
        console.error(`[AudioManager] ${error.message}`);
        throw error;
      }

      console.log(`[AudioManager] 프로세스 발견: PID=${pid}`);

      // 2. WebSocket 연결
      await this.connectWebSocket();

      // 3. 볼륨 컨트롤러에 대상 앱 이름 설정
      if (this.volumeController) {
        this.volumeController.setTargetApp(target);
      }

      // 4. 캡처 시작
      console.log(`[AudioManager] 캡처 시작: PID=${pid}`);
      await onVoiceBridge.startCapture(pid);

      // 상태 업데이트
      this.isStreaming = true;
      this.currentTarget = target;
      this.currentPid = pid;

      console.log(`[AudioManager] ✅ 스트리밍 시작 완료: ${target} (PID: ${pid})`);
    } catch (error) {
      console.error("[AudioManager] 스트리밍 시작 실패:", error);

      // 실패 시 WebSocket 닫기 및 재연결 타이머 취소
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.isReconnecting = false;

      if (this.ws) {
        this.ws.removeAllListeners();
        if (this.ws.readyState !== WebSocket.CLOSED) {
          this.ws.close();
        }
        this.ws = null;
      }

      this.isStreaming = false;
      this.currentTarget = null;
      this.currentPid = null;

      throw error;
    }
  }

  /**
   * 스트리밍 중지
   */
  public async stopStream(): Promise<void> {
    if (!this.isStreaming) {
      console.log("[AudioManager] 스트리밍 중이 아닙니다.");
      return;
    }

    try {
      // 재연결 타이머 취소
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.isReconnecting = false;

      // 1. 캡처 중지
      console.log("[AudioManager] 캡처 중지 중...");
      await onVoiceBridge.stopCapture();

      // 2. WebSocket 연결 종료
      if (this.ws) {
        this.ws.removeAllListeners(); // 이벤트 리스너 정리
        if (this.ws.readyState !== WebSocket.CLOSED) {
          this.ws.close();
        }
        this.ws = null;
      }

      // 상태 업데이트
      this.isStreaming = false;
      const previousTarget = this.currentTarget;
      this.currentTarget = null;
      this.currentPid = null;

      console.log(`[AudioManager] ✅ 스트리밍 중지 완료: ${previousTarget}`);
    } catch (error) {
      console.error("[AudioManager] 스트리밍 중지 실패:", error);
      throw error;
    }
  }

  /**
   * 현재 상태 가져오기
   */
  public getStatus(): AudioManagerStatus {
    return {
      isStreaming: this.isStreaming,
      target: this.currentTarget || undefined,
      pid: this.currentPid || undefined,
      wsConnected: this.ws?.readyState === WebSocket.OPEN,
    };
  }

  /**
   * WebSocket URL 설정 (테스트용)
   */
  public setWebSocketUrl(url: string): void {
    this.wsUrl = url;
    console.log(`[AudioManager] WebSocket URL 변경: ${this.wsUrl}`);
  }

  /**
   * 유해 표현 감지 시 볼륨 조절 처리
   * 설정된 볼륨 레벨로 조절
   */
  private async handleHarmfulExpressionDetected(): Promise<void> {
    if (!this.volumeController) {
      console.warn("[AudioManager] VolumeController가 초기화되지 않았습니다.");
      return;
    }

    try {
      this.harmfulDetectionCount++;

      // 현재 설정된 볼륨 레벨로 조절
      const currentLevel = this.volumeController.getCurrentVolumeLevel();
      await this.volumeController.setVolumeLevel(currentLevel);

      const percent = this.volumeController.getCurrentVolumePercent();
      console.log(
        `[AudioManager] 🔊 Volume adjusted due to harmful expression (detection #${this.harmfulDetectionCount}): Level ${currentLevel} (${percent}%)`
      );
    } catch (error) {
      console.error("[AudioManager] Failed to adjust volume on harmful detection:", error);
    }
  }
}

export default AudioManager;
