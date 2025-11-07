import { contextBridge } from 'electron';

// preload 스크립트 로드 확인 (메인 프로세스 콘솔에 출력)
console.log('[Preload] Preload script loaded');

// 안전한 API 노출 - 테스트용 간단한 API
try {
  contextBridge.exposeInMainWorld('api', {
    appVersion: '1.0.0',
    getVersion: () => '1.0.0',
  });
  
  console.log('[Preload] api exposed successfully');
} catch (error) {
  console.error('[Preload] Failed to expose api:', error);
}

// TypeScript 타입 정의를 위한 전역 타입 선언
declare global {
  interface Window {
    api: {
      appVersion: string;
      getVersion: () => string;
    };
  }
}

