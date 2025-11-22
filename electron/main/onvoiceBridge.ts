/**
 * OnVoice Electron Main Bridge Module
 */
import path from "node:path";
import { app } from "electron"; // app.isPackaged 확인용
import { EventEmitter } from "events";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const edge = require("electron-edge-js");

type EdgeCallback = (error: Error | null, result?: any) => void;
type EdgeFunc = (payload: any, callback: EdgeCallback) => void;

export interface OnVoiceBridge {
  events: EventEmitter;
  init(onAudioData: (pcm: Buffer) => void): Promise<void>;
  findProcess(target: "chrome" | "edge" | "discord"): Promise<number>;
  startCapture(pid: number): Promise<void>;
  stopCapture(): Promise<void>;
}

const events = new EventEmitter();

let bridgeFunc: EdgeFunc | null = null;
let initialized = false;

function getBridgeFunc(): EdgeFunc {
  if (bridgeFunc) return bridgeFunc;

  // 🛠️ DLL 경로 전략:
  // 1. 개발 모드: dist-electron/main/../../dotnet/... (프로젝트 루트의 dotnet 폴더 참조 or 복사된 폴더)
  // 2. 배포 모드(Production): resources/dotnet/... (electron-builder의 extraResources 설정 필요)

  let assemblyFile: string;

  if (app.isPackaged) {
    // 프로덕션: resources/dotnet/OnVoiceComBridge.dll
    assemblyFile = path.join(process.resourcesPath, "dotnet", "OnVoiceComBridge.dll");
  } else {
    // 개발: dist-electron/dotnet/OnVoiceComBridge.dll (copy:dll 스크립트 의존)
    // 현재 파일 위치: dist-electron/main/onVoiceBridge.js
    assemblyFile = path.join(__dirname, "..", "dotnet", "OnVoiceComBridge.dll");
  }

  // 디버깅용 경로 출력
  console.log(`[OnVoiceBridge] Loading DLL from: ${assemblyFile}`);

  try {
    bridgeFunc = edge.func({
      assemblyFile,
      typeName: "OnVoiceComBridge.Startup",
      methodName: "Invoke",
    });
  } catch (e) {
    console.error(`[OnVoiceBridge] ❌ DLL 로드 실패. 경로를 확인하세요: ${assemblyFile}`, e);
    throw e;
  }

  return bridgeFunc!;
}

function callBridge(payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const func = getBridgeFunc();
      func(payload, (err: Error | null, result?: any) => {
        if (err) return reject(err);
        if (result && result.ok === false) {
          // C# 내부 로직 에러 처리
          return reject(new Error(result.error || "Unknown C# Error"));
        }
        resolve(result);
      });
    } catch (e) {
      reject(e);
    }
  });
}

export const onVoiceBridge: OnVoiceBridge = {
  events,

  async init(onAudioData: (pcm: Buffer) => void): Promise<void> {
    if (initialized) {
      console.log("[OnVoiceBridge] 이미 초기화되었습니다.");
      return;
    }

    await callBridge({
      command: "init",
      // C# -> Node.js 역방향 콜백
      onAudioData: function (msg: any, cb: EdgeCallback) {
        // 로깅 스로틀링 (너무 많은 로그 방지)
        const callId = Math.floor(Math.random() * 10000);
        const shouldLog = callId % 200 === 0; // 약 0.5% 확률로만 로그

        try {
          if (msg && msg.type === "audio" && msg.data) {
            // Buffer 변환
            const buf = Buffer.from(msg.data);

            if (shouldLog) {
              console.log(`[AudioStream] 🎵 ${buf.length} bytes received.`);
            }

            // 1. 이벤트 방식 (옵션)
            events.emit("audio", buf);

            // 2. 직접 콜백 호출
            onAudioData(buf);
          }

          // ✅ C# Task 완료 신호 전송 (필수)
          cb(null, { ok: true });
        } catch (e: any) {
          console.error(`[OnVoiceBridge] Callback Error:`, e);
          // 에러가 나도 C# 쪽 스레드가 멈추지 않게 성공으로 응답
          cb(null, { ok: false });
        }
      },
    });

    initialized = true;
    console.log("[OnVoiceBridge] 초기화 완료");
  },

  // 🔍 프로세스 찾기 기능 추가
  async findProcess(target: "chrome" | "edge" | "discord"): Promise<number> {
    console.log(`[OnVoiceBridge] 찾는 중: ${target}...`);
    const result = await callBridge({ command: "find", target });

    // result = { ok: true, pid: 1234 }
    const pid = result.pid;
    console.log(`[OnVoiceBridge] ${target} PID 발견: ${pid}`);
    return pid;
  },

  async startCapture(pid: number): Promise<void> {
    console.log(`[OnVoiceBridge] 캡처 시작 요청: PID=${pid}`);
    await callBridge({ command: "start", pid });
    console.log(`[OnVoiceBridge] 캡처 시작됨`);
  },

  async stopCapture(): Promise<void> {
    console.log(`[OnVoiceBridge] 캡처 중지 요청`);
    await callBridge({ command: "stop" });
    console.log(`[OnVoiceBridge] 캡처 중지됨`);
  },
};
