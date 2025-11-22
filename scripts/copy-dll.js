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
  'OnVoiceComBridge.deps.json',
  'OnVoiceComBridge.runtimeconfig.json' // 런타임 구성 파일 추가
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

// Windows SDK 런타임 DLL 복사 (WinRT API 사용 시 필요)
function findWindowsSdkDlls() {
  const dotnetRoot = process.env.DOTNET_ROOT || 'C:\\Program Files\\dotnet';
  const possiblePaths = [
    // .NET 6 런타임 팩 경로
    path.join(dotnetRoot, 'packs', 'Microsoft.Windows.SDK.NET.Ref', '10.0.19041.52', 'ref', 'net6.0'),
    path.join(dotnetRoot, 'shared', 'Microsoft.WindowsDesktop.App', '6.0.0'),
    // 대체 경로들
    path.join(dotnetRoot, 'packs', 'Microsoft.Windows.SDK.NET.Ref'),
  ];

  const sdkDlls = ['Microsoft.Windows.SDK.NET.dll', 'WinRT.Runtime.dll'];
  const foundDlls = [];

  for (const searchPath of possiblePaths) {
    if (!fs.existsSync(searchPath)) continue;
    
    // 재귀적으로 DLL 찾기
    function searchDir(dir) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            searchDir(fullPath);
          } else if (entry.isFile() && sdkDlls.includes(entry.name)) {
            foundDlls.push(fullPath);
          }
        }
      } catch (err) {
        // 무시하고 계속
      }
    }
    
    searchDir(searchPath);
  }

  return foundDlls;
}

// Windows SDK DLL 복사
const sdkDlls = findWindowsSdkDlls();
if (sdkDlls.length > 0) {
  for (const dllPath of sdkDlls) {
    const fileName = path.basename(dllPath);
    const targetFile = path.join(targetDir, fileName);
    
    if (!fs.existsSync(targetFile)) {
      try {
        fs.copyFileSync(dllPath, targetFile);
        console.log(`[Copy DLL] ✅ ${fileName} 복사 완료 (Windows SDK)`);
        copiedCount++;
      } catch (err) {
        console.warn(`[Copy DLL] ⚠️  ${fileName} 복사 실패:`, err.message);
      }
    }
  }
} else {
  console.warn('[Copy DLL] ⚠️  Windows SDK 런타임 DLL을 찾을 수 없습니다. WinRT API 사용 시 문제가 발생할 수 있습니다.');
}

if (copiedCount > 0) {
  console.log(`[Copy DLL] 완료: ${copiedCount}개 파일 복사됨`);
} else {
  console.error('[Copy DLL] ❌ 복사된 파일이 없습니다. .NET 프로젝트를 먼저 빌드하세요.');
  process.exit(1);
}

