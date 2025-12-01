const fs = require('fs');
const path = require('path');

// ✅ [수정됨] package.json의 build:dotnet 스크립트가 -o bin/Release/net6.0/win-x64/publish 로 설정되어 있습니다.
const sourceDir = path.join(__dirname, '../dotnet/OnVoiceComBridge/bin/Release/net6.0/win-x64/publish');
const targetDir = path.join(__dirname, '../dist-electron/dotnet');

// 폴더가 없으면 에러 (빌드 순서 확인용)
if (!fs.existsSync(sourceDir)) {
  console.error(`[Copy DLL] ❌ 소스 디렉토리를 찾을 수 없습니다: ${sourceDir}`);
  console.error('           먼저 "npm run build:dotnet"을 실행해 주세요.');
  process.exit(1);
}

// 타겟 디렉토리 생성
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

console.log(`[Copy DLL] Source: ${sourceDir}`);
console.log(`[Copy DLL] Target: ${targetDir}`);

// 파일 복사 함수 (재귀적)
function copyFolderSync(from, to) {
  if (!fs.existsSync(to)) {
    fs.mkdirSync(to, { recursive: true });
  }
  
  const files = fs.readdirSync(from);
  let count = 0;

  files.forEach(element => {
    const stat = fs.lstatSync(path.join(from, element));
    if (stat.isFile()) {
      fs.copyFileSync(path.join(from, element), path.join(to, element));
      count++;
    } else if (stat.isDirectory()) {
      const subCount = copyFolderSync(path.join(from, element), path.join(to, element));
      count += subCount;
    }
  });
  return count;
}

// 파일 통계 수집 함수
function getFileStats(dir) {
  const stats = {
    total: 0,
    byExtension: {},
    bySize: { small: 0, medium: 0, large: 0 }
  };
  
  function scanDir(currentDir) {
    const items = fs.readdirSync(currentDir);
    items.forEach(item => {
      const fullPath = path.join(currentDir, item);
      const stat = fs.lstatSync(fullPath);
      
      if (stat.isFile()) {
        stats.total++;
        const ext = path.extname(item) || '(no extension)';
        stats.byExtension[ext] = (stats.byExtension[ext] || 0) + 1;
        
        const sizeMB = stat.size / (1024 * 1024);
        if (sizeMB < 0.1) stats.bySize.small++;
        else if (sizeMB < 1) stats.bySize.medium++;
        else stats.bySize.large++;
      } else if (stat.isDirectory()) {
        scanDir(fullPath);
      }
    });
  }
  
  scanDir(dir);
  return stats;
}

try {
  // 소스 디렉토리 통계
  console.log(`[Copy DLL] 📊 소스 디렉토리 분석 중...`);
  const sourceStats = getFileStats(sourceDir);
  console.log(`[Copy DLL] 📁 소스 파일 수: ${sourceStats.total}개`);
  
  // 상위 5개 확장자 표시
  const topExtensions = Object.entries(sourceStats.byExtension)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ext, count]) => `  - ${ext}: ${count}개`)
    .join('\n');
  if (topExtensions) {
    console.log(`[Copy DLL] 📦 주요 파일 타입:\n${topExtensions}`);
  }
  
  const fileCount = copyFolderSync(sourceDir, targetDir);
  console.log(`[Copy DLL] ✅ 복사 완료: 총 ${fileCount}개 파일`);
  
  if (fileCount !== sourceStats.total) {
    console.warn(`[Copy DLL] ⚠️ 경고: 복사된 파일 수(${fileCount})와 소스 파일 수(${sourceStats.total})가 일치하지 않습니다.`);
  }
  
  // 검증: 핵심 파일 확인
  if (fs.existsSync(path.join(targetDir, 'coreclr.dll'))) {
     console.log(`[Copy DLL] 👌 CoreCLR 런타임 확인됨 (coreclr.dll)`);
  } else {
     console.warn(`[Copy DLL] ⚠️ 경고: coreclr.dll이 보이지 않습니다. Self-contained 빌드가 맞나요?`);
  }
  
  // 추가 검증: hostfxr.dll 확인
  if (fs.existsSync(path.join(targetDir, 'hostfxr.dll'))) {
     console.log(`[Copy DLL] 👌 HostFxr 확인됨 (hostfxr.dll)`);
  } else {
     console.warn(`[Copy DLL] ⚠️ 경고: hostfxr.dll이 보이지 않습니다.`);
  }
  
  // 메인 DLL 확인
  if (fs.existsSync(path.join(targetDir, 'OnVoiceComBridge.dll'))) {
     console.log(`[Copy DLL] 👌 메인 DLL 확인됨 (OnVoiceComBridge.dll)`);
  } else {
     console.error(`[Copy DLL] ❌ OnVoiceComBridge.dll이 없습니다!`);
  }
  
  // 이전 빌드와 비교 정보
  console.log(`[Copy DLL] 💡 참고: .NET 6 self-contained 빌드에서 230~240개 파일은 정상적인 범위입니다.`);
  console.log(`[Copy DLL] 💡 이전에 300개 이상이었다면, 추가 의존성이나 설정 차이일 수 있습니다.`);
  
} catch (err) {
  console.error('[Copy DLL] ❌ 복사 중 오류 발생:', err);
  process.exit(1);
}
