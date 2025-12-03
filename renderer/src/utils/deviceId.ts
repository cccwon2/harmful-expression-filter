import { v4 as uuidv4 } from "uuid";

const STORAGE_KEY = "onvoice_device_uuid";

/**
 * 클라이언트(디바이스) 단위로 고정된 UUID를 반환합니다.
 * - 최초 호출 시 UUID를 생성하여 localStorage에 저장
 * - 이후에는 저장된 값을 재사용
 * - localStorage 사용이 불가능한 환경에서는 세션 단위 UUID 사용
 */
export function getDeviceId(): string {
  // SSR 또는 window가 없는 환경 대비
  if (typeof window === "undefined") {
    return uuidv4();
  }

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length > 0) {
      return existing;
    }

    const id = uuidv4();
    window.localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // localStorage 접근 실패 시 세션 단위 UUID 반환
    return uuidv4();
  }
}


