/**
 * electron-builder가 패키징 후 electron-edge-js를 잘못 재빌드한 경우
 * 올바른 파일로 복원하는 스크립트
 */

const fs = require('fs');
const path = require('path');

// 백업 파일 경로 (빌드 전에 올바른 파일을 백업)
const backupPath = path.join(__dirname, '..', 'node_modules', 'electron-edge-js', 'lib', 'native', 'win32', 'x64', '28.0.0', 'edge_coreclr.node.backup');
const targetPath = path.join(__dirname, '..', 'node_modules', 'electron-edge-js', 'lib', 'native', 'win32', 'x64', '28.0.0', 'edge_coreclr.node');

console.log('[Restore Edge Module] 🔄 electron-edge-js 모듈 복원 중...');

// 백업 파일이 존재하는지 확인
if (fs.existsSync(backupPath)) {
  try {
    // 파일 권한을 먼저 변경 (읽기/쓰기 가능하도록)
    try {
      fs.chmodSync(targetPath, 0o666); // 읽기/쓰기 가능
    } catch (chmodError) {
      // 권한 변경 실패해도 계속 진행 (Windows에서는 무시 가능)
      console.warn('[Restore Edge Module] ⚠️ 파일 권한 변경 실패 (무시 가능):', chmodError.message);
    }
    
    // 백업 파일로 복원
    fs.copyFileSync(backupPath, targetPath);
    console.log('[Restore Edge Module] ✅ 파일 복원 완료');
    
    // 백업 파일 삭제
    fs.unlinkSync(backupPath);
    console.log('[Restore Edge Module] ✅ 백업 파일 삭제 완료');
  } catch (error) {
    console.error('[Restore Edge Module] ❌ 파일 복원 실패:', error.message);
    // 복원 실패해도 계속 진행 (이미 패키징은 완료되었으므로)
    console.warn('[Restore Edge Module] ⚠️ 복원 실패했지만 패키징은 완료되었습니다.');
  }
} else {
  console.log('[Restore Edge Module] ℹ️ 백업 파일이 없습니다. 복원이 필요하지 않습니다.');
}

