import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from './channels';
import { setROI, setMode, getStoreSnapshot } from '../store';
import { setEditModeState } from '../state/editMode';

export interface ROI {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ROIRect = ROI;

// ROI 선택 상태 추적
let isROISelectionComplete = false;
let isROISelecting = false; // ROI 선택 중인지 여부

export function isROISelectionCompleteState(): boolean {
  return isROISelectionComplete;
}

export function isROISelectingState(): boolean {
  return isROISelecting;
}

export function setupROIHandlers(overlayWindow: BrowserWindow) {
  ipcMain.on(IPC_CHANNELS.ROI_SELECTED, (_event, rect: ROI) => {
    console.log('[ROI] ROI selected:', rect);

    if (rect.width < 4 || rect.height < 4) {
      console.warn('[ROI] Ignoring ROI - size below minimum threshold (4px):', rect);
      return;
    }

    setROI(rect);
    setMode('detect');
    console.log('[ROI] Persisted ROI and mode=detect:', getStoreSnapshot());

    setEditModeState(false, { hideOverlay: false });

    isROISelectionComplete = true;
    isROISelecting = false;
    console.log('[ROI] State flags updated - isROISelectionComplete:', isROISelectionComplete, 'isROISelecting:', isROISelecting);

    overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_SET_MODE, 'detect');
    overlayWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_PUSH, {
      mode: 'detect',
      roi: rect,
      harmful: false,
    });
    console.log('[ROI] Broadcasted detect mode via OVERLAY_SET_MODE and OVERLAY_STATE_PUSH');

    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    console.log('[ROI] Click-through enabled after ROI selection (detect mode active)');
  });

  ipcMain.on(IPC_CHANNELS.ROI_START_SELECTION, () => {
    console.log('[ROI] ROI selection started');
    // ROI 선택 완료 상태 해제
    isROISelectionComplete = false;
    // ROI 선택 중 상태 설정
    isROISelecting = true;
    console.log('[ROI] State updated - isROISelectionComplete:', isROISelectionComplete, 'isROISelecting:', isROISelecting);
    
    // 개발자 도구 상태 확인
    const isDevToolsOpen = overlayWindow.webContents.isDevToolsOpened();
    console.log('[ROI] DevTools open state:', isDevToolsOpen);
    
    // Edit Mode 상태 확인
    const { getEditModeState } = require('../state/editMode');
    const isEditMode = getEditModeState();
    console.log('[ROI] Edit Mode state:', isEditMode);
    
    // ROI 선택 시작 시 항상 마우스 이벤트 활성화 (Edit Mode에서만 가능)
    // 개발자 도구가 열려 있어도 ROI 선택을 위해서는 마우스 이벤트가 필요
    if (isEditMode) {
      overlayWindow.setIgnoreMouseEvents(false);
      console.log('[ROI] Mouse events enabled for ROI selection (Edit Mode active, DevTools:', isDevToolsOpen, ')');
    } else {
      // Edit Mode가 비활성화되어 있으면 클릭-스루 유지
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      console.log('[ROI] Click-through maintained (Edit Mode inactive)');
    }
  });

  ipcMain.on(IPC_CHANNELS.ROI_CANCEL_SELECTION, () => {
    console.log('[ROI] ROI selection cancelled');
    // ROI 선택 완료 상태 해제
    isROISelectionComplete = false;
    // ROI 선택 중 상태 해제
    isROISelecting = false;
    console.log('[ROI] State updated - isROISelectionComplete:', isROISelectionComplete, 'isROISelecting:', isROISelecting);
    
    // 개발자 도구 상태 확인
    const isDevToolsOpen = overlayWindow.webContents.isDevToolsOpened();
    console.log('[ROI] DevTools open state after cancellation:', isDevToolsOpen);
    
    // ROI 선택 취소 후 개발자 도구 상태에 따라 마우스 이벤트 설정
    const { getEditModeState } = require('../state/editMode');
    const isEditMode = getEditModeState();
    
    if (isDevToolsOpen) {
      // 개발자 도구가 열려 있으면 클릭-스루 활성화 (개발자 도구 창 상호작용을 위해)
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      console.log('[ROI] Click-through enabled after cancellation (DevTools open)');
    } else if (!isEditMode) {
      // Edit Mode가 비활성화되어 있으면 클릭-스루 활성화
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      console.log('[ROI] Click-through enabled after cancellation (Edit Mode inactive)');
    } else {
      // Edit Mode가 활성화되어 있고 개발자 도구가 닫혀 있으면 마우스 이벤트 유지 (추가 ROI 선택 가능)
      overlayWindow.setIgnoreMouseEvents(false);
      console.log('[ROI] Mouse events kept enabled after cancellation (Edit Mode active, DevTools closed)');
    }
  });
}
