/**
 * 프로세스 검색 유틸리티
 *
 * Windows에서 실행 중인 프로세스의 PID를 찾는 유틸리티 함수
 */

import { exec } from "child_process";
import { promisify } from "util";

// execAsync는 기본적으로 Buffer가 아닌 string을 반환합니다.
// 한글 윈도우에서 인코딩 문제가 발생할 수 있으나, PID 추출 로직에는 영향이 적습니다.
// 만약 로그에 한글이 깨져 나온다면 'iconv-lite'를 사용하여 decoding 해야 합니다.
const execAsync = promisify(exec);

interface ProcessInfo {
  pid: number;
  name: string;
  title: string;
}

/**
 * Window Title이 있는 메인 프로세스 찾기 (공용 함수)
 * Chrome, Edge, Discord 등 멀티 프로세스 앱의 메인 PID를 찾을 때 사용합니다.
 */
async function findWindowedProcess(imageName: string): Promise<number | null> {
  try {
    // /fi "imagename eq ..." : 프로세스 이름 필터
    // /fi "status eq running" : 실행 중인 것만
    // /fo csv : CSV 포맷
    // /nh : 헤더 제거
    // /v : 상세 정보(Window Title 포함) 출력
    const command = `tasklist /fi "imagename eq ${imageName}" /fi "status eq running" /fo csv /nh /v`;

    const { stdout, stderr } = await execAsync(command);

    // tasklist는 찾는 프로세스가 없으면 stderr가 아니라 stdout에 "정보: ..." 메시지를 띄우기도 하므로
    // stderr 체크보다는 파싱 결과로 판단하는 것이 낫습니다.

    const lines = stdout
      .trim()
      .split("\r\n")
      .filter((line) => line.trim() !== "");

    // "정보: 지정된 조건에 맞는 작업이 실행되고 있지 않습니다." 메시지 처리
    if (lines.length === 0 || lines[0].startsWith("INFO:") || lines[0].startsWith("정보:")) {
      console.warn(`[ProcessFinder] ${imageName} 프로세스를 찾을 수 없습니다.`);
      return null;
    }

    // Window Title이 있는 메인 프로세스 탐색
    for (const line of lines) {
      // CSV 파싱: "imagename","pid","session","mem","status","username","cpu","window title"
      const cols = line.split('","');

      if (cols.length < 2) continue;

      // PID 추출 (두 번째 컬럼)
      const pidStr = cols[1].replace(/"/g, "");
      const pid = parseInt(pidStr, 10);

      if (isNaN(pid) || pid <= 0) continue;

      // Window Title 추출 (마지막 컬럼)
      // cols가 8개 미만일 수도 있으므로 마지막 요소를 가져옴
      let windowTitle = cols[cols.length - 1].replace(/"/g, "").trim();

      // 한글 윈도우 등에서 깨진 문자가 올 수 있으나, 길이와 N/A 여부만 확인하면 됨
      if (windowTitle !== "N/A" && windowTitle !== "") {
        console.log(`[ProcessFinder] ✅ 메인 ${imageName} 발견! PID: ${pid}, Title: ${windowTitle}`);
        return pid;
      }
    }

    // 메인 프로세스(창이 있는 것)를 못 찾았지만 리스트에는 있는 경우
    // (예: 트레이에만 있고 창은 닫힌 상태)
    // 첫 번째 프로세스를 반환하거나 null을 반환
    console.warn(`[ProcessFinder] ⚠️ ${imageName}의 메인 창을 찾지 못해 첫 번째 PID를 반환합니다.`);

    const firstLine = lines[0].split('","');
    if (firstLine.length > 1) {
      const pidStr = firstLine[1].replace(/"/g, "");
      const pid = parseInt(pidStr, 10);
      return !isNaN(pid) && pid > 0 ? pid : null;
    }

    return null;
  } catch (error) {
    console.error(`[ProcessFinder] ${imageName} 검색 실패:`, error);
    return null;
  }
}

/**
 * Chrome 프로세스 찾기
 */
export async function findChromeProcess(): Promise<number | null> {
  return findWindowedProcess("chrome.exe");
}

/**
 * Edge 프로세스 찾기
 * Edge도 Chromium 기반이므로 Window Title 로직을 사용해야 정확합니다.
 */
export async function findEdgeProcess(): Promise<number | null> {
  return findWindowedProcess("msedge.exe");
}

/**
 * Discord 프로세스 찾기
 * Discord도 Electron 기반(멀티 프로세스)이므로 Window Title 로직이 안전합니다.
 */
export async function findDiscordProcess(): Promise<number | null> {
  // Discord는 설치 버전에 따라 Discord.exe, DiscordCanary.exe 등일 수 있음
  // 보통 Discord.exe를 찾으면 됩니다.
  return findWindowedProcess("Discord.exe");
}

/**
 * 일반 프로세스 찾기 (PowerShell Fallback)
 * Window Title 로직이 필요 없는 단일 프로세스 앱용
 */
export async function findProcessByName(processName: string): Promise<number | null> {
  try {
    // PowerShell이 tasklist보다 느릴 수 있지만, 복잡한 필터링엔 유리함
    const command = `powershell -Command "Get-Process | Where-Object {$_.ProcessName -like '*${processName}*'} | Select-Object -First 1 -ExpandProperty Id"`;
    const { stdout } = await execAsync(command);

    const pid = parseInt(stdout.trim(), 10);
    return pid > 0 ? pid : null;
  } catch (error) {
    return null;
  }
}

/**
 * 프로세스 타입으로 PID 찾기
 */
export async function findProcessByType(type: "edge" | "chrome" | "discord" | number): Promise<number | null> {
  if (typeof type === "number") {
    return type > 0 ? type : null;
  }

  switch (type) {
    case "chrome":
      return findChromeProcess();
    case "edge":
      return findEdgeProcess();
    case "discord":
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
    // /NH (No Header) 옵션 사용
    const command = `tasklist /FI "PID eq ${pid}" /NH`;
    const { stdout } = await execAsync(command);

    // PID가 없으면 "정보: 지정된 조건에 맞는 작업이 실행되고 있지 않습니다." 같은 메시지가 뜸
    // PID가 있으면 해당 라인이 출력됨
    return stdout.includes(pid.toString());
  } catch (error) {
    // 프로세스가 없어서 에러가 나는 경우도 있으므로 false 반환
    return false;
  }
}
