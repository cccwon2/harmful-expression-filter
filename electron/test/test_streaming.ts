/**
 * Phase 2: 오디오 캡처 → WebSocket 스트리밍 통합 테스트
 * 
 * 실행 방법:
 *   1. 터미널 1: FastAPI 서버 실행
 *      cd server
 *      uvicorn main:app --reload
 * 
 *   2. 터미널 2: 이 스크립트 실행
 *      npx tsx electron/test/test_streaming.ts
 * 
 *   3. 디스코드나 유튜브에서 음성 재생
 */

import naudiodon from 'naudiodon2';
import { AudioProcessor } from '../audio/audioProcessor';
import { AudioStreamClient } from '../audio/audioStreamClient';

async function testStreaming() {
  console.log('🎤 Starting audio streaming test...\n');
  
  const processor = new AudioProcessor(48000, 16000);
  const client = new AudioStreamClient('ws://localhost:8000/ws/audio');
  
  // 서버 응답 리스너
  client.on('response', (response) => {
    console.log('\n📨 Server response:');
    console.log(`   Text: ${response.text}`);
    console.log(`   Is harmful: ${response.is_harmful}`);
    console.log(`   Confidence: ${(response.confidence * 100).toFixed(1)}%`);
    console.log(`   Timestamp: ${new Date(response.timestamp).toISOString()}`);
    
    if (response.is_harmful) {
      console.log('\n⚠️  HARMFUL CONTENT DETECTED!');
    }
  });
  
  client.on('error', (err) => {
    console.error('\n❌ WebSocket error:', err);
  });
  
  client.on('close', () => {
    console.log('\n⚠️  WebSocket connection closed');
  });
  
  // WebSocket 연결
  try {
    await client.connect();
  } catch (err) {
    console.error('\n❌ Failed to connect to WebSocket server');
    console.error('💡 Make sure FastAPI server is running:');
    console.error('   cd server && uvicorn main:app --reload');
    process.exit(1);
  }
  
  // 오디오 캡처 시작
  const devices = naudiodon.getDevices();
  // Loopback 디바이스 찾기 (스테레오 믹스 우선)
  const loopbackDevice = devices.find(d => 
    (d.name.includes('스테레오 믹스') || d.name.includes('Stereo Mix')) ||
    (d.name.includes('스피커') && d.maxInputChannels >= 2) ||
    (d.name.includes('Speakers') && d.maxInputChannels >= 2) ||
    (d.name.includes('Output') && d.maxInputChannels >= 2)
  ) || devices.find(d => d.maxInputChannels >= 2 && !d.name.includes('Microphone') && !d.name.includes('마이크'));
  
  if (!loopbackDevice) {
    console.error('\n❌ No loopback device found!');
    process.exit(1);
  }
  
  console.log(`✅ Using audio device: ${loopbackDevice.name}\n`);
  
  const audioIn = new naudiodon.AudioIO({
    inOptions: {
      channelCount: 2,
      sampleFormat: 16,
      sampleRate: 48000,
      deviceId: loopbackDevice.id,
      closeOnError: true
    }
  });
  
  let chunkCount = 0;
  let totalBytesSent = 0;
  
  audioIn.on('data', (chunk: Buffer) => {
    // 스테레오 48kHz → 모노 16kHz 변환
    const processed = processor.process(chunk);
    // 서버로 전송
    client.sendAudioChunk(processed);
    
    chunkCount++;
    totalBytesSent += processed.length;
    
    if (chunkCount % 100 === 0) {
      console.log(`📊 Sent ${chunkCount} chunks, ${totalBytesSent} bytes`);
    }
  });
  
  audioIn.on('error', (err: Error) => {
    console.error('\n❌ Audio capture error:', err);
    audioIn.quit();
    client.disconnect();
    process.exit(1);
  });
  
  audioIn.start();
  console.log('✅ Streaming test started!');
  console.log('💡 Play some audio (YouTube, Discord, etc.) to test streaming.');
  console.log('⏱️  Will run for 30 seconds, then exit.\n');
  
  // 30초 후 종료
  setTimeout(() => {
    audioIn.quit();
    client.disconnect();
    console.log('\n✅ Streaming test completed!');
    console.log(`📊 Summary:`);
    console.log(`   - Total chunks sent: ${chunkCount}`);
    console.log(`   - Total bytes sent: ${totalBytesSent}`);
    process.exit(0);
  }, 30000);
}

// 에러 핸들링
process.on('uncaughtException', (err) => {
  console.error('\n❌ Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n❌ Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

testStreaming().catch(console.error);

