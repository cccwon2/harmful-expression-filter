/**
 * 디바이스 UUID 생성 및 관리 유틸리티
 * 트레이 메뉴 대시보드 바로가기에서 사용
 */
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const STORAGE_KEY = 'device_uuid';
const STORE_FILE = 'device-uuid.json';

function getStorePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, STORE_FILE);
}

/**
 * 디바이스 UUID를 가져오거나 생성합니다.
 * 최초 호출 시 UUID를 생성하여 파일에 저장하고, 이후에는 저장된 값을 재사용합니다.
 */
export function getDeviceId(): string {
  const storePath = getStorePath();
  
  try {
    // 파일이 존재하면 읽어서 반환
    if (fs.existsSync(storePath)) {
      const data = fs.readFileSync(storePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed[STORAGE_KEY] && typeof parsed[STORAGE_KEY] === 'string') {
        return parsed[STORAGE_KEY];
      }
    }
  } catch (error) {
    console.error('[DeviceId] Error loading device UUID:', error);
  }

  // UUID 생성 및 저장
  const id = uuidv4();
  try {
    fs.writeFileSync(storePath, JSON.stringify({ [STORAGE_KEY]: id }, null, 2), 'utf-8');
    console.log('[DeviceId] 새로운 디바이스 UUID 생성:', id);
  } catch (error) {
    console.error('[DeviceId] Error saving device UUID:', error);
  }

  return id;
}

