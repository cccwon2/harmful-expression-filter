/**
 * OnVoice IPC 핸들러
 *
 * 렌더러 프로세스와 메인 프로세스 간 OnVoice COM 브리지 통신을 처리합니다.
 * 전역적으로 하나의 OnVoiceService 인스턴스를 사용하여 모든 윈도우에서 접근 가능합니다.
 */

import { ipcMain, BrowserWindow } from "electron";
import { ONVOICE_CHANNELS } from "./channels";
import { OnVoiceService, getOnVoiceService, setOnVoiceService } from "../audio/onVoiceService";

let registeredWindows: Set<BrowserWindow> = new Set();

/**
 * OnVoice 핸들러 등록 (전역 단일 인스턴스)
 * 여러 윈도우에서 호출 가능하며, 첫 번째 윈도우로 OnVoiceService를 초기화합니다.
 */
export function registerOnVoiceHandlers(window: BrowserWindow) {
  // OnVoiceService가 아직 초기화되지 않았으면 초기화
  if (!getOnVoiceService()) {
    // 첫 번째 윈도우로 초기화
    const service = new OnVoiceService(window, {
      deepgramApiKey: process.env.DEEPGRAM_API_KEY,
      serverWebSocketUrl: process.env.SERVER_WS_URL || "ws://127.0.0.1:8000/ws/audio",
      enableHarmfulAnalysis: true,
    });
    setOnVoiceService(service);
    console.log("[OnVoiceHandlers] OnVoiceService initialized with window:", window.id);

    // IPC 핸들러 등록 (한 번만 등록)
    registerIpcHandlers();
  } else {
    // 이미 초기화된 경우, 새 윈도우를 OnVoiceService에 등록
    const service = getOnVoiceService();
    if (service) {
      service.addWindow(window);
      console.log("[OnVoiceHandlers] Window added to OnVoiceService:", window.id);
    }
  }

  // 등록된 윈도우 추적
  registeredWindows.add(window);

  // 윈도우가 닫히면 등록 해제
  window.on("closed", () => {
    registeredWindows.delete(window);
    const service = getOnVoiceService();
    if (service) {
      service.removeWindow(window);
    }
    console.log("[OnVoiceHandlers] Window removed from OnVoiceService:", window.id);
  });
}

/**
 * IPC 핸들러 등록 (전역적으로 한 번만)
 */
function registerIpcHandlers() {
  const service = getOnVoiceService();
  if (!service) {
    console.error("[OnVoiceHandlers] OnVoiceService is not initialized");
    return;
  }

  // 이미 등록되었는지 확인 (중복 등록 방지)
  const handlers = ipcMain.listenerCount(ONVOICE_CHANNELS.START_CAPTURE);
  if (handlers > 0) {
    console.log("[OnVoiceHandlers] IPC handlers already registered");
    return;
  }

  ipcMain.handle(
    ONVOICE_CHANNELS.START_CAPTURE,
    async (_, payload: { target?: "edge" | "chrome" | "discord" | number }) => {
      try {
        const target = payload?.target || "chrome";
        await service.startMonitoring(target);
        return { success: true };
      } catch (err: any) {
        console.error("[OnVoiceHandlers] Failed to start capture:", err);
        return { success: false, error: err.message };
      }
    }
  );

  ipcMain.handle(ONVOICE_CHANNELS.STOP_CAPTURE, () => {
    service.stopMonitoring();
    return { success: true };
  });

  ipcMain.handle(ONVOICE_CHANNELS.GET_STATUS, () => {
    return service.getStatus();
  });

  console.log("[OnVoiceHandlers] IPC handlers registered");
}

/**
 * OnVoiceService 인스턴스 가져오기 (디버깅용)
 */
export function getOnVoiceServiceInstance(): OnVoiceService | null {
  return getOnVoiceService();
}

