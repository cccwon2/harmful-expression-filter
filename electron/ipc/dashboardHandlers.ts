import { ipcMain, BrowserWindow } from "electron";
import { DASHBOARD_CHANNELS, IPC_CHANNELS } from "./channels";
import { createOverlayWindow } from "../windows/createOverlayWindow";
import { setOverlayWindow, setEditModeState } from "../state/editMode";
import { setupROIHandlers, type ROI } from "./roi";
import { setMode, getROI } from "../store";

// main.ts에서 export된 함수를 동적으로 import
let startMonitoringFn: (() => void) | null = null;
let stopMonitoringFn: ((reason?: string) => void) | null = null;
let currentROI: ROI | null = null;

async function getMonitoringFunctions() {
  if (!startMonitoringFn || !stopMonitoringFn) {
    try {
      const mainModule = await import("../main");
      startMonitoringFn = (mainModule as any).startMonitoring;
      stopMonitoringFn = (mainModule as any).stopMonitoring;
    } catch (error) {
      console.error("[Dashboard] 모니터링 함수 import 실패:", error);
    }
  }
  return { startMonitoringFn, stopMonitoringFn };
}

let overlayWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let isOcrEnabled = false;
let isVoiceEnabled = false;

/**
 * 윈도우 참조 설정
 */
export function setWindows(overlay: BrowserWindow | null, main: BrowserWindow | null) {
  overlayWindow = overlay;
  mainWindow = main;
}

/**
 * 대시보드 IPC 핸들러 등록
 */
export function registerDashboardHandlers(): void {
  console.log("[IPC] 대시보드 IPC 핸들러 등록 중...");

  // 모드 선택 (OCR 또는 음성)
  ipcMain.on(DASHBOARD_CHANNELS.SELECT_MODE, async (event, mode: 'ocr' | 'voice') => {
    console.log(`[Dashboard] 모드 선택 핸들러 호출됨: ${mode}`);
    console.log(`[Dashboard] 현재 overlayWindow:`, overlayWindow ? '존재' : 'null');
    console.log(`[Dashboard] 현재 mainWindow:`, mainWindow ? '존재' : 'null');
    
    if (mode === 'ocr') {
      // OCR 모드 선택
      isOcrEnabled = true;
      
      // 오버레이 윈도우가 없으면 생성
      if (!overlayWindow || overlayWindow.isDestroyed()) {
        console.log("[Dashboard] 오버레이 윈도우 생성 중...");
        overlayWindow = createOverlayWindow();
        setOverlayWindow(overlayWindow);
        
        // ROI 핸들러 설정
        const { startMonitoring: mainStartMonitoring, stopMonitoring: mainStopMonitoring } = await import("../main");
        const onROISelected = (roi: ROI) => {
          currentROI = roi;
          console.log("[Dashboard] ROI 선택됨:", roi);
          if (mainStartMonitoring) {
            mainStartMonitoring();
          }
        };
        const onROICancelled = () => {
          if (mainStopMonitoring) {
            mainStopMonitoring("ROI 선택 취소");
          }
        };
        setupROIHandlers(overlayWindow, {
          onROISelected,
          onROICancelled,
        });
        
        // main.ts의 함수 참조 업데이트
        startMonitoringFn = mainStartMonitoring;
        stopMonitoringFn = mainStopMonitoring;
        
        // OnVoice 핸들러 등록
        const { registerOnVoiceHandlers } = await import("./onVoiceHandlers");
        registerOnVoiceHandlers(overlayWindow);
        
        // Audio 핸들러 등록
        const { registerAudioHandlers } = await import("./audioHandlers");
        registerAudioHandlers(overlayWindow);
        
        // 트레이는 main.ts에서 생성되므로 여기서는 생성하지 않음
        // (오버레이 윈도우가 생성된 후 main.ts에서 트레이를 생성할 수 있도록 별도 처리 필요)
      }
      
      // setup 모드로 진입하여 ROI 선택 가능하도록 설정
      setEditModeState(true);
      setMode("setup");
      
      // 오버레이 표시
      overlayWindow.show();
      overlayWindow.setSkipTaskbar(false);
      
      // 오버레이가 완전히 로드되고 API가 준비될 때까지 기다린 후 setup 모드로 진입
      const enterSetupMode = () => {
        console.log("[Dashboard] 오버레이 준비 완료 - setup 모드로 진입");
        
        // 약간의 지연을 두어 렌더러가 완전히 준비될 때까지 대기
        setTimeout(() => {
          if (overlayWindow.isDestroyed()) {
            console.warn("[Dashboard] 오버레이가 이미 파괴됨");
            return;
          }
          
          // setup 모드 신호 전송
          overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_SET_MODE, "setup");
          console.log("[Dashboard] OVERLAY_SET_MODE 전송: setup");
          
          const storedROI = getROI();
          const statePayload = {
            mode: "setup" as const,
            harmful: false,
            ...(storedROI ? { roi: storedROI } : {}),
          };
          overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_PUSH, statePayload);
          console.log("[Dashboard] OVERLAY_STATE_PUSH 전송:", statePayload);
          
          // 마우스 이벤트 활성화하여 ROI 선택 가능하도록
          overlayWindow.setIgnoreMouseEvents(false);
          console.log("[Dashboard] 마우스 이벤트 활성화됨");
          
          // 포커스 설정
          overlayWindow.focus();
          console.log("[Dashboard] ✅ Setup 모드로 진입 완료 - ROI 선택 가능");
        }, 500); // 렌더러 API 준비를 위해 충분한 시간 대기
      };
      
      // 오버레이가 이미 로드된 경우
      if (!overlayWindow.webContents.isLoading()) {
        console.log("[Dashboard] 오버레이 이미 로드됨 - setup 모드로 진입");
        enterSetupMode();
      } else {
        // 오버레이가 아직 로드 중인 경우 로드 완료 대기
        console.log("[Dashboard] 오버레이 로드 대기 중...");
        
        // did-finish-load 이벤트 대기
        overlayWindow.webContents.once("did-finish-load", () => {
          console.log("[Dashboard] 오버레이 로드 완료 (did-finish-load)");
          enterSetupMode();
        });
        
        // dom-ready 이벤트도 대기 (더 빠른 진입을 위해)
        overlayWindow.webContents.once("dom-ready", () => {
          console.log("[Dashboard] 오버레이 DOM 준비 완료 (dom-ready)");
          // did-finish-load와 중복 방지를 위해 약간의 지연
          setTimeout(() => {
            if (!overlayWindow.isDestroyed() && !overlayWindow.webContents.isLoading()) {
              enterSetupMode();
            }
          }, 300);
        });
      }
      
      // 메인 윈도우 숨김
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
      
      console.log("[Dashboard] ✅ OCR 모드 활성화됨 - ROI 선택 대기 중");
    } else if (mode === 'voice') {
      // 음성 모드 선택
      isVoiceEnabled = true;
      
      // 메인 윈도우 숨김
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
      
      // 음성 필터링 시작
      try {
        const AudioManager = (await import("../main/AudioManager")).default;
        const audioManager = AudioManager.getInstance();
        
        if (!audioManager.getStatus().isStreaming) {
          await audioManager.startStream("chrome");
          console.log("[Dashboard] ✅ 음성 모드 활성화됨 (chrome)");
        }
      } catch (error: any) {
        console.error("[Dashboard] 음성 필터링 시작 실패:", error.message);
      }
    }
  });

  // OCR 필터링 토글
  ipcMain.on(DASHBOARD_CHANNELS.TOGGLE_OCR, async (event, isEnabled: boolean) => {
    console.log(`[Dashboard] OCR 필터링 토글: ${isEnabled}`);
    
    if (!overlayWindow) {
      console.warn("[Dashboard] 오버레이 윈도우가 없습니다.");
      return;
    }

    isOcrEnabled = isEnabled;

    if (isEnabled) {
      // 오버레이 표시 및 캡처 시작
      overlayWindow.show();
      overlayWindow.setSkipTaskbar(false);
      overlayWindow.setIgnoreMouseEvents(true, { forward: true }); // 클릭 투루
      
      // 오버레이에 캡처 시작 신호 전송
      overlayWindow.webContents.send(DASHBOARD_CHANNELS.OCR_STATUS_CHANGE, "start");
      
      // 모니터링 시작
      const { startMonitoringFn } = await getMonitoringFunctions();
      if (startMonitoringFn) {
        startMonitoringFn();
      } else {
        console.warn("[Dashboard] startMonitoring 함수를 찾을 수 없습니다.");
      }
      
      console.log("[Dashboard] ✅ OCR 필터링 활성화됨");
    } else {
      // 오버레이 숨김 및 캡처 중지
      overlayWindow.hide();
      overlayWindow.setSkipTaskbar(true);
      
      // 오버레이에 캡처 중지 신호 전송
      overlayWindow.webContents.send(DASHBOARD_CHANNELS.OCR_STATUS_CHANGE, "stop");
      
      // 모니터링 중지
      const { stopMonitoringFn } = await getMonitoringFunctions();
      if (stopMonitoringFn) {
        stopMonitoringFn("사용자에 의해 OCR 필터링 비활성화");
      } else {
        console.warn("[Dashboard] stopMonitoring 함수를 찾을 수 없습니다.");
      }
      
      console.log("[Dashboard] ✅ OCR 필터링 비활성화됨");
    }
  });

  // 음성 필터링 토글
  ipcMain.on(DASHBOARD_CHANNELS.TOGGLE_VOICE, async (event, isEnabled: boolean) => {
    console.log(`[Dashboard] 음성 필터링 토글: ${isEnabled}`);
    
    isVoiceEnabled = isEnabled;

    try {
      // AudioManager를 통한 음성 필터링 제어
      const AudioManager = (await import("../main/AudioManager")).default;
      const audioManager = AudioManager.getInstance();

      if (isEnabled) {
        // 음성 필터링 시작
        if (!audioManager.getStatus().isStreaming) {
          // 기본값으로 chrome 사용 (추후 사용자 선택 기능 추가 가능)
          await audioManager.startStream("chrome");
          console.log("[Dashboard] ✅ 음성 필터링 활성화됨 (chrome)");
        }
      } else {
        // 음성 필터링 중지
        if (audioManager.getStatus().isStreaming) {
          await audioManager.stopStream();
          console.log("[Dashboard] ✅ 음성 필터링 비활성화됨");
        }
      }
    } catch (error: any) {
      console.error("[Dashboard] 음성 필터링 토글 실패:", error.message);
    }
  });

  // 윈도우 상태 조회
  ipcMain.handle(DASHBOARD_CHANNELS.GET_WINDOW_STATUS, async () => {
    return {
      isOcrEnabled,
      isVoiceEnabled,
      isOverlayVisible: overlayWindow?.isVisible() ?? false,
    };
  });

  console.log("[IPC] 대시보드 IPC 핸들러 등록 완료");
}

