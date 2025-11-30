import { app } from "electron";
import path from "node:path";
import { EventEmitter } from "events";
import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";
import axios from "axios";
import * as dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import { existsSync } from "fs";

// ==================================================================================
// 1. Separate Process Bridge Management
// ==================================================================================

let bridgeProcess: ChildProcess | null = null;
let bridgeReadline: readline.Interface | null = null;
let bridgeSpawnFailed = false; // 개발 모드에서 spawn 실패 플래그
const pendingRequests = new Map<
  string,
  { resolve: (value: any) => void; reject: (reason?: any) => void; timer: NodeJS.Timeout }
>();
const BRIDGE_TIMEOUT_MS = 10000; // Increased timeout for process startup
const SERVER_REQUEST_TIMEOUT = 5000;

function getBridgePath(): string {
  let exePath: string;
  if (app.isPackaged) {
    // [배포 모드] resources/bin/OnVoiceComBridge.exe
    // NSIS 설치 버전과 포터블 버전 모두 동일하게 process.resourcesPath 사용
    // - NSIS: {설치경로}/resources
    // - 포터블 (dir): {실행파일경로}/resources
    exePath = path.join(process.resourcesPath, "bin", "OnVoiceComBridge.exe");
  } else {
    // [개발 모드] dotnet publish 출력 경로
    exePath = path.join(
      __dirname,
      "../../dotnet/OnVoiceComBridge/bin/Release/net6.0/win-x64/publish/OnVoiceComBridge.exe"
    );
  }
  // 절대 경로로 변환하여 공백이나 특수 문자 문제 방지
  return path.resolve(exePath);
}

function spawnBridge(): void {
  if (bridgeProcess) return;

  // 개발 모드에서 이미 spawn이 실패한 경우 재시도하지 않음
  if (!app.isPackaged && bridgeSpawnFailed) {
    return;
  }

  const exePath = getBridgePath();
  console.log(`[OnVoiceBridge] 🚀 Spawning Bridge Process: ${exePath}`);

  // 파일 존재 여부 확인 (포터블 배포 포함)
  if (!existsSync(exePath)) {
    const errorMsg = `[OnVoiceBridge] ❌ Bridge executable not found: ${exePath}`;
    console.error(errorMsg);
    if (app.isPackaged) {
      console.error(`[OnVoiceBridge] 💡 배포 모드: process.resourcesPath = ${process.resourcesPath}`);
      console.error(`[OnVoiceBridge] 💡 예상 경로: ${path.join(process.resourcesPath, "bin", "OnVoiceComBridge.exe")}`);
      throw new Error(errorMsg);
    } else {
      // 개발 모드에서는 에러를 throw하지 않고 경고만 출력
      console.warn(`[OnVoiceBridge] ⚠️ 개발 모드: Bridge 실행 파일을 찾을 수 없습니다. 계속 진행합니다.`);
      bridgeProcess = null;
      return;
    }
  }

  try {
    // 절대 경로로 변환하여 사용
    const absolutePath = path.resolve(exePath);
    console.log(`[OnVoiceBridge] 📍 절대 경로: ${absolutePath}`);

    // 파일 존재 여부 재확인 (절대 경로 기준)
    if (!existsSync(absolutePath)) {
      throw new Error(`Bridge executable not found at absolute path: ${absolutePath}`);
    }

    // 파일 권한 및 실행 가능 여부 확인
    try {
      const fs = require("fs");
      fs.accessSync(absolutePath, fs.constants.F_OK | fs.constants.R_OK);
      console.log(`[OnVoiceBridge] ✅ 파일 접근 권한 확인됨`);
    } catch (accessError: any) {
      console.error(`[OnVoiceBridge] ❌ 파일 접근 권한 오류:`, accessError.message);
      throw new Error(`Cannot access bridge executable: ${accessError.message}`);
    }

    // spawn 시도 (기본 방법)
    // spawn은 동기적으로 에러를 throw할 수 있으므로 try-catch로 감싸야 함
    try {
      bridgeProcess = spawn(absolutePath, [], {
        stdio: ["pipe", "pipe", "inherit"], // stdin, stdout, stderr (inherit for debug)
        windowsHide: true,
        // Windows에서 실행 권한 문제를 피하기 위해 shell 옵션은 사용하지 않음
        // (shell: true는 보안상 권장되지 않음)
      });

      // spawn이 성공했지만 프로세스가 즉시 실패할 수 있으므로 error 이벤트 리스너를 먼저 등록
      bridgeProcess.on("error", (err) => {
        console.error("[OnVoiceBridge] ❌ Failed to spawn bridge process (비동기 에러):", err);
        bridgeProcess = null;
        // 개발 모드에서는 에러를 무시하고 계속 진행
        if (!app.isPackaged) {
          console.warn("[OnVoiceBridge] ⚠️ 개발 모드: Bridge 프로세스 에러를 무시합니다.");
          return;
        }
      });
    } catch (spawnError: any) {
      // spawn이 동기적으로 실패한 경우 (예: UNKNOWN 에러)

      // 개발 모드에서는 더 자세한 진단 정보 제공 (한 번만)
      if (!app.isPackaged) {
        if (!bridgeSpawnFailed) {
          // 첫 번째 실패 시에만 상세 정보 출력
          console.warn(`[OnVoiceBridge] ⚠️ 개발 모드: Bridge 실행 실패 (에러 코드: ${spawnError.code || "UNKNOWN"})`);
          console.warn(`[OnVoiceBridge] 💡 오디오 필터링을 사용하려면 다음을 해결하세요:`);
          console.warn(`[OnVoiceBridge]    1. Visual C++ Redistributable 설치 (필수):`);
          console.warn(`[OnVoiceBridge]       https://aka.ms/vs/17/release/vc_redist.x64.exe`);
          console.warn(`[OnVoiceBridge]    2. 설치 후 앱을 재시작하세요`);
          console.warn(`[OnVoiceBridge]    3. 또는 Bridge 재빌드: npm run build:dotnet`);
          console.warn("[OnVoiceBridge] ⚠️ 개발 모드: Bridge 없이 계속 진행합니다. (오디오 필터링 비활성화)");
          bridgeSpawnFailed = true; // 플래그 설정하여 재시도 방지
        }
        bridgeProcess = null;
        return; // 에러를 throw하지 않고 함수 종료
      }
      throw spawnError; // 배포 모드에서는 에러를 throw
    }

    // bridgeProcess가 null이 아닌 경우에만 이벤트 리스너 등록
    if (!bridgeProcess) {
      // spawn이 실패했지만 개발 모드에서는 계속 진행
      return;
    }

    bridgeProcess.on("exit", (code, signal) => {
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

    // bridgeProcess가 null이거나 stdout이 null인 경우 처리
    if (!bridgeProcess || !bridgeProcess.stdout) {
      // 개발 모드에서는 에러를 throw하지 않음
      if (!app.isPackaged) {
        console.warn("[OnVoiceBridge] ⚠️ 개발 모드: Bridge stdout이 없어 계속 진행합니다.");
        bridgeProcess = null;
        return;
      }
      throw new Error("Failed to spawn bridge: stdout is null");
    }

    // Setup Readline for line-by-line JSON parsing
    bridgeReadline = readline.createInterface({
      input: bridgeProcess.stdout,
      terminal: false,
    });

    bridgeReadline.on("line", (line) => {
      if (!line || !line.trim()) return;
      try {
        const msg = JSON.parse(line);
        handleBridgeMessage(msg);
      } catch (e) {
        console.error("[OnVoiceBridge] ⚠️ Failed to parse JSON from bridge:", line);
      }
    });
  } catch (e: any) {
    console.error("[OnVoiceBridge] ❌ Exception spawning bridge:", e);
    console.error("[OnVoiceBridge] 에러 상세:", {
      message: e.message,
      code: e.code,
      errno: e.errno,
      syscall: e.syscall,
      path: e.path, // absolutePath는 정의되어 있지 않으므로 사용하지 않음
    });

    // 개발 모드에서는 에러를 더 우아하게 처리
    if (!app.isPackaged) {
      console.warn("[OnVoiceBridge] ⚠️ 개발 모드: Bridge 실행 실패를 무시하고 계속 진행합니다.");
      console.warn("[OnVoiceBridge] 💡 Bridge는 음성 필터링 기능에 필요하지만, 개발 중에는 선택적입니다.");
      console.warn("[OnVoiceBridge] 💡 해결 방법:");
      console.warn("[OnVoiceBridge]    1. Visual C++ 재배포 가능 패키지 설치");
      console.warn("[OnVoiceBridge]    2. OnVoiceComBridge.exe 재빌드: npm run build:dotnet");
      console.warn("[OnVoiceBridge]    3. 또는 Bridge 없이 개발 진행 (음성 필터링 제외)");
      // 개발 모드에서는 에러를 throw하지 않고 null로 설정하여 계속 진행
      bridgeProcess = null;
      return;
    }

    // 배포 모드에서는 에러를 throw
    throw e;
  }
}

function handleBridgeMessage(msg: any) {
  if (msg.type === "response") {
    const req = pendingRequests.get(msg.id);
    if (req) {
      clearTimeout(req.timer);
      pendingRequests.delete(msg.id);
      req.resolve(msg.result);
    }
  } else if (msg.type === "error") {
    const req = pendingRequests.get(msg.id);
    if (req) {
      clearTimeout(req.timer);
      pendingRequests.delete(msg.id);
      req.reject(new Error(msg.error));
    } else {
      console.error(`[OnVoiceBridge] ❌ Unhandled Bridge Error: ${msg.error}`);
    }
  } else if (msg.type === "audio") {
    // Audio Data Push
    if (onVoiceBridge.onAudioDataCallback && msg.data) {
      // msg.data is Base64 string from C#
      const buffer = Buffer.from(msg.data, "base64");
      onVoiceBridge.onAudioDataCallback(buffer, msg.timestamp);
    }
  } else if (msg.type === "status") {
    console.log(`[OnVoiceBridge] ℹ️ Status: ${msg.message}`);
  }
}

function callBridge(command: string, payload: any = {}): Promise<any> {
  // Bridge 프로세스가 없으면 시작 시도
  if (!bridgeProcess) {
    try {
      spawnBridge();
    } catch (error: any) {
      // 개발 모드에서 Bridge 실행 실패 시 빈 응답 반환
      if (!app.isPackaged) {
        console.warn(`[OnVoiceBridge] ⚠️ Bridge 실행 실패로 인해 '${command}' 명령을 건너뜁니다.`);
        return Promise.resolve(null);
      }
      // 배포 모드에서는 에러를 throw
      throw error;
    }
  }

  // Bridge 프로세스가 여전히 null이면 (개발 모드에서 실행 실패한 경우)
  if (!bridgeProcess) {
    if (!app.isPackaged) {
      console.warn(`[OnVoiceBridge] ⚠️ Bridge 프로세스가 없어 '${command}' 명령을 건너뜁니다.`);
      return Promise.resolve(null);
    }
    return Promise.reject(new Error("Bridge process is not available"));
  }

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

    const json = JSON.stringify(request) + "\n";
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
  } catch (error) {
    envLoaded = true;
  }
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
      ai_analysis: { is_harmful: boolean; confidence: number } | null;
    }>(`${serverUrl}/analyze`, { text: text.trim() }, { timeout: SERVER_REQUEST_TIMEOUT });

    if (response.data.ai_analysis)
      return { isHarmful: response.data.ai_analysis.is_harmful, confidence: response.data.ai_analysis.confidence };
    return { isHarmful: response.data.has_violation, confidence: response.data.has_violation ? 1.0 : 0.0 };
  } catch (error) {
    return { isHarmful: false, confidence: 0.0 };
  }
}

export async function setVolumeByPid(pid: number, volume: number): Promise<boolean> {
  try {
    const result: any = await callBridge("setVolume", { pid, volume });
    return result && result.ok === true;
  } catch (error) {
    console.error(`[OnVoiceBridge] 볼륨 조절 실패 (PID: ${pid})`, error);
    return false;
  }
}

export async function listAudioSessions(): Promise<BridgeAudioSession[]> {
  try {
    const result: any = await callBridge("listSessions");
    // 개발 모드에서 Bridge가 없으면 빈 배열 반환
    if (result === null) {
      if (!app.isPackaged) {
        console.warn("[OnVoiceBridge] ⚠️ Bridge가 없어 빈 오디오 세션 목록을 반환합니다.");
      }
      return [];
    }
    if (result && Array.isArray(result.sessions)) return result.sessions as BridgeAudioSession[];
    return [];
  } catch (error: any) {
    // 개발 모드에서는 에러를 무시하고 빈 배열 반환
    if (!app.isPackaged) {
      console.warn(`[OnVoiceBridge] ⚠️ 개발 모드: 오디오 세션 조회 실패를 무시합니다.`, error?.message || error);
      return [];
    }
    console.error(`[OnVoiceBridge] 오디오 세션 조회 실패`, error);
    return [];
  }
}

export const onVoiceBridge: OnVoiceBridge = {
  events,
  onAudioDataCallback: undefined,
  async init(onAudioData: (pcm: Buffer, timestamp?: number) => void): Promise<void> {
    this.onAudioDataCallback = onAudioData;

    // 개발 모드에서 이미 spawn이 실패한 경우 초기화를 건너뜀
    if (!app.isPackaged && bridgeSpawnFailed) {
      console.warn("[OnVoiceBridge] ⚠️ 개발 모드: Bridge 초기화를 건너뜁니다. (이전 spawn 실패)");
      return;
    }

    try {
      spawnBridge();
      await callBridge("init");
      console.log("[OnVoiceBridge] 초기화 완료 (Separate Process)");
    } catch (error: any) {
      // 개발 모드에서는 에러를 무시하고 계속 진행
      if (!app.isPackaged) {
        console.warn("[OnVoiceBridge] ⚠️ 개발 모드: Bridge 초기화 실패를 무시합니다.");
        return;
      }
      throw error;
    }
  },
  async findProcess(target: string): Promise<number> {
    const result = await callBridge("find", { target });
    if (!result || typeof result.pid !== "number") throw new Error("Process not found");
    return result.pid;
  },
  async startCapture(pid: number): Promise<void> {
    await callBridge("start", { pid });
  },
  async stopCapture(): Promise<void> {
    await callBridge("stop");
  },
  async performOCR(imageBuffer: Buffer): Promise<OCRResult> {
    return this.performOCRAndAnalyze(imageBuffer);
  },
  async performOCRAndAnalyze(imageBuffer: Buffer, roi?: any): Promise<OCRResult> {
    try {
      // Buffer to Base64 for JSON transport
      const imageBase64 = imageBuffer.toString("base64");
      const result = await callBridge("ocr", { imageData: imageBase64 });

      if (!result || result.ok === false) return { ok: false, error: result?.error || "OCR 실패" };

      const extractedText = result.text || "";
      console.log(
        `[OnVoiceBridge] 📝 OCR 텍스트: "${extractedText.substring(0, 50)}${extractedText.length > 50 ? "..." : ""}"`
      );

      let analysisResult = { isHarmful: false, confidence: 0.0 };
      if (extractedText.trim().length > 0) analysisResult = await analyzeTextWithServer(extractedText);

      return {
        ok: true,
        text: extractedText,
        isHarmful: analysisResult.isHarmful,
        matchedKeywords: [],
        confidence: analysisResult.confidence,
        blurredImage: undefined,
      };
    } catch (error: any) {
      return { ok: false, error: error.message || "처리 중 오류" };
    }
  },
};
