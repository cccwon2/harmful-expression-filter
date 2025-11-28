import { app } from "electron";
import path from "node:path";
import { EventEmitter } from "events";
import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";
import axios from "axios";
import * as dotenv from "dotenv";
import { v4 as uuidv4 } from 'uuid';

// ==================================================================================
// 1. Separate Process Bridge Management
// ==================================================================================

let bridgeProcess: ChildProcess | null = null;
let bridgeReadline: readline.Interface | null = null;
const pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void; timer: NodeJS.Timeout }>();
const BRIDGE_TIMEOUT_MS = 10000; // Increased timeout for process startup
const SERVER_REQUEST_TIMEOUT = 5000;

function getBridgePath(): string {
  if (app.isPackaged) {
    // [배포 모드] resources/bin/OnVoiceComBridge.exe
    return path.join(process.resourcesPath, "bin", "OnVoiceComBridge.exe");
  } else {
    // [개발 모드] dotnet publish 출력 경로
    return path.join(__dirname, "../../dotnet/OnVoiceComBridge/bin/Release/net6.0/win-x64/publish/OnVoiceComBridge.exe");
  }
}

function spawnBridge() {
  if (bridgeProcess) return;

  const exePath = getBridgePath();
  console.log(`[OnVoiceBridge] 🚀 Spawning Bridge Process: ${exePath}`);

  try {
    bridgeProcess = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'inherit'], // stdin, stdout, stderr (inherit for debug)
      windowsHide: true
    });

    bridgeProcess.on('error', (err) => {
      console.error('[OnVoiceBridge] ❌ Failed to spawn bridge process:', err);
      bridgeProcess = null;
    });

    bridgeProcess.on('exit', (code, signal) => {
      console.log(`[OnVoiceBridge] 🛑 Bridge process exited with code ${code} signal ${signal}`);
      bridgeProcess = null;
      bridgeReadline = null;
      // Reject all pending requests
      for (const [id, req] of pendingRequests) {
        clearTimeout(req.timer);
        req.reject(new Error("Bridge process exited"));
      }
      pendingRequests.clear();
    });

    if (!bridgeProcess.stdout) {
      throw new Error("Failed to spawn bridge: stdout is null");
    }

    // Setup Readline for line-by-line JSON parsing
    bridgeReadline = readline.createInterface({
      input: bridgeProcess.stdout,
      terminal: false
    });

    bridgeReadline.on('line', (line) => {
      if (!line || !line.trim()) return;
      try {
        const msg = JSON.parse(line);
        handleBridgeMessage(msg);
      } catch (e) {
        console.error('[OnVoiceBridge] ⚠️ Failed to parse JSON from bridge:', line);
      }
    });

  } catch (e) {
    console.error('[OnVoiceBridge] ❌ Exception spawning bridge:', e);
    throw e;
  }
}

function handleBridgeMessage(msg: any) {
  if (msg.type === 'response') {
    const req = pendingRequests.get(msg.id);
    if (req) {
      clearTimeout(req.timer);
      pendingRequests.delete(msg.id);
      req.resolve(msg.result);
    }
  } else if (msg.type === 'error') {
    const req = pendingRequests.get(msg.id);
    if (req) {
      clearTimeout(req.timer);
      pendingRequests.delete(msg.id);
      req.reject(new Error(msg.error));
    } else {
      console.error(`[OnVoiceBridge] ❌ Unhandled Bridge Error: ${msg.error}`);
    }
  } else if (msg.type === 'audio') {
    // Audio Data Push
    if (onVoiceBridge.onAudioDataCallback && msg.data) {
      // msg.data is Base64 string from C#
      const buffer = Buffer.from(msg.data, 'base64');
      onVoiceBridge.onAudioDataCallback(buffer, msg.timestamp);
    }
  } else if (msg.type === 'status') {
    console.log(`[OnVoiceBridge] ℹ️ Status: ${msg.message}`);
  }
}

function callBridge(command: string, payload: any = {}): Promise<any> {
  if (!bridgeProcess) spawnBridge();

  return new Promise((resolve, reject) => {
    const id = uuidv4();
    const request = { ...payload, command, id };

    const timer = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`BRIDGE_TIMEOUT: ${command}`));
      }
    }, BRIDGE_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timer });

    const json = JSON.stringify(request) + '\n';
    if (bridgeProcess && bridgeProcess.stdin) {
      bridgeProcess.stdin.write(json);
    } else {
      clearTimeout(timer);
      pendingRequests.delete(id);
      reject(new Error("Bridge process not running"));
    }
  });
}

// ==================================================================================
// 2. Bridge Interface
// ==================================================================================

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
  onAudioDataCallback?: (pcm: Buffer, timestamp?: number) => void;
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
    const result: any = await callBridge('setVolume', { pid, volume });
    return result && result.ok === true;
  } catch (error) {
    console.error(`[OnVoiceBridge] 볼륨 조절 실패 (PID: ${pid})`, error);
    return false;
  }
}

export async function listAudioSessions(): Promise<BridgeAudioSession[]> {
  try {
    const result: any = await callBridge('listSessions');
    if (result && Array.isArray(result.sessions)) return result.sessions as BridgeAudioSession[];
    return [];
  } catch (error) {
    console.error(`[OnVoiceBridge] 오디오 세션 조회 실패`, error);
    return [];
  }
}

export const onVoiceBridge: OnVoiceBridge = {
  events,
  onAudioDataCallback: undefined,
  async init(onAudioData: (pcm: Buffer, timestamp?: number) => void): Promise<void> {
    this.onAudioDataCallback = onAudioData;
    spawnBridge();
    await callBridge('init');
    console.log("[OnVoiceBridge] 초기화 완료 (Separate Process)");
  },
  async findProcess(target: string): Promise<number> {
    const result = await callBridge('find', { target });
    if (!result || typeof result.pid !== "number") throw new Error("Process not found");
    return result.pid;
  },
  async startCapture(pid: number): Promise<void> { await callBridge('start', { pid }); },
  async stopCapture(): Promise<void> { await callBridge('stop'); },
  async performOCR(imageBuffer: Buffer): Promise<OCRResult> { return this.performOCRAndAnalyze(imageBuffer); },
  async performOCRAndAnalyze(imageBuffer: Buffer, roi?: any): Promise<OCRResult> {
    try {
      // Buffer to Base64 for JSON transport
      const imageBase64 = imageBuffer.toString('base64');
      const result = await callBridge('ocr', { imageData: imageBase64 });

      if (!result || result.ok === false) return { ok: false, error: result?.error || "OCR 실패" };

      const extractedText = result.text || "";
      console.log(`[OnVoiceBridge] 📝 OCR 텍스트: "${extractedText.substring(0, 50)}${extractedText.length > 50 ? "..." : ""}"`);

      let analysisResult = { isHarmful: false, confidence: 0.0 };
      if (extractedText.trim().length > 0) analysisResult = await analyzeTextWithServer(extractedText);

      return { ok: true, text: extractedText, isHarmful: analysisResult.isHarmful, matchedKeywords: [], confidence: analysisResult.confidence, blurredImage: undefined };
    } catch (error: any) { return { ok: false, error: error.message || "처리 중 오류" }; }
  },
};