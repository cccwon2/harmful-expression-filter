import { app } from "electron";
import path from "node:path";
import { EventEmitter } from "events";
import axios, { AxiosError } from "axios";
import * as dotenv from "dotenv";
import * as fs from "fs";

// ==================================================================================
// 1. electron-edge-js 및 환경 변수 관리 (지연 로딩)
// ==================================================================================

let edgeInstance: any = null;

function getEdge() {
  if (edgeInstance) return edgeInstance;

  console.log('[OnVoiceBridge] 🔄 Initializing electron-edge-js (Standard Mode)...');

  // 1. CoreCLR 모드 활성화
  process.env.EDGE_USE_CORECLR = '1';

  // 2. 배포 환경 경로 설정
  if (app.isPackaged) {
    // 2-1. Bootstrap 경로 (asarUnpack으로 인해 app.asar.unpacked 내부에 존재)
    const baseUnpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'electron-edge-js');
    const bootstrapPath = path.join(baseUnpackedPath, 'lib', 'bootstrap', 'bin', 'Release', 'netcoreapp1.1');
    
    process.env.EDGE_BOOTSTRAP_DIR = bootstrapPath;
    console.log('[OnVoiceBridge] 🔧 EDGE_BOOTSTRAP_DIR set to:', bootstrapPath);

    // 2-2. Native 경로 설정 (28.0.0 폴더 탐색)
    const nativeBasePath = path.join(baseUnpackedPath, 'lib', 'native', 'win32', 'x64');
    try {
        const dirs = fs.readdirSync(nativeBasePath);
        // 28.0.0 폴더를 우선적으로 찾음
        const versionDir = dirs.find(d => d.startsWith('28.')) || dirs.find(d => /^\d+\./.test(d));
        
        if (versionDir) {
            const nativePath = path.join(nativeBasePath, versionDir, 'edge_coreclr.node');
            process.env.EDGE_NATIVE = nativePath;
            console.log('[OnVoiceBridge] ✅ EDGE_NATIVE set to:', nativePath);
        }
    } catch (e) {
        console.warn('[OnVoiceBridge] ⚠️ Native path search failed:', e);
    }

    // 2-3. .NET 런타임 경로
    const dotnetPath = path.join(process.resourcesPath, "dotnet");
    process.env.EDGE_APP_ROOT = dotnetPath;
    console.log(`[OnVoiceBridge] 🔧 EDGE_APP_ROOT set to: ${dotnetPath}`);
  } else {
    // 개발 환경
    const dotnetPath = path.join(__dirname, "../../dotnet/OnVoiceComBridge/bin/Publish");
    process.env.EDGE_APP_ROOT = dotnetPath;
  }

  // 3. 모듈 로드
  try {
    edgeInstance = require('electron-edge-js');
    console.log('[OnVoiceBridge] ✅ electron-edge-js 로드 완료');
    return edgeInstance;
  } catch (e) {
    console.error('[OnVoiceBridge] ❌ electron-edge-js 로드 실패:', e);
    throw e;
  }
}

// ==================================================================================
// 2. Bridge 함수 및 유틸리티 (나머지는 그대로 유지)
// ==================================================================================

type EdgeCallback = (error: Error | null, result?: any) => void;
type EdgeFunc = (payload: any, callback: EdgeCallback) => void;
const BRIDGE_TIMEOUT_MS = 5000;
const SERVER_REQUEST_TIMEOUT = 5000;

export interface OCRResult {
  ok: boolean;
  text?: string;
  isHarmful?: boolean;
  matchedKeywords?: string[];
  confidence?: number;
  blurredImage?: Buffer;
  error?: string;
}

export interface BridgeAudioSession {
  id: string;
  pid: number;
  name: string;
  appName: string;
  volume: number;
  state: number;
  executablePath?: string;
}

export interface OnVoiceBridge {
  events: EventEmitter;
  init(onAudioData: (pcm: Buffer, timestamp?: number) => void): Promise<void>;
  findProcess(target: "chrome" | "edge" | "discord"): Promise<number>;
  startCapture(pid: number): Promise<void>;
  stopCapture(): Promise<void>;
  performOCR(imageBuffer: Buffer): Promise<OCRResult>;
  performOCRAndAnalyze(imageBuffer: Buffer, roi?: any): Promise<OCRResult>;
}

const events = new EventEmitter();
let envLoaded = false;

// .env 로드 함수
function ensureEnvLoaded() {
  if (envLoaded) return;
  try {
    const possiblePaths: string[] = [];
    if (app && app.isPackaged && process.resourcesPath) possiblePaths.push(path.join(process.resourcesPath, ".env"));
    possiblePaths.push(path.join(__dirname, "../../.env"));
    possiblePaths.push(path.join(__dirname, "../../../.env"));
    possiblePaths.push(path.join(process.cwd(), ".env"));
    
    for (const envPath of possiblePaths) {
      const envResult = dotenv.config({ path: envPath });
      if (!envResult.error && envResult.parsed) {
        console.log(`[OnVoiceBridge] ✅ .env 파일 로드 성공: ${envPath}`);
        break;
      }
    }
    envLoaded = true;
  } catch (error) { envLoaded = true; }
}

function getServerUrl(): string {
  if (!envLoaded) ensureEnvLoaded();
  return process.env.SERVER_URL || "http://127.0.0.1:8000";
}

// C# 함수 캐싱
let bridgeFunc: EdgeFunc | null = null;
let initialized = false;

function getBridgeFunc(): EdgeFunc {
  if (bridgeFunc) return bridgeFunc;

  const edge = getEdge();
  if (!edge) throw new Error('electron-edge-js 모듈 로드 실패');

  let assemblyFile: string;
  if (app.isPackaged) {
    assemblyFile = path.join(process.resourcesPath, "dotnet", "OnVoiceComBridge.dll");
  } else {
    const relativePath = path.join(__dirname, "../../dotnet/OnVoiceComBridge/bin/Publish/OnVoiceComBridge.dll");
    assemblyFile = path.resolve(relativePath);
  }

  console.log(`[OnVoiceBridge] Loading .NET DLL from: ${assemblyFile}`);
  
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
      if (!isCompleted) { isCompleted = true; reject(new Error("BRIDGE_TIMEOUT")); }
    }, BRIDGE_TIMEOUT_MS);

    try {
      const func = getBridgeFunc();
      func(payload, (err: Error | null, result?: any) => {
        if (isCompleted) return;
        isCompleted = true;
        clearTimeout(timer);
        if (err) return reject(err);
        if (result && result.ok === false) return reject(new Error(result.error || "Unknown C# Error"));
        resolve(result || {});
      });
    } catch (e) {
      if (!isCompleted) { isCompleted = true; clearTimeout(timer); reject(e); }
    }
  });
}

// Export functions
async function analyzeTextWithServer(text: string): Promise<{ isHarmful: boolean; confidence: number }> {
  if (!text || !text.trim()) return { isHarmful: false, confidence: 0.0 };
  try {
    const serverUrl = getServerUrl();
    const response = await axios.post<{
      has_violation: boolean;
      ai_analysis: { is_harmful: boolean; confidence: number; } | null;
    }>(`${serverUrl}/analyze`, { text: text.trim() }, { timeout: SERVER_REQUEST_TIMEOUT });
    
    if (response.data.ai_analysis) return { isHarmful: response.data.ai_analysis.is_harmful, confidence: response.data.ai_analysis.confidence };
    return { isHarmful: response.data.has_violation, confidence: response.data.has_violation ? 1.0 : 0.0 };
  } catch (error) { return { isHarmful: false, confidence: 0.0 }; }
}

export async function setVolumeByPid(pid: number, volume: number): Promise<boolean> {
  try {
    const result: any = await callBridge({ command: 'setVolume', pid, volume });
    return result && result.ok === true;
  } catch (error) {
    console.error(`[OnVoiceBridge] 볼륨 조절 실패 (PID: ${pid})`, error);
    return false;
  }
}

export async function listAudioSessions(): Promise<BridgeAudioSession[]> {
  try {
    const result: any = await callBridge({ command: 'listSessions' });
    if (result && Array.isArray(result.sessions)) return result.sessions as BridgeAudioSession[];
    return [];
  } catch (error) {
    console.error(`[OnVoiceBridge] 오디오 세션 조회 실패`, error);
    return [];
  }
}

export const onVoiceBridge: OnVoiceBridge = {
  events,
  async init(onAudioData: (pcm: Buffer, timestamp?: number) => void): Promise<void> {
    if (initialized) return;
    await callBridge({
      command: "init",
      onAudioData: function (msg: any, cb: EdgeCallback) {
        try {
          if (msg && msg.type === "audio" && msg.data) {
            onAudioData(Buffer.from(msg.data), typeof msg.timestamp === 'number' ? msg.timestamp : undefined);
          }
          cb(null, { ok: true });
        } catch (e) { cb(null, { ok: false }); }
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
  async startCapture(pid: number): Promise<void> { await callBridge({ command: "start", pid }); },
  async stopCapture(): Promise<void> { await callBridge({ command: "stop" }); },
  async performOCR(imageBuffer: Buffer): Promise<OCRResult> { return this.performOCRAndAnalyze(imageBuffer); },
  async performOCRAndAnalyze(imageBuffer: Buffer, roi?: any): Promise<OCRResult> {
    try {
      const payload: any = { command: "ocr", imageData: imageBuffer };
      const result = await callBridge(payload);
      if (!result || result.ok === false) return { ok: false, error: result?.error || "OCR 실패" };
      
      const extractedText = result.text || "";
      console.log(`[OnVoiceBridge] 📝 OCR 텍스트: "${extractedText.substring(0, 50)}${extractedText.length > 50 ? "..." : ""}"`);
      
      let analysisResult = { isHarmful: false, confidence: 0.0 };
      if (extractedText.trim().length > 0) analysisResult = await analyzeTextWithServer(extractedText);
      
      return { ok: true, text: extractedText, isHarmful: analysisResult.isHarmful, matchedKeywords: [], confidence: analysisResult.confidence, blurredImage: undefined };
    } catch (error: any) { return { ok: false, error: error.message || "처리 중 오류" }; }
  },
};