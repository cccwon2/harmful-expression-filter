/**
 * electron-builder가 패키징할 때 electron-edge-js를 재빌드하지 않도록
 * 올바른 파일을 보호하는 스크립트
 */

const fs = require('fs');
const path = require('path');

const edgeModulePath = path.join(__dirname, '..', 'node_modules', 'electron-edge-js');
const nativeModulePath = path.join(edgeModulePath, 'lib', 'native', 'win32', 'x64', '28.0.0', 'edge_coreclr.node');

console.log('[Protect Edge Module] 🔒 electron-edge-js 모듈 보호 중...');

// 파일이 존재하는지 확인
if (fs.existsSync(nativeModulePath)) {
  const stats = fs.statSync(nativeModulePath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`[Protect Edge Module] ✅ 파일 확인: ${nativeModulePath}`);
  console.log(`[Protect Edge Module] 📦 파일 크기: ${sizeMB} MB`);
  
  // 백업 파일 생성
  const backupPath = nativeModulePath + '.backup';
  try {
    // 파일 권한을 먼저 확인하고 필요시 변경
    try {
      const currentMode = fs.statSync(nativeModulePath).mode;
      if ((currentMode & 0o200) === 0) {
        // 읽기 전용이면 쓰기 가능하도록 변경
        fs.chmodSync(nativeModulePath, 0o666);
        console.log('[Protect Edge Module] 🔓 파일 권한 변경 (읽기/쓰기 가능)');
      }
    } catch (chmodError) {
      // 권한 변경 실패해도 계속 진행
      console.warn('[Protect Edge Module] ⚠️ 파일 권한 확인 실패 (무시 가능):', chmodError.message);
    }
    
    // 백업 파일이 이미 있으면 삭제
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }
    
    fs.copyFileSync(nativeModulePath, backupPath);
    console.log('[Protect Edge Module] ✅ 백업 파일 생성:', backupPath);
    
    // 파일을 읽기 전용으로 설정 (Windows)
    try {
      fs.chmodSync(nativeModulePath, 0o444); // 읽기 전용
      console.log('[Protect Edge Module] ✅ 파일을 읽기 전용으로 설정했습니다.');
    } catch (error) {
      console.warn('[Protect Edge Module] ⚠️ 파일 권한 설정 실패 (무시 가능):', error.message);
    }
  } catch (error) {
    console.error('[Protect Edge Module] ❌ 백업 파일 생성 실패:', error.message);
    process.exit(1);
  }
} else {
  console.warn('[Protect Edge Module] ⚠️ 파일이 존재하지 않습니다:', nativeModulePath);
  console.warn('[Protect Edge Module] ⚠️ electron-edge-js를 CoreCLR 모드로 재빌드해야 합니다.');
  process.exit(1);
}

console.log('[Protect Edge Module] ✅ 보호 완료');

