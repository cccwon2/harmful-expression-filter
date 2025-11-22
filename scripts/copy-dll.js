/**
 * .NET DLL을 Electron 빌드 출력 디렉토리로 복사하는 스크립트
 * (모든 의존성 DLL을 포함하여 복사)
 */

const fs = require("fs");
const path = require("path");

// 1. .NET 빌드 출력 디렉토리 설정
// .csproj에 <RuntimeIdentifier>win-x64</RuntimeIdentifier>가 있으므로 win-x64 폴더를 바라봅니다.
const baseDir = path.join(__dirname, "..", "dotnet", "OnVoiceComBridge", "bin", "Debug");
const frameworkDir = "net6.0-windows10.0.19041.0";
const runtimeDir = "win-x64";

// 우선 win-x64 경로를 확인하고, 없으면 상위 폴더를 확인 (혹시 모를 경로 오류 방지)
let sourceDir = path.join(baseDir, frameworkDir, runtimeDir);
if (!fs.existsSync(sourceDir)) {
  sourceDir = path.join(baseDir, frameworkDir);
}

// 2. Electron 배포용 DLL 저장 경로
const targetDir = path.join(__dirname, "..", "dist-electron", "dotnet");

console.log(`[Copy DLL] Source: ${sourceDir}`);
console.log(`[Copy DLL] Target: ${targetDir}`);

// 소스 디렉토리 존재 확인
if (!fs.existsSync(sourceDir)) {
  console.error(`[Copy DLL] ❌ 빌드 디렉토리를 찾을 수 없습니다: ${sourceDir}`);
  console.error("           먼저 .NET 프로젝트를 빌드하세요 (npm run build:dotnet)");
  process.exit(1);
}

// 타겟 디렉토리 생성
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  console.log(`[Copy DLL] 디렉토리 생성됨: ${targetDir}`);
}

// 3. 복사할 파일 확장자 목록 (DLL, PDB, JSON 설정 파일 등)
const allowedExtensions = [".dll", ".pdb", ".json"];

try {
  const files = fs.readdirSync(sourceDir);
  let copiedCount = 0;
  let hasSdkDll = false;

  files.forEach((file) => {
    const ext = path.extname(file).toLowerCase();

    // 확장자가 일치하면 복사 (모든 종속성 포함)
    if (allowedExtensions.includes(ext)) {
      const sourceFile = path.join(sourceDir, file);
      const targetFile = path.join(targetDir, file);

      // 파일 복사 (덮어쓰기)
      fs.copyFileSync(sourceFile, targetFile);
      copiedCount++;

      // 주요 파일 로깅 (확인용)
      if (file === "OnVoiceComBridge.dll") {
        console.log(`[Copy DLL] ✅ 메인 DLL 복사됨: ${file}`);
      } else if (file.includes("Microsoft.Windows.SDK.NET")) {
        console.log(`[Copy DLL] ✅ SDK 런타임 복사됨: ${file}`);
        hasSdkDll = true;
      } else if (file.includes("WinRT.Runtime")) {
        console.log(`[Copy DLL] ✅ WinRT 런타임 복사됨: ${file}`);
      }
    }
  });

  console.log(`[Copy DLL] 총 ${copiedCount}개 파일 복사 완료.`);

  if (!hasSdkDll) {
    console.warn(`[Copy DLL] ⚠️  경고: 'Microsoft.Windows.SDK.NET.dll'이 발견되지 않았습니다.`);
    console.warn(
      `           .csproj 파일에 <CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>가 있는지 확인하세요.`
    );
  } else {
    console.log(`[Copy DLL] 👌 필수 WinRT 파일이 모두 포함되었습니다.`);
  }
} catch (err) {
  console.error(`[Copy DLL] ❌ 오류 발생: ${err.message}`);
  process.exit(1);
}
