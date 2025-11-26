/**
 * MSBuild 경로를 자동으로 찾는 스크립트
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

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
    
    // Visual Studio 2017
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Community\\MSBuild\\15.0\\Bin\\MSBuild.exe",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Professional\\MSBuild\\15.0\\Bin\\MSBuild.exe",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Enterprise\\MSBuild\\15.0\\Bin\\MSBuild.exe",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\BuildTools\\MSBuild\\15.0\\Bin\\MSBuild.exe",
    
    // .NET Framework MSBuild (최신 버전)
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe",
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

const msbuildPath = findMSBuild();

if (msbuildPath) {
  console.log(msbuildPath);
} else {
  console.error("MSBuild를 찾을 수 없습니다.");
  process.exit(1);
}

