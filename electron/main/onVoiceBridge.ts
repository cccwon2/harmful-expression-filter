/**
 * OnVoice Electron Main Bridge Module
 */

import { app } from "electron";
import path from "node:path";
import { EventEmitter } from "events";
import axios, { AxiosError } from "axios";
import * as dotenv from "dotenv";
import * as fs from "fs";

// ==================================================================================
// 1. electron-edge-js 및 환경 변수 관리 (지연 로딩)
// ==================================================================================

// 전역 변수로 edge 모듈 캐싱
let edgeInstance: any = null;

/**
 * electron-edge-js를 안전하게 로드하는 헬퍼 함수
 * 이 함수가 호출되는 시점은 이미 앱이 완전히 시작된 후이므로 환경 변수 설정이 안전하게 적용됩니다.
 */
function getEdge() {
  if (edgeInstance) return edgeInstance;

  console.log('[OnVoiceBridge] 🔄 Initializing electron-edge-js...');

  // 1. CoreCLR 모드 활성화 (필수)
  process.env.EDGE_USE_CORECLR = '1';

  // 2. 배포 환경(패키징됨)일 때 Bootstrap 및 Runtime 경로 강제 지정
  if (app.isPackaged) {
    // 2-1. Bootstrap 경로 설정
    // package.json의 extraResources에 의해 resources/bootstrap에 복사됨
    const bootstrapPath = path.join(process.resourcesPath, 'bootstrap', 'bin', 'Release', 'netcoreapp1.1');
    process.env.EDGE_BOOTSTRAP_DIR = bootstrapPath;
    console.log('[OnVoiceBridge] 🔧 EDGE_BOOTSTRAP_DIR set to:', bootstrapPath);
    
    // 파일 존재 확인 (디버깅용)
    const bootstrapDllPath = path.join(bootstrapPath, 'bootstrap.dll');
    if (fs.existsSync(bootstrapDllPath)) {
      console.log(`[OnVoiceBridge] ✅ Bootstrap.dll 확인됨: ${bootstrapDllPath}`);
    } else {
      console.warn(`[OnVoiceBridge] ⚠️ Bootstrap.dll을 찾을 수 없습니다: ${bootstrapDllPath}`);
    }

    // 2-2. .NET 런타임 경로 설정 (Self-contained 배포 시)
    const dotnetPath = path.join(process.resourcesPath, "dotnet");
    if (!process.env.EDGE_APP_ROOT) {
      process.env.EDGE_APP_ROOT = dotnetPath;
      console.log(`[OnVoiceBridge] 🔧 EDGE_APP_ROOT set to: ${dotnetPath}`);
    }
  } else {
    // 개발 환경 설정
    const dotnetPath = path.join(__dirname, "../../dotnet/OnVoiceComBridge/bin/Publish");
    if (!process.env.EDGE_APP_ROOT) {
      process.env.EDGE_APP_ROOT = dotnetPath;
    }
  }

  // 3. 모듈 로드 (환경 변수 설정 후 require)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    edgeInstance = require('electron-edge-js');
    console.log('[OnVoiceBridge] ✅ electron-edge-js 로드 완료');
    return edgeInstance;
  } catch (e) {
    console.error('[OnVoiceBridge] ❌ electron-edge-js 로드 실패:', e);
    throw e;
  }
}

// ==================================================================================
// 2. 타입 정의 및 유틸리티
// ==================================================================================

type EdgeCallback = (error: Error | null, result?: any) => void;
type EdgeFunc = (payload: any, callback: EdgeCallback) => void;

// 타임아웃 설정
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
  performOCRAndAnalyze(
    imageBuffer: Buffer,
    roi?: { x: number; y: number; width: number; height: number }
  ): Promise<OCRResult>;
}

// 이벤트 이미터
const events = new EventEmitter();

// 로그 유틸리티
function logWithTimestamp(message: string, ...args: any[]): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, ...args);
}

function warnWithTimestamp(message: string, ...args: any[]): void {
  const timestamp = new Date().toISOString();
  console.warn(`[${timestamp}] ${message}`, ...args);
}

function errorWithTimestamp(message: string, ...args: any[]): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ${message}`, ...args);
}

// .env 로드 관리
let envLoaded = false;
function ensureEnvLoaded() {
  if (envLoaded) return;
  
  try {
    const possiblePaths: string[] = [];
    
    // 1. 배포 환경: process.resourcesPath
    if (app && app.isPackaged && process.resourcesPath) {
      possiblePaths.push(path.join(process.resourcesPath, ".env"));
    }
    
    // 2. 개발 모드: 프로젝트 루트
    possiblePaths.push(path.join(__dirname, "../../.env"));
    possiblePaths.push(path.join(__dirname, "../../../.env"));
    
    // 3. Fallback: app.getAppPath()
    if (app && app.isPackaged) {
      try {
        possiblePaths.push(path.join(app.getAppPath(), ".env"));
      } catch (e) { /* ignore */ }
    }
    
    // 4. CWD
    possiblePaths.push(path.join(process.cwd(), ".env"));
    
    let loaded = false;
    for (const envPath of possiblePaths) {
      const envResult = dotenv.config({ path: envPath });
      if (!envResult.error && envResult.parsed) {
        console.log(`[OnVoiceBridge] ✅ .env 파일 로드 성공: ${envPath}`);
        loaded = true;
        break;
      }
    }
    
    if (!loaded) {
      console.warn(`[OnVoiceBridge] ⚠️ .env 파일을 찾을 수 없습니다. 시도한 경로:`, possiblePaths);
    }
    
    envLoaded = true;
  } catch (error) {
    console.warn(`[OnVoiceBridge] .env 파일 로드 중 오류:`, error);
    envLoaded = true;
  }
}

function getServerUrl(): string {
  if (!envLoaded) {
    ensureEnvLoaded();
  }
  
  const serverUrl = process.env.SERVER_URL || "http://127.0.0.1:8000";
  
  if (!process.env.SERVER_URL) {
    console.warn(`[OnVoiceBridge] ⚠️ SERVER_URL 환경 변수가 설정되지 않았습니다. 기본값 사용: ${serverUrl}`);
  }
  
  return serverUrl;
}

// ==================================================================================
// 3. C# Bridge 호출 로직
// ==================================================================================

// C# 함수 캐싱 (싱글톤)
let bridgeFunc: EdgeFunc | null = null;
let initialized = false;

function getBridgeFunc(): EdgeFunc {
  if (bridgeFunc) return bridgeFunc;

  // ✅ 여기서 지연 로딩을 수행하여 edge 모듈을 가져옵니다.
  const edge = getEdge();
  
  if (!edge) {
    throw new Error('electron-edge-js 모듈 로드 실패');
  }

  // 1. 경로 설정 (절대 경로 사용)
  let assemblyFile: string;
  if (app.isPackaged) {
    // 배포 모드: resources/dotnet/OnVoiceComBridge.dll
    assemblyFile = path.join(process.resourcesPath, "dotnet", "OnVoiceComBridge.dll");
  } else {
    // 개발 모드: 로컬 빌드 경로
    const relativePath = path.join(__dirname, "../../dotnet/OnVoiceComBridge/bin/Publish/OnVoiceComBridge.dll");
    assemblyFile = path.resolve(relativePath);
  }

  // 2. 실행 로그
  console.log(`[OnVoiceBridge] Loading .NET DLL from: ${assemblyFile}`);
  console.log(`[OnVoiceBridge] DLL 경로 확인 (절대 경로): ${path.isAbsolute(assemblyFile) ? "✅ 절대 경로" : "❌ 상대 경로"}`);

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
        reject(new Error("BRIDGE_TIMEOUT"));
      }
    }, BRIDGE_TIMEOUT_MS);

    try {
      // ✅ 호출 시점에 getBridgeFunc() 내부에서 edge 모듈이 로드됨
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

// ==================================================================================
// 4. 주요 기능 구현 (OCR, Audio, Volume)
// ==================================================================================

/**
 * 서버의 KoElectra/Kanana 모델을 사용하여 텍스트 유해성 분석
 */
async function analyzeTextWithServer(text: string): Promise<{ isHarmful: boolean; confidence: number }> {
  if (!text || !text.trim()) {
    return { isHarmful: false, confidence: 0.0 };
  }

  try {
    const serverUrl = getServerUrl();
    const response = await axios.post<{
      has_violation: boolean;
      ai_analysis: { is_harmful: boolean; confidence: number; } | null;
    }>(
      `${serverUrl}/analyze`,
      { text: text.trim() },
      {
        timeout: SERVER_REQUEST_TIMEOUT,
        headers: { "Content-Type": "application/json" },
      }
    );

    if (response.data.ai_analysis) {
      return {
        isHarmful: response.data.ai_analysis.is_harmful,
        confidence: response.data.ai_analysis.confidence,
      };
    }

    return {
      isHarmful: response.data.has_violation,
      confidence: response.data.has_violation ? 1.0 : 0.0,
    };
  } catch (error) {
    // 에러 발생 시 로그는 최소화하거나 필요 시 추가
    return { isHarmful: false, confidence: 0.0 };
  }
}

/**
 * 특정 PID의 애플리케이션 볼륨 조절
 */
export async function setVolumeByPid(pid: number, volume: number): Promise<boolean> {
  const startTime = Date.now();
  const payload = {
    command: 'setVolume',
    pid: pid,
    volume: volume
  };
  
  try {
    const bridgeCallStartTime = Date.now();
    const result = await callBridge(payload);
    const bridgeCallElapsed = Date.now() - bridgeCallStartTime;
    const totalElapsed = Date.now() - startTime;
    
    if (result && result.ok === true) {
      // 성공 로그는 너무 빈번할 수 있으므로 필요 시 주석 처리 가능
      // logWithTimestamp(`[OnVoiceBridge] ⏱️ setVolumeByPid 성공 (PID: ${pid})`);
      return true;
    } else {
      warnWithTimestamp(`[OnVoiceBridge] ⚠️ setVolumeByPid 실패 (${totalElapsed}ms)`);
      return false;
    }
  } catch (error) {
    const totalElapsed = Date.now() - startTime;
    errorWithTimestamp(`[OnVoiceBridge] 볼륨 조절 실패 (PID: ${pid}, ${totalElapsed}ms)`, error);
    return false;
  }
}

/**
 * 오디오 세션 목록 조회
 */
export async function listAudioSessions(): Promise<BridgeAudioSession[]> {
  try {
    const result = await callBridge({ command: 'listSessions' });
    
    if (result && Array.isArray(result.sessions)) {
      return result.sessions as BridgeAudioSession[];
    }
    return [];
  } catch (error) {
    errorWithTimestamp(`[OnVoiceBridge] 오디오 세션 조회 실패`, error);
    return [];
  }
}

// OnVoiceBridge 객체 export
export const onVoiceBridge: OnVoiceBridge = {
  events,

  async init(onAudioData: (pcm: Buffer, timestamp?: number) => void): Promise<void> {
    if (initialized) return;
    
    // init 호출 시 내부적으로 callBridge -> getBridgeFunc -> getEdge 순으로 호출되어
    // 환경 변수 설정 및 모듈 로드가 이 시점에 이루어집니다.
    await callBridge({
      command: "init",
      onAudioData: function (msg: any, cb: EdgeCallback) {
        try {
          if (msg && msg.type === "audio" && msg.data) {
            const buf = Buffer.from(msg.data);
            const timestamp = typeof msg.timestamp === 'number' ? msg.timestamp : undefined;
            onAudioData(buf, timestamp);
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
    return this.performOCRAndAnalyze(imageBuffer);
  },

  async performOCRAndAnalyze(
    imageBuffer: Buffer,
    roi?: { x: number; y: number; width: number; height: number }
  ): Promise<OCRResult> {
    try {
      const payload: any = {
        command: "ocr",
        imageData: imageBuffer,
        // roi 정보 제거 (Node가 이미 자른 이미지를 보냄)
      };

      const result = await callBridge(payload);

      if (!result || result.ok === false) {
        return { ok: false, error: result?.error || "OCR 실패" };
      }

      const extractedText = result.text || "";
      console.log(`[OnVoiceBridge] 📝 OCR 텍스트: "${extractedText.substring(0, 50)}${extractedText.length > 50 ? "..." : ""}"`);

      // 서버 유해성 분석
      let analysisResult = { isHarmful: false, confidence: 0.0 };
      if (extractedText.trim().length > 0) {
        analysisResult = await analyzeTextWithServer(extractedText);
        console.log(`[OnVoiceBridge] 📊 분석: 유해성=${analysisResult.isHarmful}, 신뢰도=${(analysisResult.confidence * 100).toFixed(1)}%`);
      }

      return {
        ok: true,
        text: extractedText,
        isHarmful: analysisResult.isHarmful,
        matchedKeywords: [],
        confidence: analysisResult.confidence,
        blurredImage: undefined,
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || "처리 중 오류",
      };
    }
  },
};