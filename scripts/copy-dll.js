/**
 * .NET DLL을 Electron 빌드 출력 디렉토리로 복사하는 스크립트
 */

const fs = require('fs');
const path = require('path');

// 최신 빌드 출력 디렉토리 찾기 (net6.0-windows10.0.19041.0 우선, 없으면 net6.0)
const baseDir = path.join(__dirname, '..', 'dotnet', 'OnVoiceComBridge', 'bin', 'Debug');
const windowsDir = path.join(baseDir, 'net6.0-windows10.0.19041.0');
const fallbackDir = path.join(baseDir, 'net6.0');
const sourceDir = fs.existsSync(windowsDir) ? windowsDir : fallbackDir;
const targetDir = path.join(__dirname, '..', 'dist-electron', 'dotnet');

const filesToCopy = [
  'OnVoiceComBridge.dll',
  'OnVoiceComBridge.pdb',
  'OnVoiceComBridge.deps.json'
];

// targetDir이 없으면 생성
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  console.log(`[Copy DLL] 디렉토리 생성: ${targetDir}`);
}

// 파일 복사
let copiedCount = 0;
for (const file of filesToCopy) {
  const sourceFile = path.join(sourceDir, file);
  const targetFile = path.join(targetDir, file);

  if (fs.existsSync(sourceFile)) {
    fs.copyFileSync(sourceFile, targetFile);
    console.log(`[Copy DLL] ✅ ${file} 복사 완료`);
    copiedCount++;
  } else {
    console.warn(`[Copy DLL] ⚠️  ${file} 파일을 찾을 수 없습니다: ${sourceFile}`);
  }
}

if (copiedCount > 0) {
  console.log(`[Copy DLL] 완료: ${copiedCount}개 파일 복사됨`);
} else {
  console.error('[Copy DLL] ❌ 복사된 파일이 없습니다. .NET 프로젝트를 먼저 빌드하세요.');
  process.exit(1);
}

