/**
 * 사용자 대시보드 열기
 * 기본 웹 브라우저로 대시보드 URL 열기
 */
import { shell } from 'electron';

const DASHBOARD_URL = 'https://admin-dashboard-pi-seven-83.vercel.app/';

/**
 * 대시보드를 기본 웹 브라우저로 열기
 */
export function openDashboardWindow(): void {
  console.log('[Dashboard] 기본 브라우저로 대시보드 열기:', DASHBOARD_URL);
  
  shell.openExternal(DASHBOARD_URL).then(() => {
    console.log('[Dashboard] ✅ 대시보드 브라우저 열기 성공');
  }).catch((error) => {
    console.error('[Dashboard] ❌ 대시보드 브라우저 열기 실패:', error);
  });
}

