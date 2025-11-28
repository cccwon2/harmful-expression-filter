/**
 * 패키징된 electron-edge-js 모듈을 올바른 파일로 교체하는 스크립트
 */

const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '..', 'node_modules', 'electron-edge-js', 'lib', 'native', 'win32', 'x64', '28.0.0', 'edge_coreclr.node');
const targetPath = path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'electron-edge-js', 'lib', 'native', 'win32', 'x64', '28.0.0', 'edge_coreclr.node');

console.log('[Fix Packaged Edge Module] 🔄 패키징된 파일 교체 중...');

if (!fs.existsSync(sourcePath)) {
  console.error('[Fix Packaged Edge Module] ❌ 소스 파일이 없습니다:', sourcePath);
  process.exit(1);
}

if (!fs.existsSync(targetPath)) {
  console.error('[Fix Packaged Edge Module] ❌ 대상 파일이 없습니다:', targetPath);
  process.exit(1);
}

try {
  // 파일 권한을 먼저 변경 (읽기/쓰기 가능하도록)
  try {
    fs.chmodSync(targetPath, 0o666); // 읽기/쓰기 가능
  } catch (chmodError) {
    // 권한 변경 실패해도 계속 진행
    console.warn('[Fix Packaged Edge Module] ⚠️ 파일 권한 변경 실패 (무시 가능):', chmodError.message);
  }
  
  // 소스 파일로 교체
  fs.copyFileSync(sourcePath, targetPath);
  console.log('[Fix Packaged Edge Module] ✅ 파일 교체 완료');
  
  const stats = fs.statSync(targetPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`[Fix Packaged Edge Module] 📦 파일 크기: ${sizeMB} MB`);
} catch (error) {
  console.error('[Fix Packaged Edge Module] ❌ 파일 교체 실패:', error.message);
  // 교체 실패해도 계속 진행 (이미 패키징은 완료되었으므로)
  console.warn('[Fix Packaged Edge Module] ⚠️ 교체 실패했지만 패키징은 완료되었습니다.');
}

