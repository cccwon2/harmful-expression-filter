import { app, Menu, Tray, BrowserWindow, nativeImage } from 'electron';
import type { NativeImage } from 'electron';
import * as path from 'path';

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

export function createTray(mainWindow: BrowserWindow): Tray {
  // 트레이 아이콘 생성
  const icon = createTrayIcon();
  
  tray = new Tray(icon);
  
  // tray는 위에서 초기화되었으므로 null이 아님을 보장
  const trayInstance = tray;

  // 컨텍스트 메뉴 생성
  const updateContextMenu = () => {
    const isVisible = mainWindow.isVisible();
    const contextMenu = Menu.buildFromTemplate([
      {
        label: isVisible ? 'Hide Main Window' : 'Show Main Window',
        type: 'normal',
        click: () => {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
          // 메뉴 업데이트 (다음에 열 때 올바른 라벨 표시)
          updateContextMenu();
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

  // 트레이 아이콘 클릭 시 메인 윈도우 토글
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
    // 메뉴 업데이트
    updateContextMenu();
  });

  // 윈도우 표시/숨김 상태 변경 감지하여 메뉴 업데이트
  mainWindow.on('show', () => {
    updateContextMenu();
  });

  mainWindow.on('hide', () => {
    updateContextMenu();
  });

  return tray;
}

