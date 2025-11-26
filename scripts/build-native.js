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

// 프로젝트 루트 찾기 (package.json이 있는 디렉토리)
function findProjectRoot() {
  let currentDir = __dirname;
  while (currentDir !== path.dirname(currentDir)) {
    const packageJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  // package.json을 찾지 못하면 scripts의 상위 디렉토리 반환
  return path.join(__dirname, "..");
}

// 프로젝트 경로 확인 (여러 가능한 경로 시도)
function findProjectPath() {
  const projectRoot = findProjectRoot();
  
  // 환경 변수로 경로 지정 가능 (상대 경로는 프로젝트 루트 기준)
  const envPath = process.env.NATIVE_PROJECT_PATH;
  if (envPath) {
    // 절대 경로인지 확인
    const resolvedPath = path.isAbsolute(envPath) 
      ? envPath 
      : path.resolve(projectRoot, envPath);
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  // 가능한 경로 목록 (상대 경로 우선, 프로젝트 루트 기준)
  const possiblePaths = [
    // 상대 경로 (프로젝트 루트 기준 ../onvoice-com-bridge/phase3-com-dll/OnVoiceAudioBridge)
    path.join(projectRoot, "..", "onvoice-com-bridge", "phase3-com-dll", "OnVoiceAudioBridge"),
    // 서브모듈 경로 (phase3-com-dll 포함)
    path.join(projectRoot, "native", "OnVoiceAudioBridge", "phase3-com-dll", "OnVoiceAudioBridge"),
    // 서브모듈 경로 (직접)
    path.join(projectRoot, "native", "OnVoiceAudioBridge"),
    // 절대 경로 (fallback)
    "C:\\github\\onvoice-com-bridge\\phase3-com-dll\\OnVoiceAudioBridge",
    path.join(process.env.USERPROFILE || "", "github", "onvoice-com-bridge", "phase3-com-dll", "OnVoiceAudioBridge"),
  ];

  // 디버깅: 확인하는 경로 출력
  if (process.env.DEBUG_NATIVE_BUILD) {
    console.log(`[Build Native] 프로젝트 루트: ${projectRoot}`);
    console.log(`[Build Native] 확인할 경로들:`);
  }

  for (const projectPath of possiblePaths) {
    const solutionFileSln = path.join(projectPath, "OnVoiceAudioBridge.sln");
    const solutionFileSlnx = path.join(projectPath, "OnVoiceAudioBridge.slnx");
    const dirExists = fs.existsSync(projectPath);
    const solutionExistsSln = fs.existsSync(solutionFileSln);
    const solutionExistsSlnx = fs.existsSync(solutionFileSlnx);
    const solutionExists = solutionExistsSln || solutionExistsSlnx;
    
    // x64/Debug 또는 x64/Release 폴더가 있으면 프로젝트로 인식
    const hasBuildOutput = dirExists && (
      fs.existsSync(path.join(projectPath, "x64", "Debug")) ||
      fs.existsSync(path.join(projectPath, "x64", "Release")) ||
      fs.existsSync(path.join(projectPath, "Debug")) ||
      fs.existsSync(path.join(projectPath, "Release"))
    );
    
    if (process.env.DEBUG_NATIVE_BUILD) {
      console.log(`  - ${projectPath}`);
      console.log(`    디렉토리 존재: ${dirExists ? '✅' : '❌'}`);
      console.log(`    솔루션 파일 (.sln) 존재: ${solutionExistsSln ? '✅' : '❌'} (${solutionFileSln})`);
      console.log(`    솔루션 파일 (.slnx) 존재: ${solutionExistsSlnx ? '✅' : '❌'} (${solutionFileSlnx})`);
      console.log(`    빌드 출력 폴더 존재: ${hasBuildOutput ? '✅' : '❌'}`);
    }
    
    // 솔루션 파일이 있거나, 빌드 출력 폴더가 있으면 프로젝트로 인식
    if (solutionExists || hasBuildOutput) {
      if (process.env.DEBUG_NATIVE_BUILD) {
        console.log(`[Build Native] ✅ 프로젝트 찾음: ${projectPath}`);
      }
      return projectPath;
    }
  }

  return null;
}

const projectDir = findProjectPath();

if (!projectDir) {
  const projectRoot = findProjectRoot();
  console.error(`[Build Native] ❌ 프로젝트 디렉토리를 찾을 수 없습니다.`);
  console.error("");
  console.error(`           프로젝트 루트: ${projectRoot}`);
  console.error("");
  console.error("           다음 경로를 확인했습니다:");
  
  const checkedPaths = [
    path.join(projectRoot, "..", "onvoice-com-bridge", "phase3-com-dll", "OnVoiceAudioBridge"),
    path.join(projectRoot, "native", "OnVoiceAudioBridge", "phase3-com-dll", "OnVoiceAudioBridge"),
    path.join(projectRoot, "native", "OnVoiceAudioBridge"),
  ];
  
  checkedPaths.forEach((p) => {
    const dirExists = fs.existsSync(p);
    const solutionExists = fs.existsSync(path.join(p, "OnVoiceAudioBridge.sln"));
    const status = dirExists ? (solutionExists ? "✅" : "⚠️ (디렉토리 존재, 솔루션 파일 없음)") : "❌";
    console.error(`           ${status} ${p}`);
  });
  
  console.error("");
  console.error("           해결 방법:");
  console.error("           1. 상대 경로로 프로젝트 배치: ../onvoice-com-bridge/phase3-com-dll/OnVoiceAudioBridge");
  console.error("           2. 환경 변수로 경로 지정 (프로젝트 루트 기준):");
  console.error(`              set NATIVE_PROJECT_PATH=../onvoice-com-bridge/phase3-com-dll/OnVoiceAudioBridge`);
  console.error("           3. Git 서브모듈 추가: git submodule add https://github.com/cccwon2/onvoice-com-bridge.git native/OnVoiceAudioBridge");
  console.error("");
  console.error("           디버깅 모드로 실행: set DEBUG_NATIVE_BUILD=1 && npm run build:native");
  console.error("           (각 경로의 디렉토리 및 솔루션 파일 존재 여부를 자세히 확인할 수 있습니다)");
  process.exit(1);
}

// .sln 또는 .slnx 파일 확인
const solutionFileSln = path.join(projectDir, "OnVoiceAudioBridge.sln");
const solutionFileSlnx = path.join(projectDir, "OnVoiceAudioBridge.slnx");
const solutionFile = fs.existsSync(solutionFileSlnx) ? solutionFileSlnx : solutionFileSln;

if (!fs.existsSync(solutionFileSln) && !fs.existsSync(solutionFileSlnx)) {
  console.error(`[Build Native] ❌ 솔루션 파일을 찾을 수 없습니다.`);
  console.error(`           확인한 경로:`);
  console.error(`           - ${solutionFileSln}`);
  console.error(`           - ${solutionFileSlnx}`);
  console.error("");
  console.error("           C++ 프로젝트가 올바르게 포함되었는지 확인하세요.");
  process.exit(1);
}

// .slnx 파일인 경우 MSBuild가 지원하는지 확인
if (solutionFile.endsWith('.slnx')) {
  console.log(`[Build Native] ⚠️  .slnx 파일을 사용합니다. Visual Studio 2022 이상이 필요할 수 있습니다.`);
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
  // MSBuild 실행 (.slnx 파일도 지원)
  // .slnx 파일은 Visual Studio 2022 이상의 MSBuild에서 지원
  // 플랫폼 도구 집합을 명시적으로 지정 (VS 2022 = v143, VS 2019 = v142, VS 2017 = v141)
  // VS 2022를 사용 중이면 v143을 사용, 없으면 자동으로 감지
  const msbuildDir = path.dirname(msbuildPath);
  const isVS2022 = msbuildDir.includes('2022');
  const platformToolset = isVS2022 ? 'v143' : 'v142'; // VS 2022 = v143, VS 2019 = v142
  
  console.log(`[Build Native] 플랫폼 도구 집합: ${platformToolset} (${isVS2022 ? 'Visual Studio 2022' : 'Visual Studio 2019'})`);
  
  execSync(
    `"${msbuildPath}" "${solutionFile}" /p:Configuration=Release /p:Platform=x64 /p:PlatformToolset=${platformToolset} /t:Build /v:minimal`,
    { 
      cwd: projectDir,
      stdio: 'inherit'
    }
  );
  
  console.log(`[Build Native] ✅ 빌드 완료`);
} catch (err) {
  console.error(`[Build Native] ❌ 빌드 실패: ${err.message}`);
  if (solutionFile.endsWith('.slnx')) {
    console.error("");
    console.error("           .slnx 파일은 Visual Studio 2022 이상이 필요할 수 있습니다.");
    console.error("           또는 Visual Studio에서 직접 빌드한 후 npm run copy:native를 실행하세요.");
  }
  console.error("");
  console.error("           플랫폼 도구 집합 오류가 발생한 경우:");
  console.error("           1. Visual Studio에서 프로젝트를 열고 '프로젝트 > 속성 > 일반 > 플랫폼 도구 집합'을 확인하세요.");
  console.error("           2. Visual Studio 2022를 사용 중이라면 'v143'으로 변경하세요.");
  console.error("           3. 또는 Visual Studio Installer에서 'C++ v143 빌드 도구'를 설치하세요.");
  process.exit(1);
}

