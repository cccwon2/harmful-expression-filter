/**
 * 프로세스 검색 유틸리티
 * 
 * Windows에서 실행 중인 프로세스의 PID를 찾는 유틸리티 함수
 * 
 * TODO: node-process-list 같은 패키지를 사용하면 더 효율적일 수 있습니다.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ProcessInfo {
  pid: number;
  name: string;
}

/**
 * 프로세스 이름으로 PID 찾기
 */
export async function findProcessByName(processName: string): Promise<number | null> {
  try {
    // PowerShell을 사용하여 프로세스 검색
    // Get-Process | Where-Object {$_.ProcessName -like "*chrome*"} | Select-Object -First 1 Id
    const command = `powershell -Command "Get-Process | Where-Object {$_.ProcessName -like '*${processName}*'} | Select-Object -First 1 -ExpandProperty Id"`;
    
    const { stdout, stderr } = await execAsync(command);
    
    if (stderr && stderr.trim()) {
      console.warn(`[ProcessFinder] PowerShell 오류: ${stderr}`);
      return null;
    }
    
    const pidStr = stdout.trim();
    if (!pidStr || isNaN(Number(pidStr))) {
      return null;
    }
    
    const pid = parseInt(pidStr, 10);
    return pid > 0 ? pid : null;
  } catch (error) {
    console.error(`[ProcessFinder] 프로세스 검색 실패 (${processName}):`, error);
    return null;
  }
}

/**
 * Chrome 프로세스 찾기
 * Chrome은 여러 프로세스를 사용하므로, 메인 프로세스를 찾습니다.
 */
export async function findChromeProcess(): Promise<number | null> {
  // Chrome의 메인 프로세스는 보통 chrome.exe입니다
  return findProcessByName('chrome');
}

/**
 * Edge 프로세스 찾기
 * Edge는 Chromium 기반이므로 msedge.exe를 찾습니다.
 */
export async function findEdgeProcess(): Promise<number | null> {
  return findProcessByName('msedge');
}

/**
 * Discord 프로세스 찾기
 */
export async function findDiscordProcess(): Promise<number | null> {
  return findProcessByName('Discord');
}

/**
 * 프로세스 타입으로 PID 찾기
 */
export async function findProcessByType(
  type: 'edge' | 'chrome' | 'discord' | number
): Promise<number | null> {
  if (typeof type === 'number') {
    return type > 0 ? type : null;
  }

  switch (type) {
    case 'chrome':
      return findChromeProcess();
    case 'edge':
      return findEdgeProcess();
    case 'discord':
      return findDiscordProcess();
    default:
      return null;
  }
}

/**
 * 프로세스가 실행 중인지 확인
 */
export async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    // tasklist 명령어로 프로세스 확인
    const command = `tasklist /FI "PID eq ${pid}" /NH`;
    const { stdout } = await execAsync(command);
    
    // PID가 있으면 stdout에 프로세스 정보가 포함됨
    return stdout.includes(`${pid}`);
  } catch (error) {
    console.error(`[ProcessFinder] 프로세스 확인 실패 (PID: ${pid}):`, error);
    return false;
  }
}

