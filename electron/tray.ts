import { app, Menu, Tray, BrowserWindow, nativeImage } from 'electron';
import type { NativeImage } from 'electron';
import * as path from 'path';
import { getEditModeState, setEditModeState } from './state/editMode';
import { IPC_CHANNELS } from './ipc/channels';
import AudioManager from './main/AudioManager';
import { getOnVoiceService } from './audio/onVoiceService';
import { getVolumeLevel, setVolumeLevel, getThreshold, setThreshold } from './store';

let tray: Tray | null = null;
let trayUpdateCallback: (() => void) | null = null;

type TrayHandlers = {
  enterSetupMode: () => void;
  resetToSetupMode?: () => void;
};

/**
 * 트레이 메뉴 업데이트 콜백 설정
 */
export function setTrayAudioUpdateCallback(callback: (() => void) | null): void {
  trayUpdateCallback = callback;
}

/**
 * 트레이 메뉴 업데이트 콜백 가져오기
 */
export function getTrayAudioUpdateCallback(): (() => void) | null {
  return trayUpdateCallback;
}

function createTrayIcon(isMonitoring: boolean = false): NativeImage {
  // 32x32 픽셀 버퍼 생성 (트레이 아이콘용)
  const size = 32;
  const bytesPerPixel = 4; // RGBA
  const buffer = Buffer.alloc(size * size * bytesPerPixel);

  // 모니터링 중이면 초록색 배경 (#10b981), 중지면 파란색 배경 (#2563eb)
  const bgR = isMonitoring ? 0x10 : 0x25;
  const bgG = isMonitoring ? 0xb9 : 0x63;
  const bgB = isMonitoring ? 0x81 : 0xeb;
  // 흰색 텍스트
  const textR = 255, textG = 255, textB = 255;

  // "H" 글자 그리기 (32x32 픽셀 중앙에 배치)
  const hWidth = 12;  // H 글자 너비
  const hHeight = 18; // H 글자 높이
  const hThickness = 3; // 막대 두께
  const hStartX = Math.floor((size - hWidth) / 2);
  const hStartY = Math.floor((size - hHeight) / 2);
  const hMiddleRow = Math.floor(hHeight / 2); // 가로 막대의 중간 행 위치 (상대 좌표)

  // 배경 채우기 및 H 글자 그리기
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * bytesPerPixel;

      // H 글자 영역인지 확인
      const inHArea = x >= hStartX && x < hStartX + hWidth &&
        y >= hStartY && y < hStartY + hHeight;

      let isText = false;
      if (inHArea) {
        const relX = x - hStartX;
        const relY = y - hStartY;

        // 왼쪽 세로 막대
        const leftBar = relX < hThickness;
        // 오른쪽 세로 막대
        const rightBar = relX >= hWidth - hThickness;
        // 중간 가로 막대 (중간 행 주변)
        const middleBar = relY >= hMiddleRow - 1 && relY <= hMiddleRow + 1;

        isText = leftBar || rightBar || (middleBar && relX >= hThickness && relX < hWidth - hThickness);
      }

      if (isText) {
        // 흰색 텍스트
        buffer[offset] = textR;
        buffer[offset + 1] = textG;
        buffer[offset + 2] = textB;
        buffer[offset + 3] = 255; // A
      } else {
        // 파란색 배경
        buffer[offset] = bgR;
        buffer[offset + 1] = bgG;
        buffer[offset + 2] = bgB;
        buffer[offset + 3] = 255; // A
      }
    }
  }

  // nativeImage 생성
  const icon = nativeImage.createFromBuffer(buffer, { width: size, height: size });

  // 시스템 트레이 크기에 맞게 리사이즈 (Windows는 보통 16x16, 고해상도는 20x20)
  // @2x 리소스도 생성 (고해상도 디스플레이용)
  return icon;
}

export function createTray(overlayWindow: BrowserWindow, handlers: TrayHandlers): Tray {
  // 트레이 아이콘 생성 (초기에는 모니터링 중지 상태)
  const icon = createTrayIcon(false);

  tray = new Tray(icon);

  // tray는 위에서 초기화되었으므로 null이 아님을 보장
  const trayInstance = tray;

  // 컨텍스트 메뉴 생성
  const updateContextMenu = () => {
    const isOverlayVisible = overlayWindow.isVisible();
    const isEditMode = getEditModeState();

    // AudioManager 상태 가져오기
    const audioManager = AudioManager.getInstance();
    const audioStatus = audioManager.getStatus();
    const isStreaming = audioStatus.isStreaming || false;
    const currentTarget = audioStatus.target || null;

    // 트레이 아이콘 업데이트 (스트리밍 상태에 따라 색상 변경)
    const newIcon = createTrayIcon(isStreaming);
    trayInstance.setImage(newIcon);

    // 트레이 툴팁 업데이트
    const tooltip = isStreaming
      ? `Harmful Expression Filter - 스트리밍 중 (${currentTarget || 'Unknown'})`
      : 'Harmful Expression Filter - 대기 중';
    trayInstance.setToolTip(tooltip);

    // 현재 Threshold 값 가져오기 (로컬 스토어에서)
    const currentThreshold = getCurrentThresholdSync();

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '영역 지정 (Select Region)',
        type: 'normal',
        click: () => {
          console.log('[Tray] Select Region requested');
          if (handlers?.enterSetupMode) {
            handlers.enterSetupMode();
          } else {
            overlayWindow.show();
            overlayWindow.setSkipTaskbar(false);
            overlayWindow.setIgnoreMouseEvents(false);
            overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_SET_MODE, 'setup');
            overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_PUSH, {
              mode: 'setup',
            });
          }
          updateContextMenu();
        },
      },
      {
        label: '영역 재지정 (Re-setup)',
        type: 'normal',
        click: () => {
          console.log('[Tray] Reset to setup mode');
          if (handlers?.resetToSetupMode) {
            handlers.resetToSetupMode();
          } else {
            overlayWindow.show();
            overlayWindow.setSkipTaskbar(false);
            overlayWindow.setIgnoreMouseEvents(false);
            overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_SET_MODE, 'setup');
            overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_PUSH, {
              mode: 'setup',
              harmful: false,
            });
          }
          updateContextMenu();
        },
      },
      {
        label: isOverlayVisible ? 'Hide Overlay' : 'Show Overlay',
        type: 'normal',
        click: () => {
          if (overlayWindow.isVisible()) {
            overlayWindow.hide();
            // 숨길 때 작업표시줄에서도 제거
            overlayWindow.setSkipTaskbar(true);
            // 오버레이 숨길 때 Edit Mode도 비활성화
            setEditModeState(false);
          } else {
            overlayWindow.show();
            overlayWindow.setSkipTaskbar(false); // 표시할 때만 작업표시줄에 표시
            // 오버레이 표시할 때 자동으로 Edit Mode 활성화
            setEditModeState(true);
            // 마우스 이벤트 활성화 확인 (setEditModeState에서 이미 처리되지만 명시적으로 확인)
            overlayWindow.setIgnoreMouseEvents(false);
            console.log('[Tray] Overlay shown, Edit Mode enabled, mouse events enabled');
            // 키보드 포커스를 명시적으로 설정
            overlayWindow.focus();
            // Windows에서 포커스를 보장하기 위해 약간의 지연 후 다시 포커스
            setTimeout(() => {
              if (overlayWindow && overlayWindow.isVisible()) {
                overlayWindow.focus();
                // 마우스 이벤트가 제대로 활성화되었는지 확인
                overlayWindow.setIgnoreMouseEvents(false);
                console.log('[Tray] Overlay focus and mouse events re-enabled after timeout');
              }
            }, 100);
          }
          updateContextMenu();
        },
      },
      {
        label: isEditMode ? 'Exit Edit Mode' : 'Edit Mode',
        type: 'normal',
        click: () => {
          // Edit Mode 토글
          if (isEditMode) {
            // Edit Mode 종료 시 오버레이도 숨김 (다른 창을 방해하지 않도록)
            setEditModeState(false);
            overlayWindow.hide();
            overlayWindow.setSkipTaskbar(true);
          } else {
            // Edit Mode 활성화 시 오버레이 표시
            overlayWindow.show();
            overlayWindow.setSkipTaskbar(false);
            setEditModeState(true);
            overlayWindow.setIgnoreMouseEvents(false);
            overlayWindow.focus();
          }
          updateContextMenu();
        },
      },
      {
        type: 'separator',
      },
      {
        label: 'Toggle DevTools',
        type: 'normal',
        click: () => {
          if (overlayWindow.isVisible()) {
            if (overlayWindow.webContents.isDevToolsOpened()) {
              overlayWindow.webContents.closeDevTools();
              // 개발자 도구가 닫히면 Edit Mode 상태에 따라 마우스 이벤트 설정
              setTimeout(() => {
                const { getEditModeState } = require('./state/editMode');
                const isEditMode = getEditModeState();
                if (isEditMode) {
                  overlayWindow.setIgnoreMouseEvents(false);
                  console.log('[Tray] Mouse events re-enabled after DevTools closed (Edit Mode active)');
                }
              }, 100);
            } else {
              // detach 모드로 열어서 완전히 독립된 창으로 표시 (이동 가능)
              overlayWindow.webContents.openDevTools({ mode: 'detach' });
              console.log('[Tray] DevTools opened in detach mode - window should be movable');

              // 개발자 도구가 열릴 때 오버레이 창의 키보드 포커스 해제
              // 개발자 도구가 키보드 입력을 받을 수 있도록
              overlayWindow.blur();

              // 개발자 도구가 열릴 때 renderer에 테스트 로그 출력 요청 (콘솔 확인용)
              setTimeout(() => {
                if (overlayWindow && overlayWindow.webContents.isDevToolsOpened()) {
                  overlayWindow.webContents.executeJavaScript(`
                    (function() {
                      console.log('%c[DevTools] DevTools opened successfully!', 'color: green; font-weight: bold; font-size: 16px;');
                      console.log('[DevTools] Console logging is working properly');
                      console.log('[DevTools] Overlay state available at window.__overlayState');
                      console.log('[DevTools] You can now type commands in the console');
                      if (window.__overlayState) {
                        console.log('[DevTools] Current overlay state:', window.__overlayState);
                      }
                      console.log('[DevTools] Test: 1 + 1 =', 1 + 1);
                    })();
                  `).catch((err) => {
                    console.error('[Tray] Error executing JavaScript in DevTools:', err);
                  });
                }
              }, 500);

              // 개발자 도구가 열려 있을 때도 Edit Mode가 활성화되어 있으면 마우스 이벤트 유지
              // (ROI 선택을 시작할 수 있도록)
              const { getEditModeState } = require('./state/editMode');
              const isEditMode = getEditModeState();
              if (isEditMode) {
                // Edit Mode가 활성화되어 있으면 마우스 이벤트 유지
                // 개발자 도구 창은 detach 모드로 열려 있어서 독립적으로 이동 가능
                overlayWindow.setIgnoreMouseEvents(false);
                console.log('[Tray] Mouse events kept enabled while DevTools is open (Edit Mode active)');
              } else {
                // Edit Mode가 비활성화되어 있으면 클릭-스루 활성화
                overlayWindow.setIgnoreMouseEvents(true, { forward: true });
                console.log('[Tray] Click-through enabled while DevTools is open (Edit Mode inactive)');
              }
              // 개발자 도구 창이 닫히면 다시 마우스 이벤트 활성화
              overlayWindow.webContents.once('devtools-closed', () => {
                if (overlayWindow && overlayWindow.isVisible()) {
                  const { getEditModeState } = require('./state/editMode');
                  const isEditMode = getEditModeState();
                  if (isEditMode) {
                    overlayWindow.setIgnoreMouseEvents(false);
                    console.log('[Tray] Mouse events re-enabled after DevTools closed (Edit Mode active)');
                  }
                }
              });
            }
          }
        },
      },
      {
        type: 'separator',
      },
      {
        label: '--- 오디오 캡처 (Audio Capture) ---',
        enabled: false,
      },
      {
        label: isStreaming ? `🟢 스트리밍 중 (${currentTarget || 'Unknown'})` : '⚪ 스트리밍 중지',
        enabled: false,
      },
      {
        label: 'Capture Chrome',
        type: 'normal',
        click: async () => {
          const audioManager = AudioManager.getInstance();
          try {
            if (isStreaming) {
              await audioManager.stopStream();
              await new Promise(resolve => setTimeout(resolve, 500)); // 잠시 대기
            }
            await audioManager.startStream('chrome');
            console.log('[Tray] Chrome 캡처 시작');
            setTimeout(() => {
              updateContextMenu();
            }, 100);
          } catch (err) {
            console.error('[Tray] Chrome 캡처 실패:', err);
          }
        },
      },
      {
        label: 'Capture Edge',
        type: 'normal',
        click: async () => {
          const audioManager = AudioManager.getInstance();
          try {
            if (isStreaming) {
              await audioManager.stopStream();
              await new Promise(resolve => setTimeout(resolve, 500)); // 잠시 대기
            }
            await audioManager.startStream('edge');
            console.log('[Tray] Edge 캡처 시작');
            setTimeout(() => {
              updateContextMenu();
            }, 100);
          } catch (err) {
            console.error('[Tray] Edge 캡처 실패:', err);
          }
        },
      },
      {
        label: 'Capture Discord',
        type: 'normal',
        click: async () => {
          const audioManager = AudioManager.getInstance();
          try {
            if (isStreaming) {
              await audioManager.stopStream();
              await new Promise(resolve => setTimeout(resolve, 500)); // 잠시 대기
            }
            await audioManager.startStream('discord');
            console.log('[Tray] Discord 캡처 시작');
            setTimeout(() => {
              updateContextMenu();
            }, 100);
          } catch (err) {
            console.error('[Tray] Discord 캡처 실패:', err);
          }
        },
      },
      {
        type: 'separator',
      },
      {
        label: 'Stop Capture',
        type: 'normal',
        enabled: isStreaming,
        click: async () => {
          const audioManager = AudioManager.getInstance();
          try {
            await audioManager.stopStream();
            console.log('[Tray] 캡처 중지');
            setTimeout(() => {
              updateContextMenu();
            }, 100);
          } catch (err) {
            console.error('[Tray] 캡처 중지 실패:', err);
          }
        },
      },
      {
        type: 'separator',
      },
      {
        type: 'separator',
      },
      {
        label: '--- 볼륨 설정 (Volume) ---',
        enabled: false,
      },
      {
        label: `현재 볼륨: ${getVolumeLevel()} (${getVolumeLevel() * 10}%)`,
        enabled: false,
      },
      {
        label: '볼륨 조절',
        submenu: [
          {
            label: '1 (10%)',
            type: 'radio',
            checked: getVolumeLevel() === 1,
            click: async () => {
              await setTrayVolumeLevel(1);
              updateContextMenu();
            },
          },
          {
            label: '2 (20%)',
            type: 'radio',
            checked: getVolumeLevel() === 2,
            click: async () => {
              await setTrayVolumeLevel(2);
              updateContextMenu();
            },
          },
          {
            label: '3 (30%)',
            type: 'radio',
            checked: getVolumeLevel() === 3,
            click: async () => {
              await setTrayVolumeLevel(3);
              updateContextMenu();
            },
          },
          {
            label: '4 (40%)',
            type: 'radio',
            checked: getVolumeLevel() === 4,
            click: async () => {
              await setTrayVolumeLevel(4);
              updateContextMenu();
            },
          },
          {
            label: '5 (50%)',
            type: 'radio',
            checked: getVolumeLevel() === 5,
            click: async () => {
              await setTrayVolumeLevel(5);
              updateContextMenu();
            },
          },
          {
            label: '6 (60%)',
            type: 'radio',
            checked: getVolumeLevel() === 6,
            click: async () => {
              await setTrayVolumeLevel(6);
              updateContextMenu();
            },
          },
          {
            label: '7 (70%)',
            type: 'radio',
            checked: getVolumeLevel() === 7,
            click: async () => {
              await setTrayVolumeLevel(7);
              updateContextMenu();
            },
          },
          {
            label: '8 (80%)',
            type: 'radio',
            checked: getVolumeLevel() === 8,
            click: async () => {
              await setTrayVolumeLevel(8);
              updateContextMenu();
            },
          },
          {
            label: '9 (90%)',
            type: 'radio',
            checked: getVolumeLevel() === 9,
            click: async () => {
              await setTrayVolumeLevel(9);
              updateContextMenu();
            },
          },
        ],
      },
      {
        type: 'separator',
      },
      {
        label: '--- 민감도 설정 (Sensitivity) ---',
        enabled: false,
      },
      {
        label: `현재 민감도: ${getCurrentThresholdSync().toFixed(1)}`,
        enabled: false,
      },
      {
        label: '◀ 민감도 낮추기 (-0.1)',
        enabled: getCurrentThresholdSync() > 0.0,
        click: async () => {
          const current = getCurrentThresholdSync();
          const newThreshold = Math.max(0.0, current - 0.1);
          await setTrayThreshold(newThreshold);
          updateContextMenu();
        },
      },
      {
        label: '▶ 민감도 높이기 (+0.1)',
        enabled: getCurrentThresholdSync() < 1.0,
        click: async () => {
          const current = getCurrentThresholdSync();
          const newThreshold = Math.min(1.0, current + 0.1);
          await setTrayThreshold(newThreshold);
          updateContextMenu();
        },
      },
      {
        label: '민감도 설정',
        submenu: [
          {
            label: '0.0 (가장 낮음)',
            type: 'radio',
            checked: Math.abs(getCurrentThresholdSync() - 0.0) < 0.01,
            click: async () => {
              await setTrayThreshold(0.0);
              updateContextMenu();
            },
          },
          {
            label: '0.1',
            type: 'radio',
            checked: Math.abs(getCurrentThresholdSync() - 0.1) < 0.01,
            click: async () => {
              await setTrayThreshold(0.1);
              updateContextMenu();
            },
          },
          {
            label: '0.2',
            type: 'radio',
            checked: Math.abs(getCurrentThresholdSync() - 0.2) < 0.01,
            click: async () => {
              await setTrayThreshold(0.2);
              updateContextMenu();
            },
          },
          {
            label: '0.3',
            type: 'radio',
            checked: Math.abs(getCurrentThresholdSync() - 0.3) < 0.01,
            click: async () => {
              await setTrayThreshold(0.3);
              updateContextMenu();
            },
          },
          {
            label: '0.4',
            type: 'radio',
            checked: Math.abs(getCurrentThresholdSync() - 0.4) < 0.01,
            click: async () => {
              await setTrayThreshold(0.4);
              updateContextMenu();
            },
          },
          {
            label: '0.5',
            type: 'radio',
            checked: Math.abs(getCurrentThresholdSync() - 0.5) < 0.01,
            click: async () => {
              await setTrayThreshold(0.5);
              updateContextMenu();
            },
          },
          {
            label: '0.6',
            type: 'radio',
            checked: Math.abs(getCurrentThresholdSync() - 0.6) < 0.01,
            click: async () => {
              await setTrayThreshold(0.6);
              updateContextMenu();
            },
          },
          {
            label: '0.7',
            type: 'radio',
            checked: Math.abs(getCurrentThresholdSync() - 0.7) < 0.01,
            click: async () => {
              await setTrayThreshold(0.7);
              updateContextMenu();
            },
          },
          {
            label: '0.8',
            type: 'radio',
            checked: Math.abs(getCurrentThresholdSync() - 0.8) < 0.01,
            click: async () => {
              await setTrayThreshold(0.8);
              updateContextMenu();
            },
          },
          {
            label: '0.9',
            type: 'radio',
            checked: Math.abs(getCurrentThresholdSync() - 0.9) < 0.01,
            click: async () => {
              await setTrayThreshold(0.9);
              updateContextMenu();
            },
          },
          {
            label: '1.0 (가장 높음)',
            type: 'radio',
            checked: Math.abs(getCurrentThresholdSync() - 1.0) < 0.01,
            click: async () => {
              await setTrayThreshold(1.0);
              updateContextMenu();
            },
          },
        ],
      },
      {
        type: 'separator',
      },
      {
        label: 'Quit',
        type: 'normal',
        click: () => {
          app.quit();
        },
      },
    ]);

    trayInstance.setContextMenu(contextMenu);
  };

  // 초기 메뉴 설정
  updateContextMenu();

  // 트레이 아이콘 더블클릭 시 오버레이 창 표시/숨김
  tray.on('double-click', () => {
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
      overlayWindow.setSkipTaskbar(true);
      // 오버레이 숨길 때 Edit Mode도 비활성화
      setEditModeState(false);
    } else {
      overlayWindow.show();
      overlayWindow.setSkipTaskbar(false);
      // 오버레이 표시할 때 자동으로 Edit Mode 활성화
      setEditModeState(true);
      // 마우스 이벤트 활성화 확인 (setEditModeState에서 이미 처리되지만 명시적으로 확인)
      overlayWindow.setIgnoreMouseEvents(false);
      console.log('[Tray] Overlay shown (double-click), Edit Mode enabled, mouse events enabled');
      // 키보드 포커스를 명시적으로 설정
      overlayWindow.focus();
      // Windows에서 포커스를 보장하기 위해 약간의 지연 후 다시 포커스
      setTimeout(() => {
        if (overlayWindow && overlayWindow.isVisible()) {
          overlayWindow.focus();
          // 마우스 이벤트가 제대로 활성화되었는지 확인
          overlayWindow.setIgnoreMouseEvents(false);
          console.log('[Tray] Overlay focus and mouse events re-enabled after timeout (double-click)');
        }
      }, 100);
    }
    updateContextMenu();
  });

  // 윈도우 표시/숨김 상태 변경 감지하여 메뉴 업데이트
  overlayWindow.on('show', () => {
    updateContextMenu();
  });

  overlayWindow.on('hide', () => {
    updateContextMenu();
  });

  // updateContextMenu를 외부에서 호출할 수 있도록 export
  (trayInstance as any).updateContextMenu = updateContextMenu;

  return tray;
}

/**
 * 현재 Threshold 값 가져오기 (서버 또는 로컬 스토어)
 */
/**
 * 현재 Threshold 값 가져오기 (동기 - 로컬 스토어에서)
 */
function getCurrentThresholdSync(): number {
  // 로컬 스토어에서 가져오기
  const storedThreshold = getThreshold();
  if (storedThreshold !== null) {
    return storedThreshold;
  }

  // 로컬 스토어에 없으면 기본값 반환
  // 실제 서버 threshold는 서버 시작 시 모델 타입에 따라 설정됨 (KoElectra: 0.5, Kanana: 0.22)
  return 0.5; // 기본값
}

/**
 * 트레이 메뉴에서 Threshold 설정
 */
async function setTrayThreshold(threshold: number): Promise<void> {
  try {
    // 0.0 ~ 1.0 범위로 제한하고 0.1 단위로 반올림
    const clampedThreshold = Math.round(Math.max(0.0, Math.min(1.0, threshold)) * 10) / 10;

    // 로컬 스토어에 저장
    setThreshold(clampedThreshold);

    console.log(`[Tray] Threshold 설정: ${clampedThreshold}`);

    // 서버에 동적으로 설정 요청
    try {
      const axios = (await import('axios')).default;
      const serverUrl = process.env.SERVER_URL || "http://127.0.0.1:8000";
      await axios.post(`${serverUrl}/settings/threshold`, {
        threshold: clampedThreshold
      });
      console.log(`[Tray] ✅ 서버 Threshold 업데이트 성공: ${clampedThreshold}`);
    } catch (serverErr: any) {
      console.warn(`[Tray] ⚠️ 서버 Threshold 업데이트 실패 (서버가 꺼져있을 수 있음): ${serverErr?.message || serverErr}`);
    }

  } catch (err) {
    console.error('[Tray] Failed to set threshold:', err);
  }
}

/**
 * 트레이 메뉴에서 볼륨 레벨 설정
 */
async function setTrayVolumeLevel(level: number): Promise<void> {
  try {
    // 설정 저장
    setVolumeLevel(level);

    // OnVoiceService에 볼륨 레벨 설정
    const service = getOnVoiceService();
    if (service) {
      await service.setVolumeLevel(level);
      console.log(`[Tray] Volume level set to: ${level} (${level * 10}%)`);
    } else {
      console.warn('[Tray] OnVoiceService is not initialized');
    }
  } catch (err) {
    console.error('[Tray] Failed to set volume level:', err);
  }
}

