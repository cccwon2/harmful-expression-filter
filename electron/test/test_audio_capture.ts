/**
 * Phase 1: Windows 오디오 캡처 테스트
 * 
 * 이 스크립트는 naudiodon2를 사용하여 Windows 시스템 오디오를 캡처하는지 테스트합니다.
 * 
 * 실행 방법:
 *   npx tsx electron/test/test_audio_capture.ts
 */

import naudiodon from 'naudiodon2';

function testAudioCapture() {
  console.log('🎤 Testing Windows audio capture...');
  
  // WASAPI Loopback 디바이스 검색
  const devices = naudiodon.getDevices();
  console.log(`\n📋 Found ${devices.length} audio devices:`);
  devices.forEach((device, index) => {
    console.log(`  ${index + 1}. [${device.id}] ${device.name} (${device.maxInputChannels} input channels)`);
  });
  
  // Loopback 디바이스 찾기
  // Windows에서는 출력 디바이스가 Loopback으로 사용 가능
  // 스테레오 믹스나 실제 출력 디바이스를 찾아야 함
  const loopbackDevice = devices.find(d => 
    (d.name.includes('스테레오 믹스') || d.name.includes('Stereo Mix')) ||
    (d.name.includes('스피커') && d.maxInputChannels >= 2) ||
    (d.name.includes('Speakers') && d.maxInputChannels >= 2) ||
    (d.name.includes('Output') && d.maxInputChannels >= 2)
  ) || devices.find(d => d.maxInputChannels >= 2 && !d.name.includes('Microphone') && !d.name.includes('마이크'));
  
  if (!loopbackDevice) {
    console.error('\n❌ No loopback device found!');
    console.log('\n💡 Available devices:');
    devices.forEach((device, index) => {
      console.log(`  ${index + 1}. ${device.name} (ID: ${device.id})`);
    });
    console.log('\n⚠️  Please check your audio device settings or modify the filter condition.');
    process.exit(1);
  }
  
  console.log(`\n✅ Using device: ${loopbackDevice.name} (ID: ${loopbackDevice.id})`);
  
  // 오디오 캡처 스트림 생성
  const audioIn = new naudiodon.AudioIO({
    inOptions: {
      channelCount: 2,        // 스테레오 → 모노로 변환 필요
      sampleFormat: 16,       // 16-bit PCM
      sampleRate: 48000,      // Windows 기본 (나중에 16kHz로 리샘플링)
      deviceId: loopbackDevice.id,
      closeOnError: true
    }
  });
  
  let chunkCount = 0;
  let totalBytes = 0;
  
  audioIn.on('data', (chunk: Buffer) => {
    chunkCount++;
    totalBytes += chunk.length;
    if (chunkCount % 100 === 0) {
      console.log(`📊 Received ${chunkCount} chunks, total: ${totalBytes} bytes`);
    }
  });
  
  audioIn.on('error', (err: Error) => {
    console.error('\n❌ Audio capture error:', err);
    audioIn.quit();
    process.exit(1);
  });
  
  console.log('\n🎵 Starting audio capture...');
  console.log('💡 Play some audio (YouTube, Discord, etc.) to test capture.');
  console.log('⏱️  Will run for 10 seconds, then exit.\n');
  
  audioIn.start();
  
  // 10초 후 종료
  setTimeout(() => {
    audioIn.quit();
    console.log('\n✅ Audio capture test completed!');
    console.log(`📊 Summary:`);
    console.log(`   - Total chunks: ${chunkCount}`);
    console.log(`   - Total bytes: ${totalBytes}`);
    console.log(`   - Average chunk size: ${Math.round(totalBytes / chunkCount)} bytes`);
    console.log(`   - Estimated sample rate: ${Math.round(totalBytes / 2 / 2 / 10)} Hz (stereo, 16-bit)`);
    process.exit(0);
  }, 10000);
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

testAudioCapture();

