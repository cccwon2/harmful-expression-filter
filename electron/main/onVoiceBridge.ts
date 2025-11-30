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
let bridgeWarningShown = false; // 개발 모드에서 경고 메시지 한 번만 표시
const pendingRequests = new Map<
  string,
  { resolve: (value: any) => void; reject: (reason?: any) => void; timer: NodeJS.Timeout }
>();
const BRIDGE_TIMEOUT_MS = 10000; // Increased timeout for process startup
const SERVER_REQUEST_TIMEOUT = 2000; // OCR은 1초 이내 유해 판독 및 블러 처리가 목표이므로 2초로 설정
const SERVER_REQUEST_RETRY_COUNT = 0; // 재시도 없음 (타임아웃이 발생하면 즉시 false 반환)

function getBridgePath(): string {
  let exePath: string;
  if (app.isPackaged) {
    // [배포 모드] resources/bin/OnVoiceComBridge.exe
    // NSIS 설치 버전과 포터블 버전 모두 동일하게 process.resourcesPath 사용
    // - NSIS: {설치경로}/resources
    // - 포터블 (dir): {실행파일경로}/resources
    exePath = path.join(process.resourcesPath, "bin", "OnVoiceComBridge.exe");
  } else {
    // [개발 모드] Debug 빌드를 우선 사용, 없으면 Release 사용
    const debugPath = path.join(
      __dirname,
      "../../dotnet/OnVoiceComBridge/bin/Debug/net6.0/win-x64/publish/OnVoiceComBridge.exe"
    );
    const releasePath = path.join(
      __dirname,
      "../../dotnet/OnVoiceComBridge/bin/Release/net6.0/win-x64/publish/OnVoiceComBridge.exe"
    );

    // Debug 빌드가 있으면 사용, 없으면 Release 사용
    if (existsSync(debugPath)) {
      exePath = debugPath;
      console.log(`[OnVoiceBridge] 🔍 Debug 빌드 사용: ${debugPath}`);
    } else {
      exePath = releasePath;
      console.log(`[OnVoiceBridge] 🔍 Release 빌드 사용: ${releasePath}`);
    }
  }
  // 절대 경로로 변환하여 공백이나 특수 문자 문제 방지
  return path.resolve(exePath);
}

function spawnBridge(): void {
  if (bridgeProcess) return;

  // 개발 모드에서 이미 spawn이 실패한 경우 재시도하지 않음
  // 단, bridgeSpawnFailed 플래그를 리셋할 수 있는 옵션 제공 (디버깅용)
  if (!app.isPackaged && bridgeSpawnFailed) {
    // 개발 모드에서 재시도하려면 bridgeSpawnFailed를 false로 설정하거나
    // 앱을 재시작하면 다시 시도됩니다
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
      // Bridge 실행 파일이 있는 디렉토리를 작업 디렉토리로 설정
      // 이렇게 하면 COM DLL과 매니페스트 파일을 찾을 수 있습니다
      const bridgeDir = path.dirname(absolutePath);
      console.log(`[OnVoiceBridge] 📁 Bridge 작업 디렉토리: ${bridgeDir}`);

      bridgeProcess = spawn(absolutePath, [], {
        stdio: ["pipe", "pipe", "pipe"], // stdin, stdout, stderr 모두 pipe로 받아서 필터링
        windowsHide: true,
        cwd: bridgeDir, // 작업 디렉토리를 Bridge 실행 파일이 있는 폴더로 설정
        // Windows에서 실행 권한 문제를 피하기 위해 shell 옵션은 사용하지 않음
        // (shell: true는 보안상 권장되지 않음)
      });

      // stderr 필터링: 0자 추출 로그는 완전히 무시
      bridgeProcess.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        // 0자 추출 로그 패턴 매칭 (정규표현식 사용)
        const zeroCharPattern = /\[OnVoiceComBridge\]\s*OCR\s*완료:\s*0자\s*추출/;
        if (zeroCharPattern.test(text)) {
          return; // 0자 추출 로그는 완전히 무시
        }

        // 다른 stderr 로그는 개발 모드에서만 출력 (0자 추출 제외)
        if (!app.isPackaged) {
          const lines = text.split("\n");
          lines.forEach((line) => {
            const trimmedLine = line.trim();
            // 각 라인도 0자 추출 로그인지 확인
            if (trimmedLine && !zeroCharPattern.test(trimmedLine)) {
              console.error(`[Bridge stderr] ${trimmedLine}`);
            }
          });
        }
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
      // spawn이 동기적으로 실패한 경우 (예: UNKNOWN 에러, 파일 손상, VC++ 미설치 등)
      console.error(`[OnVoiceBridge] ❌ spawn 동기 에러: ${spawnError.message}`);

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

      // 0자 추출 OCR 로그 필터링
      if (line.includes("[OnVoiceComBridge] OCR 완료: 0자 추출")) {
        return; // 0자 추출 로그는 출력하지 않음
      }

      // C++ COM DLL의 로그 패턴 감지 (JSON이 아닌 로그는 필터링)
      // 이 로그들은 COM DLL 내부의 디버그 메시지로, JSON 파싱에서 제외해야 합니다
      const cppLogPatterns = [
        /^\[COnVoiceCapture\]/,
        /^\[ProcessHelper\]/,
        /^\[Engine\]/,
        /^\[GIT prep src/,
        /^\[conn \d+\]/,
        /^  \[GIT prep src/,
        /^  \[conn \d+\]/,
      ];

      const isCppLog = cppLogPatterns.some((pattern) => pattern.test(line));

      if (isCppLog) {
        // C++ DLL의 로그는 stderr로 출력 (JSON 파싱하지 않음)
        // 개발 모드에서만 출력하여 콘솔을 깔끔하게 유지
        if (!app.isPackaged) {
          console.error(`[COM DLL] ${line}`);
        }
        return;
      }

      // JSON 파싱 시도
      try {
        const msg = JSON.parse(line);
        handleBridgeMessage(msg);
      } catch (e) {
        // JSON 파싱 실패 시에도 경고만 출력 (C++ 로그가 아닌 경우에만)
        // C++ 로그는 이미 위에서 필터링되었으므로, 여기서는 실제 JSON 파싱 오류만 표시
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
      // 개발 모드에서 경고 메시지는 한 번만 출력
      if (!bridgeWarningShown) {
        console.warn(
          `[OnVoiceBridge] ⚠️ 개발 모드: Bridge 프로세스가 없어 명령을 건너뜁니다. (오디오 필터링 비활성화)`
        );
        bridgeWarningShown = true;
      }
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
let lastAnalyzedText = ""; // 중복 텍스트 필터링을 위한 변수 (서버 전송 방지)

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

  const serverUrl = getServerUrl();
  let lastError: any = null;

  // 재시도 로직
  for (let attempt = 0; attempt <= SERVER_REQUEST_RETRY_COUNT; attempt++) {
    try {
      if (attempt > 0) {
        // 재시도 전에 짧은 대기 (빠른 재시도를 위해 100ms)
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const response = await axios.post<{
        has_violation: boolean | number;
        ai_analysis: { is_harmful: boolean | number; confidence: number } | null;
      }>(`${serverUrl}/analyze`, { text: text.trim(), use_ai: true }, { timeout: SERVER_REQUEST_TIMEOUT });

      // 유해 표현 감지 시에만 상세 로그 출력
      const isHarmfulFromResponse = response.data.ai_analysis
        ? response.data.ai_analysis.is_harmful === true || response.data.ai_analysis.is_harmful === 1
        : response.data.has_violation === true || response.data.has_violation === 1;

      if (isHarmfulFromResponse) {
        console.log(`[OnVoiceBridge] 서버 AI 분석 응답:`, JSON.stringify(response.data, null, 2));
      }

      if (response.data.ai_analysis) {
        const isHarmful = response.data.ai_analysis.is_harmful === true || response.data.ai_analysis.is_harmful === 1;
        return {
          isHarmful,
          confidence: response.data.ai_analysis.confidence || 0.0,
        };
      }

      const isHarmful = response.data.has_violation === true || response.data.has_violation === 1;
      return {
        isHarmful,
        confidence: isHarmful ? 1.0 : 0.0,
      };
    } catch (error: any) {
      lastError = error;
      const isTimeout = error.code === "ECONNABORTED" || error.message?.includes("timeout");

      // 타임아웃이면 즉시 false 반환 (재시도 없음)
      if (isTimeout) {
        console.warn(
          `[OnVoiceBridge] ⚠️ 서버 AI 분석 타임아웃 (${SERVER_REQUEST_TIMEOUT}ms) - 유해하지 않은 것으로 간주`
        );
        return { isHarmful: false, confidence: 0.0 };
      }

      // 타임아웃이 아닌 다른 에러는 재시도
      if (attempt < SERVER_REQUEST_RETRY_COUNT) {
        continue; // 재시도
      } else {
        // 마지막 시도 실패 시에만 에러 로그 출력
        console.warn(`[OnVoiceBridge] ⚠️ 서버 AI 분석 실패:`, error.message || error);
        break; // 재시도 중단
      }
    }
  }

  // 모든 재시도 실패 시 false 반환
  return { isHarmful: false, confidence: 0.0 };
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
    // 개발 모드에서 Bridge가 없으면 빈 배열 반환 (경고는 callBridge에서 이미 출력됨)
    if (result === null) {
      return [];
    }
    if (result && Array.isArray(result.sessions)) return result.sessions as BridgeAudioSession[];
    return [];
  } catch (error: any) {
    // 개발 모드에서는 에러를 무시하고 빈 배열 반환 (경고는 callBridge에서 이미 출력됨)
    if (!app.isPackaged) {
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
    
    // 개발 모드에서 Bridge 프로세스가 없을 때 더 명확한 에러 메시지 제공
    if (!result) {
      if (!app.isPackaged) {
        throw new Error(
          "Bridge 프로세스를 찾을 수 없습니다. 오디오 필터링을 사용하려면:\n" +
          "1. Visual C++ Redistributable 설치: https://aka.ms/vs/17/release/vc_redist.x64.exe\n" +
          "2. Bridge 재빌드: npm run build:dotnet\n" +
          "3. 앱 재시작"
        );
      }
      throw new Error("Process not found: Bridge process is not available");
    }
    
    if (typeof result.pid !== "number") {
      throw new Error(`Process not found: Invalid response from bridge (target: ${target})`);
    }
    
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
      const normalizedText = extractedText.trim(); // 공백 정규화

      let analysisResult = { isHarmful: false, confidence: 0.0 };
      if (normalizedText.length > 0) {
        // 중복 텍스트 필터링: 같은 텍스트가 연속으로 나오면 서버 분석 건너뜀
        // 정규화된 텍스트로 비교 (공백, 줄바꿈 차이 무시)
        if (normalizedText === lastAnalyzedText) {
          // 중복 텍스트는 서버로 전송하지 않음 (DB 저장 방지)
          return {
            ok: true,
            text: extractedText,
            isHarmful: false, // 중복이므로 유해하지 않은 것으로 간주
            matchedKeywords: [],
            confidence: 0.0,
            blurredImage: undefined,
          };
        }

        // 새로운 텍스트인 경우에만 서버 분석 수행
        lastAnalyzedText = normalizedText;
        analysisResult = await analyzeTextWithServer(normalizedText);
        // 유해 표현 감지 시에만 로그 출력
        if (analysisResult.isHarmful) {
          console.warn(
            `[OnVoiceBridge] 🚨 유해 표현 감지: "${extractedText.substring(0, 50)}${
              extractedText.length > 50 ? "..." : ""
            }" (confidence: ${analysisResult.confidence.toFixed(3)})`
          );
        }
      } else {
        // 빈 텍스트인 경우 lastAnalyzedText 초기화하지 않음 (이전 텍스트 유지)
      }

      return {
        ok: true,
        text: extractedText,
        isHarmful: analysisResult.isHarmful || false,
        matchedKeywords: [], // 서버 AI 모델 기반으로만 동작하므로 키워드는 사용하지 않음
        confidence: analysisResult.confidence || 0.0,
        blurredImage: undefined,
      };
    } catch (error: any) {
      return { ok: false, error: error.message || "처리 중 오류" };
    }
  },
};
