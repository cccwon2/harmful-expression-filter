/**
 * Phase 3: 오디오 모니터링 서비스 (메인 프로세스)
 * 
 * 오디오 캡처, 처리, WebSocket 통신을 통합 관리합니다.
 */

import { BrowserWindow } from 'electron';
import naudiodon from 'naudiodon2';
import { AudioProcessor } from './audioProcessor';
import { AudioStreamClient, AudioStreamResponse } from './audioStreamClient';
import { IPC_CHANNELS } from '../ipc/channels';
import { AppVolumeController } from './appVolumeController';

export class AudioService {
  private isMonitoring = false;
  private audioIn: any = null;
  private processor: AudioProcessor;
  private streamClient: AudioStreamClient;
  private volumeLevel = 1; // 0~10, 기본값 1 (1단계 볼륨)
  private beepEnabled = false;
  private volumeController: AppVolumeController;
  private targetAppName: string | null = 'chrome'; // 모니터링할 앱 이름 (기본값: chrome, null이면 모든 앱)
  private windows: Set<BrowserWindow> = new Set(); // 여러 윈도우 지원
  
  constructor(initialWindow: BrowserWindow | null) {
    // AudioProcessor는 startMonitoring에서 실제 디바이스 샘플 레이트로 초기화됨
    // 임시로 48000으로 초기화 (실제로는 startMonitoring에서 재설정됨)
    this.processor = new AudioProcessor(48000, 16000);
    this.streamClient = new AudioStreamClient('ws://127.0.0.1:8000/ws/audio');
    this.volumeController = new AppVolumeController();
    
    if (initialWindow) {
      this.windows.add(initialWindow);
    }
    
    // 서버 응답 리스너
    this.streamClient.on('response', (response: AudioStreamResponse) => {
      void this.handleServerResponse(response);
    });
    
    this.streamClient.on('error', (err) => {
      console.error('[AudioService] WebSocket error:', err);
    });
    
    this.streamClient.on('close', () => {
      console.log('[AudioService] WebSocket connection closed');
      if (this.isMonitoring) {
        // 재연결 시도
        console.log('[AudioService] Attempting to reconnect...');
        setTimeout(() => {
          this.streamClient.connect().catch(console.error);
        }, 1000);
      }
    });
  }
  
  /**
   * 윈도우 추가 (여러 윈도우에서 오디오 상태 수신 가능)
   */
  addWindow(window: BrowserWindow): void {
    this.windows.add(window);
    console.log(`[AudioService] Window added (total: ${this.windows.size})`);
    
    // 현재 상태를 새 윈도우에 전송
    this.broadcastStatus();
  }
  
  /**
   * 윈도우 제거
   */
  removeWindow(window: BrowserWindow): void {
    this.windows.delete(window);
    console.log(`[AudioService] Window removed (total: ${this.windows.size})`);
  }
  
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      console.log('[AudioService] Audio monitoring already started');
      return;
    }
    
    try {
      // WebSocket 연결
      await this.streamClient.connect();
      
      // 오디오 캡처 시작
      const devices = naudiodon.getDevices();
      console.log(`[AudioService] Found ${devices.length} audio devices:`);
      devices.forEach((d, idx) => {
        console.log(`  [${idx}] ${d.name} - Input: ${d.maxInputChannels}, Output: ${d.maxOutputChannels}, SampleRate: ${d.defaultSampleRate}`);
        // 디바이스 상세 정보 출력 (있는 경우)
        if ((d as any).hostAPI) {
          console.log(`       HostAPI: ${(d as any).hostAPI}`);
        }
      });
      
      // WASAPI Loopback 디바이스 찾기
      // Windows naudiodon2에서는 출력 디바이스를 입력 디바이스로 사용해야 함
      // naudiodon2는 출력 디바이스에 대해 maxInputChannels를 설정하여 Loopback을 지원
      
      // 디바이스 선택 전략:
      // 1순위: 스테레오 믹스 (명시적 - 가장 안정적)
      // 2순위: 48000Hz 스테레오 믹스 (더 나은 샘플 레이트)
      // 3순위: WASAPI Loopback 디바이스
      // 4순위: 출력 디바이스
      
      // 1순위: 스테레오 믹스 (44100Hz)
      let loopbackDevice = devices.find(d => {
        const nameLower = d.name.toLowerCase();
        const isStereoMix = nameLower.includes('stereo mix') || 
                           nameLower.includes('스테레오 믹스') ||
                           nameLower.includes('stereo 믹스');
        return isStereoMix && d.defaultSampleRate === 44100;
      });
      
      // 2순위: 스테레오 믹스 (48000Hz) - 더 나은 샘플 레이트
      if (!loopbackDevice) {
        loopbackDevice = devices.find(d => {
          const nameLower = d.name.toLowerCase();
          const isStereoMix = nameLower.includes('stereo mix') || 
                             nameLower.includes('스테레오 믹스') ||
                             nameLower.includes('stereo 믹스');
          return isStereoMix && d.defaultSampleRate === 48000;
        });
      }
      
      // 3순위: 모든 스테레오 믹스
      if (!loopbackDevice) {
        loopbackDevice = devices.find(d => {
          const nameLower = d.name.toLowerCase();
          return nameLower.includes('stereo mix') || 
                 nameLower.includes('스테레오 믹스') ||
                 nameLower.includes('stereo 믹스');
        });
      }
      
      if (loopbackDevice) {
        console.log(`[AudioService] 🎯 Found Stereo Mix device: ${loopbackDevice.name} (Sample rate: ${loopbackDevice.defaultSampleRate} Hz)`);
      }
      
      if (!loopbackDevice) {
        // 4순위: WASAPI Loopback 디바이스 (출력 디바이스 중 입력 채널이 있는 것)
        // Windows 10/11에서는 출력 디바이스가 Loopback으로 사용 가능 (naudiodon2 지원)
        // 출력 채널이 있고, 입력 채널도 있으면서 마이크가 아닌 것
        const candidates = devices.filter(d => {
          const hasOutput = d.maxOutputChannels > 0;
          const hasInput = d.maxInputChannels > 0;
          const nameLower = d.name.toLowerCase();
          const isNotMic = !nameLower.includes('microphone') && 
                          !nameLower.includes('마이크') &&
                          !nameLower.includes('mic') &&
                          !nameLower.includes('headset') &&
                          !nameLower.includes('headphone') &&
                          !nameLower.includes('헤드셋') &&
                          !nameLower.includes('헤드폰');
          
          return hasOutput && hasInput && isNotMic;
        });
        
        if (candidates.length > 0) {
          // 출력 채널이 가장 많은 디바이스 선택 (일반적으로 기본 출력 디바이스)
          loopbackDevice = candidates.sort((a, b) => b.maxOutputChannels - a.maxOutputChannels)[0];
          console.log(`[AudioService] 🎯 Found WASAPI Loopback device: ${loopbackDevice.name} (Output: ${loopbackDevice.maxOutputChannels}, Input: ${loopbackDevice.maxInputChannels})`);
          console.log(`[AudioService] Other candidates: ${candidates.slice(1).map(d => d.name).join(', ')}`);
        }
      }
      
      if (!loopbackDevice) {
        // 5순위: 출력 채널이 있는 디바이스 (스피커 등 - 마지막 수단)
        // naudiodon2가 Loopback을 지원하는 경우에만 작동
        const outputDevices = devices.filter(d => {
          const hasOutput = d.maxOutputChannels > 0;
          const nameLower = d.name.toLowerCase();
          const isNotMic = !nameLower.includes('microphone') && 
                          !nameLower.includes('마이크') &&
                          !nameLower.includes('mic');
          
          return hasOutput && isNotMic;
        });
        
        if (outputDevices.length > 0) {
          // 출력 채널이 가장 많은 디바이스 선택
          loopbackDevice = outputDevices.sort((a, b) => b.maxOutputChannels - a.maxOutputChannels)[0];
          console.log(`[AudioService] ⚠️ Using output device as loopback (may not work): ${loopbackDevice.name} (Output: ${loopbackDevice.maxOutputChannels}, Input: ${loopbackDevice.maxInputChannels})`);
          console.warn(`[AudioService] ⚠️ This device has no input channels - loopback may fail!`);
        }
      }
      
      if (!loopbackDevice) {
        console.error('[AudioService] ❌ No loopback device found!');
        console.error('[AudioService] Available devices:');
        devices.forEach((d, idx) => {
          console.error(`  [${idx}] ${d.name} - Input: ${d.maxInputChannels}, Output: ${d.maxOutputChannels}`);
        });
        console.error('[AudioService] 💡 Please check:');
        console.error('[AudioService]   1. Windows Sound Settings > Recording > Enable "Stereo Mix"');
        console.error('[AudioService]   2. Or use a WASAPI-compatible audio device');
        throw new Error('No loopback device found. Please enable "Stereo Mix" in Windows audio settings or check audio device configuration.');
      }
      
      console.log(`[AudioService] ✅ Using audio device: ${loopbackDevice.name} (ID: ${loopbackDevice.id})`);
      console.log(`[AudioService] Device info: Input channels=${loopbackDevice.maxInputChannels}, Output channels=${loopbackDevice.maxOutputChannels}, Sample rate=${loopbackDevice.defaultSampleRate}`);
      
      // 디바이스가 실제로 입력을 지원하는지 확인
      if (loopbackDevice.maxInputChannels === 0) {
        console.warn('[AudioService] ⚠️ Selected device has no input channels. This may not work for loopback capture.');
        console.warn('[AudioService] ⚠️ Trying anyway, but audio capture may fail.');
      }
      
      // 스테레오 믹스 사용 시 중요 안내사항
      if (loopbackDevice.name.includes('스테레오 믹스') || loopbackDevice.name.toLowerCase().includes('stereo mix')) {
        console.log(`[AudioService] 📢 IMPORTANT: Stereo Mix device detected (${loopbackDevice.defaultSampleRate} Hz).`);
        console.log(`[AudioService] 📢 ℹ️  Stereo Mix captures audio from your DEFAULT playback device (speakers/headphones).`);
        console.log(`[AudioService] 📢 ℹ️  You do NOT need to remove headphones - it will capture audio playing through them.`);
        console.log(`[AudioService] 📢 ⚠️  CRITICAL CHECKLIST:`);
        console.log(`[AudioService] 📢   1. Is audio ACTUALLY playing? (YouTube, Discord, etc.) - Audio must be playing for capture to work!`);
        console.log(`[AudioService] 📢   2. Check Windows Sound Settings > Recording tab - Stereo Mix audio bars MUST move when audio plays`);
        console.log(`[AudioService] 📢   3. If audio bars don't move: Stereo Mix is not capturing audio - check Windows audio settings`);
        console.log(`[AudioService] 📢   4. Check default playback device (System > Sound > Output) - must match your speakers/headphones`);
        console.log(`[AudioService] 📢   5. Stereo Mix volume: 100% in Properties > Levels tab`);
        console.log(`[AudioService] 📢   6. System playback volume: Should be > 0%`);
        console.log(`[AudioService] 📢   7. Close other apps using Stereo Mix (OBS, Discord, etc.)`);
        console.log(`[AudioService] 📢   8. If still not working: Try restarting Windows Audio Service (services.msc > Windows Audio)`);
      }
      
      // 디바이스가 지원하는 입력 채널 수 확인
      // WASAPI Loopback의 경우 출력 디바이스를 입력으로 사용하므로,
      // maxInputChannels가 0일 수 있지만 실제로는 작동할 수 있음
      const inputChannels = loopbackDevice.maxInputChannels > 0 
        ? Math.min(2, loopbackDevice.maxInputChannels) 
        : 2; // 입력 채널이 없어도 시도 (WASAPI Loopback은 다를 수 있음)
      const sampleRate = loopbackDevice.defaultSampleRate || 48000;
      
      // AudioProcessor를 실제 디바이스 샘플 레이트로 재초기화
      // 중요: 디바이스 샘플 레이트와 AudioProcessor 입력 샘플 레이트가 일치해야 함
      this.processor = new AudioProcessor(sampleRate, 16000);
      console.log(`[AudioService] AudioProcessor initialized: ${sampleRate} Hz → 16000 Hz`);
      
      console.log(`[AudioService] Creating audio stream:`);
      console.log(`[AudioService]   - Device: ${loopbackDevice.name} (ID: ${loopbackDevice.id})`);
      console.log(`[AudioService]   - Channels: ${inputChannels} (device supports: ${loopbackDevice.maxInputChannels} input, ${loopbackDevice.maxOutputChannels} output)`);
      console.log(`[AudioService]   - Sample rate: ${sampleRate} Hz`);
      console.log(`[AudioService]   - Format: 16-bit PCM`);
      
      try {
        this.audioIn = new naudiodon.AudioIO({
          inOptions: {
            channelCount: inputChannels,
            sampleFormat: 16,
            sampleRate: sampleRate,
            deviceId: loopbackDevice.id,
            closeOnError: true
          }
        });
        console.log(`[AudioService] ✅ Audio stream created successfully`);
      } catch (err: any) {
        console.error(`[AudioService] ❌ Failed to create audio stream:`, err);
        throw new Error(`Failed to create audio stream for device ${loopbackDevice.name}: ${err.message}`);
      }
      
      // 오디오 청크 통계 추적 (첫 번째 청크만 상세 로깅)
      let chunkCount = 0;
      let lastLogTime = Date.now();
      
      this.audioIn.on('data', (chunk: Buffer) => {
        chunkCount++;
        const now = Date.now();
        
        // 오디오 청크 통계 계산
        // 스테레오 16-bit: chunk.length = samples * 2 * 2 (2 channels, 2 bytes per sample)
        const samples = chunk.length / 4; // 스테레오 = 4 bytes per sample pair
        let sum = 0;
        let max = 0;
        let nonZeroSamples = 0;
        
        for (let i = 0; i < samples; i++) {
          // Left channel
          const left = Math.abs(chunk.readInt16LE(i * 4));
          // Right channel
          const right = Math.abs(chunk.readInt16LE(i * 4 + 2));
          // 평균
          const sample = Math.floor((left + right) / 2);
          
          sum += sample;
          max = Math.max(max, sample);
          if (sample > 0) {
            nonZeroSamples++;
          }
        }
        
        const mean = sum / samples;
        const meanAbs = mean / 32768.0; // 정규화 (0.0 ~ 1.0)
        const maxAbs = max / 32768.0;
        const nonZeroRatio = nonZeroSamples / samples;
        
        // 첫 번째 청크 또는 주기적으로 상세 로깅
        if (chunkCount === 1 || (now - lastLogTime) > 5000) {
          console.log(`[AudioService] Audio chunk #${chunkCount}: size=${chunk.length} bytes, samples=${samples}, mean_abs=${meanAbs.toFixed(6)}, max_abs=${maxAbs.toFixed(6)}, non_zero=${(nonZeroRatio * 100).toFixed(1)}%`);
          
          // 오디오 신호 강도 평가
          // 참고: 정상 오디오 신호는 보통 mean_abs > 0.01 이상 (음성: 0.01~0.1, 음악: 0.1~0.5)
          // 현재 신호: mean_abs=0.000054 ~ 0.000065 (정상 대비 200배 이상 약함)
          if (meanAbs < 0.0001) {
            // 매우 조용함 (거의 무음) - STT 불가능
            console.warn(`[AudioService] ⚠️ Audio signal is extremely quiet (mean_abs=${meanAbs.toFixed(6)}) - STT will likely fail`);
            console.warn(`[AudioService] ⚠️ Current signal is ~200x weaker than normal speech (need > 0.01)`);
            if (chunkCount === 1 || chunkCount % 50 === 0) {
              console.warn(`[AudioService] ⚠️ ========================================`);
              console.warn(`[AudioService] ⚠️ CRITICAL: Stereo Mix volume is too low!`);
              console.warn(`[AudioService] ⚠️ ========================================`);
              console.warn(`[AudioService] ⚠️ Action required:`);
              console.warn(`[AudioService] ⚠️   1. Windows Settings > Sound > Sound Control Panel`);
              console.warn(`[AudioService] ⚠️   2. Recording tab > Find "Stereo Mix"`);
              console.warn(`[AudioService] ⚠️   3. Right-click > Properties > Levels tab`);
              console.warn(`[AudioService] ⚠️   4. Set volume to 100% (NOT 50%, NOT 80% - use 100%!)`);
              console.warn(`[AudioService] ⚠️   5. Make sure it's NOT muted`);
              console.warn(`[AudioService] ⚠️   6. Play audio (YouTube, Discord) - check if audio bars move`);
              console.warn(`[AudioService] ⚠️   7. Restart app after changing volume`);
              console.warn(`[AudioService] ⚠️ ========================================`);
            }
          } else if (meanAbs < 0.001) {
            // 조용함 (신호는 있지만 약함) - STT 가능하지만 품질 낮음
            console.warn(`[AudioService] ⚠️ Audio signal is very quiet (mean_abs=${meanAbs.toFixed(6)}) - STT may fail`);
            console.warn(`[AudioService] ⚠️ Current signal is ~10-100x weaker than normal speech (need > 0.01)`);
            console.warn(`[AudioService] ⚠️ Consider increasing Stereo Mix recording volume to 100%`);
          } else if (meanAbs < 0.01) {
            // 약한 신호 (STT 가능하지만 품질 낮을 수 있음)
            console.log(`[AudioService] ⚠️ Audio signal is weak (mean_abs=${meanAbs.toFixed(4)}) - STT may work but quality may be low`);
            console.log(`[AudioService] 💡 Consider increasing Stereo Mix recording volume for better results`);
          } else {
            // 정상 신호 (STT 정상 작동 가능)
            console.log(`[AudioService] ✅ Audio signal detected: mean_abs=${meanAbs.toFixed(4)}, max_abs=${maxAbs.toFixed(4)} - STT should work`);
          }
          
          lastLogTime = now;
        }
        
        const processed = this.processor.process(chunk);
        
        // 처리된 오디오 크기 확인
        if (processed.length === 0) {
          console.error('[AudioService] ❌ Processed audio is empty!');
          return;
        }
        
        // 처리된 오디오 신호 강도 확인 (디버깅)
        if (chunkCount === 1 || chunkCount % 50 === 0) {
          const processedSamples = processed.length / 2; // 16-bit = 2 bytes
          let processedSum = 0;
          let processedMax = 0;
          for (let i = 0; i < processedSamples; i++) {
            const sample = Math.abs(processed.readInt16LE(i * 2));
            processedSum += sample;
            processedMax = Math.max(processedMax, sample);
          }
          const processedMean = processedSum / processedSamples;
          const processedMeanAbs = processedMean / 32768.0;
          const processedMaxAbs = processedMax / 32768.0;
          
          console.log(`[AudioService] Processed audio: size=${processed.length} bytes, samples=${processedSamples}, mean_abs=${processedMeanAbs.toFixed(6)}, max_abs=${processedMaxAbs.toFixed(6)}`);
          
          if (processedMeanAbs < 0.001) {
            console.warn(`[AudioService] ⚠️ Processed audio signal is very weak - may cause STT failure on server`);
          }
        }
        
        this.streamClient.sendAudioChunk(processed);
      });
      
      this.audioIn.on('error', (err: Error) => {
        console.error('[AudioService] Audio capture error:', err);
        this.stopMonitoring();
      });
      
      this.audioIn.start();
      this.isMonitoring = true;
      console.log('[AudioService] ✅ Audio monitoring started');
      
      // 렌더러에 상태 업데이트 전송
      this.broadcastStatus();
    } catch (err) {
      console.error('[AudioService] Failed to start audio monitoring:', err);
      throw err;
    }
  }
  
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }
    
    // 오디오 캡처 중지
    if (this.audioIn) {
      try {
        this.audioIn.quit();
      } catch (err) {
        console.error('[AudioService] Error stopping audio capture:', err);
      }
      this.audioIn = null;
    }
    
    // WebSocket 연결 정상 종료
    try {
      this.streamClient.disconnect();
    } catch (err) {
      console.error('[AudioService] Error disconnecting WebSocket:', err);
    }
    
    this.isMonitoring = false;
    console.log('[AudioService] ✅ Audio monitoring stopped');
    
    void this.volumeController.restoreVolume();
    this.broadcastStatus();
  }
  
  /**
   * 모니터링할 앱 설정 (null이면 모든 앱)
   */
  setTargetApp(appName: string | null): void {
    this.targetAppName = appName;
    console.log(`[AudioService] Target app set to: ${appName || 'all apps'}`);
  }
  
  /**
   * 현재 실행 중인 오디오 세션 조회
   */
  getAudioSessions() {
    return this.volumeController.getAudioSessions();
  }
  
  private async handleServerResponse(response: AudioStreamResponse): Promise<void> {
    console.log('[AudioService] Server response:', response);

    const isHarmful = response.is_harmful === true || response.is_harmful === 1;
    if (!isHarmful) {
      return;
    }

    console.log(`[AudioService] ⚠️ HARMFUL AUDIO DETECTED: ${response.text}`);

    // 등록된 모든 윈도우에 유해 감지 알림 전송
    const harmfulData = {
      text: response.text,
      confidence: response.confidence || 0,
      timestamp: response.timestamp || Date.now()
    };
    
    this.windows.forEach((window) => {
      if (!window.isDestroyed()) {
        try {
          window.webContents.send(IPC_CHANNELS.AUDIO_HARMFUL_DETECTED, harmfulData);
          console.log(`[AudioService] Harmful detection sent to window ${window.id}`);
        } catch (err) {
          console.error(`[AudioService] Failed to send harmful detection to window ${window.id}:`, err);
        }
      }
    });

    if (this.beepEnabled) {
      this.playBeep();
      return;
    }

    await this.adjustVolume(this.volumeLevel);
  }
  
  private async adjustVolume(level: number): Promise<void> {
    try {
      // 유해 표현 감지 시 볼륨 조절
      if (this.targetAppName) {
        // 특정 앱만 음소거 (예: Chrome)
        console.log(`[AudioService] 🔇 Muting specific app: ${this.targetAppName} (no auto-restore)`);
        const success = await this.volumeController.muteApp(this.targetAppName);
        if (success) {
          console.log(`[AudioService] ✅ Successfully muted ${this.targetAppName}`);
        } else {
          console.warn(`[AudioService] ⚠️ Failed to mute ${this.targetAppName}, falling back to mute all apps`);
          // 폴백: 특정 앱을 찾을 수 없으면 모든 앱 음소거
          await this.volumeController.muteAllApps(0);
        }
      } else {
        // 모든 앱 음소거 (폴백 방식)
        console.log(`[AudioService] 🔇 Muting all apps due to harmful content (no auto-restore)`);
        await this.volumeController.muteAllApps(0); // 자동 복원 없음 (0 = 복원 안함)
      }
    } catch (error) {
      console.error('[AudioService] Failed to mute apps:', error);
    }
  }
  
  private playBeep(): void {
    // TODO: 비프음 재생 (Phase 5에서 구현)
    console.log('[AudioService] 🔔 Playing beep sound');
  }
  
  setVolumeLevel(level: number): void {
    this.volumeLevel = Math.max(0, Math.min(10, level));
    console.log(`[AudioService] Volume level set to: ${this.volumeLevel}`);
    this.broadcastStatus();
  }
  
  setBeepEnabled(enabled: boolean): void {
    this.beepEnabled = enabled;
    console.log(`[AudioService] Beep enabled: ${this.beepEnabled}`);
    this.broadcastStatus();
  }
  
  getStatus() {
    return {
      isMonitoring: this.isMonitoring,
      volumeLevel: this.volumeLevel,
      beepEnabled: this.beepEnabled,
      targetAppName: this.targetAppName,
      audioSessions: this.getAudioSessions()
    };
  }
  
  private broadcastStatus(): void {
    const status = this.getStatus();
    
    // 등록된 모든 윈도우에 상태 전송
    this.windows.forEach((window) => {
      if (!window.isDestroyed()) {
        try {
          window.webContents.send(IPC_CHANNELS.AUDIO_STATUS, status);
        } catch (err) {
          console.error(`[AudioService] Failed to broadcast status to window ${window.id}:`, err);
        }
      }
    });
    
    // 트레이 메뉴 업데이트는 main.ts에서 주기적으로 처리 (순환 의존성 방지)
    // 또는 getTrayAudioUpdateCallback을 통해 간접적으로 호출
    try {
      const { getTrayAudioUpdateCallback } = require('../tray');
      const trayUpdateCallback = getTrayAudioUpdateCallback();
      if (trayUpdateCallback && typeof trayUpdateCallback === 'function') {
        trayUpdateCallback();
      }
    } catch (err) {
      // 트레이 업데이트 실패는 치명적이지 않음 (순환 의존성 방지)
      // console.error('[AudioService] Failed to update tray menu:', err);
    }
  }
}

