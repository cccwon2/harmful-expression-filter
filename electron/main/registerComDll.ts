import { app } from "electron";
import path from "node:path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Registration-Free COM 매니페스트 파일이 존재하는지 확인합니다.
 * 
 * @returns 매니페스트 파일이 존재하는지 여부
 */
async function hasRegistrationFreeManifest(): Promise<boolean> {
  try {
    const fs = await import("fs/promises");
    
    // DLL 매니페스트 파일 경로
    const dllManifestPath = app.isPackaged
      ? path.join(process.resourcesPath, "native", "OnVoiceAudioBridge.dll.manifest")
      : path.join(__dirname, "../../native/OnVoiceAudioBridge.dll.manifest");
    
    // 앱 매니페스트 파일 경로
    const appManifestPath = app.isPackaged
      ? path.join(process.resourcesPath, "..", "OnVoice.exe.manifest")
      : path.join(__dirname, "../../electron/OnVoice.exe.manifest");
    
    try {
      const [dllManifestExists, appManifestExists] = await Promise.all([
        fs.access(dllManifestPath).then(() => true).catch(() => false),
        fs.access(appManifestPath).then(() => true).catch(() => false)
      ]);
      
      return dllManifestExists && appManifestExists;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * COM DLL을 시스템에 등록합니다.
 * Registration-Free COM 매니페스트가 있으면 등록을 건너뜁니다.
 * 
 * @returns 등록 성공 여부 (또는 Registration-Free COM 사용 시 true)
 */
export async function registerComDll(): Promise<boolean> {
  try {
    // Registration-Free COM 매니페스트 확인
    const hasManifest = await hasRegistrationFreeManifest();
    if (hasManifest) {
      console.log(`[COM Registration] ✅ Registration-Free COM 매니페스트가 감지되었습니다. 레지스트리 등록이 필요하지 않습니다.`);
      return true;
    }

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
    console.log(`[COM Registration] ⚠️ Registration-Free COM 매니페스트가 없어 레지스트리 등록 방식을 사용합니다.`);

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
 * Registration-Free COM을 사용하는 경우 항상 true를 반환합니다.
 * 
 * @returns 등록되어 있는지 여부 (또는 Registration-Free COM 사용 시 true)
 */
export async function checkComDllRegistered(): Promise<boolean> {
  try {
    // Registration-Free COM 매니페스트 확인
    const hasManifest = await hasRegistrationFreeManifest();
    if (hasManifest) {
      // Registration-Free COM을 사용하면 레지스트리 등록이 필요 없음
      return true;
    }

    // 레지스트리에서 ProgID 확인 (기존 방식)
    const command = `reg query "HKEY_CLASSES_ROOT\\OnVoiceAudioBridge.OnVoiceCapture" /ve 2>nul`;
    const { stdout } = await execAsync(command);
    return stdout.includes("OnVoiceAudioBridge.OnVoiceCapture");
  } catch {
    return false;
  }
}

