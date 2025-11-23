/**
 * LocalSttService - 로컬 Whisper 모델을 사용한 STT 서비스
 * 
 * Deepgram 서버 연결 실패 시 폴백으로 사용되는 로컬 STT 서비스입니다.
 * @huggingface/transformers를 사용하여 로컬에서 음성 인식을 수행합니다.
 */

import { pipeline, AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

type ServiceState = 'loading' | 'ready' | 'processing' | 'error';

export class LocalSttService {
  private static instance: LocalSttService | null = null;
  private transcriber: AutomaticSpeechRecognitionPipeline | null = null;
  private state: ServiceState = 'loading';
  private audioBuffer: Float32Array[] = [];
  
  // 오디오 설정
  private readonly CHUNK_SIZE_SEC = 3.0; // 3초 분량 버퍼링
  private readonly SAMPLE_RATE = 16000; // 16kHz 샘플레이트
  private readonly CHUNK_SIZE_SAMPLES = Math.floor(this.CHUNK_SIZE_SEC * this.SAMPLE_RATE);

  private constructor() {
    // Singleton 패턴: 외부에서 직접 생성 불가
  }

  public static getInstance(): LocalSttService {
    if (!LocalSttService.instance) {
      LocalSttService.instance = new LocalSttService();
    }
    return LocalSttService.instance;
  }

  /**
   * Whisper 모델 초기화 및 로딩
   * 
   * 첫 호출 시 모델을 다운로드하고 로딩합니다.
   * 이미 로딩 중이거나 준비된 상태면 아무 작업도 하지 않습니다.
   */
  public async init(): Promise<void> {
    if (this.state === 'ready') {
      console.log('[LocalSttService] 모델이 이미 로딩되어 있습니다.');
      return;
    }
    
    if (this.state === 'loading') {
      console.log('[LocalSttService] 모델 로딩 중... 대기합니다.');
      // 로딩 완료까지 대기 (간단한 폴링)
      while (this.state === 'loading') {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    this.state = 'loading';
    console.log('[LocalSttService] Whisper 모델 로딩 시작...');

    try {
      // Xenova/whisper-tiny 모델 로딩 (quantized 버전 사용)
      this.transcriber = await pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-tiny',
        { 
          quantized: true, // 양자화된 모델 사용 (메모리 절약)
        }
      );
      
      this.state = 'ready';
      console.log('[LocalSttService] ✅ 모델 로딩 완료');
    } catch (error) {
      this.state = 'error';
      console.error('[LocalSttService] ❌ 모델 로딩 실패:', error);
      throw error;
    }
  }

  /**
   * 오디오 데이터 처리 및 STT 수행
   * 
   * @param pcmInt16 PCM Int16 형식의 오디오 데이터 (Buffer)
   * @returns 인식된 텍스트 (3초 분량이 쌓이지 않았으면 null)
   */
  public async processAudio(pcmInt16: Buffer): Promise<string | null> {
    if (this.state !== 'ready' || !this.transcriber) {
      // 모델이 준비되지 않았으면 null 반환
      return null;
    }

    // Int16 → Float32 변환 및 버퍼에 추가
    const float32Array = this.convertInt16ToFloat32(pcmInt16);
    this.audioBuffer.push(float32Array);

    // 3초 분량이 쌓였는지 확인
    const totalSamples = this.audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
    if (totalSamples < this.CHUNK_SIZE_SAMPLES) {
      // 아직 충분한 데이터가 없음
      return null;
    }

    // 버퍼 합치기
    const combinedBuffer = new Float32Array(totalSamples);
    let offset = 0;
    for (const arr of this.audioBuffer) {
      combinedBuffer.set(arr, offset);
      offset += arr.length;
    }

    // 버퍼 초기화 (다음 청크를 위해)
    this.audioBuffer = [];

    // STT 처리
    this.state = 'processing';
    try {
      const result = await this.transcriber(combinedBuffer, {
        return_timestamps: false,
        language: 'ko', // 한국어 지정
      });
      
      this.state = 'ready';
      const text = result?.text?.trim() || '';
      
      if (text) {
        console.log(`[LocalSttService] STT 결과: "${text}"`);
      }
      
      return text || null;
    } catch (error) {
      this.state = 'ready';
      console.error('[LocalSttService] STT 처리 실패:', error);
      return null;
    }
  }

  /**
   * PCM Int16 데이터를 Float32 배열로 변환
   * 
   * @param buffer PCM Int16 형식의 Buffer
   * @returns Float32 배열 (-1.0 ~ 1.0 범위로 정규화)
   */
  private convertInt16ToFloat32(buffer: Buffer): Float32Array {
    const int16Array = new Int16Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.length / 2
    );
    const float32Array = new Float32Array(int16Array.length);
    
    // Int16 (-32768 ~ 32767) → Float32 (-1.0 ~ 1.0)
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }
    
    return float32Array;
  }

  /**
   * 현재 서비스 상태 반환
   */
  public getState(): ServiceState {
    return this.state;
  }

  /**
   * 버퍼 초기화 (필요시 수동으로 호출)
   */
  public clearBuffer(): void {
    this.audioBuffer = [];
  }
}

