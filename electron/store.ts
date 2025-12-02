import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { ROI } from './ipc/roi';

export type OverlayMode = 'setup' | 'detect' | 'alert';

export interface StoreData {
  roi: ROI | null;
  mode: OverlayMode;
  volumeLevel?: number; // 1~9 (1 = 10%, 9 = 90%), 기본값: 1 (10%)
  threshold?: number; // 0.0 ~ 1.0, 민감도 설정 (threshold)
  blurIntensity?: number; // 15 | 25 | 40 (px), 블러 강도 설정, 기본값: 40
}

const getStorePath = () => {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'store.json');
};

const defaultData: StoreData = {
  roi: null,
  mode: 'setup',
  volumeLevel: 1, // 기본값: 1 (10%)
  blurIntensity: 40, // 기본값: 40px (강한 블러)
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
  const level = data.volumeLevel ?? defaultData.volumeLevel ?? 1;
  // 기존에 0으로 설정된 값이 있다면 1로 변경
  return Math.max(1, level);
}

export function setVolumeLevel(level: number): void {
  const data = loadData();
  // 1~9 범위로 제한 (무소음 0% 제외)
  data.volumeLevel = Math.max(1, Math.min(9, Math.round(level)));
  saveData(data);
}

/**
 * Threshold 값 가져오기
 * @returns Threshold 값 (0.0 ~ 1.0), 설정되지 않았으면 null
 */
export function getThreshold(): number | null {
  const data = loadData();
  if (data.threshold !== undefined && data.threshold !== null) {
    // 0.0 ~ 1.0 범위로 제한하고 0.1 단위로 반올림
    return Math.round(Math.max(0.0, Math.min(1.0, data.threshold)) * 10) / 10;
  }
  return null;
}

/**
 * Threshold 값 설정
 * @param threshold Threshold 값 (0.0 ~ 1.0), 0.1 단위로 자동 반올림
 */
export function setThreshold(threshold: number): void {
  const data = loadData();
  // 0.0 ~ 1.0 범위로 제한하고 0.1 단위로 반올림
  data.threshold = Math.round(Math.max(0.0, Math.min(1.0, threshold)) * 10) / 10;
  saveData(data);
  console.log(`[Store] Threshold 설정: ${data.threshold}`);
}

/**
 * 블러 강도 가져오기
 * @returns 블러 강도 (15 | 25 | 40), 설정되지 않았으면 기본값 40
 */
export function getBlurIntensity(): number {
  const data = loadData();
  const intensity = data.blurIntensity ?? defaultData.blurIntensity ?? 40;
  // 유효한 값만 허용 (15, 25, 40)
  if ([15, 25, 40].includes(intensity)) {
    return intensity;
  }
  return 40; // 기본값
}

/**
 * 블러 강도 설정
 * @param intensity 블러 강도 (15 | 25 | 40)
 */
export function setBlurIntensity(intensity: number): void {
  const data = loadData();
  // 유효한 값만 허용 (15, 25, 40)
  if ([15, 25, 40].includes(intensity)) {
    data.blurIntensity = intensity;
    saveData(data);
    console.log(`[Store] Blur intensity 설정: ${data.blurIntensity}px`);
  } else {
    console.warn(`[Store] 유효하지 않은 blur intensity: ${intensity} (15, 25, 40만 허용)`);
  }
}
