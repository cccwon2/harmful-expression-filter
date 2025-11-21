/**
 * OnVoice Electron Main Bridge Module
 * 
 * electron-edge-js를 사용하여 C# COM wrapper와 통신하는 브리지 모듈
 * 
 * 이 bridge는 winax 대체 역할을 하며, Node/Electron에서는 StartCapture(pid) / StopCapture + audio 이벤트 스트림만 신경 쓰면 됩니다.
 * COM 이벤트 구현부(SubscribeComEvents / OnAudioData)는 C# 측에서 실제 OnVoice COM 인터페이스에 맞게 채워야 합니다.
 */

// electron/main/onvoiceBridge.ts
import path from "node:path";
import { EventEmitter } from "events";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const edge = require("electron-edge-js");

type EdgeCallback = (error: Error | null, result?: any) => void;
type EdgeFunc = (payload: any, callback: EdgeCallback) => void;

export interface OnVoiceBridge {
  events: EventEmitter;
  init(onAudioData: (pcm: Buffer) => void): Promise<void>;
  startCapture(pid: number): Promise<void>;
  stopCapture(): Promise<void>;
}

const events = new EventEmitter();

let bridgeFunc: EdgeFunc | null = null;
let initialized = false;

function getBridgeFunc(): EdgeFunc {
  if (bridgeFunc) return bridgeFunc;

  // NOTE: DLL은 dist-electron/dotnet/OnVoiceComBridge.dll에 복사됨
  // __dirname은 빌드된 JavaScript 파일의 위치 (dist-electron/main/)
  // 상위 디렉토리로 올라가서 dotnet 폴더 접근
  const assemblyFile = path.join(
    __dirname,
    "..",
    "dotnet",
    "OnVoiceComBridge.dll"
  );

  bridgeFunc = edge.func({
    assemblyFile,
    typeName: "OnVoiceComBridge.Startup",
    methodName: "Invoke",
  });

  return bridgeFunc!;
}

function callBridge(payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const func = getBridgeFunc();
    func(payload, (err: Error | null, result?: any) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

export const onVoiceBridge: OnVoiceBridge = {
  events,

  async init(onAudioData: (pcm: Buffer) => void): Promise<void> {
    if (initialized) return;

    await callBridge({
      command: "init",

      // This function is marshalled to C# as Func<object, Task<object>>
      // C# will call it with: { type: "audio", data: byte[] }
      onAudioData: function (msg: any, cb: EdgeCallback) {
        try {
          // Null 체크
          if (!msg) {
            console.warn('[OnVoiceBridge] 메시지가 null입니다.');
            cb(null, { ok: true });
            return;
          }

          if (msg.type === "audio" && msg.data) {
            try {
              const buf = Buffer.from(msg.data);
              
              // DEBUG: 반복 로그는 디버그 레벨로만 출력 (프로덕션에서는 표시되지 않음)
              // console.debug(`[OnVoiceBridge] 오디오 데이터 수신: ${buf.length} bytes`);
              
              // Emit event for listeners (예외가 발생해도 계속 진행)
              try {
                events.emit("audio", buf);
              } catch (emitErr) {
                console.error('[OnVoiceBridge] events.emit 오류:', emitErr);
              }
              
              // Invoke user callback (예외가 발생해도 계속 진행)
              try {
                onAudioData(buf);
              } catch (callbackErr) {
                console.error('[OnVoiceBridge] onAudioData 콜백 오류:', callbackErr);
              }
            } catch (bufErr) {
              console.error('[OnVoiceBridge] Buffer.from 오류:', bufErr);
            }
          } else {
            console.warn('[OnVoiceBridge] 예상하지 못한 메시지 형식:', msg);
          }

          // 항상 성공 응답 (예외가 발생해도 C#에 성공 응답을 보내서 COM 스레드가 블록되지 않도록 함)
          cb(null, { ok: true });
        } catch (e: any) {
          console.error('[OnVoiceBridge] 콜백 처리 오류:', e);
          // 예외가 발생해도 성공 응답을 보냄 (COM 스레드가 블록되지 않도록)
          cb(null, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      },
    });

    initialized = true;
  },

  async startCapture(pid: number): Promise<void> {
    await callBridge({ command: "start", pid });
  },

  async stopCapture(): Promise<void> {
    await callBridge({ command: "stop" });
  },
};

