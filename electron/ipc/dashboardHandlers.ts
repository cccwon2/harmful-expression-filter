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
 * OCR 모드로 전환하는 함수 (트레이에서 직접 호출 가능)
 */
export async function switchToOcrMode(): Promise<void> {
  console.log("[Dashboard] switchToOcrMode 호출됨");
  console.log(`[Dashboard] 현재 overlayWindow:`, overlayWindow ? '존재' : 'null');
  console.log(`[Dashboard] 현재 mainWindow:`, mainWindow ? '존재' : 'null');
  
  // OCR 모드 선택
  isOcrEnabled = true;
  isVoiceEnabled = false; // 음성 모드 비활성화
  
  // 음성 스트리밍이 활성화되어 있으면 중지
  try {
    const AudioManager = (await import("../main/AudioManager")).default;
    const audioManager = AudioManager.getInstance();
    if (audioManager.getStatus().isStreaming) {
      await audioManager.stopStream();
      console.log("[Dashboard] ✅ 음성 스트리밍 중지됨 (OCR 모드로 전환)");
    }
  } catch (error: any) {
    console.error("[Dashboard] 음성 스트리밍 중지 실패:", error.message);
  }
  
  // 오버레이 윈도우가 없으면 생성
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    console.log("[Dashboard] 오버레이 윈도우 생성 중...");
    overlayWindow = createOverlayWindow();
    setOverlayWindow(overlayWindow);
    
    // ROI 핸들러 설정
    const { startMonitoring: mainStartMonitoring, stopMonitoring: mainStopMonitoring, setCurrentROI: mainSetCurrentROI, setOverlayWindowInstance: mainSetOverlayWindow } = await import("../main");
    
    // main.ts의 전역 overlayWindow 변수도 업데이트
    if (mainSetOverlayWindow) {
      mainSetOverlayWindow(overlayWindow);
      console.log("[Dashboard] ✅ main.ts의 overlayWindow 업데이트 완료");
    }
    const onROISelected = (roi: ROI) => {
      currentROI = roi;
      console.log("[Dashboard] ROI 선택됨:", roi);
      
      // main.ts의 currentROI도 업데이트
      if (mainSetCurrentROI) {
        mainSetCurrentROI(roi);
        console.log("[Dashboard] main.ts의 currentROI 업데이트 완료");
      }
      
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
    
    // Ctrl+E/Q 핸들러 설정
    const { setExitEditModeAndHideHandler } = await import("../windows/createOverlayWindow");
    const mainModule = await import("../main");
    const { globalShortcut } = await import("electron");
    
    const handleExitEditModeAndHide = () => {
      console.log("[Dashboard] ✅ Exit Edit Mode and hide overlay (Ctrl+E/Q 핸들러 호출됨)");
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        const { setEditModeState } = require("../state/editMode");
        setEditModeState(false);
        overlayWindow.hide();
        overlayWindow.setSkipTaskbar(true);
        const mainStopMonitoring = (mainModule as any).stopMonitoring;
        if (mainStopMonitoring) {
          mainStopMonitoring("Exit edit mode and hide overlay request");
        }
        console.log("[Dashboard] ✅ 오버레이 숨김 완료");
      } else {
        console.warn("[Dashboard] ⚠️ 오버레이 윈도우가 없거나 파괴됨");
      }
    };
    setExitEditModeAndHideHandler(handleExitEditModeAndHide);
    
    // globalShortcut으로 Ctrl+E/Q 등록 (포커스 없이도 작동)
    const retCtrlE = globalShortcut.register("CommandOrControl+E", () => {
      console.log("[Dashboard] ✅ Ctrl+E globalShortcut 감지됨");
      if (overlayWindow && overlayWindow.isVisible()) {
        handleExitEditModeAndHide();
      }
    });
    const retCtrlQ = globalShortcut.register("CommandOrControl+Q", () => {
      console.log("[Dashboard] ✅ Ctrl+Q globalShortcut 감지됨");
      if (overlayWindow && overlayWindow.isVisible()) {
        handleExitEditModeAndHide();
      }
    });
    
    if (retCtrlE) {
      console.log("[Dashboard] ✅ Ctrl+E globalShortcut 등록 완료");
    } else {
      console.warn("[Dashboard] ⚠️ Ctrl+E globalShortcut 등록 실패");
    }
    if (retCtrlQ) {
      console.log("[Dashboard] ✅ Ctrl+Q globalShortcut 등록 완료");
    } else {
      console.warn("[Dashboard] ⚠️ Ctrl+Q globalShortcut 등록 실패");
    }
    
    console.log("[Dashboard] ✅ Ctrl+E/Q 핸들러 설정 완료 (globalShortcut + before-input-event)");
    
    // 트레이 생성 (오버레이 윈도우가 생성된 후)
    const { createTray } = await import("../tray");
    const { setTrayUpdateCallback, setTrayAudioUpdateCallback } = await import("../tray");
    const { setOverlayTrayUpdateCallback } = await import("../windows/createOverlayWindow");
    
    // main.ts의 함수들을 가져와서 트레이 핸들러에 전달
    const mainEnterSetupMode = (mainModule as any).enterSetupMode;
    const mainResetToSetupMode = (mainModule as any).resetToSetupMode;
    
    // 트레이 생성
    let trayInstance: ReturnType<typeof createTray> | null = null;
    try {
      // main.ts의 전역 tray 변수 확인
      const mainTray = (mainModule as any).tray;
      if (!mainTray) {
        if (!overlayWindow || overlayWindow.isDestroyed()) {
          console.error("[Dashboard] ❌ 오버레이 윈도우가 없거나 파괴됨 - 트레이 생성 불가");
        } else {
          trayInstance = createTray(overlayWindow, {
            enterSetupMode: mainEnterSetupMode || (() => {
              console.log("[Dashboard] enterSetupMode 호출됨");
            }),
            resetToSetupMode: mainResetToSetupMode || (() => {
              console.log("[Dashboard] resetToSetupMode 호출됨");
            }),
          });
          // main.ts의 setTrayInstance 함수를 통해 설정
          const setTrayInstance = (mainModule as any).setTrayInstance;
          if (setTrayInstance) {
            setTrayInstance(trayInstance);
            console.log("[Dashboard] ✅ 트레이 생성 완료 및 main.ts에 등록됨");
          } else {
            // fallback: 직접 설정
            (mainModule as any).tray = trayInstance;
            console.log("[Dashboard] ✅ 트레이 생성 완료 (fallback 방식)");
          }
          
          // 트레이가 제대로 생성되었는지 확인 및 강제 표시
          if (trayInstance) {
            console.log("[Dashboard] ✅ 트레이 인스턴스 확인됨");
            // 트레이 아이콘과 메뉴가 제대로 설정되었는지 확인
            try {
              // 컨텍스트 메뉴를 즉시 업데이트하여 표시되도록 함
              if (typeof (trayInstance as any).updateContextMenu === "function") {
                (trayInstance as any).updateContextMenu();
                console.log("[Dashboard] ✅ 트레이 컨텍스트 메뉴 업데이트 완료");
              }
            } catch (err: any) {
              console.error("[Dashboard] ❌ 트레이 메뉴 업데이트 실패:", err);
            }
          } else {
            console.error("[Dashboard] ❌ 트레이 인스턴스가 null입니다");
          }
        }
      } else {
        trayInstance = mainTray;
        console.log("[Dashboard] 트레이가 이미 존재함");
      }
      
      if (trayInstance) {
        const trayUpdateFn = () => {
          if (trayInstance && typeof (trayInstance as any).updateContextMenu === "function") {
            (trayInstance as any).updateContextMenu();
          }
        };
        setTrayUpdateCallback(trayUpdateFn);
        setOverlayTrayUpdateCallback(trayUpdateFn);
        setTrayAudioUpdateCallback(trayUpdateFn);
      }
    } catch (err: any) {
      console.error("[Dashboard] ❌ 트레이 생성 실패:", err);
      console.error("[Dashboard] 에러 상세:", err.message, err.stack);
    }
  }
  
  // setup 모드로 진입하여 ROI 선택 가능하도록 설정
  setEditModeState(true);
  setMode("setup");
  
  // 오버레이 표시
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    console.error("[Dashboard] ❌ 오버레이 윈도우가 없거나 파괴됨");
    return;
  }
  
  overlayWindow.show();
  overlayWindow.setSkipTaskbar(false);
  
  // 키보드 이벤트를 받기 위해 포커스 설정
  overlayWindow.focus();
  console.log("[Dashboard] 오버레이 포커스 설정 완료");
  
  // before-input-event 리스너가 등록되었는지 확인
  const listeners = overlayWindow.webContents.listenerCount('before-input-event');
  console.log(`[Dashboard] before-input-event 리스너 개수: ${listeners}`);
  
  // 오버레이가 완전히 로드되고 API가 준비될 때까지 기다린 후 setup 모드로 진입
  const enterSetupMode = () => {
    console.log("[Dashboard] 오버레이 준비 완료 - setup 모드로 진입");
    
    // 약간의 지연을 두어 렌더러가 완전히 준비될 때까지 대기
    setTimeout(() => {
      if (!overlayWindow || overlayWindow.isDestroyed()) {
        console.warn("[Dashboard] 오버레이가 이미 파괴됨");
        return;
      }
      
      // 포커스를 다시 설정하여 키보드 이벤트 수신 보장
      overlayWindow.focus();
      console.log("[Dashboard] 오버레이 포커스 재설정 완료");
      
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
      overlayWindow.focus();
      console.log("[Dashboard] 마우스 이벤트 활성화 및 포커스 설정 완료");
    }, 300);
  };
  
  // 오버레이가 이미 로드되어 있으면 즉시 setup 모드로 진입
  if (overlayWindow.webContents.isLoading()) {
    overlayWindow.webContents.once('did-finish-load', () => {
      enterSetupMode();
    });
  } else {
    // 이미 로드되어 있으면 약간의 지연 후 setup 모드로 진입
    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed() && !overlayWindow.webContents.isLoading()) {
        enterSetupMode();
      }
    }, 300);
  }
  
  // 메인 윈도우 숨김
  // mainWindow가 null이면 모든 윈도우에서 찾기
  let targetMainWindow = mainWindow;
  if (!targetMainWindow || targetMainWindow.isDestroyed()) {
    const allWindows = BrowserWindow.getAllWindows();
    targetMainWindow = allWindows.find((win: BrowserWindow) => {
      const url = win.webContents.getURL();
      return url.includes('index.html') || (!url.includes('overlay.html') && url !== '');
    }) || null;
    
    // 찾은 윈도우를 mainWindow에 저장
    if (targetMainWindow) {
      mainWindow = targetMainWindow;
    }
  }
  
  if (targetMainWindow && !targetMainWindow.isDestroyed()) {
    targetMainWindow.hide();
    console.log("[Dashboard] ✅ 메인 윈도우 숨김 완료");
  } else {
    console.warn("[Dashboard] ⚠️ 메인 윈도우를 찾을 수 없음 (이미 숨겨져 있거나 없음)");
  }
  
  console.log("[Dashboard] ✅ OCR 모드 활성화됨 - ROI 선택 대기 중");
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
      await switchToOcrMode();
      // OCR 모드 선택
      isOcrEnabled = true;
      isVoiceEnabled = false; // 음성 모드 비활성화
      
      // 음성 스트리밍이 활성화되어 있으면 중지
      try {
        const AudioManager = (await import("../main/AudioManager")).default;
        const audioManager = AudioManager.getInstance();
        if (audioManager.getStatus().isStreaming) {
          await audioManager.stopStream();
          console.log("[Dashboard] ✅ 음성 스트리밍 중지됨 (OCR 모드로 전환)");
        }
      } catch (error: any) {
        console.error("[Dashboard] 음성 스트리밍 중지 실패:", error.message);
      }
      
      // 오버레이 윈도우가 없으면 생성
      if (!overlayWindow || overlayWindow.isDestroyed()) {
        console.log("[Dashboard] 오버레이 윈도우 생성 중...");
        overlayWindow = createOverlayWindow();
        setOverlayWindow(overlayWindow);
        
        // ROI 핸들러 설정
        const { startMonitoring: mainStartMonitoring, stopMonitoring: mainStopMonitoring, setCurrentROI: mainSetCurrentROI, setOverlayWindowInstance: mainSetOverlayWindow } = await import("../main");
        
        // main.ts의 전역 overlayWindow 변수도 업데이트
        if (mainSetOverlayWindow) {
          mainSetOverlayWindow(overlayWindow);
          console.log("[Dashboard] ✅ main.ts의 overlayWindow 업데이트 완료");
        }
        const onROISelected = (roi: ROI) => {
          currentROI = roi;
          console.log("[Dashboard] ROI 선택됨:", roi);
          
          // main.ts의 currentROI도 업데이트
          if (mainSetCurrentROI) {
            mainSetCurrentROI(roi);
            console.log("[Dashboard] main.ts의 currentROI 업데이트 완료");
          }
          
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
        
        // Ctrl+E/Q 핸들러 설정
        const { setExitEditModeAndHideHandler } = await import("../windows/createOverlayWindow");
        const mainModule = await import("../main");
        const { globalShortcut } = await import("electron");
        
        const handleExitEditModeAndHide = () => {
          console.log("[Dashboard] ✅ Exit Edit Mode and hide overlay (Ctrl+E/Q 핸들러 호출됨)");
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            const { setEditModeState } = require("../state/editMode");
            setEditModeState(false);
            overlayWindow.hide();
            overlayWindow.setSkipTaskbar(true);
            const mainStopMonitoring = (mainModule as any).stopMonitoring;
            if (mainStopMonitoring) {
              mainStopMonitoring("Exit edit mode and hide overlay request");
            }
            console.log("[Dashboard] ✅ 오버레이 숨김 완료");
          } else {
            console.warn("[Dashboard] ⚠️ 오버레이 윈도우가 없거나 파괴됨");
          }
        };
        setExitEditModeAndHideHandler(handleExitEditModeAndHide);
        
        // globalShortcut으로 Ctrl+E/Q 등록 (포커스 없이도 작동)
        const retCtrlE = globalShortcut.register("CommandOrControl+E", () => {
          console.log("[Dashboard] ✅ Ctrl+E globalShortcut 감지됨");
          if (overlayWindow && overlayWindow.isVisible()) {
            handleExitEditModeAndHide();
          }
        });
        const retCtrlQ = globalShortcut.register("CommandOrControl+Q", () => {
          console.log("[Dashboard] ✅ Ctrl+Q globalShortcut 감지됨");
          if (overlayWindow && overlayWindow.isVisible()) {
            handleExitEditModeAndHide();
          }
        });
        
        if (retCtrlE) {
          console.log("[Dashboard] ✅ Ctrl+E globalShortcut 등록 완료");
        } else {
          console.warn("[Dashboard] ⚠️ Ctrl+E globalShortcut 등록 실패");
        }
        if (retCtrlQ) {
          console.log("[Dashboard] ✅ Ctrl+Q globalShortcut 등록 완료");
        } else {
          console.warn("[Dashboard] ⚠️ Ctrl+Q globalShortcut 등록 실패");
        }
        
        console.log("[Dashboard] ✅ Ctrl+E/Q 핸들러 설정 완료 (globalShortcut + before-input-event)");
        
        // 트레이 생성 (오버레이 윈도우가 생성된 후)
        const { createTray } = await import("../tray");
        const { setTrayUpdateCallback, setTrayAudioUpdateCallback } = await import("../tray");
        const { setOverlayTrayUpdateCallback } = await import("../windows/createOverlayWindow");
        
        // main.ts의 함수들을 가져와서 트레이 핸들러에 전달
        const mainEnterSetupMode = (mainModule as any).enterSetupMode;
        const mainResetToSetupMode = (mainModule as any).resetToSetupMode;
        
        // 트레이 생성
        let trayInstance: ReturnType<typeof createTray> | null = null;
        try {
          // main.ts의 전역 tray 변수 확인
          const mainTray = (mainModule as any).tray;
          if (!mainTray) {
            if (!overlayWindow || overlayWindow.isDestroyed()) {
              console.error("[Dashboard] ❌ 오버레이 윈도우가 없거나 파괴됨 - 트레이 생성 불가");
            } else {
              trayInstance = createTray(overlayWindow, {
                enterSetupMode: mainEnterSetupMode || (() => {
                  console.log("[Dashboard] enterSetupMode 호출됨");
                }),
                resetToSetupMode: mainResetToSetupMode || (() => {
                  console.log("[Dashboard] resetToSetupMode 호출됨");
                }),
              });
              // main.ts의 setTrayInstance 함수를 통해 설정
              const setTrayInstance = (mainModule as any).setTrayInstance;
              if (setTrayInstance) {
                setTrayInstance(trayInstance);
                console.log("[Dashboard] ✅ 트레이 생성 완료 및 main.ts에 등록됨");
              } else {
                // fallback: 직접 설정
                (mainModule as any).tray = trayInstance;
                console.log("[Dashboard] ✅ 트레이 생성 완료 (fallback 방식)");
              }
              
              // 트레이가 제대로 생성되었는지 확인 및 강제 표시
              if (trayInstance) {
                console.log("[Dashboard] ✅ 트레이 인스턴스 확인됨");
                // 트레이 아이콘과 메뉴가 제대로 설정되었는지 확인
                try {
                  // 컨텍스트 메뉴를 즉시 업데이트하여 표시되도록 함
                  if (typeof (trayInstance as any).updateContextMenu === "function") {
                    (trayInstance as any).updateContextMenu();
                    console.log("[Dashboard] ✅ 트레이 컨텍스트 메뉴 업데이트 완료");
                  }
                } catch (err: any) {
                  console.error("[Dashboard] ❌ 트레이 메뉴 업데이트 실패:", err);
                }
              } else {
                console.error("[Dashboard] ❌ 트레이 인스턴스가 null입니다");
              }
            }
          } else {
            trayInstance = mainTray;
            console.log("[Dashboard] 트레이가 이미 존재함");
          }
          
          if (trayInstance) {
            const trayUpdateFn = () => {
              if (trayInstance && typeof (trayInstance as any).updateContextMenu === "function") {
                (trayInstance as any).updateContextMenu();
              }
            };
            setTrayUpdateCallback(trayUpdateFn);
            setOverlayTrayUpdateCallback(trayUpdateFn);
            setTrayAudioUpdateCallback(trayUpdateFn);
          }
        } catch (err: any) {
          console.error("[Dashboard] ❌ 트레이 생성 실패:", err);
          console.error("[Dashboard] 에러 상세:", err.message, err.stack);
        }
      }
      
      // setup 모드로 진입하여 ROI 선택 가능하도록 설정
      setEditModeState(true);
      setMode("setup");
      
      // 오버레이 표시
      if (!overlayWindow || overlayWindow.isDestroyed()) {
        console.error("[Dashboard] ❌ 오버레이 윈도우가 없거나 파괴됨");
        return;
      }
      
      overlayWindow.show();
      overlayWindow.setSkipTaskbar(false);
      
      // 키보드 이벤트를 받기 위해 포커스 설정
      overlayWindow.focus();
      console.log("[Dashboard] 오버레이 포커스 설정 완료");
      
      // before-input-event 리스너가 등록되었는지 확인
      const listeners = overlayWindow.webContents.listenerCount('before-input-event');
      console.log(`[Dashboard] before-input-event 리스너 개수: ${listeners}`);
      
      // 오버레이가 완전히 로드되고 API가 준비될 때까지 기다린 후 setup 모드로 진입
      const enterSetupMode = () => {
        console.log("[Dashboard] 오버레이 준비 완료 - setup 모드로 진입");
        
        // 약간의 지연을 두어 렌더러가 완전히 준비될 때까지 대기
        setTimeout(() => {
          if (!overlayWindow || overlayWindow.isDestroyed()) {
            console.warn("[Dashboard] 오버레이가 이미 파괴됨");
            return;
          }
          
          // 포커스를 다시 설정하여 키보드 이벤트 수신 보장
          overlayWindow.focus();
          console.log("[Dashboard] 오버레이 포커스 재설정 완료");
          
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
          overlayWindow.focus();
          console.log("[Dashboard] 마우스 이벤트 활성화 및 포커스 설정 완료");
          
          // Windows에서 포커스를 보장하기 위해 약간의 지연 후 다시 포커스
          setTimeout(() => {
            if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
              overlayWindow.focus();
              console.log("[Dashboard] 오버레이 포커스 재설정 (지연 후)");
            }
          }, 100);
          
          // 포커스 설정
          overlayWindow.focus();
          console.log("[Dashboard] ✅ Setup 모드로 진입 완료 - ROI 선택 가능");
        }, 500); // 렌더러 API 준비를 위해 충분한 시간 대기
      };
      
      // 오버레이가 이미 로드된 경우
      if (overlayWindow && !overlayWindow.isDestroyed()) {
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
              if (overlayWindow && !overlayWindow.isDestroyed() && !overlayWindow.webContents.isLoading()) {
                enterSetupMode();
              }
            }, 300);
          });
        }
      }
      
      // 메인 윈도우 숨김
      // mainWindow가 null이면 모든 윈도우에서 찾기
      let targetMainWindow = mainWindow;
      if (!targetMainWindow || targetMainWindow.isDestroyed()) {
        const allWindows = BrowserWindow.getAllWindows();
        targetMainWindow = allWindows.find((win: BrowserWindow) => {
          const url = win.webContents.getURL();
          return url.includes('index.html') || (!url.includes('overlay.html') && url !== '');
        }) || null;
        
        // 찾은 윈도우를 mainWindow에 저장
        if (targetMainWindow) {
          mainWindow = targetMainWindow;
        }
      }
      
      if (targetMainWindow && !targetMainWindow.isDestroyed()) {
        targetMainWindow.hide();
        console.log("[Dashboard] ✅ 메인 윈도우 숨김 완료");
      } else {
        console.warn("[Dashboard] ⚠️ 메인 윈도우를 찾을 수 없음 (이미 숨겨져 있거나 없음)");
      }
      
      console.log("[Dashboard] ✅ OCR 모드 활성화됨 - ROI 선택 대기 중");
    } else if (mode === 'voice') {
      // 음성 모드 선택
      isVoiceEnabled = true;
      
      // 메인 윈도우 숨김
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
      
      // 트레이 생성 (음성 모드에서도 필요)
      const { createTray } = await import("../tray");
      const { setTrayUpdateCallback, setTrayAudioUpdateCallback } = await import("../tray");
      const mainModule = await import("../main");
      
      // main.ts의 함수들을 가져와서 트레이 핸들러에 전달
      const mainEnterSetupMode = (mainModule as any).enterSetupMode;
      const mainResetToSetupMode = (mainModule as any).resetToSetupMode;
      
      // 트레이 생성
      let trayInstance: ReturnType<typeof createTray> | null = null;
      try {
        // main.ts의 전역 tray 변수 확인
        const mainTray = (mainModule as any).tray;
        if (!mainTray) {
          // 메인 윈도우를 사용하여 트레이 생성 (오버레이 윈도우가 없으므로)
          if (!mainWindow || mainWindow.isDestroyed()) {
            console.error("[Dashboard] ❌ 메인 윈도우가 없거나 파괴됨 - 트레이 생성 불가");
          } else {
            trayInstance = createTray(mainWindow, {
              enterSetupMode: mainEnterSetupMode || (() => {
                console.log("[Dashboard] enterSetupMode 호출됨");
              }),
              resetToSetupMode: mainResetToSetupMode || (() => {
                console.log("[Dashboard] resetToSetupMode 호출됨");
              }),
            });
            // main.ts의 setTrayInstance 함수를 통해 설정
            const setTrayInstance = (mainModule as any).setTrayInstance;
            if (setTrayInstance) {
              setTrayInstance(trayInstance);
              console.log("[Dashboard] ✅ 트레이 생성 완료 및 main.ts에 등록됨 (음성 모드)");
            } else {
              // fallback: 직접 설정
              (mainModule as any).tray = trayInstance;
              console.log("[Dashboard] ✅ 트레이 생성 완료 (fallback 방식, 음성 모드)");
            }
            
            // 트레이가 제대로 생성되었는지 확인 및 강제 표시
            if (trayInstance) {
              try {
                const trayUpdateFn = () => {
                  if (trayInstance && typeof (trayInstance as any).updateContextMenu === "function") {
                    (trayInstance as any).updateContextMenu();
                  }
                };
                setTrayUpdateCallback(trayUpdateFn);
                setTrayAudioUpdateCallback(trayUpdateFn);
                // 트레이 메뉴 즉시 업데이트
                if (typeof (trayInstance as any).updateContextMenu === "function") {
                  (trayInstance as any).updateContextMenu();
                  console.log("[Dashboard] ✅ 트레이 컨텍스트 메뉴 업데이트 완료 (음성 모드)");
                }
              } catch (err: any) {
                console.error("[Dashboard] ❌ 트레이 메뉴 업데이트 실패:", err);
              }
            }
          }
        } else {
          trayInstance = mainTray;
          console.log("[Dashboard] 트레이가 이미 존재함 (음성 모드)");
        }
      } catch (err: any) {
        console.error("[Dashboard] ❌ 트레이 생성 실패 (음성 모드):", err);
        console.error("[Dashboard] 에러 상세:", err.message, err.stack);
      }
      
      // 음성 필터링 시작
      try {
        const AudioManager = (await import("../main/AudioManager")).default;
        const audioManager = AudioManager.getInstance();
        
        if (!audioManager.getStatus().isStreaming) {
          await audioManager.startStream("chrome");
          console.log("[Dashboard] ✅ 음성 모드 활성화됨 (chrome)");
          
          // 스트리밍 시작 후 트레이 메뉴 업데이트 (약간의 지연을 두어 상태가 확실히 반영되도록)
          setTimeout(() => {
            if (trayInstance && typeof (trayInstance as any).updateContextMenu === "function") {
              try {
                (trayInstance as any).updateContextMenu();
                console.log("[Dashboard] ✅ 트레이 메뉴 업데이트 완료 (스트리밍 시작 후)");
              } catch (err: any) {
                console.error("[Dashboard] ❌ 트레이 메뉴 업데이트 실패:", err);
              }
            } else {
              // 트레이 업데이트 콜백을 통해 업데이트 시도
              const { getTrayAudioUpdateCallback } = require("../tray");
              const trayUpdateCallback = getTrayAudioUpdateCallback();
              if (trayUpdateCallback && typeof trayUpdateCallback === "function") {
                try {
                  trayUpdateCallback();
                  console.log("[Dashboard] ✅ 트레이 메뉴 업데이트 완료 (콜백 방식)");
                } catch (err: any) {
                  console.error("[Dashboard] ❌ 트레이 메뉴 업데이트 실패 (콜백):", err);
                }
              }
            }
          }, 200);
        } else {
          // 이미 스트리밍 중이면 메뉴만 업데이트
          if (trayInstance && typeof (trayInstance as any).updateContextMenu === "function") {
            try {
              (trayInstance as any).updateContextMenu();
              console.log("[Dashboard] ✅ 트레이 메뉴 업데이트 완료 (이미 스트리밍 중)");
            } catch (err: any) {
              console.error("[Dashboard] ❌ 트레이 메뉴 업데이트 실패:", err);
            }
          }
        }
      } catch (error: any) {
        console.error("[Dashboard] 음성 필터링 시작 실패:", error.message);
        if (error.stack) {
          console.error("[Dashboard] 에러 스택:", error.stack);
        }
        // Bridge 프로세스 관련 에러인 경우 추가 정보 제공
        if (error.message && error.message.includes("Bridge")) {
          console.error("[Dashboard] 💡 Bridge 프로세스 문제 해결 방법:");
          console.error("[Dashboard]    1. Visual C++ Redistributable 설치");
          console.error("[Dashboard]    2. npm run build:dotnet 실행");
          console.error("[Dashboard]    3. 앱 재시작");
        }
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

