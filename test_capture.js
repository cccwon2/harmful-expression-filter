const winax = require('winax');

// ActiveXObject 별칭 (편의용)
const ActiveXObject = winax.Object;

// 로그 헬퍼
const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

// Node.js 프로세스가 조기 종료되지 않도록
process.stdin.resume();

// 전역 카운터
global.packetCount = 0;
global.totalBytes = 0;

// 🕐 COM 이벤트를 처리해 주는 메시지 펌프
const pump = setInterval(() => {
  try {
    winax.peekAndDispatchMessages(); // 이벤트 디스패치
  } catch (e) {
    console.error('peekAndDispatchMessages error:', e);
  }
}, 50);

try {
  log('🔄 1. COM 객체 생성 중...');
  const capture = new ActiveXObject('OnVoiceAudioBridge.OnVoiceCapture');
  log('✅ COM 객체 생성 성공');

  // ---------------------------------------------------------
  // 🔍 Connection Points 검사
  // ---------------------------------------------------------
  log('🔍 Connection Points 검사 중...');
  const cps = winax.getConnectionPoints(capture);

  if (!cps || cps.length === 0) {
    log('❌ 치명적: 인식된 연결점(Connection Points)이 없습니다.');
    log('   -> IDL [source] / TypeLib / regsvr32 등록 상태 확인 필요');
    clearInterval(pump);
    process.exit(1);
  }

  log(`📊 발견된 연결점 개수: ${cps.length}`);

  const cp = cps[0];
  log(`   [0] keys: ${Object.keys(cp).join(', ')}`);

  // ---------------------------------------------------------
  // 🔗 연결: 첫 번째 연결점에 advise 사용
  // ---------------------------------------------------------
  const eventSink = {
    OnAudioData: function (data) {
      try {
        if (!data) return;

        const length = data.length !== undefined ? data.length : 0;
        if (length <= 0) return;

        global.packetCount += 1;
        global.totalBytes += length;

        if (global.packetCount % 50 === 0) {
          process.stdout.write(
            `\r🔊 수신 중... 패킷: ${global.packetCount}, 데이터: ${global.totalBytes}`
          );
        }
      } catch (e) {
        console.error('Event Error:', e);
      }
    },
  };

  log('🔗 이벤트 리스너 연결(advise) 시도...');

  // ✅ 여기서 소문자 advise 를 써야 함
  const cookie = cp.advise(eventSink);
  log(`✅ 이벤트 연결 성공! (Cookie: ${cookie})`);

  // ---------------------------------------------------------
  // ▶️ 실행: Edge 프로세스 캡처
  // ---------------------------------------------------------
  log('🔍 Edge 프로세스 PID 조회...');
  const pid = capture.FindEdgeProcess();
  log(`🎯 Edge PID: ${pid}`);

  if (pid > 0) {
    log('▶️ StartCapture 호출...');
    capture.StartCapture(pid);

    log('⏳ 10초간 대기...');

    setTimeout(() => {
      log('\n⏹️ StopCapture 호출...');
      capture.StopCapture();

      log(
        `🎉 결과: 총 ${global.packetCount} 패킷 수신, 총 바이트: ${global.totalBytes}`
      );

      try {
        // unadvise 지원되면 정리
        if (typeof cp.unadvise === 'function') {
          cp.unadvise(cookie);
        }
      } catch (e) {
        console.warn('unadvise 중 에러(무시 가능):', e.message);
      }

      winax.release(capture);
      clearInterval(pump);
      log('👋 종료');
      process.exit(0);
    }, 10000);
  } else {
    log('⚠️ Edge를 찾지 못했습니다.');
    winax.release(capture);
    clearInterval(pump);
    process.exit(0);
  }
} catch (e) {
  log(`❌ 에러 발생: ${e.message}`);
  console.error(e);
  clearInterval(pump);
  process.exit(1);
}
