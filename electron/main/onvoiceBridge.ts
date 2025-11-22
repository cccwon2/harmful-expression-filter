/**
 * OnVoice Electron Main Bridge Module
 */
import path from "node:path";
import { app } from "electron";
import { EventEmitter } from "events";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const edge = require("electron-edge-js");

type EdgeCallback = (error: Error | null, result?: any) => void;
type EdgeFunc = (payload: any, callback: EdgeCallback) => void;

// 타임아웃: 3초 (3초 내 응답 없으면 강제 실패 처리)
const BRIDGE_TIMEOUT_MS = 3000;

// 🔥 [핵심] 유해어 리스트를 Node.js에서 직접 관리 (C# 의존성 제거)
// 필요한 단어를 여기에 추가하세요. 정규식도 가능합니다.
const HARMFUL_KEYWORDS = [
  "새끼",
  "시발",
  "씨발",
  "병신",
  "꺼져",
  "죽어",
  "미친",
  "지랄",
  "존나",
  "개새끼",
  "느금마",
  "애미",
  "느개비",
  // ... 추가 필터링 단어
];

export interface OCRResult {
  ok: boolean;
  text?: string;
  isHarmful?: boolean;
  matchedKeywords?: string[];
  confidence?: number;
  blurredImage?: Buffer; // 이제 사용하지 않음 (React CSS로 대체)
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

  let assemblyFile: string;
  if (app.isPackaged) {
    assemblyFile = path.join(process.resourcesPath, "dotnet", "OnVoiceComBridge.dll");
  } else {
    assemblyFile = path.join(__dirname, "..", "dotnet", "OnVoiceComBridge.dll");
  }

  console.log(`[OnVoiceBridge] Loading DLL from: ${assemblyFile}`);

  try {
    bridgeFunc = edge.func({
      assemblyFile,
      typeName: "OnVoiceComBridge.Startup",
      methodName: "Invoke",
    });
  } catch (e) {
    console.error(`[OnVoiceBridge] ❌ DLL 로드 실패:`, e);
    throw e;
  }

  return bridgeFunc!;
}

function callBridge(payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let isCompleted = false;

    // 타임아웃 타이머
    const timer = setTimeout(() => {
      if (!isCompleted) {
        isCompleted = true;
        const errorMsg = `[OnVoiceBridge] Timeout: C# Bridge did not respond within ${BRIDGE_TIMEOUT_MS}ms`;
        // console.error(errorMsg); // 로그 과다 방지
        reject(new Error("BRIDGE_TIMEOUT"));
      }
    }, BRIDGE_TIMEOUT_MS);

    try {
      const func = getBridgeFunc();
      func(payload, (err: Error | null, result?: any) => {
        if (isCompleted) return;
        isCompleted = true;
        clearTimeout(timer);

        if (err) return reject(err);
        if (result && result.ok === false) {
          return reject(new Error(result.error || "Unknown C# Error"));
        }
        resolve(result || {});
      });
    } catch (e) {
      if (!isCompleted) {
        isCompleted = true;
        clearTimeout(timer);
        reject(e);
      }
    }
  });
}

/**
 * 텍스트 내 유해어 검사 함수 (Node.js 실행)
 */
function analyzeTextLocally(text: string): { isHarmful: boolean; matched: string[] } {
  if (!text || !text.trim()) return { isHarmful: false, matched: [] };

  const matched: string[] = [];
  // 공백 제거 후 검사하거나, 원본 텍스트로 검사
  const cleanText = text.replace(/\s+/g, " ");

  for (const keyword of HARMFUL_KEYWORDS) {
    if (cleanText.includes(keyword)) {
      matched.push(keyword);
    }
  }

  return {
    isHarmful: matched.length > 0,
    matched: matched,
  };
}

export const onVoiceBridge: OnVoiceBridge = {
  events,

  async init(onAudioData: (pcm: Buffer) => void): Promise<void> {
    if (initialized) return;
    await callBridge({
      command: "init",
      onAudioData: function (msg: any, cb: EdgeCallback) {
        try {
          if (msg && msg.type === "audio" && msg.data) {
            const buf = Buffer.from(msg.data);
            // events.emit("audio", buf); // 필요 시 활성화
            onAudioData(buf);
          }
          cb(null, { ok: true });
        } catch (e) {
          cb(null, { ok: false });
        }
      },
    });
    initialized = true;
    console.log("[OnVoiceBridge] 초기화 완료");
  },

  async findProcess(target: string): Promise<number> {
    const result = await callBridge({ command: "find", target });
    if (!result || typeof result.pid !== "number") throw new Error("Process not found");
    return result.pid;
  },

  async startCapture(pid: number): Promise<void> {
    await callBridge({ command: "start", pid });
  },

  async stopCapture(): Promise<void> {
    await callBridge({ command: "stop" });
  },

  // 단순 OCR (기존 유지)
  async performOCR(imageBuffer: Buffer): Promise<OCRResult> {
    try {
      const result = await callBridge({ command: "ocr", imageData: imageBuffer });
      return {
        ok: true,
        text: result.text || "",
        // OCR 커맨드가 유해성 분석을 안 해준다면 기본값 false
        isHarmful: false,
        matchedKeywords: [],
        confidence: result.confidence || 0,
      };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  },

  // 🔥 [수정됨] OCR + 분석 (C# Blur 우회)
  async performOCRAndAnalyze(
    imageBuffer: Buffer,
    roi?: { x: number; y: number; width: number; height: number }
  ): Promise<OCRResult> {
    try {
      console.log(`[OnVoiceBridge] OCR + 분석 요청: 이미지 크기 ${imageBuffer.length} bytes`);

      // 1. C#에는 단순 'ocr' 명령만 보냅니다. (이미지 처리 부하 제거)
      // 'ocrAndBlur' 대신 'ocr'을 사용하면 멈춤 현상이 사라집니다.
      const payload: any = {
        command: "ocr",
        imageData: imageBuffer,
      };

      if (roi) payload.roi = roi;

      // 2. 텍스트 추출 실행
      const result = await callBridge(payload);

      if (!result || result.ok === false) {
        return { ok: false, error: result?.error || "OCR 실패" };
      }

      const extractedText = result.text || "";

      // 3. 🔥 Node.js에서 직접 유해어 분석 수행
      const analysis = analyzeTextLocally(extractedText);

      if (extractedText.trim().length > 0) {
        console.log(`[OnVoiceBridge] OCR 완료: "${extractedText.substring(0, 20)}..." / 유해: ${analysis.isHarmful}`);
      } else {
        console.log(`[OnVoiceBridge] OCR 완료: 텍스트 없음`);
      }

      return {
        ok: true,
        text: extractedText,
        isHarmful: analysis.isHarmful, // 로컬 분석 결과 사용
        matchedKeywords: analysis.matched, // 로컬 분석 결과 사용
        confidence: result.confidence || 0,
        blurredImage: undefined, // C#에서 이미지를 받지 않음 (React CSS 사용)
      };
    } catch (error: any) {
      console.error(`[OnVoiceBridge] OCR + 분석 오류:`, error.message);
      return {
        ok: false,
        error: error.message || "처리 중 오류",
      };
    }
  },
};
