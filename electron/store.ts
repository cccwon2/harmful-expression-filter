import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { ROIRect } from './ipc/roi';

// OverlayMode 타입 정의 (electron에서 직접 정의)
type OverlayMode = 'setup' | 'detect' | 'alert';

interface StoreData {
  roi: ROIRect | null;
  mode: OverlayMode;
}

// 저장 파일 경로 (app.whenReady() 후에만 호출되어야 함)
const getStorePath = () => {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'store.json');
};

// 기본 데이터
const defaultData: StoreData = {
  roi: null,
  mode: 'setup',
};

// 데이터 읽기
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

// 데이터 저장
function saveData(data: StoreData) {
  const storePath = getStorePath();
  try {
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('[Store] Error saving store:', error);
  }
}

// Store 객체
const store = {
  get: (key: keyof StoreData): any => {
    const data = loadData();
    return data[key];
  },
  set: (key: keyof StoreData, value: any) => {
    const data = loadData();
    data[key] = value;
    saveData(data);
  },
  // 모든 데이터 가져오기
  getAll: (): StoreData => {
    return loadData();
  },
  // 모든 데이터 설정
  setAll: (data: StoreData) => {
    saveData(data);
  },
};

export { store };
export type { OverlayMode };
