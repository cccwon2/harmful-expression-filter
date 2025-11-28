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
  if (edgeInstance) {
    console.log('[OnVoiceBridge] ⚡ Using cached edge instance');
    return edgeInstance;
  }

  console.log('[OnVoiceBridge] 🔄 Initializing electron-edge-js (Standard Mode)...');

  // Check if module is already in cache
  const edgeModuleId = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'electron-edge-js', 'lib', 'edge.js')
    : require.resolve('electron-edge-js');

  if (require.cache[edgeModuleId]) {
    console.warn('[OnVoiceBridge] ⚠️ electron-edge-js is already in require cache! This suggests double initialization.');
  }

  if (!process.env.EDGE_USE_CORECLR) {
    process.env.EDGE_USE_CORECLR = '1';
  }
  process.env.EDGE_DEBUG = '1';
  process.env.COREHOST_TRACE = '1';

  const traceFile = app.isPackaged
    ? path.resolve(process.resourcesPath, 'corehost_trace.txt')
    : path.resolve(__dirname, '../../corehost_trace.txt');
  process.env.COREHOST_TRACEFILE = traceFile;

  console.log('[OnVoiceBridge] 🔍 CoreCLR trace file:', traceFile);

  // 변수 선언 (스코프 문제 해결)
  let bootstrapDll = "";
  let coreclrDll = "";
  let hostfxrDll = "";
  let hostpolicyDll = "";

  if (app.isPackaged) {
    // [배포 환경]
    const bootstrapPath = path.join(process.resourcesPath, 'bootstrap', 'bin', 'Release', 'netcoreapp1.1');
    process.env.EDGE_BOOTSTRAP_DIR = bootstrapPath;
    bootstrapDll = path.join(bootstrapPath, 'bootstrap.dll');

    const baseUnpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'electron-edge-js');
    let baseNativePath = path.join(baseUnpackedPath, 'lib', 'native', 'win32', 'x64');
    const buildReleasePath = path.join(baseUnpackedPath, 'build', 'Release', 'edge_coreclr.node');

    let nativePath: string | null = null;
    if (fs.existsSync(buildReleasePath)) {
      nativePath = buildReleasePath;
    } else if (fs.existsSync(baseNativePath)) {
      // 버전별 폴더 찾기 로직 생략 (단순화)
      nativePath = path.join(baseNativePath, '28.0.1', 'edge_coreclr.node'); // 하드코딩 또는 검색
      if (!fs.existsSync(nativePath)) {
        // 폴더 검색
        const dirs = fs.readdirSync(baseNativePath);
        const versionDir = dirs.find(d => /^\d+\./.test(d));
        if (versionDir) nativePath = path.join(baseNativePath, versionDir, 'edge_coreclr.node');
      }
    }

    if (nativePath) process.env.EDGE_NATIVE = nativePath;

    const dotnetPath = path.join(process.resourcesPath, "dotnet");
    process.env.EDGE_APP_ROOT = dotnetPath;
    process.env.CORECLR_DIR = dotnetPath;

    coreclrDll = path.join(dotnetPath, 'coreclr.dll');
    hostfxrDll = path.join(dotnetPath, 'hostfxr.dll');
    hostpolicyDll = path.join(dotnetPath, 'hostpolicy.dll');

  } else {
    // [개발 환경]
    // C# 앱은 bin/Publish에 있음 (Self-contained)
    const dotnetPath = path.join(__dirname, "../../dotnet/OnVoiceComBridge/bin/Publish");
    process.env.EDGE_APP_ROOT = dotnetPath;
    process.env.CORECLR_DIR = dotnetPath;

    // Bootstrap은 net6.0에 있음 (수동 빌드 후 bin/Publish로 복사됨)
    // const bootstrapPath = path.join(__dirname, "../../node_modules/electron-edge-js/lib/bootstrap/bin/Release/net6.0");
    const bootstrapPath = dotnetPath; // bin/Publish 사용
    process.env.EDGE_BOOTSTRAP_DIR = bootstrapPath;
    bootstrapDll = path.join(bootstrapPath, 'bootstrap.dll');

    coreclrDll = path.join(dotnetPath, 'coreclr.dll');
    hostfxrDll = path.join(dotnetPath, 'hostfxr.dll');
    hostpolicyDll = path.join(dotnetPath, 'hostpolicy.dll');

    console.log(`[OnVoiceBridge] 🔧 EDGE_APP_ROOT (dev): ${dotnetPath}`);
    console.log(`[OnVoiceBridge] 🔧 EDGE_BOOTSTRAP_DIR (dev): ${bootstrapPath}`);
  }

  try {
    if (app.isPackaged) {
      const edgeModulePath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'electron-edge-js', 'lib', 'edge.js');
      edgeInstance = require(edgeModulePath);
    } else {
      edgeInstance = require('electron-edge-js');
    }

    if (typeof (edgeInstance as any).initializeClrFunc !== 'function') {
      console.error('[OnVoiceBridge] ⚠️ initializeClrFunc missing. Debug info:');
      console.error(`[OnVoiceBridge]    Bootstrap DLL: ${fs.existsSync(bootstrapDll) ? '✅' : '❌'} (${bootstrapDll})`);
      console.error(`[OnVoiceBridge]    CoreCLR DLL: ${fs.existsSync(coreclrDll) ? '✅' : '❌'} (${coreclrDll})`);
      console.error(`[OnVoiceBridge]    HostFxr DLL: ${fs.existsSync(hostfxrDll) ? '✅' : '❌'} (${hostfxrDll})`);

      // Bootstrap 크기 확인 (로그만 남김)
      if (fs.existsSync(bootstrapDll)) {
        console.log(`[OnVoiceBridge]    Bootstrap Size: ${fs.statSync(bootstrapDll).size} bytes`);
      }

      throw new Error('electron-edge-js loaded but initializeClrFunc is missing.');
    }

    console.log('[OnVoiceBridge] ✅ electron-edge-js loaded successfully');
    return edgeInstance;
  } catch (e) {
    console.error('[OnVoiceBridge] ❌ Failed to load electron-edge-js:', e);
    throw e;
  }
}

// ==================================================================================
// 2. Bridge 함수 및 유틸리티
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

  let edge;
  try {
    edge = getEdge();
    if (!edge) throw new Error('electron-edge-js 모듈 로드 실패: edge 인스턴스가 null입니다');
  } catch (error: any) {
    const errorMsg = error?.message || '알 수 없는 오류';
    console.error('[OnVoiceBridge] ❌ electron-edge-js 로드 실패:', errorMsg);
    throw new Error(`electron-edge-js 모듈 로드 실패: ${errorMsg}. OCR 및 오디오 기능이 작동하지 않습니다.`);
  }

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