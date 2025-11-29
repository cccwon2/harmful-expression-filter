/**
 * OnVoice Bridge 테스트 스크립트
 * 
 * Spawn 방식으로 실행되는 C# COM bridge를 테스트합니다.
 * 
 * 실행 방법:
 *   npx tsx electron/test/test_onvoice_bridge.ts
 */

import { app, BrowserWindow } from 'electron';
import { onVoiceBridge } from '../main/onVoiceBridge';

// Electron 앱 초기화 (테스트용)
if (!app.isReady()) {
  app.whenReady().then(() => {
    console.log('[Test] Electron 앱 준비 완료');
    runTest();
  });
} else {
  runTest();
}

async function runTest() {
  console.log('[Test] ========================================');
  console.log('[Test] OnVoice Bridge 테스트 시작');
  console.log('[Test] ========================================\n');

  try {
    // 1. 초기화 테스트
    console.log('[Test] 1. Bridge 초기화...');
    let audioDataReceived = false;
    let audioEventReceived = false;

    await onVoiceBridge.init((pcm: Buffer) => {
      audioDataReceived = true;
      console.log(`[Test] ✅ 콜백으로 오디오 데이터 수신: ${pcm.length} bytes`);
    });

    // 이벤트 리스너 등록
    onVoiceBridge.events.on('audio', (pcm: Buffer) => {
      audioEventReceived = true;
      console.log(`[Test] ✅ 이벤트로 오디오 데이터 수신: ${pcm.length} bytes`);
    });

    console.log('[Test] ✅ Bridge 초기화 완료\n');

    // 2. 캡처 시작 테스트 (PID는 실제 프로세스 ID로 변경해야 함)
    console.log('[Test] 2. 캡처 시작...');
    console.log('[Test] ⚠️  실제 PID로 변경해야 합니다 (예: Chrome 프로세스 ID)');
    
    // 예시: PID를 환경변수나 커맨드라인 인자로 받을 수 있음
    const testPid = process.env.TEST_PID ? parseInt(process.env.TEST_PID, 10) : 0;
    
    if (testPid > 0) {
      await onVoiceBridge.startCapture(testPid);
      console.log(`[Test] ✅ 캡처 시작 (PID: ${testPid})`);
      
      // 5초 동안 대기 (오디오 데이터 수신 확인)
      console.log('[Test] 3. 오디오 데이터 수신 대기 (5초)...\n');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      if (audioDataReceived || audioEventReceived) {
        console.log('[Test] ✅ 오디오 데이터 수신 확인됨');
      } else {
        console.log('[Test] ⚠️  오디오 데이터가 수신되지 않았습니다');
        console.log('[Test]    - COM 객체가 올바르게 초기화되었는지 확인');
        console.log('[Test]    - COM 이벤트 구독이 구현되었는지 확인');
        console.log('[Test]    - PID가 올바른지 확인');
      }
      
      // 4. 캡처 중지 테스트
      console.log('\n[Test] 4. 캡처 중지...');
      await onVoiceBridge.stopCapture();
      console.log('[Test] ✅ 캡처 중지 완료');
    } else {
      console.log('[Test] ⚠️  PID가 설정되지 않아 캡처 테스트를 건너뜁니다');
      console.log('[Test]    환경변수로 PID 지정: TEST_PID=12345 npx tsx electron/test/test_onvoice_bridge.ts');
      console.log('\n[Test] 5초 후 종료...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    console.log('\n[Test] ========================================');
    console.log('[Test] 테스트 완료');
    console.log('[Test] ========================================');

  } catch (error) {
    console.error('[Test] ❌ 테스트 실패:', error);
    if (error instanceof Error) {
      console.error('[Test] 오류 메시지:', error.message);
      console.error('[Test] 스택 트레이스:', error.stack);
    }
  } finally {
    // 앱 종료
    if (app.isReady()) {
      app.quit();
    }
  }
}

// 처리되지 않은 오류 처리
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Test] 처리되지 않은 Promise 거부:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Test] 처리되지 않은 예외:', error);
});

