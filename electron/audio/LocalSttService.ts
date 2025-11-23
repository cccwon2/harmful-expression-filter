/**
 * LocalSttService - 로컬 Whisper 모델을 사용한 STT 서비스
 * 
 * Deepgram 서버 연결 실패 시 폴백으로 사용되는 로컬 STT 서비스입니다.
 * @huggingface/transformers를 사용하여 로컬에서 음성 인식을 수행합니다.
 */

import { pipeline, AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import * as fs from 'fs';
import * as path from 'path';

type ServiceState = 'idle' | 'loading' | 'ready' | 'processing' | 'error';

export class LocalSttService {
  private static instance: LocalSttService | null = null;
  private transcriber: AutomaticSpeechRecognitionPipeline | null = null;
  private state: ServiceState = 'idle'; // 초기 상태: 'idle' (아직 로딩 시작 안 함)
  private audioBuffer: Float32Array[] = [];
  private _hasLoggedLoading: boolean = false;
  private _lastErrorLogTime: number = 0;
  private _lastIdleLogTime: number = 0;
  private loadingPromise: Promise<void> | null = null; // 동시 호출 방지용
  private lastProcessedText: string = ''; // 중복 제거용
  private lastProcessedTime: number = 0; // 마지막 처리 시간
  private processingPromise: Promise<string | null> | null = null; // 현재 처리 중인 Promise
  
  // 오디오 설정
  private readonly CHUNK_SIZE_SEC = 3.0; // 3초 분량 버퍼링 (정확도 향상을 위해 3초 유지)
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
   * 이미 로딩 중이거나 준비된 상태면 대기하거나 즉시 반환합니다.
   */
  public async init(): Promise<void> {
    console.log(`[LocalSttService] init() 호출됨. 현재 상태: ${this.state}, loadingPromise 존재: ${!!this.loadingPromise}`);
    
    // 이미 준비된 상태면 즉시 반환
    if (this.state === 'ready') {
      console.log('[LocalSttService] 모델이 이미 로딩되어 있습니다.');
      return;
    }
    
    // 이미 로딩 중이고 Promise가 있으면 대기
    if (this.state === 'loading' && this.loadingPromise) {
      console.log('[LocalSttService] 모델 로딩 중... 대기합니다.');
      console.log('[LocalSttService] Promise 상태 확인 중...');
      try {
        await this.loadingPromise;
        console.log('[LocalSttService] 대기 완료. 현재 상태:', this.state);
        return;
      } catch (error) {
        // Promise가 실패했으면 다시 시도
        console.log('[LocalSttService] 이전 로딩 실패. 다시 시도합니다...', error);
        this.state = 'idle';
        this.loadingPromise = null;
      }
    }

    // 상태가 'loading'인데 Promise가 없는 경우 (이상 상태) 리셋
    if (this.state === 'loading' && !this.loadingPromise) {
      console.warn('[LocalSttService] ⚠️ 이상 상태 감지 (loading이지만 Promise 없음). 리셋합니다.');
      this.state = 'idle';
    }

    // 에러 상태면 다시 시도 (ONNX 에러인 경우 캐시 삭제 후 재시도)
    if (this.state === 'error') {
      console.log('[LocalSttService] 이전 로딩 실패. 다시 시도합니다...');
      // 에러 상태에서 재시도할 때는 캐시를 삭제하고 재시도
      try {
        await this.clearModelCache();
        console.log('[LocalSttService] 캐시 삭제 완료. 모델을 다시 로딩합니다...');
      } catch (cacheError) {
        console.warn('[LocalSttService] 캐시 삭제 실패 (계속 진행):', cacheError);
      }
      this.state = 'idle';
    }

    // 로딩 시작
    this.state = 'loading';
    console.log('[LocalSttService] Whisper 모델 로딩 시작...');
    console.log('[LocalSttService] 모델: Xenova/whisper-tiny (~75MB, 첫 다운로드 시 시간이 걸릴 수 있습니다)');

    // 동시 호출 방지: 로딩 Promise 저장
    this.loadingPromise = (async () => {
      const startTime = Date.now(); // try 블록 밖에서 선언하여 catch 블록에서도 접근 가능
      
      try {
        // Xenova/whisper-tiny 모델 로딩 (Xenova 모델은 기본적으로 양자화됨)
        console.log('[LocalSttService] 모델 다운로드 및 초기화 중...');
        console.log('[LocalSttService] pipeline() 호출 시작...');
        console.log('[LocalSttService] Node.js 버전:', process.version);
        console.log('[LocalSttService] 플랫폼:', process.platform);
        
        // pipeline 호출을 별도로 감싸서 더 자세한 로그
        console.log('[LocalSttService] pipeline() 함수 호출 직전...');
        const pipelinePromise = pipeline(
          'automatic-speech-recognition',
          'Xenova/whisper-tiny'
        );
        console.log('[LocalSttService] pipeline() Promise 생성됨. 대기 중...');
        
        this.transcriber = await pipelinePromise;
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        this.state = 'ready';
        this._hasLoggedLoading = false; // 리셋
        this.loadingPromise = null; // 완료 후 초기화
        console.log(`[LocalSttService] ✅ 모델 로딩 완료 (소요 시간: ${elapsed}초)`);
      } catch (error) {
        // 디버깅: 에러 타입 및 메시지 확인
        console.log('[LocalSttService] 에러 발생 - 타입:', typeof error, 'instanceof Error:', error instanceof Error);
        if (error instanceof Error) {
          console.log('[LocalSttService] 에러 메시지:', error.message);
          console.log('[LocalSttService] "Protobuf parsing failed" 포함 여부:', error.message.includes('Protobuf parsing failed'));
        }
        
        // ONNX 파일 파싱 에러인 경우 캐시 삭제 후 재시도
        // 에러 메시지에 "Protobuf parsing failed" 또는 "onnx" 관련 에러가 포함되어 있는지 확인
        const isOnnxError = error instanceof Error && (
          error.message.includes('Protobuf parsing failed') ||
          error.message.includes('onnx') && error.message.includes('failed') ||
          error.message.includes('decoder_model_merged')
        );
        
        if (isOnnxError) {
          console.warn('[LocalSttService] ⚠️ ONNX 모델 파일이 손상되었습니다. 캐시를 삭제하고 재다운로드합니다...');
          try {
            const errorMsg = error instanceof Error ? error.message : String(error);
            await this.clearModelCache(errorMsg);
            console.log('[LocalSttService] 캐시 삭제 완료. 모델을 다시 다운로드합니다...');
            
            // 재시도 (새로운 시작 시간)
            const retryStartTime = Date.now();
            this.transcriber = await pipeline(
              'automatic-speech-recognition',
              'Xenova/whisper-tiny'
            );
            
            const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const retryElapsed = ((Date.now() - retryStartTime) / 1000).toFixed(1);
            this.state = 'ready';
            this._hasLoggedLoading = false;
            this.loadingPromise = null;
            console.log(`[LocalSttService] ✅ 모델 로딩 완료 (재시도 성공, 전체 소요: ${totalElapsed}초, 재시도 소요: ${retryElapsed}초)`);
            return; // 성공했으므로 에러를 throw하지 않음
          } catch (retryError) {
            console.error('[LocalSttService] ❌ 캐시 삭제 후 재시도 실패:', retryError);
            if (retryError instanceof Error) {
              console.error('[LocalSttService] 재시도 에러 메시지:', retryError.message);
            }
            // 재시도도 실패했으면 원래 에러를 throw
          }
        }
        
        this.state = 'error';
        this.loadingPromise = null; // 실패 후 초기화
        console.error('[LocalSttService] ❌ 모델 로딩 실패:', error);
        if (error instanceof Error) {
          console.error('[LocalSttService] 에러 이름:', error.name);
          console.error('[LocalSttService] 에러 메시지:', error.message);
          console.error('[LocalSttService] 에러 스택:', error.stack);
        } else {
          console.error('[LocalSttService] 알 수 없는 에러 타입:', typeof error, error);
        }
        throw error;
      }
    })();
    
    // 타임아웃 추가 (5분)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('모델 로딩 타임아웃 (5분 초과). 네트워크 연결이나 모델 다운로드에 문제가 있을 수 있습니다.'));
      }, 5 * 60 * 1000);
    });
    
    console.log('[LocalSttService] Promise 생성 완료. 대기 시작...');

    try {
      await Promise.race([this.loadingPromise, timeoutPromise]);
    } catch (error) {
      // 타임아웃 또는 로딩 실패
      this.state = 'error';
      this.loadingPromise = null;
      console.error('[LocalSttService] 모델 로딩 중단:', error);
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
      if (this.state === 'loading') {
        // 첫 번째 호출 시에만 로그 출력 (너무 많은 로그 방지)
        if (!this._hasLoggedLoading) {
          console.log('[LocalSttService] 모델 로딩 중... 오디오 데이터는 버퍼링됩니다.');
          console.log('[LocalSttService] loadingPromise 상태:', !!this.loadingPromise);
          this._hasLoggedLoading = true;
        }
      } else if (this.state === 'error') {
        // 에러 상태는 주기적으로 로그 (5초마다)
        const now = Date.now();
        if (!this._lastErrorLogTime || now - this._lastErrorLogTime > 5000) {
          console.warn('[LocalSttService] ⚠️ 모델이 로딩되지 않았습니다. STT 기능을 사용할 수 없습니다.');
          console.warn('[LocalSttService] 현재 상태:', this.state);
          this._lastErrorLogTime = now;
        }
      } else if (this.state === 'idle') {
        // idle 상태면 init()이 호출되지 않았거나 실패한 것
        const now = Date.now();
        if (!this._lastIdleLogTime || now - this._lastIdleLogTime > 5000) {
          console.warn('[LocalSttService] ⚠️ 모델이 초기화되지 않았습니다. init()을 호출해주세요.');
          console.warn('[LocalSttService] 현재 상태:', this.state);
          this._lastIdleLogTime = now;
        }
      }
      return null;
    }

    // Int16 → Float32 변환 및 버퍼에 추가 (최적화: 직접 변환)
    const float32Array = this.convertInt16ToFloat32Fast(pcmInt16);
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

    // 오디오 품질 검증 (너무 조용하면 스킵)
    const audioMean = Math.abs(combinedBuffer.reduce((sum, val) => sum + Math.abs(val), 0) / combinedBuffer.length);
    if (audioMean < 0.001) {
      // 오디오가 너무 조용하면 스킵 (노이즈만 있을 수 있음)
      this.audioBuffer = [];
      return null;
    }

    // 오디오 정규화 (클리핑 방지)
    const maxAbs = Math.max(...Array.from(combinedBuffer).map(Math.abs));
    if (maxAbs > 0.95) {
      // 클리핑 위험이 있으면 정규화
      const scale = 0.95 / maxAbs;
      for (let i = 0; i < combinedBuffer.length; i++) {
        combinedBuffer[i] *= scale;
      }
    }

    // 버퍼 초기화 (다음 청크를 위해)
    this.audioBuffer = [];

    // 이미 처리 중이면 이번 청크는 스킵 (렉 방지)
    if (this.state === 'processing' || this.processingPromise) {
      return null;
    }

    // STT 처리 (비동기로 처리하여 블로킹 최소화)
    this.state = 'processing';
    this.processingPromise = (async () => {
      try {
        // STT 처리를 다음 틱으로 지연시켜 메인 스레드 블로킹 최소화
        await new Promise(resolve => setImmediate(resolve));
        
        // 한글 인식 정확도 향상을 위한 옵션 설정
        const result = await this.transcriber(combinedBuffer, {
          return_timestamps: false,
          language: 'ko', // 한국어 지정
          // chunk_length_s: 30, // 청크 길이 (기본값 사용)
          // stride_length_s: 5, // 스트라이드 길이 (기본값 사용)
          // task: 'transcribe', // transcribe 또는 translate
        });
        
        // result가 배열일 수 있으므로 처리
        let text = '';
        if (Array.isArray(result)) {
          text = result[0]?.text?.trim() || '';
        } else {
          text = result?.text?.trim() || '';
        }
        
        // 반복 패턴 제거 및 중복 필터링 (간소화된 버전)
        text = this.deduplicateTextFast(text);
        
        this.state = 'ready';
        this.processingPromise = null;
        
        if (text) {
          console.log(`[LocalSttService] STT 결과: "${text}"`);
        }
        
        return text || null;
      } catch (error) {
        this.state = 'ready';
        this.processingPromise = null;
        console.error('[LocalSttService] STT 처리 실패:', error);
        return null;
      }
    })();

    return this.processingPromise;
  }

  /**
   * PCM Int16 데이터를 Float32 배열로 변환 (최적화 버전)
   * 
   * @param buffer PCM Int16 형식의 Buffer
   * @returns Float32 배열 (-1.0 ~ 1.0 범위로 정규화)
   */
  private convertInt16ToFloat32Fast(buffer: Buffer): Float32Array {
    const int16Array = new Int16Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.length / 2
    );
    const float32Array = new Float32Array(int16Array.length);
    
    // Int16 (-32768 ~ 32767) → Float32 (-1.0 ~ 1.0)
    // 최적화: 루프 언롤링 및 상수 사용
    const scale = 1.0 / 32768.0;
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] * scale;
    }
    
    return float32Array;
  }

  /**
   * PCM Int16 데이터를 Float32 배열로 변환 (레거시 버전)
   * 
   * @param buffer PCM Int16 형식의 Buffer
   * @returns Float32 배열 (-1.0 ~ 1.0 범위로 정규화)
   */
  private convertInt16ToFloat32(buffer: Buffer): Float32Array {
    return this.convertInt16ToFloat32Fast(buffer);
  }

  /**
   * 현재 서비스 상태 반환
   */
  public getState(): ServiceState {
    return this.state;
  }

  /**
   * 수동으로 캐시를 삭제하고 모델을 재로딩 (에러 상태에서 복구용)
   */
  public async resetAndRetry(): Promise<void> {
    console.log('[LocalSttService] 수동 재시도 요청. 현재 상태:', this.state);
    
    // 상태를 idle로 리셋
    this.state = 'idle';
    this.loadingPromise = null;
    this.transcriber = null;
    this._hasLoggedLoading = false;
    
    // 캐시 삭제 시도
    try {
      await this.clearModelCache();
      console.log('[LocalSttService] 캐시 삭제 완료. 모델을 다시 로딩합니다...');
    } catch (error) {
      console.warn('[LocalSttService] 캐시 삭제 실패 (계속 진행):', error);
    }
    
    // 모델 재로딩
    await this.init();
  }

  /**
   * 버퍼 초기화 (필요시 수동으로 호출)
   */
  public clearBuffer(): void {
    this.audioBuffer = [];
  }

  /**
   * 텍스트에서 반복 패턴 제거 및 중복 필터링 (정확도 향상을 위해 덜 공격적으로)
   */
  private deduplicateTextFast(text: string): string {
    if (!text) return '';

    let cleaned = text.trim();
    
    // 1. 같은 문장이 반복되는 패턴 제거 (3번 이상 반복만 제거)
    // "-문장. -문장. -문장." 패턴을 "-문장."으로
    const dashPattern = /^([-]\s*[^.-]+[.-]?)(\s*\1\s*){2,}/;
    const dashMatch = cleaned.match(dashPattern);
    if (dashMatch) {
      cleaned = dashMatch[1].trim();
    }
    
    // 2. 짧은 단어 반복 제거 (5번 이상 반복만 제거, 정확도 보호)
    const shortRepeat = /(\b\S{1,2}\b)(\s*[,\s]?\s*\1){4,}/g;
    cleaned = cleaned.replace(shortRepeat, (match) => {
      const parts = match.split(/[,\s]+/).filter((p: string) => p.trim());
      // 반복이 너무 많으면 첫 2개만 유지
      if (parts.length > 5) {
        return parts.slice(0, 2).join(' ');
      }
      return match;
    });
    
    // 3. 이전 결과와 동일하면 제거 (시간 간격을 2초로 늘려 정확도 보호)
    const now = Date.now();
    if (cleaned === this.lastProcessedText && now - this.lastProcessedTime < 2000) {
      return '';
    }
    
    // 4. 너무 짧은 텍스트는 제거하지 않음 (한 글자도 의미 있을 수 있음)
    // 대신 1글자 미만만 제거
    if (cleaned.length < 1) {
      return '';
    }
    
    this.lastProcessedText = cleaned;
    this.lastProcessedTime = now;
    
    return cleaned;
  }

  /**
   * 텍스트에서 반복 패턴 제거 및 중복 필터링 (상세 버전)
   */
  private deduplicateText(text: string): string {
    if (!text) return '';

    let cleaned = text.trim();
    
    // 1. 같은 문장이 반복되는 패턴 제거
    // 예: "-너는 인턴을 해. -너는 인턴을 해. -너는 인턴을 해."
    // 패턴을 찾아서 첫 번째만 유지
    const sentencePattern = /([-]?[^.-]+[.-]?)/g;
    const sentences: string[] = [];
    let match;
    while ((match = sentencePattern.exec(cleaned)) !== null) {
      sentences.push(match[1].trim());
    }
    
    // 문장이 3개 이상이고 모두 비슷하면 중복 제거
    if (sentences.length >= 3) {
      const firstSentence = sentences[0];
      const allSimilar = sentences.slice(1).every(s => {
        // 유사도 체크: 첫 문장과 80% 이상 유사하면 중복으로 간주
        const similarity = this.calculateSimilarity(firstSentence, s);
        return similarity > 0.8;
      });
      
      if (allSimilar) {
        // 모두 비슷하면 첫 번째만 유지
        cleaned = firstSentence;
      } else {
        // 일부만 유사하면 중복 제거
        const uniqueSentences: string[] = [sentences[0]];
        for (let i = 1; i < sentences.length; i++) {
          const isDuplicate = uniqueSentences.some(unique => {
            return this.calculateSimilarity(unique, sentences[i]) > 0.8;
          });
          if (!isDuplicate) {
            uniqueSentences.push(sentences[i]);
          }
        }
        cleaned = uniqueSentences.join(' ');
      }
    }
    
    // 2. 짧은 단어가 반복되는 패턴 제거 (예: "아, 아, 아, 아..." 또는 "아 아 아...")
    // 2글자 이하 단어가 5번 이상 반복되면 제거
    const shortWordRepeat = /(\b\S{1,2}\b)(\s*[,\s]?\s*\1){4,}/g;
    cleaned = cleaned.replace(shortWordRepeat, (match) => {
      // 반복이 너무 많으면 첫 2개만 유지
      const parts = match.split(/[,\s]+/).filter((p: string) => p.trim());
      if (parts.length > 5) {
        return parts.slice(0, 2).join(' ');
      }
      return match;
    });
    
    // 3. 이전 결과와 동일하면 null 반환 (중복 제거)
    const now = Date.now();
    if (cleaned === this.lastProcessedText && now - this.lastProcessedTime < 2000) {
      // 2초 이내에 같은 텍스트가 나오면 중복으로 간주
      return '';
    }
    
    // 4. 유사한 텍스트 필터링 (이전 텍스트의 일부가 반복되는 경우)
    if (this.lastProcessedText && cleaned.length > 0) {
      const similarity = this.calculateSimilarity(this.lastProcessedText, cleaned);
      if (similarity > 0.9 && cleaned.length < this.lastProcessedText.length * 1.2) {
        // 90% 이상 유사하고 길이가 비슷하면 중복으로 간주
        return '';
      }
    }
    
    // 5. 너무 짧은 텍스트 필터링 (노이즈 제거)
    if (cleaned.length < 2) {
      return '';
    }
    
    // 결과 저장
    this.lastProcessedText = cleaned;
    this.lastProcessedTime = now;
    
    return cleaned;
  }

  /**
   * 두 텍스트의 유사도 계산 (간단한 Jaccard 유사도)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    if (!text1 || !text2) return 0;
    if (text1 === text2) return 1;
    
    // 공백과 특수문자 제거 후 비교
    const clean1 = text1.replace(/[^\w가-힣]/g, '').toLowerCase();
    const clean2 = text2.replace(/[^\w가-힣]/g, '').toLowerCase();
    
    if (clean1 === clean2) return 1;
    
    // 짧은 텍스트가 긴 텍스트에 포함되어 있는지 확인
    const shorter = clean1.length < clean2.length ? clean1 : clean2;
    const longer = clean1.length >= clean2.length ? clean1 : clean2;
    
    if (longer.includes(shorter) && shorter.length > 3) {
      return shorter.length / longer.length;
    }
    
    // 문자 단위로 유사도 계산
    const set1 = new Set(clean1.split(''));
    const set2 = new Set(clean2.split(''));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  /**
   * 모델 캐시 삭제 (손상된 모델 파일 재다운로드를 위해)
   * @param errorMessage 에러 메시지에서 캐시 경로 추출 (선택적)
   */
  public async clearModelCache(errorMessage?: string): Promise<void> {
    try {
      let cachePathToDelete: string | null = null;
      
      // 에러 메시지에서 경로 추출 시도
      if (errorMessage) {
        const match = errorMessage.match(/from\s+(.+?)\s+failed/i);
        if (match && match[1]) {
          const filePath = match[1].trim();
          // 파일 경로에서 디렉토리 경로 추출
          const dirPath = path.dirname(filePath);
          // onnx 디렉토리의 부모 디렉토리 (whisper-tiny)
          if (dirPath.includes('whisper-tiny')) {
            const whisperTinyPath = dirPath.split('whisper-tiny')[0] + 'whisper-tiny';
            if (fs.existsSync(whisperTinyPath)) {
              cachePathToDelete = whisperTinyPath;
              console.log(`[LocalSttService] 에러 메시지에서 캐시 경로 추출: ${cachePathToDelete}`);
            }
          }
        }
      }
      
      // 추출 실패 시 일반적인 캐시 경로 시도
      if (!cachePathToDelete) {
        const possibleCachePaths = [
          path.join(process.cwd(), 'node_modules', '@huggingface', 'transformers', '.cache', 'Xenova', 'whisper-tiny'),
          path.join(__dirname, '../../node_modules/@huggingface/transformers/.cache/Xenova/whisper-tiny'),
          path.join(require('os').homedir(), '.cache', 'huggingface', 'transformers', 'Xenova', 'whisper-tiny'),
        ];

        for (const possiblePath of possibleCachePaths) {
          if (fs.existsSync(possiblePath)) {
            cachePathToDelete = possiblePath;
            console.log(`[LocalSttService] 일반 캐시 경로에서 발견: ${cachePathToDelete}`);
            break;
          }
        }
      }

      if (cachePathToDelete && fs.existsSync(cachePathToDelete)) {
        console.log(`[LocalSttService] 캐시 삭제 중: ${cachePathToDelete}`);
        try {
          fs.rmSync(cachePathToDelete, { recursive: true, force: true });
          console.log(`[LocalSttService] ✅ 캐시 삭제 완료: ${cachePathToDelete}`);
        } catch (deleteError) {
          console.warn(`[LocalSttService] 캐시 삭제 실패:`, deleteError);
          throw deleteError;
        }
      } else {
        console.warn('[LocalSttService] ⚠️ 캐시 경로를 찾을 수 없습니다.');
        console.warn('[LocalSttService] 수동으로 다음 경로를 삭제해주세요:');
        console.warn(`  - ${path.join(process.cwd(), 'node_modules', '@huggingface', 'transformers', '.cache', 'Xenova', 'whisper-tiny')}`);
      }
    } catch (error) {
      console.error('[LocalSttService] 캐시 삭제 중 오류:', error);
      throw error; // 재시도 실패를 알리기 위해 에러를 throw
    }
  }
}


