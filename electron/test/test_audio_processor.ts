/**
 * Phase 2: 오디오 프로세서 테스트
 * 
 * 실행 방법:
 *   npx tsx electron/test/test_audio_processor.ts
 */

import { AudioProcessor } from '../audio/audioProcessor';

const processor = new AudioProcessor(48000, 16000);

// 더미 스테레오 데이터 생성 (1초, 48kHz, 16-bit)
const dummyStereo = Buffer.alloc(48000 * 2 * 2); // stereo = 2 channels
for (let i = 0; i < dummyStereo.length; i++) {
  dummyStereo[i] = Math.floor(Math.random() * 256);
}

console.log('🧪 Testing AudioProcessor...');
console.log(`📥 Input: ${dummyStereo.length} bytes (48kHz stereo, 1 second)`);
console.log(`📥 Expected output: ${16000 * 2} bytes (16kHz mono, 1 second)`);

const processed = processor.process(dummyStereo);

console.log(`📤 Output: ${processed.length} bytes`);

const expectedSize = 16000 * 2; // 16kHz mono, 16-bit = 2 bytes per sample
const tolerance = 100; // 허용 오차

if (Math.abs(processed.length - expectedSize) < tolerance) {
  console.log('✅ Audio processor test passed!');
  console.log(`   Size difference: ${Math.abs(processed.length - expectedSize)} bytes (within tolerance)`);
} else {
  console.error('❌ Size mismatch!');
  console.error(`   Expected: ${expectedSize} bytes`);
  console.error(`   Got: ${processed.length} bytes`);
  console.error(`   Difference: ${Math.abs(processed.length - expectedSize)} bytes`);
  process.exit(1);
}

