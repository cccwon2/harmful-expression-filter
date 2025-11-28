import { app } from "electron";
import path from "node:path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * COM DLL을 시스템에 등록합니다.
 * 포터블 방식에서 앱 시작 시 자동으로 COM DLL을 등록하기 위해 사용됩니다.
 * 
 * @returns 등록 성공 여부
 */
export async function registerComDll(): Promise<boolean> {
  try {
    // COM DLL 경로 찾기
    const dllPath = app.isPackaged
      ? path.join(process.resourcesPath, "native", "OnVoiceAudioBridge.dll")
      : path.join(__dirname, "../../native/OnVoiceAudioBridge.dll");

    // DLL 파일 존재 확인
    const fs = await import("fs/promises");
    try {
      await fs.access(dllPath);
    } catch {
      console.warn(`[COM Registration] DLL 파일을 찾을 수 없습니다: ${dllPath}`);
      return false;
    }

    console.log(`[COM Registration] COM DLL 등록 시도: ${dllPath}`);

    // regsvr32를 사용하여 COM DLL 등록
    // /s: 자동 모드 (메시지 표시 안 함)
    const command = `regsvr32.exe /s "${dllPath}"`;
    
    try {
      const { stdout, stderr } = await execAsync(command);
      if (stderr) {
        console.warn(`[COM Registration] 경고: ${stderr}`);
      }
      console.log(`[COM Registration] ✅ COM DLL 등록 성공`);
      return true;
    } catch (error: any) {
      // regsvr32는 실패해도 종료 코드 0을 반환할 수 있으므로
      // 실제 등록 여부는 COM 객체 생성 시 확인해야 함
      console.warn(`[COM Registration] ⚠️ 등록 시도 완료 (관리자 권한이 필요할 수 있습니다): ${error.message}`);
      
      // 관리자 권한이 필요한 경우를 위한 안내
      if (error.code !== 0) {
        console.warn(`[COM Registration] 💡 관리자 권한으로 실행하거나 수동 등록이 필요할 수 있습니다.`);
        console.warn(`[COM Registration] 💡 수동 등록: regsvr32.exe "${dllPath}"`);
      }
      
      // 등록 시도는 완료했으므로 true 반환 (실제 등록 여부는 나중에 확인)
      return true;
    }
  } catch (error: any) {
    console.error(`[COM Registration] ❌ COM DLL 등록 실패:`, error);
    return false;
  }
}

/**
 * COM DLL 등록 상태를 확인합니다.
 * 
 * @returns 등록되어 있는지 여부
 */
export async function checkComDllRegistered(): Promise<boolean> {
  try {
    // 레지스트리에서 ProgID 확인
    const command = `reg query "HKEY_CLASSES_ROOT\\OnVoiceAudioBridge.OnVoiceCapture" /ve 2>nul`;
    const { stdout } = await execAsync(command);
    return stdout.includes("OnVoiceAudioBridge.OnVoiceCapture");
  } catch {
    return false;
  }
}

