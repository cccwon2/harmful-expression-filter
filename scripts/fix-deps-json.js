const fs = require('fs');
const path = require('path');

/**
 * OnVoiceComBridge.deps.json에 runtimeTarget.runtime 섹션을 추가하여
 * coreclr.dll 참조를 추가합니다.
 * 
 * 이 스크립트는 electron-edge-js의 deps_resolver가 coreclr.dll을 찾을 수 있도록
 * runtimeTarget.runtime 섹션에 coreclr.dll 참조를 추가합니다.
 */
function fixDepsJson(depsJsonPath) {
  console.log(`[fix-deps-json] Processing: ${depsJsonPath}`);
  
  if (!fs.existsSync(depsJsonPath)) {
    console.error(`[fix-deps-json] ❌ File not found: ${depsJsonPath}`);
    return false;
  }

  const content = JSON.parse(fs.readFileSync(depsJsonPath, 'utf8'));
  
  // runtimeTarget.runtime 섹션이 없으면 추가
  if (!content.runtimeTarget) {
    content.runtimeTarget = {};
  }
  
  if (!content.runtimeTarget.runtime) {
    content.runtimeTarget.runtime = {};
  }

  // coreclr.dll 참조 추가
  // self-contained 배포에서는 coreclr.dll이 EDGE_APP_ROOT에 직접 포함되어 있음
  // runtimepack.Microsoft.NETCore.App.Runtime.win-x64/6.0.36 패키지의 native/coreclr.dll을 참조
  const runtimePackage = 'runtimepack.Microsoft.NETCore.App.Runtime.win-x64/6.0.36';
  
  // targets 키를 찾기 (보통 ".NETCoreApp,Version=v6.0/win-x64" 형식)
  let targetKey = null;
  for (const key in content.targets) {
    if (key.includes('/win-x64') || key.includes('/win-x86')) {
      targetKey = key;
      break;
    }
  }
  
  if (targetKey && content.targets[targetKey] && content.targets[targetKey][runtimePackage]) {
    const runtimePackageData = content.targets[targetKey][runtimePackage];
    
    // runtimepack 패키지에 native 섹션이 있고 coreclr.dll이 있는지 확인
    if (runtimePackageData.native && runtimePackageData.native['coreclr.dll']) {
      console.log('[fix-deps-json] ✅ coreclr.dll found in runtimepack native section');
      
      // runtimeTarget.runtime에도 coreclr.dll 참조 추가
      // 경로는 패키지 이름을 기반으로 함
      const coreclrKey = `${runtimePackage}/native/coreclr.dll`;
      if (!content.runtimeTarget.runtime[coreclrKey]) {
        content.runtimeTarget.runtime[coreclrKey] = {};
        console.log('[fix-deps-json] ✅ Added coreclr.dll to runtimeTarget.runtime');
      }
    } else {
      console.warn('[fix-deps-json] ⚠️ coreclr.dll not found in runtimepack native section');
    }
  } else {
    console.warn('[fix-deps-json] ⚠️ runtimepack.Microsoft.NETCore.App.Runtime.win-x64/6.0.36 not found in targets');
  }

  // JSON을 파일에 쓰기 (들여쓰기 2)
  fs.writeFileSync(depsJsonPath, JSON.stringify(content, null, 2), 'utf8');
  console.log(`[fix-deps-json] ✅ Fixed: ${depsJsonPath}`);
  
  return true;
}

// 실행
const depsJsonPath = process.argv[2] || path.join(__dirname, '../dotnet/OnVoiceComBridge/bin/Publish/OnVoiceComBridge.deps.json');

if (fixDepsJson(depsJsonPath)) {
  console.log('[fix-deps-json] ✅ Success');
  process.exit(0);
} else {
  console.error('[fix-deps-json] ❌ Failed');
  process.exit(1);
}

