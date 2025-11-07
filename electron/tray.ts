import { app, Menu, Tray, BrowserWindow, nativeImage } from 'electron';
import type { NativeImage } from 'electron';
import * as path from 'path';
import { getEditModeState, setEditModeState } from './state/editMode';
import { IPC_CHANNELS } from './ipc/channels';

let tray: Tray | null = null;

function createTrayIcon(): NativeImage {
  // 32x32 픽셀 버퍼 생성 (트레이 아이콘용)
  const size = 32;
  const bytesPerPixel = 4; // RGBA
  const buffer = Buffer.alloc(size * size * bytesPerPixel);
  
  // 파란색 배경 (#2563eb)
  const bgR = 0x25, bgG = 0x63, bgB = 0xeb;
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

export function createTray(overlayWindow: BrowserWindow): Tray {
  // 트레이 아이콘 생성
  const icon = createTrayIcon();
  
  tray = new Tray(icon);
  
  // tray는 위에서 초기화되었으므로 null이 아님을 보장
  const trayInstance = tray;

  // 컨텍스트 메뉴 생성
  const updateContextMenu = () => {
    const isOverlayVisible = overlayWindow.isVisible();
    const isEditMode = getEditModeState();
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '영역 지정 (Enter Setup Mode)',
        type: 'normal',
        click: () => {
          console.log('[Tray] Entering setup mode');
          // 오버레이 창 표시
          overlayWindow.show();
          overlayWindow.setSkipTaskbar(false);
          // 클릭-스루 비활성화 (마우스 입력 가능)
          overlayWindow.setIgnoreMouseEvents(false);
          // Edit Mode 활성화
          setEditModeState(true);
          // IPC로 모드 변경 알림
          overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_SET_MODE, 'setup');
          console.log('[Tray] Setup mode entered - overlay shown, click-through disabled');
          // 키보드 포커스 설정
          overlayWindow.focus();
          // Windows에서 포커스를 보장하기 위해 약간의 지연 후 다시 포커스
          setTimeout(() => {
            if (overlayWindow && overlayWindow.isVisible()) {
              overlayWindow.focus();
              overlayWindow.setIgnoreMouseEvents(false);
              console.log('[Tray] Overlay focus and mouse events re-enabled after timeout');
            }
          }, 100);
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

  tray.setToolTip('Harmful Expression Filter');

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

