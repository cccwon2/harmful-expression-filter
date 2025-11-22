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

// 타임아웃: 3초
const BRIDGE_TIMEOUT_MS = 3000;

// 🔥 유해어 리스트 (Node.js 로컬 분석용)
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
  "놈",
  "년",
  // 필요한 단어 추가
];

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
    const timer = setTimeout(() => {
      if (!isCompleted) {
        isCompleted = true;
        // console.error(`[OnVoiceBridge] Timeout...`); // 로그 과다 방지
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

function analyzeTextLocally(text: string): { isHarmful: boolean; matched: string[] } {
  if (!text || !text.trim()) return { isHarmful: false, matched: [] };
  const matched: string[] = [];
  const cleanText = text.replace(/\s+/g, " ");
  for (const keyword of HARMFUL_KEYWORDS) {
    if (cleanText.includes(keyword)) matched.push(keyword);
  }
  return { isHarmful: matched.length > 0, matched };
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

  async performOCR(imageBuffer: Buffer): Promise<OCRResult> {
    // 기존 함수도 로컬 분석 사용하도록 통일
    return this.performOCRAndAnalyze(imageBuffer);
  },

  // 🔥 [수정됨] C#에 ROI를 보내지 않음 (순수 OCR 모드 강제)
  async performOCRAndAnalyze(
    imageBuffer: Buffer,
    roi?: { x: number; y: number; width: number; height: number }
  ): Promise<OCRResult> {
    try {
      // console.log(`[OnVoiceBridge] OCR 요청: ${imageBuffer.length} bytes`);

      // 1. Payload 생성: command는 'ocr', roi 정보는 '제거'
      // ROI 정보를 보내면 C# DLL이 좌표 계산이나 블러링을 시도하다가 죽을 수 있음
      const payload: any = {
        command: "ocr",
        imageData: imageBuffer,
        // roi: roi,  <-- ❌ 제거함! Node가 이미 자른 이미지를 보내므로 C#은 몰라도 됨
      };

      // 2. C# 호출
      const result = await callBridge(payload);

      if (!result || result.ok === false) {
        return { ok: false, error: result?.error || "OCR 실패" };
      }

      const extractedText = result.text || "";

      // 3. Node.js 로컬 분석
      const analysis = analyzeTextLocally(extractedText);

      if (extractedText.trim().length > 0) {
        console.log(
          `[OnVoiceBridge] 결과: "${extractedText.substring(0, 20)}..." (${analysis.isHarmful ? "🚨유해" : "✅정상"})`
        );
      }

      return {
        ok: true,
        text: extractedText,
        isHarmful: analysis.isHarmful,
        matchedKeywords: analysis.matched,
        confidence: result.confidence || 0,
        blurredImage: undefined,
      };
    } catch (error: any) {
      // console.error(`[OnVoiceBridge] 오류:`, error.message);
      return {
        ok: false,
        error: error.message || "처리 중 오류",
      };
    }
  },
};
