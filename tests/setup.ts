jest.setTimeout(10000);

process.env.NODE_ENV = 'test';
process.env.SERVER_URL = 'http://127.0.0.1:8000';

// 콘솔 경고 무시
const originalWarn = console.warn;
const originalError = console.error;

beforeAll(() => {
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterAll(() => {
  console.warn = originalWarn;
  console.error = originalError;
});

// 전역 Mock 설정
global.mockElectronApp = {
  isPackaged: false,
  getPath: jest.fn((name: string) => {
    const paths: Record<string, string> = {
      userData: '/mock/userData',
      appData: '/mock/appData',
      temp: '/mock/temp',
    };
    return paths[name] || '/mock/default';
  }),
  quit: jest.fn(),
};

global.mockBrowserWindow = {
  webContents: {
    send: jest.fn(),
    on: jest.fn(),
    executeJavaScript: jest.fn(),
  },
  setIgnoreMouseEvents: jest.fn(),
  show: jest.fn(),
  hide: jest.fn(),
  isVisible: jest.fn(() => true),
  isDestroyed: jest.fn(() => false),
  setContentProtection: jest.fn(),
};

declare global {
  var mockElectronApp: any;
  var mockBrowserWindow: any;
}

export {};

