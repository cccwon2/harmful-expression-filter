import path from "path";

// ⚠️ 이 파일은 반드시 다른 모든 import보다 먼저 import 되어야 합니다.
// electron-edge-js가 .NET Framework 대신 .NET 6 CoreCLR을 사용하도록 강제
process.env.EDGE_USE_CORECLR = '1';
process.env.EDGE_DEBUG = '1';
process.env.COREHOST_TRACE = '1';
process.env.COREHOST_TRACEFILE = 'c:\\github\\harmful-expression-filter\\trace.txt';

// [Dev Mode Hardcoded Path]
// dist-electron/env.js -> __dirname is dist-electron
// Project root is ../
const projectRoot = path.join(__dirname, '..');
const dotnetPath = path.join(projectRoot, 'dotnet/OnVoiceComBridge/bin/Publish');

process.env.EDGE_APP_ROOT = dotnetPath;
process.env.CORECLR_DIR = dotnetPath;
process.env.EDGE_BOOTSTRAP_DIR = dotnetPath;

// [Dev Mode Hardcoded Path]
// node_modules/electron-edge-js/lib/native/win32/x64/28.0.0/edge_coreclr.node
const edgeNativePath = path.join(projectRoot, 'node_modules/electron-edge-js/lib/native/win32/x64/28.0.0/edge_coreclr.node');
process.env.EDGE_NATIVE = edgeNativePath;

console.log(`[Env] Environment variables set: EDGE_USE_CORECLR=1, TRACE=1`);
console.log(`[Env] EDGE_APP_ROOT: ${dotnetPath}`);
console.log(`[Env] EDGE_NATIVE: ${edgeNativePath}`);
