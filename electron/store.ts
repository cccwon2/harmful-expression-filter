import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { ROI } from './ipc/roi';

export type OverlayMode = 'setup' | 'detect' | 'alert';

export interface StoreData {
  roi: ROI | null;
  mode: OverlayMode;
  volumeLevel?: number; // 0~9 (0 = 무소음, 9 = 90%), 기본값: 1 (10%)
}

const getStorePath = () => {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'store.json');
};

const defaultData: StoreData = {
  roi: null,
  mode: 'setup',
  volumeLevel: 1, // 기본값: 1 (10%)
};

function loadData(): StoreData {
  const storePath = getStorePath();
  try {
    if (fs.existsSync(storePath)) {
      const data = fs.readFileSync(storePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[Store] Error loading store:', error);
  }
  return { ...defaultData };
}

function saveData(data: StoreData) {
  const storePath = getStorePath();
  try {
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('[Store] Error saving store:', error);
  }
}

export function getStoreSnapshot(): StoreData {
  return loadData();
}

export function setStoreSnapshot(data: StoreData) {
  saveData(data);
}

export function getROI(): ROI | null {
  return loadData().roi ?? null;
}

export function setROI(roi: ROI | null) {
  const data = loadData();
  data.roi = roi;
  saveData(data);
}

export function getMode(): OverlayMode {
  return loadData().mode;
}

export function setMode(mode: OverlayMode) {
  const data = loadData();
  data.mode = mode;
  saveData(data);
}

export function updateStore(updater: (state: StoreData) => StoreData) {
  const nextState = updater(loadData());
  saveData(nextState);
}

export function getVolumeLevel(): number {
  const data = loadData();
  return data.volumeLevel ?? defaultData.volumeLevel ?? 1;
}

export function setVolumeLevel(level: number): void {
  const data = loadData();
  // 0~9 범위로 제한
  data.volumeLevel = Math.max(0, Math.min(9, Math.round(level)));
  saveData(data);
}
