import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { ROI } from './ipc/roi';

export type OverlayMode = 'setup' | 'detect' | 'alert';

export interface StoreData {
  roi: ROI | null;
  mode: OverlayMode;
}

const getStorePath = () => {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'store.json');
};

const defaultData: StoreData = {
  roi: null,
  mode: 'setup',
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
