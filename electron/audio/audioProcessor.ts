/**
 * Phase 2: 오디오 처리 모듈
 * 
 * 스테레오 48kHz → 모노 16kHz 변환을 담당합니다.
 */

export class AudioProcessor {
  private inputSampleRate: number;
  private outputSampleRate: number;
  
  constructor(inputSampleRate = 48000, outputSampleRate = 16000) {
    this.inputSampleRate = inputSampleRate;
    this.outputSampleRate = outputSampleRate;
  }
  
  /**
   * 스테레오 → 모노 변환
   * 16-bit PCM 스테레오 버퍼를 모노로 변환합니다.
   */
  stereoToMono(stereoBuffer: Buffer): Buffer {
    const samples = stereoBuffer.length / 4; // 16-bit = 2 bytes, stereo = 2 channels
    const monoBuffer = Buffer.alloc(samples * 2);
    
    for (let i = 0; i < samples; i++) {
      const left = stereoBuffer.readInt16LE(i * 4);
      const right = stereoBuffer.readInt16LE(i * 4 + 2);
      const mono = Math.floor((left + right) / 2);
      monoBuffer.writeInt16LE(mono, i * 2);
    }
    
    return monoBuffer;
  }
  
  /**
   * 간단한 리샘플링 (Linear Interpolation)
   * 실제 프로덕션에서는 libsamplerate 사용 권장
   */
  resample(inputBuffer: Buffer): Buffer {
    const inputSamples = inputBuffer.length / 2; // 16-bit = 2 bytes
    const outputSamples = Math.floor(inputSamples * this.outputSampleRate / this.inputSampleRate);
    const outputBuffer = Buffer.alloc(outputSamples * 2);
    
    for (let i = 0; i < outputSamples; i++) {
      const srcIndex = (i * this.inputSampleRate) / this.outputSampleRate;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples - 1);
      const fraction = srcIndex - srcIndexFloor;
      
      const sample1 = inputBuffer.readInt16LE(srcIndexFloor * 2);
      const sample2 = inputBuffer.readInt16LE(srcIndexCeil * 2);
      const interpolated = Math.floor(sample1 * (1 - fraction) + sample2 * fraction);
      
      outputBuffer.writeInt16LE(interpolated, i * 2);
    }
    
    return outputBuffer;
  }
  
  /**
   * 전체 파이프라인: 스테레오 48kHz → 모노 16kHz
   */
  process(stereoBuffer: Buffer): Buffer {
    if (!stereoBuffer || stereoBuffer.length === 0) {
      console.warn('[AudioProcessor] ⚠️ Empty input buffer');
      return Buffer.alloc(0);
    }
    
    if (stereoBuffer.length % 4 !== 0) {
      console.warn(`[AudioProcessor] ⚠️ Invalid buffer size: ${stereoBuffer.length} (expected multiple of 4 for stereo 16-bit)`);
    }
    
    const monoBuffer = this.stereoToMono(stereoBuffer);
    if (monoBuffer.length === 0) {
      console.warn('[AudioProcessor] ⚠️ Empty mono buffer after conversion');
      return Buffer.alloc(0);
    }
    
    const resampledBuffer = this.resample(monoBuffer);
    if (resampledBuffer.length === 0) {
      console.warn('[AudioProcessor] ⚠️ Empty resampled buffer');
      return Buffer.alloc(0);
    }
    
    return resampledBuffer;
  }
}

