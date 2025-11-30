/**
 * DLL 빌드 모드 확인 스크립트
 * 
 * 현재 복사된 DLL이 Release인지 Debug인지 확인합니다.
 * 
 * 실행 방법:
 *   node scripts/check-dll-build-mode.js
 */

const fs = require("fs");
const path = require("path");

const dllPath = path.join(__dirname, "..", "native", "OnVoiceAudioBridge.dll");

console.log("=".repeat(80));
console.log("DLL 빌드 모드 확인");
console.log("=".repeat(80));
console.log();

if (!fs.existsSync(dllPath)) {
  console.error(`❌ DLL을 찾을 수 없습니다: ${dllPath}`);
  console.error();
  console.error("해결 방법:");
  console.error("  1. C++ 프로젝트를 Release 모드로 빌드: npm run build:native");
  console.error("  2. DLL 복사: npm run copy:native");
  process.exit(1);
}

console.log(`✅ DLL 발견: ${dllPath}`);
console.log();

// 파일 정보
const stats = fs.statSync(dllPath);
const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
console.log(`파일 크기: ${fileSizeInMB} MB`);
console.log(`수정 시간: ${stats.mtime.toLocaleString()}`);
console.log();

// DLL 의존성 확인 (dumpbin 또는 objdump 사용)
// Windows에서는 dumpbin을 사용 (Visual Studio Developer Command Prompt 필요)
// 또는 간단하게 파일 크기와 경로로 판단

// 가능한 소스 경로 확인
const projectRoot = path.join(__dirname, "..");
const possibleSourcePaths = [
  // Release 빌드 경로
  path.join(projectRoot, "..", "onvoice-com-bridge", "phase3-com-dll", "OnVoiceAudioBridge", "x64", "Release", "OnVoiceAudioBridge.dll"),
  path.join(projectRoot, "native", "OnVoiceAudioBridge", "x64", "Release", "OnVoiceAudioBridge.dll"),
  path.join(projectRoot, "native", "OnVoiceAudioBridge", "phase3-com-dll", "OnVoiceAudioBridge", "x64", "Release", "OnVoiceAudioBridge.dll"),
  // Debug 빌드 경로
  path.join(projectRoot, "..", "onvoice-com-bridge", "phase3-com-dll", "OnVoiceAudioBridge", "x64", "Debug", "OnVoiceAudioBridge.dll"),
  path.join(projectRoot, "native", "OnVoiceAudioBridge", "x64", "Debug", "OnVoiceAudioBridge.dll"),
  path.join(projectRoot, "native", "OnVoiceAudioBridge", "phase3-com-dll", "OnVoiceAudioBridge", "x64", "Debug", "OnVoiceAudioBridge.dll"),
];

console.log("가능한 소스 경로 확인:");
let foundSource = null;
let isReleaseSource = false;

for (const sourcePath of possibleSourcePaths) {
  if (fs.existsSync(sourcePath)) {
    const sourceStats = fs.statSync(sourcePath);
    const isRelease = sourcePath.toLowerCase().includes('release');
    const isDebug = sourcePath.toLowerCase().includes('debug');
    
    // 파일 크기와 수정 시간 비교
    const sizeMatch = Math.abs(stats.size - sourceStats.size) < 1024; // 1KB 이내 차이
    const timeMatch = Math.abs(stats.mtime - sourceStats.mtime) < 1000; // 1초 이내 차이
    
    if (sizeMatch && timeMatch) {
      foundSource = sourcePath;
      isReleaseSource = isRelease && !isDebug;
      break;
    }
    
    console.log(`  ${isRelease ? '✅ Release' : isDebug ? '⚠️  Debug' : '❓'} ${sourcePath}`);
    console.log(`    크기: ${(sourceStats.size / (1024 * 1024)).toFixed(2)} MB, 수정: ${sourceStats.mtime.toLocaleString()}`);
  }
}

console.log();

if (foundSource) {
  if (isReleaseSource) {
    console.log("✅ Release 빌드로 확인됨");
    console.log(`   소스: ${foundSource}`);
    console.log();
    console.log("이 DLL은 배포에 적합합니다.");
  } else {
    console.error("❌ Debug 빌드로 확인됨!");
    console.error(`   소스: ${foundSource}`);
    console.error();
    console.error("⚠️  이 DLL은 일반 사용자 PC에서 실행되지 않을 수 있습니다.");
    console.error();
    console.error("해결 방법:");
    console.error("  1. C++ 프로젝트를 Release 모드로 빌드:");
    console.error("     npm run build:native");
    console.error();
    console.error("  2. Release DLL 복사:");
    console.error("     npm run copy:native");
    console.error();
    console.error("  3. 또는 Visual Studio에서 직접 빌드:");
    console.error("     - Visual Studio에서 OnVoiceAudioBridge.sln 열기");
    console.error("     - 상단 툴바에서 'Debug'를 'Release'로 변경");
    console.error("     - '솔루션 빌드' 실행");
    console.error("     - npm run copy:native 실행");
    process.exit(1);
  }
} else {
  console.warn("⚠️  소스 경로를 찾을 수 없습니다.");
  console.warn();
  console.warn("다음 방법으로 빌드 모드를 확인할 수 있습니다:");
  console.warn("  1. Visual Studio Developer Command Prompt 열기");
  console.warn("  2. 다음 명령어 실행:");
  console.warn(`     dumpbin /dependents "${dllPath}"`);
  console.warn();
  console.warn("  Debug 빌드인 경우 다음 DLL에 의존합니다:");
  console.warn("    - MSVCP140D.dll (Debug Runtime)");
  console.warn("    - VCRUNTIME140D.dll (Debug Runtime)");
  console.warn();
  console.warn("  Release 빌드인 경우 다음 DLL에 의존합니다:");
  console.warn("    - MSVCP140.dll (Standard Runtime)");
  console.warn("    - VCRUNTIME140.dll (Standard Runtime)");
  console.warn();
  console.warn("또는 Release 빌드를 다시 생성하세요:");
  console.warn("  npm run build:native && npm run copy:native");
}

console.log();
console.log("=".repeat(80));

