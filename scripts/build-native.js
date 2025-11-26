/**
 * C++ COM DLL 빌드 스크립트 (MSBuild 경로 자동 탐색)
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// MSBuild 경로 찾기
function findMSBuild() {
  const possiblePaths = [
    // Visual Studio 2022
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\MSBuild\\Current\\Bin\\MSBuild.exe",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\MSBuild\\Current\\Bin\\MSBuild.exe",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe",
    
    // Visual Studio 2019
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional\\MSBuild\\Current\\Bin\\MSBuild.exe",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise\\MSBuild\\Current\\Bin\\MSBuild.exe",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe",
  ];

  // vswhere.exe를 사용하여 MSBuild 찾기 (가장 정확한 방법)
  const vswherePath = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
  if (fs.existsSync(vswherePath)) {
    try {
      const result = execSync(
        `"${vswherePath}" -latest -requires Microsoft.Component.MSBuild -find MSBuild\\**\\Bin\\MSBuild.exe`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim();
      
      if (result && fs.existsSync(result)) {
        return result;
      }
    } catch (err) {
      // vswhere 실패 시 무시하고 다음 방법 시도
    }
  }

  // 직접 경로 확인
  for (const msbuildPath of possiblePaths) {
    if (fs.existsSync(msbuildPath)) {
      return msbuildPath;
    }
  }

  return null;
}

// 프로젝트 경로 확인
const projectDir = path.join(__dirname, "..", "native", "OnVoiceAudioBridge");
const solutionFile = path.join(projectDir, "OnVoiceAudioBridge.sln");

if (!fs.existsSync(projectDir)) {
  console.error(`[Build Native] ❌ 프로젝트 디렉토리를 찾을 수 없습니다: ${projectDir}`);
  console.error("");
  console.error("           해결 방법:");
  console.error("           1. Git 서브모듈 추가: git submodule add https://github.com/cccwon2/onvoice-com-bridge.git native/OnVoiceAudioBridge");
  console.error("           2. 또는 C++ 소스 코드를 native/OnVoiceAudioBridge/ 경로에 복사하세요");
  process.exit(1);
}

if (!fs.existsSync(solutionFile)) {
  console.error(`[Build Native] ❌ 솔루션 파일을 찾을 수 없습니다: ${solutionFile}`);
  console.error("");
  console.error("           C++ 프로젝트가 올바르게 포함되었는지 확인하세요.");
  process.exit(1);
}

// MSBuild 찾기
const msbuildPath = findMSBuild();

if (!msbuildPath) {
  console.error(`[Build Native] ❌ MSBuild를 찾을 수 없습니다.`);
  console.error("");
  console.error("           해결 방법:");
  console.error("           1. Visual Studio 2019 이상 또는 Visual Studio Build Tools 설치");
  console.error("           2. 또는 Visual Studio Developer Command Prompt에서 직접 빌드:");
  console.error(`              cd ${projectDir}`);
  console.error(`              msbuild OnVoiceAudioBridge.sln /p:Configuration=Release /p:Platform=x64`);
  console.error("           3. 또는 Visual Studio에서 솔루션을 열어 직접 빌드");
  console.error("");
  console.error("           참고: 빌드된 DLL이 이미 있다면 다음 명령으로 복사할 수 있습니다:");
  console.error("           npm run copy:native");
  process.exit(1);
}

console.log(`[Build Native] MSBuild 경로: ${msbuildPath}`);
console.log(`[Build Native] 프로젝트 경로: ${projectDir}`);
console.log(`[Build Native] 빌드 시작...`);

try {
  // MSBuild 실행
  execSync(
    `"${msbuildPath}" "${solutionFile}" /p:Configuration=Release /p:Platform=x64 /t:Build /v:minimal`,
    { 
      cwd: projectDir,
      stdio: 'inherit'
    }
  );
  
  console.log(`[Build Native] ✅ 빌드 완료`);
} catch (err) {
  console.error(`[Build Native] ❌ 빌드 실패: ${err.message}`);
  process.exit(1);
}

