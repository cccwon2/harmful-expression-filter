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

try {
  const fileCount = copyFolderSync(sourceDir, targetDir);
  console.log(`[Copy DLL] ✅ 복사 완료: 총 ${fileCount}개 파일`);
  
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
  
} catch (err) {
  console.error('[Copy DLL] ❌ 복사 중 오류 발생:', err);
  process.exit(1);
}
