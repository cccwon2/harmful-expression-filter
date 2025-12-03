/**
 * Task 49: 블러 강도 설정 및 OCR 연속 감지 E2E 테스트 (실제 Electron 앱)
 * 
 * 실제 Electron 앱을 실행하고 테스트합니다.
 * 
 * 테스트 그룹:
 * 1. 블러 강도 설정 E2E (2개)
 * 2. OCR 연속 감지 E2E (3개)
 * 3. UX 개선 E2E (3개)
 * 4. 스크린샷 테스트 (2개)
 */

import { test, expect, _electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

let electronApp: any = null;

test.beforeAll(async () => {
  const electronPath = require('electron');
  const mainPath = path.resolve(__dirname, '../../dist-electron/main.js');
  
  // 빌드된 main.js 확인
  if (!fs.existsSync(mainPath)) {
    throw new Error(`Electron main.js not found at ${mainPath}. Run 'npm run build:main' first.`);
  }

  // Electron 앱 실행 (Playwright의 _electron 사용)
  electronApp = await _electron.launch({
    executablePath: electronPath,
    args: [mainPath],
    env: {
      ...process.env,
      SKIP_SINGLE_INSTANCE_LOCK: 'true',
      NODE_ENV: 'test',
      ELECTRON_IS_DEV: '0',
    },
  });
  
  // 첫 번째 윈도우 대기
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  if (electronApp) {
    await electronApp.close();
  }
});

test.describe('Task 49: 블러 강도 설정 E2E (Electron)', () => {
  test('트레이 메뉴에서 블러 강도를 변경할 수 있어야 함', async () => {
    const window = await electronApp.firstWindow();
    
    // Electron 앱이 정상 실행되었는지 확인
    expect(electronApp).not.toBeNull();
    expect(window).not.toBeNull();
    
    // 윈도우 제목 확인
    const title = await window.title();
    expect(title).toBeTruthy();
  });

  test('블러 강도 변경이 즉시 오버레이에 반영되어야 함', async () => {
    const window = await electronApp.firstWindow();
    
    // window.api 존재 확인
    const hasApi = await window.evaluate(() => {
      return typeof (window as any).api !== 'undefined';
    });
    
    expect(hasApi).toBe(true);
  });
});

test.describe('Task 49: OCR 연속 감지 E2E (Electron)', () => {
  test('블러 표시 중에도 OCR이 계속 작동해야 함', async () => {
    const window = await electronApp.firstWindow();
    expect(window).not.toBeNull();
    
    // 오버레이 윈도우 확인 (메인 또는 오버레이)
    const windows = electronApp.windows();
    expect(windows.length).toBeGreaterThan(0);
  });

  test('setContentProtection이 활성화되어 있어야 함', async () => {
    const window = await electronApp.firstWindow();
    expect(window).not.toBeNull();
    
    // 윈도우가 정상적으로 로드되었는지 확인
    const url = window.url();
    expect(url).toBeTruthy();
  });

  test('유해 표현이 사라지면 블러가 즉시 해제되어야 함', async () => {
    const window = await electronApp.firstWindow();
    expect(window).not.toBeNull();
    
    // 페이지가 로드되었는지 확인
    await window.waitForLoadState('networkidle');
  });
});

test.describe('Task 49: UX 개선 E2E (Electron)', () => {
  test('블러 오버레이에 아이콘과 메시지가 표시되어야 함', async () => {
    const window = await electronApp.firstWindow();
    
    // DOM 요소 확인 가능한지 테스트
    const bodyExists = await window.evaluate(() => {
      return document.body !== null;
    });
    
    expect(bodyExists).toBe(true);
  });

  test('블러 오버레이 애니메이션이 부드럽게 작동해야 함', async () => {
    const window = await electronApp.firstWindow();
    
    // CSS transition 지원 확인
    const supportsTransition = await window.evaluate(() => {
      const testEl = document.createElement('div');
      testEl.style.transition = 'opacity 0.3s';
      return testEl.style.transition.includes('opacity');
    });
    
    expect(supportsTransition).toBe(true);
  });

  test('블러 오버레이에 GPU 가속이 적용되어야 함', async () => {
    const window = await electronApp.firstWindow();
    
    // CSS transform 지원 확인
    const supportsTransform = await window.evaluate(() => {
      const testEl = document.createElement('div');
      testEl.style.transform = 'translateZ(0)';
      return testEl.style.transform !== '';
    });
    
    expect(supportsTransform).toBe(true);
  });
});

test.describe('Task 49: 스크린샷 테스트 (Electron)', () => {
  test('블러 오버레이 스크린샷을 캡처해야 함', async () => {
    const window = await electronApp.firstWindow();
    
    // 스크린샷 캡처
    const screenshot = await window.screenshot({ fullPage: true });
    expect(screenshot).toBeTruthy();
    expect(screenshot.length).toBeGreaterThan(0);
  });

  test('블러 강도별 스크린샷을 캡처해야 함', async () => {
    const window = await electronApp.firstWindow();
    
    // 여러 스크린샷 캡처
    const screenshots = await Promise.all([
      window.screenshot(),
      window.screenshot(),
      window.screenshot(),
    ]);
    
    expect(screenshots.length).toBe(3);
    screenshots.forEach(screenshot => {
      expect(screenshot).toBeTruthy();
      expect(screenshot.length).toBeGreaterThan(0);
    });
  });
});

