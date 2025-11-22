/**
 * OnVoice Electron Main Bridge Module
 */
import path from "node:path";
import { app } from "electron"; // app.isPackaged 확인용
import { EventEmitter } from "events";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const edge = require("electron-edge-js");

type EdgeCallback = (error: Error | null, result?: any) => void;
type EdgeFunc = (payload: any, callback: EdgeCallback) => void;

export interface OCRResult {
  ok: boolean;
  text?: string;
  isHarmful?: boolean;
  matchedKeywords?: string[];
  confidence?: number;
  blurredImage?: Buffer;
  error?: string;
}

export interface OnVoiceBridge {
  events: EventEmitter;
  init(onAudioData: (pcm: Buffer) => void): Promise<void>;
  findProcess(target: "chrome" | "edge" | "discord"): Promise<number>;
  startCapture(pid: number): Promise<void>;
  stopCapture(): Promise<void>;
  performOCR(imageBuffer: Buffer): Promise<OCRResult>;
  performOCRAndAnalyze(
    imageBuffer: Buffer,
    roi?: { x: number; y: number; width: number; height: number }
  ): Promise<OCRResult>;
}

const events = new EventEmitter();

let bridgeFunc: EdgeFunc | null = null;
let initialized = false;

function getBridgeFunc(): EdgeFunc {
  if (bridgeFunc) return bridgeFunc;

  // 🛠️ DLL 경로 전략:
  // 1. 개발 모드: dist-electron/main/../../dotnet/... (프로젝트 루트의 dotnet 폴더 참조 or 복사된 폴더)
  // 2. 배포 모드(Production): resources/dotnet/... (electron-builder의 extraResources 설정 필요)

  let assemblyFile: string;

  if (app.isPackaged) {
    // 프로덕션: resources/dotnet/OnVoiceComBridge.dll
    assemblyFile = path.join(process.resourcesPath, "dotnet", "OnVoiceComBridge.dll");
  } else {
    // 개발: dist-electron/dotnet/OnVoiceComBridge.dll (copy:dll 스크립트 의존)
    // 현재 파일 위치: dist-electron/main/onVoiceBridge.js
    assemblyFile = path.join(__dirname, "..", "dotnet", "OnVoiceComBridge.dll");
  }

  // 디버깅용 경로 출력
  console.log(`[OnVoiceBridge] Loading DLL from: ${assemblyFile}`);

  try {
    bridgeFunc = edge.func({
      assemblyFile,
      typeName: "OnVoiceComBridge.Startup",
      methodName: "Invoke",
    });
  } catch (e) {
    console.error(`[OnVoiceBridge] ❌ DLL 로드 실패. 경로를 확인하세요: ${assemblyFile}`, e);
    throw e;
  }

  return bridgeFunc!;
}

function callBridge(payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const func = getBridgeFunc();
      func(payload, (err: Error | null, result?: any) => {
        if (err) return reject(err);
        if (result && result.ok === false) {
          // C# 내부 로직 에러 처리
          return reject(new Error(result.error || "Unknown C# Error"));
        }
        resolve(result || {});
      });
    } catch (e) {
      reject(e);
    }
  });
}

export const onVoiceBridge: OnVoiceBridge = {
  events,

  async init(onAudioData: (pcm: Buffer) => void): Promise<void> {
    if (initialized) {
      console.log("[OnVoiceBridge] 이미 초기화되었습니다. 새로운 콜백은 무시됩니다.");
      return;
    }

    if (typeof onAudioData !== "function") {
      throw new Error("onAudioData는 함수여야 합니다.");
    }

    await callBridge({
      command: "init",
      // C# -> Node.js 역방향 콜백
      onAudioData: function (msg: any, cb: EdgeCallback) {
        // 로깅 스로틀링 (너무 많은 로그 방지)
        const callId = Math.floor(Math.random() * 10000);
        const shouldLog = callId % 200 === 0; // 약 0.5% 확률로만 로그

        try {
          if (msg && msg.type === "audio" && msg.data) {
            // Buffer 변환
            const buf = Buffer.from(msg.data);

            if (shouldLog) {
              console.log(`[AudioStream] 🎵 ${buf.length} bytes received.`);
            }

            // 1. 이벤트 방식 (옵션)
            events.emit("audio", buf);

            // 2. 직접 콜백 호출
            onAudioData(buf);
          }

          // ✅ C# Task 완료 신호 전송 (필수)
          cb(null, { ok: true });
        } catch (e: any) {
          console.error(`[OnVoiceBridge] Callback Error:`, e);
          // 에러가 나도 C# 쪽 스레드가 멈추지 않게 성공으로 응답
          cb(null, { ok: false });
        }
      },
    });

    initialized = true;
    console.log("[OnVoiceBridge] 초기화 완료");
  },

  // 🔍 프로세스 찾기 기능 추가
  async findProcess(target: "chrome" | "edge" | "discord"): Promise<number> {
    console.log(`[OnVoiceBridge] 찾는 중: ${target}...`);
    const result = await callBridge({ command: "find", target });

    // result = { ok: true, pid: 1234 } 또는 { ok: false, error: "..." }
    if (!result || typeof result.pid !== "number") {
      const error = new Error(`프로세스를 찾을 수 없습니다: ${target}`);
      console.error(`[OnVoiceBridge] ${error.message}`);
      throw error;
    }

    const pid = result.pid;
    console.log(`[OnVoiceBridge] ${target} PID 발견: ${pid}`);
    return pid;
  },

  async startCapture(pid: number): Promise<void> {
    if (!initialized) {
      throw new Error("초기화되지 않았습니다. 먼저 init()을 호출하세요.");
    }

    if (typeof pid !== "number" || pid <= 0 || !Number.isInteger(pid)) {
      throw new Error(`유효하지 않은 PID: ${pid}. PID는 양의 정수여야 합니다.`);
    }

    console.log(`[OnVoiceBridge] 캡처 시작 요청: PID=${pid}`);
    try {
      await callBridge({ command: "start", pid });
      console.log(`[OnVoiceBridge] 캡처 시작됨`);
    } catch (error) {
      console.error(`[OnVoiceBridge] 캡처 시작 실패: PID=${pid}`, error);
      throw error;
    }
  },

  async stopCapture(): Promise<void> {
    if (!initialized) {
      console.warn("[OnVoiceBridge] 초기화되지 않았습니다. stopCapture를 건너뜁니다.");
      return;
    }

    console.log(`[OnVoiceBridge] 캡처 중지 요청`);
    try {
      await callBridge({ command: "stop" });
      console.log(`[OnVoiceBridge] 캡처 중지됨`);
    } catch (error) {
      console.error(`[OnVoiceBridge] 캡처 중지 실패:`, error);
      throw error;
    }
  },

  /**
   * Windows OCR 수행 (텍스트 추출 + 유해성 검사)
   */
  async performOCR(imageBuffer: Buffer): Promise<OCRResult> {
    try {
      console.log(`[OnVoiceBridge] OCR 요청: 이미지 크기 ${imageBuffer.length} bytes`);

      // Buffer를 직접 전달 (electron-edge-js가 자동으로 byte[]로 변환)
      const result = await callBridge({
        command: "ocr",
        imageData: imageBuffer,
      });

      if (!result || result.ok === false) {
        return {
          ok: false,
          error: result?.error || "OCR 실패",
        };
      }

      return {
        ok: true,
        text: result.text || "",
        isHarmful: result.isHarmful || false,
        matchedKeywords: result.matchedKeywords || [],
        confidence: result.confidence || 0,
      };
    } catch (error: any) {
      console.error(`[OnVoiceBridge] OCR 오류:`, error);
      return {
        ok: false,
        error: error.message || "OCR 처리 중 오류 발생",
      };
    }
  },

  /**
   * Windows OCR 수행 + 블러 처리 (ROI 영역)
   */
  async performOCRAndAnalyze(
    imageBuffer: Buffer,
    roi?: { x: number; y: number; width: number; height: number }
  ): Promise<OCRResult> {
    try {
      console.log(`[OnVoiceBridge] OCR + 분석 요청: 이미지 크기 ${imageBuffer.length} bytes`);

      // Buffer를 직접 전달 (electron-edge-js가 자동으로 byte[]로 변환)
      const payload: any = {
        command: "ocrAndBlur",
        imageData: imageBuffer,
      };

      if (roi) {
        payload.roi = roi;
      }

      const result = await callBridge(payload);

      if (!result || result.ok === false) {
        console.error(`[OnVoiceBridge] OCR + 분석 실패:`, result?.error || "알 수 없는 오류");
        return {
          ok: false,
          error: result?.error || "OCR + 분석 실패",
        };
      }

      // OCR 결과 검증 및 로그 (항상 출력)
      const extractedText = result.text || "";
      if (!extractedText || extractedText.trim().length === 0) {
        console.log(`[OnVoiceBridge] OCR 완료: 텍스트 추출 없음 (isHarmful: ${result.isHarmful || false})`);
      } else {
        console.log(`[OnVoiceBridge] OCR 완료: 텍스트 추출 성공 (${extractedText.length}자)`);
      }

      // blurredImage가 있으면 Buffer로 변환
      let blurredImageBuffer: Buffer | undefined;
      if (result.blurredImage && Array.isArray(result.blurredImage)) {
        blurredImageBuffer = Buffer.from(result.blurredImage);
      }

      return {
        ok: true,
        text: extractedText,
        isHarmful: result.isHarmful || false,
        matchedKeywords: result.matchedKeywords || [],
        confidence: result.confidence || 0,
        blurredImage: blurredImageBuffer,
      };
    } catch (error: any) {
      console.error(`[OnVoiceBridge] OCR + 분석 오류:`, error);
      return {
        ok: false,
        error: error.message || "OCR + 분석 처리 중 오류 발생",
      };
    }
  },
};
