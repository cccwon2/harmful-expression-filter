/**
 * Electron 앱 실행 및 테스트 헬퍼
 * 실제 Electron 앱을 실행하고 테스트하는 유틸리티
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface ElectronApp {
  process: ChildProcess;
  kill: () => Promise<void>;
  waitForReady: () => Promise<void>;
}

/**
 * Electron 앱 실행
 */
export async function launchElectronApp(options: {
  show?: boolean;
  devTools?: boolean;
} = {}): Promise<ElectronApp> {
  const electronPath = require('electron');
  const mainPath = path.resolve(__dirname, '../../dist-electron/main.js');
  
  // 빌드된 main.js 확인
  if (!fs.existsSync(mainPath)) {
    throw new Error(`Electron main.js not found at ${mainPath}. Run 'npm run build:main' first.`);
  }

  // 환경 변수 설정
  const env = {
    ...process.env,
    SKIP_SINGLE_INSTANCE_LOCK: 'true',
    NODE_ENV: 'test',
    ELECTRON_IS_DEV: '0',
  };

  // Electron 실행
  const electronProcess = spawn(electronPath, [mainPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let isReady = false;
  const readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!isReady) {
        reject(new Error('Electron app failed to start within 10 seconds'));
      }
    }, 10000);

    // 프로세스 출력 모니터링
    electronProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log('[Electron]', output);
      
      // 앱이 준비되었는지 확인 (로그 기반)
      if (output.includes('DOM ready') || output.includes('Window loaded')) {
        if (!isReady) {
          isReady = true;
          clearTimeout(timeout);
          resolve();
        }
      }
    });

    electronProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      console.error('[Electron Error]', output);
      
      // 일부 에러는 무시 (경고 등)
      if (output.includes('Warning:') || output.includes('DeprecationWarning:')) {
        return;
      }
    });

    electronProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Electron app exited with code ${code}`));
      }
    });

    // 기본 대기 시간 후 준비로 간주
    setTimeout(() => {
      if (!isReady) {
        isReady = true;
        clearTimeout(timeout);
        resolve();
      }
    }, 3000);
  });

  return {
    process: electronProcess,
    kill: async () => {
      return new Promise((resolve) => {
        if (electronProcess.killed) {
          resolve();
          return;
        }

        electronProcess.on('exit', () => resolve());
        electronProcess.kill();
        
        // 강제 종료
        setTimeout(() => {
          if (!electronProcess.killed) {
            electronProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);
      });
    },
    waitForReady: () => readyPromise,
  };
}

/**
 * Electron 앱의 모든 프로세스 종료
 */
export async function killAllElectronProcesses(): Promise<void> {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  try {
    // Windows
    if (process.platform === 'win32') {
      await execAsync('taskkill /F /IM electron.exe 2>nul || exit 0');
      await execAsync('taskkill /F /IM OnVoice.exe 2>nul || exit 0');
    } else {
      // macOS/Linux
      await execAsync('pkill -f electron || true');
      await execAsync('pkill -f OnVoice || true');
    }
  } catch (error) {
    // 프로세스가 없으면 에러 무시
    console.log('[Cleanup] No electron processes found or already killed');
  }
}

