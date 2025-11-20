/**
 * Deepgram WebSocket + OnVoice COM Bridge 통합 테스트 스크립트
 * 
 * OnVoice COM 브리지를 통해 Edge/Chrome 오디오를 캡처하고,
 * Deepgram WebSocket으로 실시간 STT를 수행합니다.
 * 
 * 사용법:
 *   DEEPGRAM_API_KEY=your_api_key node examples/deepgram_onvoice_client.js
 * 
 * 의존성:
 *   - winax: COM 객체 접근
 *   - ws: WebSocket 클라이언트
 */

const winax = require('winax');
const WebSocket = require('ws');

// 환경변수에서 API 키 읽기
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
if (!DEEPGRAM_API_KEY) {
  console.error('❌ DEEPGRAM_API_KEY 환경변수가 설정되지 않았습니다.');
  console.error('   사용법: DEEPGRAM_API_KEY=your_api_key node examples/deepgram_onvoice_client.js');
  process.exit(1);
}

// 로그 헬퍼
const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

// 통계
let packetCount = 0;
let totalBytes = 0;
let transcriptCount = 0;

// Deepgram WebSocket 연결
const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen';
const ws = new WebSocket(DEEPGRAM_URL, {
  headers: {
    Authorization: `Token ${DEEPGRAM_API_KEY}`,
  },
});

// Deepgram 연결 파라미터 설정
ws.on('open', () => {
  log('✅ Deepgram WebSocket 연결 성공');
  
  // Deepgram 설정 메시지 전송
  const config = {
    type: 'Settings',
    channels: 1,
    sample_rate: 16000,
    encoding: 'linear16',
    language: 'ko', // 한국어
    model: 'nova-2', // 최신 모델
    punctuate: true,
    interim_results: true, // 중간 결과도 수신
  };
  
  ws.send(JSON.stringify(config));
  log('📤 Deepgram 설정 전송 완료');
});

// Deepgram 메시지 수신
ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    
    if (message.type === 'Results') {
      const transcript = message.channel?.alternatives?.[0]?.transcript;
      const isFinal = message.is_final;
      
      if (transcript && transcript.trim()) {
        transcriptCount++;
        const prefix = isFinal ? '[STT]' : '[STT-interim]';
        log(`${prefix} ${transcript}`);
      }
    } else if (message.type === 'Metadata') {
      log(`[Deepgram] Metadata: ${JSON.stringify(message)}`);
    } else {
      log(`[Deepgram] 기타 메시지: ${message.type}`);
    }
  } catch (err) {
    console.error('[Deepgram] 메시지 파싱 오류:', err);
  }
});

ws.on('error', (err) => {
  console.error('[Deepgram] WebSocket 오류:', err);
});

ws.on('close', () => {
  log('🔌 Deepgram WebSocket 연결 종료');
});

// OnVoice 브리지 모듈 로드 (동적 import 대신 직접 구현)
// 실제로는 electron/audio/onvoiceCaptureBridge.ts를 사용하지만,
// 여기서는 독립 실행 가능한 스크립트로 작성

// COM 메시지 펌프
const pump = setInterval(() => {
  try {
    winax.peekAndDispatchMessages();
  } catch (e) {
    console.error('[OnVoice] peekAndDispatchMessages 오류:', e);
  }
}, 50);

// COM 객체 생성
let capture = null;
let connectionPoint = null;
let cookie = null;

try {
  log('🔄 COM 객체 생성 중...');
  capture = new winax.Object('OnVoiceAudioBridge.OnVoiceCapture');
  log('✅ COM 객체 생성 성공');

  // Connection Points 검사
  const cps = winax.getConnectionPoints(capture);
  if (!cps || cps.length === 0) {
    log('❌ Connection Points를 찾을 수 없습니다.');
    clearInterval(pump);
    process.exit(1);
  }

  connectionPoint = cps[0];
  log(`📊 Connection Point 발견: ${cps.length}개`);

  // 이벤트 리스너
  const eventSink = {
    OnAudioData: (data) => {
      try {
        if (!data) return;

        // Buffer로 정규화
        let buf;
        if (Buffer.isBuffer(data)) {
          buf = data;
        } else if (Array.isArray(data)) {
          buf = Buffer.from(data);
        } else if (data.buffer) {
          buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        } else {
          buf = Buffer.from(data);
        }

        if (buf.length > 0) {
          packetCount++;
          totalBytes += buf.length;

          // Deepgram으로 전송 (WebSocket이 열려있을 때만)
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(buf);
          }

          // 50개 패킷마다 통계 출력
          if (packetCount % 50 === 0) {
            process.stdout.write(
              `\r🔊 패킷: ${packetCount}, 데이터: ${totalBytes} bytes, STT 결과: ${transcriptCount}개`
            );
          }
        }
      } catch (e) {
        console.error('[OnVoice] OnAudioData 오류:', e);
      }
    },
  };

  // 이벤트 구독
  log('🔗 이벤트 리스너 연결 중...');
  cookie = connectionPoint.advise(eventSink);
  log(`✅ 이벤트 연결 성공 (Cookie: ${cookie})`);

  // Edge 프로세스 찾기
  log('🔍 Edge 프로세스 PID 조회...');
  const pid = capture.FindEdgeProcess();
  log(`🎯 Edge PID: ${pid}`);

  if (pid > 0) {
    log('▶️ StartCapture 호출...');
    capture.StartCapture(pid);

    log('⏳ 30초간 캡처 및 STT 수행 중...');
    log('   (Ctrl+C로 조기 종료 가능)');

    // 30초 후 자동 종료
    setTimeout(() => {
      log('\n⏹️ StopCapture 호출...');
      capture.StopCapture();

      log(`🎉 결과:`);
      log(`   - 총 패킷: ${packetCount}개`);
      log(`   - 총 데이터: ${totalBytes} bytes (${(totalBytes / 1024).toFixed(2)} KB)`);
      log(`   - STT 결과: ${transcriptCount}개`);

      // 정리
      if (cookie !== null && connectionPoint && typeof connectionPoint.unadvise === 'function') {
        try {
          connectionPoint.unadvise(cookie);
        } catch (e) {
          console.warn('[OnVoice] unadvise 오류 (무시 가능):', e.message);
        }
      }

      winax.release(capture);
      clearInterval(pump);
      ws.close();
      
      log('👋 종료');
      process.exit(0);
    }, 30000);
  } else {
    log('⚠️ Edge를 찾지 못했습니다.');
    winax.release(capture);
    clearInterval(pump);
    ws.close();
    process.exit(0);
  }
} catch (e) {
  log(`❌ 에러 발생: ${e.message}`);
  console.error(e);
  clearInterval(pump);
  if (ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  process.exit(1);
}

// Ctrl+C 처리
process.on('SIGINT', () => {
  log('\n\n⚠️ 사용자에 의해 중단됨');
  
  if (capture) {
    try {
      capture.StopCapture();
    } catch (e) {
      // 무시
    }
    
    if (cookie !== null && connectionPoint && typeof connectionPoint.unadvise === 'function') {
      try {
        connectionPoint.unadvise(cookie);
      } catch (e) {
        // 무시
      }
    }
    
    try {
      winax.release(capture);
    } catch (e) {
      // 무시
    }
  }
  
  clearInterval(pump);
  if (ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  
  log('👋 종료');
  process.exit(0);
});

