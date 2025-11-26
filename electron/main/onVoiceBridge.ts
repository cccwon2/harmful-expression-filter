/**
 * OnVoice Electron Main Bridge Module
 */
import path from "node:path";
import { app } from "electron";
import { EventEmitter } from "events";
import axios, { AxiosError } from "axios";
import * as dotenv from "dotenv";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const edge = require("electron-edge-js");

// .env 파일 로드 (이 모듈이 import될 때 실행)
// 여러 경로를 시도하여 .env 파일 찾기
let envLoaded = false;
function ensureEnvLoaded() {
  if (envLoaded) return;
  
  try {
    // 시도할 경로 목록
    const possiblePaths: string[] = [];
    
    // 1. 개발 모드: 프로젝트 루트 (__dirname 기준)
    possiblePaths.push(path.join(__dirname, "../../.env"));
    possiblePaths.push(path.join(__dirname, "../../../.env"));
    
    // 2. 프로덕션 모드: app.getAppPath() (app이 초기화된 경우)
    if (app && app.isPackaged) {
      try {
        possiblePaths.push(path.join(app.getAppPath(), ".env"));
      } catch (e) {
        // app이 아직 초기화되지 않았을 수 있음
      }
    }
    
    // 3. 현재 작업 디렉토리
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
      console.log(`[OnVoiceBridge] ⏱️ setVolumeByPid 성공 (C# Bridge 호출: ${bridgeCallElapsed}ms, 총: ${totalElapsed}ms)`);
      return true;
    } else {
      console.warn(`[OnVoiceBridge] ⚠️ setVolumeByPid 실패 (${totalElapsed}ms)`);
      return false;
    }
  } catch (error) {
    const totalElapsed = Date.now() - startTime;
    console.error(`[OnVoiceBridge] 볼륨 조절 실패 (PID: ${pid}, ${totalElapsed}ms)`, error);
    return false;
  }
}

export async function listAudioSessions(): Promise<BridgeAudioSession[]> {
  const startTime = Date.now();
  try {
    const bridgeCallStartTime = Date.now();
    const result = await callBridge({ command: 'listSessions' });
    const bridgeCallElapsed = Date.now() - bridgeCallStartTime;
    
    if (result && Array.isArray(result.sessions)) {
      const totalElapsed = Date.now() - startTime;
      console.log(`[OnVoiceBridge] ⏱️ listAudioSessions 성공 (C# Bridge 호출: ${bridgeCallElapsed}ms, 총: ${totalElapsed}ms, 세션 수: ${result.sessions.length})`);
      return result.sessions as BridgeAudioSession[];
    }
    const totalElapsed = Date.now() - startTime;
    console.warn(`[OnVoiceBridge] ⚠️ listAudioSessions 결과 형식 오류 (${totalElapsed}ms)`);
    return [];
  } catch (error) {
    const totalElapsed = Date.now() - startTime;
    console.error(`[OnVoiceBridge] 오디오 세션 조회 실패 (${totalElapsed}ms)`, error);
    return [];
  }
  return [];
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
