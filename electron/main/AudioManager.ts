import WebSocket from "ws";
import { onVoiceBridge } from "./onVoiceBridge";
import { VolumeController } from "../audio/volumeController";
import { AppVolumeController } from "../audio/appVolumeController";
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
  private appVolumeController: AppVolumeController;
  private harmfulDetectionCount: number = 0;
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private audioTimestamps: number[] = []; // 오디오 캡처 타임스탬프 (최근 10개만 유지)
  private lastProcessedText: string = ""; // 중간 결과 중복 방지용

  private constructor() {
    this.wsUrl = process.env.SERVER_WS_URL || "ws://localhost:8000/ws/audio";
    console.log(`[AudioManager] WebSocket URL: ${this.wsUrl}`);

    // AppVolumeController를 생성하고 VolumeController에 주입
    this.appVolumeController = new AppVolumeController();
    this.volumeController = new VolumeController(this.appVolumeController);
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
      await onVoiceBridge.init((pcm: Buffer, timestamp?: number) => {
        this.handleAudioData(pcm, timestamp);
      });
      this.isInitialized = true;
      
      // Bridge 초기화 완료 후 AppVolumeController 모니터링 시작
      // 이렇게 하면 Bridge가 준비된 후에만 세션 조회가 시작됨
      this.appVolumeController.ensureMonitoringStarted();
      
      console.log("[AudioManager] ✅ 초기화 완료");
    } catch (error: any) {
      // 개발 모드에서는 에러를 무시하고 계속 진행
      const isDev = !require('electron').app.isPackaged;
      if (isDev) {
        console.warn("[AudioManager] ⚠️ 개발 모드: Bridge 초기화 실패를 무시합니다. (오디오 필터링 비활성화)");
        this.isInitialized = false; // 초기화되지 않음으로 표시
        // 개발 모드에서도 모니터링은 시작 (Bridge 없이도 캐시만 유지)
        this.appVolumeController.ensureMonitoringStarted();
        return; // 에러를 throw하지 않고 계속 진행
      }
      console.error("[AudioManager] 초기화 실패:", error);
      throw error;
    }
  }

  private handleAudioData(pcm: Buffer, captureTimestamp?: number): void {
    if (!this.isStreaming) {
      return;
    }

    // 비동기로 처리하여 COM 이벤트 스레드가 블로킹되지 않도록 함
    setImmediate(() => {
      // 서버 STT로만 동작: WebSocket 전송
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          // 오디오 캡처 시간 기록 (전체 파이프라인 지연 측정용)
          const now = Date.now();
          const captureTime = captureTimestamp || now;
          
          if (captureTimestamp) {
            const latency = now - captureTimestamp;
            // COM 브리지에서 JavaScript로 전달되는 지연 시간 측정
            // 100ms 이상 지연 시 경고 (정상적인 범위: 20-50ms)
            if (latency > 100) {
                 console.log(`[AudioManager] [Latency] High Latency: ${latency}ms`);
            }
          }

          // WebSocket.send는 동기적으로 버퍼를 복사하므로 빠르게 처리됨
          this.ws.send(pcm);
          // 타임스탬프를 메타데이터로 저장 (최근 10개만 유지)
          if (!this.audioTimestamps) {
            this.audioTimestamps = [];
          }
          this.audioTimestamps.push(captureTime);
          if (this.audioTimestamps.length > 10) {
            this.audioTimestamps.shift();
          }
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
        // WebSocket이 CONNECTING 또는 OPEN 상태일 때만 close() 호출
        // CLOSING 또는 CLOSED 상태에서는 close() 호출하지 않음
        const state = this.ws.readyState;
        if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) {
          try {
            this.ws.close();
          } catch (err) {
            // close() 호출 중 오류 발생 시 무시 (이미 닫혔을 수 있음)
            console.warn("[AudioManager] WebSocket close() 오류 (무시됨):", err);
          }
        }
      }

      console.log(`[AudioManager] WebSocket 연결 시도: ${this.wsUrl}`);
      
      let timeoutCleared = false;
      let resolvedOrRejected = false;
      
      // 연결 타임아웃 설정 (10초)
      const timeout = setTimeout(() => {
        if (timeoutCleared || resolvedOrRejected) return;
        
        console.error("[AudioManager] WebSocket 연결 타임아웃 (10초)");
        resolvedOrRejected = true;
        
        if (this.ws) {
          // 리스너만 제거하고 close()는 호출하지 않음
          // close()는 WebSocket이 자동으로 처리하거나 close 이벤트에서 처리됨
          try {
            this.ws.removeAllListeners();
          } catch (err) {
            // 무시
          }
          // WebSocket을 null로 설정하여 더 이상 사용하지 않음을 표시
          this.ws = null;
        }
        
        reject(new Error("WebSocket connection timeout"));
      }, 10000);

      this.ws = new WebSocket(this.wsUrl);

      this.ws.on("open", () => {
        if (resolvedOrRejected) return;
        timeoutCleared = true;
        clearTimeout(timeout);
        console.log("[AudioManager] ✅ WebSocket 연결 성공");
        // 연결 성공 시 재연결 시도 횟수 초기화
        this.reconnectAttempts = 0;
        resolvedOrRejected = true;
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
              if (!text || !text.trim()) return;
              
              // 중복 필터링: 같은 텍스트가 연속으로 오는 경우 무시
              const isHarmful = parsed.is_harmful === 1 || parsed.is_harmful === true;
              const aiChecked = parsed.ai_checked === true;
              
              // AI 판별이 완료된 경우에만 처리 (중복 방지)
              // 서버에서 STT 결과를 먼저 보내고, AI 판별 후 다시 보내므로
              // ai_checked가 true인 경우만 로그 출력 및 볼륨 조절
              if (!aiChecked) {
                // AI 판별 전 초기 STT 결과는 무시 (중복 방지)
                return;
              }
              
              // 중간 결과(is_final=false)도 처리하되, 중복 방지
              const isFinal = parsed.is_final !== false; // 기본값은 true (하위 호환성)
              if (!isFinal && text === this.lastProcessedText) {
                // 중간 결과에서 같은 텍스트가 반복되면 무시
                return;
              }
              if (!isFinal) {
                this.lastProcessedText = text; // 중간 결과 텍스트 저장
              } else {
                this.lastProcessedText = ""; // 최종 결과면 초기화
              }
              
              // 전체 파이프라인 시간 측정 (오디오 캡처부터 결과 수신까지)
              const receiveTime = Date.now();
              let totalLatency = 0;
              if (this.audioTimestamps.length > 0) {
                // 가장 오래된 오디오 캡처 시간 사용 (더 정확한 측정)
                const oldestCaptureTime = this.audioTimestamps[0];
                totalLatency = (receiveTime - oldestCaptureTime) / 1000; // 초 단위
                // 사용한 타임스탬프 제거
                this.audioTimestamps = [];
              }
              
              // AI 판별 완료 후 텍스트 표시 (유해/비유해 구분 없이)
              const confidenceInfo = parsed.confidence 
                ? ` (신뢰도: ${(parsed.confidence * 100).toFixed(1)}%)`
                : "";
              const latencyInfo = totalLatency > 0 
                ? ` [전체 지연: ${totalLatency.toFixed(3)}초]`
                : "";
              console.log(`[AudioManager] [STT] "${text}"${confidenceInfo}${latencyInfo}`);
              
              // 유해 표현인 경우 추가 경고 표시 및 볼륨 조절
              if (isHarmful) {
                // 🔇 키워드 표시 완전 제거 - AI 모델만 사용
                // matchedKeywords는 서버에서 보내는 정보이지만, 키워드 기반이 아닌 AI 감지 결과임
                const aiInfo = parsed.ai_detection?.model 
                  ? `(${parsed.ai_detection.model} 모델 감지, 신뢰도: ${(parsed.ai_detection.confidence * 100).toFixed(1)}%)`
                  : "(AI 모델 감지)";
                console.warn(`[AudioManager] 🚨 유해 표현 감지! "${text}" ${aiInfo}`);
                // ⚡️ 볼륨 조절을 비동기로 실행 (블로킹 방지)
                // setImmediate를 사용하여 WebSocket 메시지 처리를 블로킹하지 않음
                setImmediate(() => {
                  this.handleHarmfulExpressionDetected().catch((err) => {
                    console.error("[AudioManager] 볼륨 조절 중 오류:", err);
                  });
                });
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
        if (resolvedOrRejected) return;
        timeoutCleared = true;
        clearTimeout(timeout);
        console.error("[AudioManager] WebSocket 오류:", error);
        this.reconnectAttempts++;
        resolvedOrRejected = true;
        
        if (this.ws) {
          try {
            this.ws.removeAllListeners();
          } catch (err) {
            // 무시
          }
          // close() 호출하지 않고 null로 설정
          this.ws = null;
        }
        
        reject(error);
      });

      this.ws.on("close", (code, reason) => {
        timeoutCleared = true;
        clearTimeout(timeout);
        console.log(`[AudioManager] WebSocket 연결 종료 (code: ${code}, reason: ${reason || 'none'})`);
        
        // 타임아웃이나 에러로 이미 reject된 경우가 아니면 처리
        if (!resolvedOrRejected) {
          resolvedOrRejected = true;
          // 연결이 닫혔지만 아직 resolve/reject가 호출되지 않은 경우
          reject(new Error(`WebSocket closed before connection established: code=${code}`));
        }
        
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
      
      // 트레이 메뉴 업데이트 (순환 의존성 방지를 위해 동적 import)
      try {
        const { getTrayAudioUpdateCallback } = require("../tray");
        const trayUpdateCallback = getTrayAudioUpdateCallback();
        if (trayUpdateCallback && typeof trayUpdateCallback === "function") {
          trayUpdateCallback();
        }
      } catch (err) {
        // 트레이 업데이트 실패는 치명적이지 않음
      }
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  public async stopStream(): Promise<void> {
    if (!this.isStreaming) return;
    await onVoiceBridge.stopCapture();
    if (this.ws) {
      // 재연결 타이머 취소
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.isReconnecting = false;
      
      // WebSocket 상태 확인 후 안전하게 close()
      const state = this.ws.readyState;
      if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) {
        try {
          this.ws.removeAllListeners();
          this.ws.close();
        } catch (err) {
          console.warn("[AudioManager] stopStream에서 WebSocket close() 오류 (무시됨):", err);
        }
      }
      this.ws = null;
    }
    this.isStreaming = false;
    this.currentTarget = null;
    this.currentPid = null;
    // 재연결 시도 횟수 초기화 (다음 스트리밍 시도 시)
    this.reconnectAttempts = 0;
    
    // 트레이 메뉴 업데이트 (순환 의존성 방지를 위해 동적 import)
    try {
      const { getTrayAudioUpdateCallback } = require("../tray");
      const trayUpdateCallback = getTrayAudioUpdateCallback();
      if (trayUpdateCallback && typeof trayUpdateCallback === "function") {
        trayUpdateCallback();
      }
    } catch (err) {
      // 트레이 업데이트 실패는 치명적이지 않음
    }
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

    const volumeControlStartTime = Date.now();

    try {
      this.harmfulDetectionCount++;

      // 타겟 앱이 설정되지 않았다면 현재 타겟으로 설정
      // currentTarget이 없어도 볼륨 조절 시도 (VolumeController가 자동으로 처리)
      if (this.currentTarget) {
        this.volumeController.setTargetApp(this.currentTarget);
        console.log(`[AudioManager] 타겟 앱 설정: ${this.currentTarget}`);
      } else {
        // currentTarget이 없으면 기본 타겟 앱 설정 시도 (chrome, edge, discord 중 하나)
        // 또는 VolumeController가 자동으로 처리하도록 null 전달
        console.warn("[AudioManager] 현재 타겟 앱이 설정되지 않았습니다. 볼륨 조절을 시도합니다.");
      }

      // 저장소에서 설정된 볼륨 레벨 가져오기
      const savedVolumeLevel = getVolumeLevel();
      console.log(`[AudioManager] 🔊 유해 표현 감지! 볼륨 조절: ${savedVolumeLevel} (${savedVolumeLevel * 10}%)`);

      await this.volumeController.setVolumeLevel(savedVolumeLevel);
      
      const volumeControlElapsed = Date.now() - volumeControlStartTime;
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [AudioManager] ⏱️ 볼륨 조절 완료 (총 소요 시간: ${volumeControlElapsed}ms)`);
    } catch (error) {
      const volumeControlElapsed = Date.now() - volumeControlStartTime;
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] [AudioManager] 유해 표현 처리 중 오류 (${volumeControlElapsed}ms):`, error);
    }
  }
}

export default AudioManager;
