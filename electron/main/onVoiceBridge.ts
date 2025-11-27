/**
 * OnVoice Electron Main Bridge Module
 */
process.env.EDGE_USE_CORECLR = '1';

import path from "node:path";
import { app } from "electron";
import { EventEmitter } from "events";
import axios, { AxiosError } from "axios";
import * as dotenv from "dotenv";

/**
 * 타임스탬프가 포함된 로그 유틸리티
 */
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
// ⚠️ 중요: electron-edge-js가 .NET Framework 대신 .NET 6 CoreCLR을 사용하도록 강제
// 패키지된 exe에서는 npm 스크립트의 EDGE_USE_CORECLR 환경변수가 적용되지 않기 때문에
// 여기서 직접 설정해 준다.
if (!process.env.EDGE_USE_CORECLR) {
  process.env.EDGE_USE_CORECLR = "1";
}

// ⚠️ 중요: Self-contained 배포 시 .NET 런타임 경로 설정 (EDGE_APP_ROOT)
// electron-edge-js가 번들링된 .NET 런타임(hostfxr.dll 등)을 찾을 수 있도록 설정해야 함
let dotnetPath: string;
if (app.isPackaged) {
  // 배포 모드: resources/dotnet 폴더
  dotnetPath = path.join(process.resourcesPath, "dotnet");
} else {
  // 개발 모드: 로컬 빌드 폴더
  dotnetPath = path.join(__dirname, "../../dotnet/OnVoiceComBridge/bin/Publish");
}

// EDGE_APP_ROOT가 설정되지 않았을 때만 설정
if (!process.env.EDGE_APP_ROOT) {
  process.env.EDGE_APP_ROOT = dotnetPath;
  console.log(`[OnVoiceBridge] 🔧 EDGE_APP_ROOT set to: ${dotnetPath}`);
} else {
  console.log(`[OnVoiceBridge] ℹ️ EDGE_APP_ROOT already set: ${process.env.EDGE_APP_ROOT}`);
}

// ✅ [중요] 배포 환경일 경우 Bootstrap 경로 강제 지정
// 이것이 없으면 edge.js는 app.asar 내부를 뒤지다가 실패합니다.
// Bootstrap.dll은 .NET 런타임이 직접 접근해야 하므로 ASAR 밖에 있어야 합니다.
// EDGE_BOOTSTRAP_DIR은 bootstrap.dll이 있는 디렉토리(bin/Release/netcoreapp1.1)를 가리켜야 합니다.
if (app.isPackaged) {
  const fs = require("fs");
  // resources/bootstrap 폴더 경로 (package.json의 extraResources에 의해 복사됨)
  const bootstrapBasePath = path.join(process.resourcesPath, "bootstrap");
  const bootstrapPath = path.join(bootstrapBasePath, "bin", "Release", "netcoreapp1.1");
  
  // bootstrap.dll이 있는 디렉토리 경로 설정 (edge.js가 이 경로에서 bootstrap.dll을 찾습니다)
  process.env.EDGE_BOOTSTRAP_DIR = bootstrapPath;
  console.log(`[OnVoiceBridge] 🔧 EDGE_BOOTSTRAP_DIR set to: ${bootstrapPath}`);
  
  // 파일 존재 확인
  const bootstrapDllPath = path.join(bootstrapPath, "bootstrap.dll");
  if (fs.existsSync(bootstrapDllPath)) {
    console.log(`[OnVoiceBridge] ✅ Bootstrap.dll 확인됨: ${bootstrapDllPath}`);
  } else {
    console.warn(`[OnVoiceBridge] ⚠️ Bootstrap.dll을 찾을 수 없습니다: ${bootstrapDllPath}`);
    // bootstrap 폴더 구조 확인
    if (fs.existsSync(bootstrapBasePath)) {
      console.log(`[OnVoiceBridge] ℹ️ bootstrap 폴더는 존재합니다: ${bootstrapBasePath}`);
      try {
        const files = fs.readdirSync(bootstrapBasePath);
        console.log(`[OnVoiceBridge] ℹ️ bootstrap 폴더 내용:`, files);
      } catch (e) {
        console.warn(`[OnVoiceBridge] ⚠️ bootstrap 폴더 읽기 실패:`, e);
      }
    } else {
      console.error(`[OnVoiceBridge] ❌ bootstrap 폴더가 존재하지 않습니다: ${bootstrapBasePath}`);
      console.error(`[OnVoiceBridge] ❌ package.json의 extraResources 설정을 확인하세요.`);
    }
  }
}

// ⚠️ 중요: electron-edge-js를 최상단에서 require하지 않음
// 지연 로딩(Lazy Loading)을 위해 getBridgeFunc() 함수 내부에서 require하도록 변경
// 이렇게 하면 환경 변수가 확실히 설정된 후에 electron-edge-js가 로드됩니다.

// .env 파일 로드 (이 모듈이 import될 때 실행)
// 여러 경로를 시도하여 .env 파일 찾기
let envLoaded = false;
function ensureEnvLoaded() {
  if (envLoaded) return;
  
  try {
    // 시도할 경로 목록
    const possiblePaths: string[] = [];
    
    // 1. 배포 환경: process.resourcesPath (extraResources로 복사된 .env 위치)
    if (app && app.isPackaged && process.resourcesPath) {
      possiblePaths.push(path.join(process.resourcesPath, ".env"));
    }
    
    // 2. 개발 모드: 프로젝트 루트 (__dirname 기준)
    possiblePaths.push(path.join(__dirname, "../../.env"));
    possiblePaths.push(path.join(__dirname, "../../../.env"));
    
    // 3. 프로덕션 모드: app.getAppPath() (fallback)
    if (app && app.isPackaged) {
      try {
        possiblePaths.push(path.join(app.getAppPath(), ".env"));
      } catch (e) {
        // app이 아직 초기화되지 않았을 수 있음
      }
    }
    
    // 4. 현재 작업 디렉토리
    possiblePaths.push(path.join(process.cwd(), ".env"));
    
    let loaded = false;
    for (const envPath of possiblePaths) {
      const envResult = dotenv.config({ path: envPath });
      if (!envResult.error && envResult.parsed) {
        console.log(`[OnVoiceBridge] ✅ .env 파일 로드 성공: ${envPath}`);
        console.log(`[OnVoiceBridge] .env 파일 내용:`, Object.keys(envResult.parsed));
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
    envLoaded = true; // 오류가 발생해도 다시 시도하지 않도록
  }
}

type EdgeCallback = (error: Error | null, result?: any) => void;
type EdgeFunc = (payload: any, callback: EdgeCallback) => void;

// 타임아웃: 5초
const BRIDGE_TIMEOUT_MS = 5000;

// 서버 설정
// ⚠️ 중요: .env 파일이 로드되기 전에 이 모듈이 import될 수 있으므로,
// SERVER_URL은 함수 내부에서 지연 평가(lazy evaluation)하도록 변경
function getServerUrl(): string {
  // .env 파일이 아직 로드되지 않았다면 로드 시도
  if (!envLoaded) {
    ensureEnvLoaded();
  }
  
  const serverUrl = process.env.SERVER_URL || "http://127.0.0.1:8000";
  
  // 디버깅: 환경 변수 상태 확인 (한 번만 출력)
  if (!process.env.SERVER_URL) {
    console.warn(`[OnVoiceBridge] ⚠️ SERVER_URL 환경 변수가 설정되지 않았습니다. 기본값 사용: ${serverUrl}`);
  }
  
  return serverUrl;
}
const SERVER_REQUEST_TIMEOUT = 5000;

// 🔇 키워드 리스트 주석처리 (kanana-lora-v1 모델만 사용)
// const HARMFUL_KEYWORDS = [
//   "새끼",
//   "시발",
//   "씨발",
//   "병신",
//   "꺼져",
//   "죽어",
//   "미친",
//   "지랄",
//   "존나",
//   "개새끼",
//   "느금마",
//   "애미",
//   "느개비",
//   "놈",
//   "년",
//   // 필요한 단어 추가
// ];

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

const events = new EventEmitter();

let bridgeFunc: EdgeFunc | null = null;
let initialized = false;

function getBridgeFunc(): EdgeFunc {
  if (bridgeFunc) return bridgeFunc;

  // ✅ 환경 변수 확실히 설정 (안전을 위해 매번 확인)
  if (!process.env.EDGE_USE_CORECLR) {
    process.env.EDGE_USE_CORECLR = "1";
  }
  console.log(`[OnVoiceBridge] 🔧 EDGE_USE_CORECLR: ${process.env.EDGE_USE_CORECLR}`);

  // ✅ 네이티브 모듈 경로 명시적 설정 (asar 언패킹 경로)
  if (app.isPackaged && !process.env.EDGE_NATIVE) {
    // 배포 모드: app.asar.unpacked 경로 사용
    // process.resourcesPath는 'resources' 폴더이므로, 상위 폴더로 이동해야 함
    const appPath = app.getAppPath(); // app.asar 경로
    const appDir = path.dirname(appPath); // app.asar가 있는 폴더 (dist/win-unpacked/resources)
    const electronVersion = process.versions.electron.split(".")[0] + ".0.0";
    const nativeModulePath = path.join(
      appDir,
      "app.asar.unpacked",
      "node_modules",
      "electron-edge-js",
      "lib",
      "native",
      "win32",
      "x64",
      electronVersion,
      "edge_coreclr.node"
    );
    
    // 파일이 존재하는지 확인
    const fs = require("fs");
    if (fs.existsSync(nativeModulePath)) {
      process.env.EDGE_NATIVE = nativeModulePath;
      console.log(`[OnVoiceBridge] 🔧 EDGE_NATIVE set to: ${nativeModulePath}`);
    } else {
      console.warn(`[OnVoiceBridge] ⚠️ 네이티브 모듈을 찾을 수 없습니다: ${nativeModulePath}`);
      // 대체 경로 시도 (직접 확인)
      const altPath = path.join(process.resourcesPath, "..", "app.asar.unpacked", "node_modules", "electron-edge-js", "lib", "native", "win32", "x64", electronVersion, "edge_coreclr.node");
      if (fs.existsSync(altPath)) {
        process.env.EDGE_NATIVE = altPath;
        console.log(`[OnVoiceBridge] 🔧 EDGE_NATIVE set to (대체 경로): ${altPath}`);
      }
    }
  }

  // ✅ 지연 로딩 (Lazy Load): 환경 변수가 설정된 후에 electron-edge-js 로드
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const edge = require("electron-edge-js");

  // 1. 경로 설정 (절대 경로 사용 - 핵심!)
  let assemblyFile: string;
  if (app.isPackaged) {
    // 배포 모드: resources/dotnet 폴더 안을 가리킴
    // process.resourcesPath는 'resources' 폴더까지의 절대 경로입니다.
    assemblyFile = path.join(process.resourcesPath, "dotnet", "OnVoiceComBridge.dll");
  } else {
    // 개발 모드: 로컬 빌드 폴더 가리킴 (절대 경로로 변환)
    const relativePath = path.join(__dirname, "../../dotnet/OnVoiceComBridge/bin/Publish/OnVoiceComBridge.dll");
    assemblyFile = path.resolve(relativePath);
  }

  // 2. 실행 (경로 확인용 로그 추가)
  console.log(`[OnVoiceBridge] Loading .NET DLL from: ${assemblyFile}`);
  console.log(`[OnVoiceBridge] DLL 경로 확인 (절대 경로): ${path.isAbsolute(assemblyFile) ? "✅ 절대 경로" : "❌ 상대 경로"}`);

  try {
    bridgeFunc = edge.func({
      assemblyFile, // 절대 경로 변수 사용
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

/**
 * 서버의 KoElectra/Kanana 모델을 사용하여 텍스트 유해성 분석
 * 
 * @param text 분석할 텍스트
 * @returns 분석 결과 (isHarmful, confidence)
 */
async function analyzeTextWithServer(text: string): Promise<{ isHarmful: boolean; confidence: number }> {
  // 빈 텍스트 처리
  if (!text || !text.trim()) {
    console.log(`[OnVoiceBridge] 빈 텍스트로 인해 분석을 건너뜁니다.`);
    return { isHarmful: false, confidence: 0.0 };
  }

  try {
    const serverUrl = getServerUrl();
    console.log(`[OnVoiceBridge] 서버 분석 요청: ${serverUrl}/analyze (텍스트: "${text.substring(0, 30)}${text.length > 30 ? "..." : ""}")`);
    
    const response = await axios.post<{
      has_violation: boolean;
      ai_analysis: {
        is_harmful: boolean;
        confidence: number;
      } | null;
    }>(
      `${serverUrl}/analyze`,
      { text: text.trim() },
      {
        timeout: SERVER_REQUEST_TIMEOUT,
        headers: { "Content-Type": "application/json" },
      }
    );

    // 서버 응답 파싱
    console.log(`[OnVoiceBridge] 서버 응답 수신:`, {
      has_violation: response.data.has_violation,
      ai_analysis: response.data.ai_analysis ? {
        is_harmful: response.data.ai_analysis.is_harmful,
        confidence: response.data.ai_analysis.confidence,
      } : null,
    });
    
    if (response.data.ai_analysis) {
      const result = {
        isHarmful: response.data.ai_analysis.is_harmful,
        confidence: response.data.ai_analysis.confidence,
      };
      console.log(`[OnVoiceBridge] ✅ AI 분석 결과: isHarmful=${result.isHarmful}, confidence=${result.confidence}`);
      return result;
    }

    // AI 분석이 없는 경우 has_violation 사용
    const result = {
      isHarmful: response.data.has_violation,
      confidence: response.data.has_violation ? 1.0 : 0.0,
    };
    console.log(`[OnVoiceBridge] ⚠️ AI 분석 없음, has_violation 사용: isHarmful=${result.isHarmful}`);
    return result;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      console.error(`[OnVoiceBridge] 서버 분석 요청 실패:`, {
        message: axiosError.message,
        code: axiosError.code,
        status: axiosError.response?.status,
      });
    } else {
      console.error(`[OnVoiceBridge] 서버 분석 요청 실패 (알 수 없는 오류):`, error);
    }

    // 서버 오류 시 안전하게 false 반환
    return { isHarmful: false, confidence: 0.0 };
  }
}

/**
 * 특정 PID의 애플리케이션 볼륨 조절 (C# Bridge)
 * @param pid 프로세스 ID
 * @param volume 0.0 ~ 1.0 사이의 실수
 * @returns 성공 여부
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
      logWithTimestamp(`[OnVoiceBridge] ⏱️ setVolumeByPid 성공 (C# Bridge 호출: ${bridgeCallElapsed}ms, 총: ${totalElapsed}ms)`);
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

export async function listAudioSessions(): Promise<BridgeAudioSession[]> {
  try {
    const result = await callBridge({ command: 'listSessions' });
    
    if (result && Array.isArray(result.sessions)) {
      return result.sessions as BridgeAudioSession[];
    }
    return [];
  } catch (error) {
    // 오류 발생 시에만 로그 출력
    errorWithTimestamp(`[OnVoiceBridge] 오디오 세션 조회 실패`, error);
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
      
      // OCR 텍스트 추출 로그
      console.log(`[OnVoiceBridge] 📝 OCR 텍스트 추출 완료: "${extractedText.substring(0, 50)}${extractedText.length > 50 ? "..." : ""}" (길이: ${extractedText.length})`);

      // 3. 서버의 KoElectra/Kanana 모델을 사용한 유해성 분석
      let analysisResult = { isHarmful: false, confidence: 0.0 };
      
      if (extractedText.trim().length > 0) {
        console.log(`[OnVoiceBridge] 🔍 서버에 유해성 분석 요청 중...`);
        analysisResult = await analyzeTextWithServer(extractedText);
        
        console.log(
          `[OnVoiceBridge] 📊 분석 결과: "${extractedText.substring(0, 30)}${extractedText.length > 30 ? "..." : ""}" | ` +
          `유해성: ${analysisResult.isHarmful ? "⚠️ 유해" : "✅ 정상"} (신뢰도: ${(analysisResult.confidence * 100).toFixed(1)}%)`
        );
      } else {
        console.log(`[OnVoiceBridge] ⚠️ 추출된 텍스트가 비어있어 분석을 건너뜁니다.`);
      }

      return {
        ok: true,
        text: extractedText,
        isHarmful: analysisResult.isHarmful,
        matchedKeywords: [], // 서버 모델은 키워드 리스트를 반환하지 않음
        confidence: analysisResult.confidence,
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
