/**
 * OnVoice Bridge Adapter
 *
 * electron-edge-js + C# COM wrapper 기반의 OnVoice bridge를 사용하는 어댑터
 * 기존 코드와의 호환성을 유지하는 인터페이스를 제공합니다.
 */

import { onVoiceBridge, OnVoiceBridge } from "../main/onvoiceBridge";

export interface CreateOnVoiceCaptureOptions {
  /** COM 객체 ProgID (기본값: "OnVoiceAudioBridge.OnVoiceCapture") - 새로운 bridge에서는 C#에서 처리 */
  progId?: string;
  /**
   * 프로세스 ID 찾기 방법
   * - 'edge': Edge 프로세스 자동 검색 (FindEdgeProcess)
   * - 'chrome': Chrome 프로세스 자동 검색 (FindChromeProcess)
   * - 'discord': Discord 프로세스 자동 검색 (FindDiscordProcess)
   * - number: 직접 PID 지정
   * - function: 커스텀 검색 함수 (새로운 bridge에서는 지원하지 않음)
   *
   * TODO: 새로운 bridge에서는 PID를 직접 받도록 수정 필요
   */
  findPid?: "edge" | "chrome" | "discord" | number | ((capture: any) => number);
  /** PCM 오디오 데이터 수신 콜백 (Buffer) */
  onData: (buf: Buffer) => void;
  /** 에러 콜백 (선택) */
  onError?: (err: Error) => void;
}

export interface OnVoiceCaptureHandle {
  /** 캡처 시작 */
  start(): void;
  /** 캡처 중지 */
  stop(): void;
  /** 리소스 정리 (stop + dispose) */
  dispose(): void;
  /** 원본 COM 객체 참조 (새로운 bridge에서는 사용하지 않음) */
  capture: any;
  /** 현재 캡처 상태 */
  isCapturing: boolean;
}

/**
 * OnVoice COM 객체를 생성하고 이벤트를 구독하는 함수 (새로운 bridge 사용)
 *
 * @param options 설정 옵션
 * @returns OnVoiceCaptureHandle 인스턴스
 */
export function createOnVoiceCapture(options: CreateOnVoiceCaptureOptions): OnVoiceCaptureHandle {
  const { findPid = "chrome", onData, onError } = options;

  let currentPid: number | null = null;
  let isCapturing = false;
  let isInitialized = false;

  return {
    start: (): void => {
      (async () => {
        if (isCapturing) {
          console.log("[OnVoiceBridgeAdapter] 이미 캡처 중입니다.");
          return;
        }

        try {
          // 초기화 (한 번만)
          if (!isInitialized) {
            // Note: onAudioData 콜백과 audio 이벤트가 모두 호출되므로 중복 방지
            // audio 이벤트만 사용하고 콜백은 빈 함수로 설정
            await onVoiceBridge.init((buf: Buffer) => {
              // 콜백은 사용하지 않고 audio 이벤트만 사용
              // 중복 호출 방지
            });

            // 오디오 이벤트 리스너 등록 (단일 경로로 처리)
            // Note: 중복 로그 방지를 위해 콜백과 이벤트 중 하나만 사용
            onVoiceBridge.events.on("audio", (buf: Buffer) => {
              try {
                // DEBUG: 반복 로그는 제거 (너무 많이 출력됨)
                // console.debug(`[OnVoiceBridgeAdapter] 오디오 데이터 수신: ${buf.length} bytes`);
                onData(buf);
              } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                console.error("[OnVoiceBridgeAdapter] audio 이벤트 오류:", error);
                if (onError) {
                  onError(error);
                }
              }
            });

            isInitialized = true;
            console.log("[OnVoiceBridgeAdapter] ✅ 초기화 완료");
          }

          // PID 해결
          let pid: number;
          if (typeof findPid === "number") {
            pid = findPid;
          } else {
            // TODO: 프로세스 자동 검색 구현 필요
            const error = new Error("프로세스 자동 검색은 아직 구현되지 않았습니다. PID를 직접 지정하세요.");
            console.error(`[OnVoiceBridgeAdapter] ${error.message}`);
            if (onError) {
              onError(error);
            }
            return;
          }

          if (pid <= 0) {
            const error = new Error(`프로세스를 찾을 수 없습니다. (PID: ${pid})`);
            console.error(`[OnVoiceBridgeAdapter] ${error.message}`);
            if (onError) {
              onError(error);
            }
            return;
          }

          currentPid = pid;
          await onVoiceBridge.startCapture(pid);
          isCapturing = true;
          console.log(`[OnVoiceBridgeAdapter] 캡처 시작 (PID: ${pid})`);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error("[OnVoiceBridgeAdapter] StartCapture 실패:", error);
          isCapturing = false;
          if (onError) {
            onError(error);
          }
        }
      })().catch((err) => {
        console.error("[OnVoiceBridgeAdapter] start() 오류:", err);
        if (onError) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    stop: (): void => {
      (async () => {
        if (!isCapturing) {
          return;
        }

        try {
          await onVoiceBridge.stopCapture();
          isCapturing = false;
          console.log("[OnVoiceBridgeAdapter] 캡처 중지");
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error("[OnVoiceBridgeAdapter] StopCapture 실패:", error);
          if (onError) {
            onError(error);
          }
        }
      })().catch((err) => {
        console.error("[OnVoiceBridgeAdapter] stop() 오류:", err);
      });
    },
    dispose: (): void => {
      (async () => {
        // 캡처 중지
        if (isCapturing) {
          try {
            await onVoiceBridge.stopCapture();
            isCapturing = false;
          } catch (err) {
            console.error("[OnVoiceBridgeAdapter] dispose 중 stopCapture 오류:", err);
          }
        }

        // 이벤트 리스너 제거
        if (isInitialized) {
          onVoiceBridge.events.removeAllListeners("audio");
          isInitialized = false;
        }

        console.log("[OnVoiceBridgeAdapter] 리소스 정리 완료");
      })().catch((err) => {
        console.error("[OnVoiceBridgeAdapter] dispose() 오류:", err);
      });
    },
    capture: null, // 새로운 bridge에서는 사용하지 않음
    get isCapturing() {
      return isCapturing;
    },
  };
}
