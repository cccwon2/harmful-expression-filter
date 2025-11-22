/**
 * OnVoice 서비스 (Electron Main Process)
 *
 * OnVoice COM 브리지를 사용하여 프로세스별 오디오 캡처를 관리하고,
 * STT 및 유해 표현 분석을 수행합니다.
 *
 * 현재는 Deepgram WebSocket을 직접 사용하거나, 서버 WebSocket을 통해 STT를 수행할 수 있습니다.
 */

import { BrowserWindow } from "electron";
import WebSocket from "ws";
import { createOnVoiceCapture, OnVoiceCaptureHandle } from "./onVoiceBridgeAdapter";
import { sendTextForAnalysis, AnalysisResult } from "../utils/harmfulAnalysisClient";
import { IPC_CHANNELS } from "../ipc/channels";
import { findProcessByType } from "../utils/processFinder";
import { VolumeController } from "./volumeController";
import { getVolumeLevel, setVolumeLevel as saveVolumeLevel } from "../store";

export interface OnVoiceServiceOptions {
  /** Deepgram API 키 (Deepgram WebSocket 사용 시) */
  deepgramApiKey?: string;
  /** 서버 WebSocket URL (서버 STT 사용 시, 예: "ws://127.0.0.1:8000/ws/audio") */
  serverWebSocketUrl?: string;
  /** 유해 표현 분석 사용 여부 (기본값: true) */
  enableHarmfulAnalysis?: boolean;
  /** 유해 표현 감지 시 볼륨 조절 활성화 (기본값: true) */
  enableVolumeControl?: boolean;
  /** 유해 표현 감지 시 볼륨 복원 대기 시간 (밀리초, 기본값: 3000) */
  volumeRestoreDelayMs?: number;
}

export class OnVoiceService {
  private isMonitoring = false;
  private captureHandle: OnVoiceCaptureHandle | null = null;
  private deepgramWs: WebSocket | null = null;
  private serverWs: WebSocket | null = null;
  private windows: Set<BrowserWindow> = new Set();
  private options: Required<OnVoiceServiceOptions>;
  private targetPid: "edge" | "chrome" | "discord" | number = "chrome";
  private volumeController: VolumeController | null = null;
  private harmfulDetectionCount: number = 0; // 유해 표현 감지 횟수 추적

  constructor(initialWindow: BrowserWindow | null, options: OnVoiceServiceOptions = {}) {
    this.options = {
      deepgramApiKey: options.deepgramApiKey || process.env.DEEPGRAM_API_KEY || "",
      serverWebSocketUrl: options.serverWebSocketUrl || "ws://127.0.0.1:8000/ws/audio",
      enableHarmfulAnalysis: options.enableHarmfulAnalysis !== false,
      enableVolumeControl: options.enableVolumeControl !== false,
      volumeRestoreDelayMs: options.volumeRestoreDelayMs || 3000,
    };

    // 볼륨 조절 활성화 시 VolumeController 초기화
    if (this.options.enableVolumeControl) {
      this.volumeController = new VolumeController();
      // 저장된 볼륨 레벨 로드 및 설정
      const savedLevel = getVolumeLevel();
      this.volumeController.setVolumeLevel(savedLevel).catch((err) => {
        console.error("[OnVoiceService] Failed to load saved volume level:", err);
      });
      console.log(`[OnVoiceService] VolumeController initialized with level ${savedLevel} (${savedLevel * 10}%)`);
    }

    if (initialWindow) {
      this.windows.add(initialWindow);
    }
  }

  /**
   * 윈도우 추가 (여러 윈도우에서 상태 수신 가능)
   */
  addWindow(window: BrowserWindow): void {
    this.windows.add(window);
    console.log(`[OnVoiceService] Window added (total: ${this.windows.size})`);
    this.broadcastStatus();
  }

  /**
   * 윈도우 제거
   */
  removeWindow(window: BrowserWindow): void {
    this.windows.delete(window);
    console.log(`[OnVoiceService] Window removed (total: ${this.windows.size})`);
  }

  /**
   * 모니터링 시작
   *
   * @param target 캡처할 프로세스 ('edge', 'chrome', 'discord', 또는 PID)
   */
  async startMonitoring(target: "edge" | "chrome" | "discord" | number = "chrome"): Promise<void> {
    if (this.isMonitoring) {
      console.log("[OnVoiceService] 이미 모니터링 중입니다.");
      return;
    }

    this.targetPid = target;

    try {
      // 프로세스 PID 해결
      const pid = await findProcessByType(target);
      if (!pid || pid <= 0) {
        const error = new Error(`프로세스를 찾을 수 없습니다. (target: ${target})`);
        console.error(`[OnVoiceService] ${error.message}`);
        throw error;
      }

      console.log(`[OnVoiceService] 프로세스 PID: ${pid} (target: ${target})`);

      // WebSocket 연결 (Deepgram 또는 서버)
      if (this.options.deepgramApiKey) {
        await this.connectDeepgram();
      } else {
        await this.connectServer();
      }

      // OnVoice 브리지 생성 및 시작 (새로운 bridge adapter 사용)
      this.captureHandle = createOnVoiceCapture({
        findPid: pid, // 숫자 PID로 전달
        onData: (buf: Buffer) => {
          // DEBUG: 반복 로그 제거
          // console.log(`[OnVoiceService] 오디오 데이터 수신 (adapter): ${buf.length} bytes`);
          this.handleAudioData(buf);
        },
        onError: (err: Error) => {
          console.error("[OnVoiceService] 캡처 오류:", err);
          this.stopMonitoring();
        },
      });

      this.captureHandle.start();
      this.isMonitoring = true;
      console.log("[OnVoiceService] ✅ 모니터링 시작 완료");
      this.broadcastStatus();
    } catch (err) {
      console.error("[OnVoiceService] 모니터링 시작 실패:", err);
      this.stopMonitoring();
      throw err;
    }
  }

  /**
   * 모니터링 중지
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    console.log("[OnVoiceService] 모니터링 중지 중...");

    // 캡처 중지
    if (this.captureHandle) {
      this.captureHandle.dispose();
      this.captureHandle = null;
    }

    // WebSocket 연결 종료
    if (this.deepgramWs) {
      this.deepgramWs.close();
      this.deepgramWs = null;
    }

    if (this.serverWs) {
      this.serverWs.close();
      this.serverWs = null;
    }

    this.harmfulDetectionCount = 0;
    this.isMonitoring = false;
    console.log("[OnVoiceService] 모니터링 중지 완료");
    this.broadcastStatus();
  }

  /**
   * Deepgram WebSocket 연결
   */
  private async connectDeepgram(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = "wss://api.deepgram.com/v1/listen";
      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Token ${this.options.deepgramApiKey}`,
        },
      });

      ws.on("open", () => {
        console.log("[OnVoiceService] Deepgram WebSocket 연결 성공");

        // 설정 전송
        const config = {
          type: "Settings",
          channels: 1,
          sample_rate: 16000,
          encoding: "linear16",
          language: "ko",
          model: "nova-2",
          punctuate: true,
          interim_results: true,
        };

        ws.send(JSON.stringify(config));
        this.deepgramWs = ws;
        resolve();
      });

      ws.on("message", (data: Buffer) => {
        this.handleDeepgramMessage(data);
      });

      ws.on("error", (err) => {
        console.error("[OnVoiceService] Deepgram WebSocket 오류:", err);
        reject(err);
      });

      ws.on("close", () => {
        console.log("[OnVoiceService] Deepgram WebSocket 연결 종료");
        if (this.isMonitoring) {
          // 재연결 시도
          setTimeout(() => {
            this.connectDeepgram().catch(console.error);
          }, 1000);
        }
      });
    });
  }

  /**
   * 서버 WebSocket 연결
   */
  private async connectServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.options.serverWebSocketUrl);

      ws.on("open", () => {
        console.log("[OnVoiceService] 서버 WebSocket 연결 성공");
        this.serverWs = ws;
        resolve();
      });

      ws.on("message", (data: Buffer) => {
        // DEBUG: 반복 로그 제거 (버퍼링 메시지가 너무 많이 출력됨)
        // console.log(`[OnVoiceService] 서버로부터 메시지 수신: ${data.length} bytes`);
        this.handleServerMessage(data);
      });

      ws.on("error", (err) => {
        console.error("[OnVoiceService] 서버 WebSocket 오류:", err);
        reject(err);
      });

      ws.on("close", () => {
        console.log("[OnVoiceService] 서버 WebSocket 연결 종료");
        if (this.isMonitoring) {
          // 재연결 시도
          setTimeout(() => {
            this.connectServer().catch(console.error);
          }, 1000);
        }
      });
    });
  }

  /**
   * 오디오 데이터 처리 (WebSocket으로 전송)
   */
  private static _audioDataCallCount = 0;

  private handleAudioData(buf: Buffer): void {
    const callId = ++OnVoiceService._audioDataCallCount;
    const shouldLog = callId <= 3 || callId % 100 === 0;

    if (shouldLog) {
      console.log(`[OnVoiceService] 🎵 handleAudioData 호출됨! (callId=${callId}, size=${buf.length} bytes)`);
    }

    try {
      if (this.deepgramWs && this.deepgramWs.readyState === WebSocket.OPEN) {
        if (shouldLog) {
          console.log(`[OnVoiceService] 📤 Deepgram WebSocket으로 전송 (callId=${callId})`);
        }
        this.deepgramWs.send(buf);
        if (shouldLog) {
          console.log(`[OnVoiceService] ✅ Deepgram 전송 완료 (callId=${callId})`);
        }
      } else if (this.serverWs && this.serverWs.readyState === WebSocket.OPEN) {
        if (shouldLog) {
          console.log(`[OnVoiceService] 📤 서버 WebSocket으로 전송 (callId=${callId})`);
        }
        this.serverWs.send(buf);
        if (shouldLog) {
          console.log(`[OnVoiceService] ✅ 서버 전송 완료 (callId=${callId})`);
        }
      } else {
        // 연결 문제는 경고로 출력
        if (shouldLog) {
          console.warn(
            `[OnVoiceService] ⚠️ WebSocket 연결이 없어 오디오 데이터를 전송할 수 없습니다. (callId=${callId})`
          );
          console.warn(
            `[OnVoiceService] Deepgram 상태: ${this.deepgramWs?.readyState}, 서버 상태: ${this.serverWs?.readyState}`
          );
        }
      }
    } catch (err) {
      console.error(`[OnVoiceService] ❌ WebSocket 전송 오류 (callId=${callId}):`, err);
    }
  }

  /**
   * Deepgram 메시지 처리 (STT 결과)
   */
  private handleDeepgramMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === "Results") {
        const transcript = message.channel?.alternatives?.[0]?.transcript;
        const isFinal = message.is_final;

        if (transcript && transcript.trim()) {
          console.log(`[OnVoiceService] [STT${isFinal ? "" : "-interim"}] ${transcript}`);

          // 최종 결과만 분석
          if (isFinal && this.options.enableHarmfulAnalysis) {
            this.analyzeText(transcript);
          }
        }
      }
    } catch (err) {
      console.error("[OnVoiceService] Deepgram 메시지 파싱 오류:", err);
    }
  }

  /**
   * 서버 메시지 처리 (STT + 분석 결과)
   */
  private handleServerMessage(data: Buffer): void {
    try {
      const messageStr = data.toString();
      const message = JSON.parse(messageStr);

      // 서버에서 이미 STT + 분석이 완료된 경우
      // 서버 응답 형식: status="ok", text, is_harmful, confidence 등
      if (message.status === "ok" && message.text) {
        const text = message.text;
        const isHarmful = message.is_harmful === 1 || message.is_harmful === true;
        const confidence = message.confidence || 0;
        const rawText = message.raw_text || text;

        if (text && text.trim()) {
          console.log(`[OnVoiceService] [STT] ${text} (confidence: ${confidence.toFixed(2)})`);

          if (isHarmful) {
            // 서버에서 키워드 정보를 제공하지 않으므로, 텍스트 전체를 사용
            const matchedKeywords = message.matched_keywords || [rawText];
            console.warn(
              `[OnVoiceService] 🚨 유해 표현 감지 (confidence: ${confidence.toFixed(2)}): ${matchedKeywords.join(", ")}`
            );
            this.broadcastHarmfulDetection(text, matchedKeywords);
          }
        }
      } else if (message.status === "buffering") {
        // 버퍼링 메시지는 DEBUG 레벨로만 출력 (너무 많이 출력됨)
        // console.debug(`[OnVoiceService] 서버 버퍼링 중... (size: ${message.size || 'unknown'})`);
      } else if (message.status === "connected") {
        console.log(`[OnVoiceService] ✅ 서버 연결 확인: ${message.message || ""}`);
      } else if (message.status === "error") {
        console.error(`[OnVoiceService] ❌ 서버 오류: ${message.detail || message.message || "Unknown error"}`);
      }
    } catch (err) {
      console.error("[OnVoiceService] 서버 메시지 파싱 오류:", err);
      console.error("[OnVoiceService] 원본 데이터:", data.toString());
    }
  }

  /**
   * 텍스트 유해성 분석
   */
  private async analyzeText(text: string): Promise<void> {
    try {
      const result = await sendTextForAnalysis(text);

      if ("error" in result) {
        console.error("[OnVoiceService] 분석 오류:", result.message);
        return;
      }

      if (result.isHarmful) {
        console.warn(`[OnVoiceService] 🚨 유해 표현 감지: ${result.matchedKeywords.join(", ")}`);
        this.broadcastHarmfulDetection(text, result.matchedKeywords);
      }
    } catch (err) {
      console.error("[OnVoiceService] 텍스트 분석 실패:", err);
    }
  }

  /**
   * 상태 브로드캐스트
   */
  private broadcastStatus(): void {
    const status = {
      isMonitoring: this.isMonitoring,
      targetPid: this.targetPid,
    };

    this.windows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.AUDIO_STATUS, status);
      }
    });
  }

  /**
   * 유해 표현 감지 브로드캐스트
   */
  private broadcastHarmfulDetection(text: string, keywords: string[]): void {
    const payload = {
      text,
      keywords,
      timestamp: Date.now(),
    };

    this.windows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.AUDIO_HARMFUL_DETECTED, payload);
      }
    });

    // 볼륨 조절 활성화 시 볼륨 낮추기
    if (this.options.enableVolumeControl && this.volumeController) {
      this.handleHarmfulExpressionDetected();
    }
  }

  /**
   * 유해 표현 감지 시 볼륨 조절 처리
   * 설정된 볼륨 레벨로 조절
   */
  private async handleHarmfulExpressionDetected(): Promise<void> {
    if (!this.volumeController) {
      return;
    }

    try {
      this.harmfulDetectionCount++;

      // 현재 설정된 볼륨 레벨로 조절
      const currentLevel = this.volumeController.getCurrentVolumeLevel();
      await this.volumeController.setVolumeLevel(currentLevel);

      const percent = this.volumeController.getCurrentVolumePercent();
      console.log(
        `[OnVoiceService] 🔊 Volume adjusted due to harmful expression (detection #${this.harmfulDetectionCount}): Level ${currentLevel} (${percent}%)`
      );
    } catch (error) {
      console.error("[OnVoiceService] Failed to adjust volume on harmful detection:", error);
    }
  }

  /**
   * 현재 모니터링 상태
   */
  getStatus() {
    return {
      isMonitoring: this.isMonitoring,
      targetPid: this.targetPid,
      volumeLevel: this.volumeController?.getCurrentVolumeLevel() ?? null,
      volumePercent: this.volumeController?.getCurrentVolumePercent() ?? null,
    };
  }

  /**
   * 볼륨 레벨 설정 (0~9: 0% = 무소음, 9 = 90%)
   */
  async setVolumeLevel(level: number): Promise<boolean> {
    if (!this.volumeController) {
      console.warn("[OnVoiceService] VolumeController is not initialized");
      return false;
    }

    try {
      await this.volumeController.setVolumeLevel(level);
      // 설정 저장
      saveVolumeLevel(level);
      console.log(`[OnVoiceService] Volume level saved: ${level} (${level * 10}%)`);
      return true;
    } catch (error) {
      console.error("[OnVoiceService] Failed to set volume level:", error);
      return false;
    }
  }
}

// 전역 인스턴스 (선택적)
let globalOnVoiceService: OnVoiceService | null = null;

export function getOnVoiceService(): OnVoiceService | null {
  return globalOnVoiceService;
}

export function setOnVoiceService(service: OnVoiceService | null): void {
  globalOnVoiceService = service;
}
