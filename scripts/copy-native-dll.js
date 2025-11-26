/**
 * C++ COM DLL을 Electron 빌드 출력 디렉토리로 복사하는 스크립트
 */

const fs = require("fs");
const path = require("path");

// 1. C++ DLL 소스 경로 (여러 가능한 경로 확인)
const possibleSourcePaths = [
  // Visual Studio 기본 빌드 경로 (x64/Release)
  path.join(__dirname, "..", "native", "OnVoiceAudioBridge", "x64", "Release", "OnVoiceAudioBridge.dll"),
  // Visual Studio 기본 빌드 경로 (Release)
  path.join(__dirname, "..", "native", "OnVoiceAudioBridge", "Release", "OnVoiceAudioBridge.dll"),
  // 이미 native 폴더에 복사된 경우
  path.join(__dirname, "..", "native", "OnVoiceAudioBridge.dll"),
  // Debug 빌드 경로 (개발용)
  path.join(__dirname, "..", "native", "OnVoiceAudioBridge", "x64", "Debug", "OnVoiceAudioBridge.dll"),
  path.join(__dirname, "..", "native", "OnVoiceAudioBridge", "Debug", "OnVoiceAudioBridge.dll"),
];

// 2. Electron 배포용 DLL 저장 경로
const targetDir = path.join(__dirname, "..", "native");
const targetFile = path.join(targetDir, "OnVoiceAudioBridge.dll");

// 소스 파일 찾기
let sourceFile = null;
for (const sourcePath of possibleSourcePaths) {
  if (fs.existsSync(sourcePath)) {
    sourceFile = sourcePath;
    break;
  }
}

if (!sourceFile) {
  console.error(`[Copy Native DLL] ❌ DLL을 찾을 수 없습니다.`);
  console.error("           다음 경로를 확인하세요:");
  possibleSourcePaths.forEach((p) => {
    console.error(`           - ${p}`);
  });
  console.error("");
  console.error("           해결 방법:");
  console.error("           1. C++ 프로젝트를 빌드하세요 (npm run build:native)");
  console.error("           2. 또는 빌드된 DLL을 native/OnVoiceAudioBridge.dll 경로에 복사하세요");
  process.exit(1);
}

// 타겟 디렉토리 생성
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  console.log(`[Copy Native DLL] 디렉토리 생성됨: ${targetDir}`);
}

// DLL 복사
try {
  fs.copyFileSync(sourceFile, targetFile);
  console.log(`[Copy Native DLL] ✅ 복사 완료: ${sourceFile} → ${targetFile}`);
  
  // 파일 크기 확인
  const stats = fs.statSync(targetFile);
  const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`[Copy Native DLL] 파일 크기: ${fileSizeInMB} MB`);
} catch (err) {
  console.error(`[Copy Native DLL] ❌ 복사 오류: ${err.message}`);
  process.exit(1);
}

