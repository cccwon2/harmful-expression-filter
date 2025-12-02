/**
 * 사용자 대시보드 창 생성
 * Header에 UUID를 user_id로 포함
 */
import { BrowserWindow, session } from 'electron';
import { getDeviceId } from '../utils/deviceId';

const DASHBOARD_URL = 'https://admin-dashboard-pi-seven-83.vercel.app/';

let dashboardWindow: BrowserWindow | null = null;

/**
 * 대시보드 창을 생성하고 열기
 */
export function openDashboardWindow(): void {
  // 이미 창이 열려있으면 포커스만 이동
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    if (dashboardWindow.isMinimized()) {
      dashboardWindow.restore();
    }
    dashboardWindow.focus();
    return;
  }

  // 디바이스 UUID 가져오기
  const deviceId = getDeviceId();
  console.log('[Dashboard] 디바이스 UUID:', deviceId);

  // 새로운 세션 생성 (기본 세션과 분리하여 Header 추가)
  const partition = `persist:dashboard-${deviceId}`;
  const dashboardSession = session.fromPartition(partition);

  // 모든 HTTP 요청에 Header 추가
  dashboardSession.webRequest.onBeforeSendHeaders(
    {
      urls: ['*://*/*'], // 모든 URL
    },
    (details, callback) => {
      // 대시보드 URL에만 Header 추가
      if (details.url.startsWith(DASHBOARD_URL) || details.url.includes('vercel.app') || details.url.includes('admin-dashboard')) {
        details.requestHeaders['user_id'] = deviceId;
        console.log('[Dashboard] Header 추가:', { url: details.url, user_id: deviceId });
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  // 대시보드 창 생성
  dashboardWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: '#ffffff',
    title: '사용자 대시보드',
    webPreferences: {
      session: dashboardSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 창이 닫히면 참조 제거
  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });

  // 로드 완료 후 표시
  dashboardWindow.webContents.once('did-finish-load', () => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.show();
      console.log('[Dashboard] 대시보드 창 열림:', DASHBOARD_URL);
    }
  });

  // 로드 실패 처리
  dashboardWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[Dashboard] 로드 실패:', { errorCode, errorDescription });
  });

  // 대시보드 URL 로드
  dashboardWindow.loadURL(DASHBOARD_URL);
}

