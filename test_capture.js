const winax = require('winax');

// 로깅 헬퍼
const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

// 프로세스 유지
process.stdin.resume();

try {
    log("🔄 1. COM 객체 생성...");
    const capture = new winax.Object('OnVoiceAudioBridge.OnVoiceCapture');
    
    // ⭐ [핵심 해결책] 
    // winax에게 "이 객체를 _IOnVoiceCaptureEvents 인터페이스로도 봐줘"라고 명령합니다.
    // 이제 'OnAudioData'라는 이름을 인식하게 됩니다.
    const eventSource = winax.cast(capture, '_IOnVoiceCaptureEvents');
    
    log("✅ COM 객체 생성 및 캐스팅 성공");

    // 전역 변수
    global.packetCount = 0;
    global.totalBytes = 0;

    // ---------------------------------------------------------
    // 🔗 2. 이벤트 핸들러 할당 (Casted Object 사용)
    // ---------------------------------------------------------
    log("🔗 2. 이벤트 리스너 연결...");

    // 이제 에러가 나지 않습니다. (이름이 존재하므로)
    eventSource.OnAudioData = function(data) {
        try {
            if (!data) return;

            // winax가 변환해준 데이터 길이 확인
            const length = data.length !== undefined ? data.length : 0;

            if (length > 0) {
                global.packetCount++;
                global.totalBytes += length;

                // 50번째 패킷마다 로그 출력
                if (global.packetCount % 50 === 0) {
                    process.stdout.write(`\r🔊 [Event] 수신 중... 패킷: ${global.packetCount}, 데이터: ${global.totalBytes}`);
                }
            }
        } catch (e) {
            // console.error(e);
        }
    };
    
    log("✅ 이벤트 리스너 할당 완료");

    // ---------------------------------------------------------
    // ▶️ 3. 실행
    // ---------------------------------------------------------
    log("🔍 Edge 프로세스 탐색...");
    const pid = capture.FindEdgeProcess();
    log(`🎯 Edge PID: ${pid}`);

    if (pid > 0) {
        log("▶️ StartCapture 호출...");
        
        // ⭐ [승부처] 호출 직후 C++ 로그창에 "GIT sink count=1" 확인 필수!
        capture.StartCapture(pid);
        
        log("⏳ 10초간 캡처 진행...");

        setTimeout(() => {
            log("\n⏹️ StopCapture 호출...");
            capture.StopCapture();
            
            log(`\n🎉 최종 결과:`);
            log(`- 총 패킷: ${global.packetCount}`);
            log(`- 총 데이터: ${global.totalBytes} bytes`);
            
            if (global.packetCount > 0) {
                log("🚀 SUCCESS: Electron(Node.js) 연동 성공!");
            } else {
                log("❌ FAILURE: 데이터 수신 0. (C++ 로그 'GIT sink count' 확인 필요)");
            }
            
            try { winax.release(capture); } catch(e) {}
            process.exit(0);
        }, 10000);
    } else {
        log("⚠️ Edge 브라우저를 찾지 못했습니다.");
        try { winax.release(capture); } catch(e) {}
        process.exit(0);
    }

} catch (e) {
    log(`❌ 에러 발생: ${e.message}`);
    console.error(e);
    process.exit(1);
}