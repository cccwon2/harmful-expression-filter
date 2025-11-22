/**
 * OnVoice IPC Wiring Skeleton
 * 
 * Renderer 프로세스와 OnVoice 브리지를 연결하는 IPC 핸들러 (TODO 레벨)
 * 
 * 이 파일은 skeleton이며, 실제 구현은 프로젝트 요구사항에 맞게 채워야 합니다.
 * 
 * Renderer 쪽에서는 `ipcRenderer.on("onvoice:audio", (event, buf) => { ... })` 로 수신합니다.
 */

// electron/main/ipc/onvoiceIpc.ts
import { ipcMain, WebContents } from "electron";
import { onVoiceBridge } from "../onVoiceBridge";

/**
 * OnVoice IPC 핸들러 등록
 * 
 * @param targetWebContents - 현재 overlay / UI 윈도우를 반환하는 함수
 * 
 * TODO: targetWebContents()는 main에서 현재 overlay / UI 윈도우를 반환하도록 구현해야 합니다.
 */
export function registerOnVoiceIpc(targetWebContents: () => WebContents | null) {
  // Renderer → start capture
  ipcMain.handle("onvoice:start-capture", async (_event, pid: number) => {
    await onVoiceBridge.startCapture(pid);
    return { ok: true };
  });

  // Renderer → stop capture
  ipcMain.handle("onvoice:stop-capture", async () => {
    await onVoiceBridge.stopCapture();
    return { ok: true };
  });

  // Server-side audio event → Renderer push
  onVoiceBridge.init((buf) => {
    const wc = targetWebContents();
    if (!wc) return;
    wc.send("onvoice:audio", buf);
  });

  // EventEmitter를 통한 audio 이벤트도 처리 (옵션)
  onVoiceBridge.events.on("audio", (buf: Buffer) => {
    const wc = targetWebContents();
    if (!wc) return;
    wc.send("onvoice:audio", buf);
  });
}

