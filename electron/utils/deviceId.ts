/**
 * 디바이스 UUID 생성 및 관리 유틸리티
 * 트레이 메뉴 대시보드 바로가기에서 사용
 * 
 * ✅ 기존 store.ts의 저장소 시스템을 활용하여 영구 저장
 */
import { getOrCreateDeviceId } from '../store';

/**
 * 디바이스 UUID를 가져오거나 생성합니다.
 * 최초 호출 시 UUID를 생성하여 store.json에 저장하고, 이후에는 저장된 값을 재사용합니다.
 * 
 * ✅ 앱을 재시작해도 동일한 UUID가 반환됩니다.
 */
export function getDeviceId(): string {
  return getOrCreateDeviceId();
}

