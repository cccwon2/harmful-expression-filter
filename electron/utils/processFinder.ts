/**
 * 프로세스 검색 유틸리티
 *
 * Windows에서 실행 중인 프로세스의 PID를 찾는 유틸리티 함수
 *
 * TODO: node-process-list 같은 패키지를 사용하면 더 효율적일 수 있습니다.
 */

import { exec } from "child_process";
import { promisify } from "util";

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
 * 메인 프로세스는 Window Title을 가지고 있으므로 이를 기준으로 찾습니다.
 */
export async function findChromeProcess(): Promise<number | null> {
  try {
    // tasklist /v 옵션으로 Window Title 정보 포함하여 검색
    // /fi "imagename eq chrome.exe" : chrome.exe만 필터링
    // /fi "status eq running" : 실행 중인 것만
    // /fo csv : CSV 포맷으로 파싱하기 쉽게
    // /nh : 헤더 제거
    // /v : 상세 정보(Window Title 포함) 출력
    const command = `tasklist /fi "imagename eq chrome.exe" /fi "status eq running" /fo csv /nh /v`;

    const { stdout, stderr } = await execAsync(command);

    if (stderr && stderr.trim()) {
      console.warn(`[ProcessFinder] tasklist 오류: ${stderr}`);
      // 오류가 있어도 stdout이 있으면 계속 진행
    }

    const lines = stdout
      .trim()
      .split("\r\n")
      .filter((line) => line.trim() !== "");

    if (lines.length === 0) {
      console.warn("[ProcessFinder] Chrome 프로세스를 찾을 수 없습니다.");
      return null;
    }

    // Window Title이 있는 메인 프로세스 찾기
    for (const line of lines) {
      // CSV 파싱: "imagename","pid","session","mem","status","username","cpu","window title"
      // 간이 파싱: "로 구분된 컬럼들
      const cols = line.split('","');

      if (cols.length < 2) continue;

      // PID 추출 (두 번째 컬럼, 앞뒤 따옴표 제거)
      const pidStr = cols[1].replace(/"/g, "");
      const pid = parseInt(pidStr, 10);

      if (isNaN(pid) || pid <= 0) continue;

      // Window Title 추출 (마지막 컬럼, 앞뒤 따옴표 제거)
      const windowTitle = cols[cols.length - 1].replace(/"/g, "").trim();

      // 💡 핵심: Window Title이 "N/A"가 아니고, 비어있지 않은 것이 메인 프로세스
      if (windowTitle !== "N/A" && windowTitle !== "") {
        console.log(`[ProcessFinder] ✅ 메인 Chrome 발견! PID: ${pid}, Title: ${windowTitle}`);
        return pid;
      }
    }

    // 메인 프로세스를 찾지 못했으면 첫 번째 프로세스라도 반환
    console.warn("[ProcessFinder] ⚠️ 메인 프로세스를 특정하지 못해 첫 번째 프로세스를 반환합니다.");
    const firstLine = lines[0].split('","');
    if (firstLine.length > 1) {
      const pidStr = firstLine[1].replace(/"/g, "");
      const pid = parseInt(pidStr, 10);
      if (!isNaN(pid) && pid > 0) {
        return pid;
      }
    }

    return null;
  } catch (error) {
    console.error("[ProcessFinder] Chrome 프로세스 검색 실패:", error);
    // 폴백: 기존 방식으로 시도
    return findProcessByName("chrome");
  }
}

/**
 * Edge 프로세스 찾기
 * Edge는 Chromium 기반이므로 msedge.exe를 찾습니다.
 */
export async function findEdgeProcess(): Promise<number | null> {
  return findProcessByName("msedge");
}

/**
 * Discord 프로세스 찾기
 */
export async function findDiscordProcess(): Promise<number | null> {
  return findProcessByName("Discord");
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
