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

export class AudioService {
  private isMonitoring = false;
  private audioIn: any = null;
  private processor: AudioProcessor;
  private streamClient: AudioStreamClient;
  private volumeLevel = 5; // 0~10, 기본값 5
  private beepEnabled = false;
  
  constructor(private mainWindow: BrowserWindow | null) {
    this.processor = new AudioProcessor(48000, 16000);
    this.streamClient = new AudioStreamClient('ws://localhost:8000/ws/audio');
    
    // 서버 응답 리스너
    this.streamClient.on('response', (response: AudioStreamResponse) => {
      this.handleServerResponse(response);
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
      // Loopback 디바이스 찾기 (스테레오 믹스 우선)
      const loopbackDevice = devices.find(d => 
        (d.name.includes('스테레오 믹스') || d.name.includes('Stereo Mix')) ||
        (d.name.includes('스피커') && d.maxInputChannels >= 2) ||
        (d.name.includes('Speakers') && d.maxInputChannels >= 2) ||
        (d.name.includes('Output') && d.maxInputChannels >= 2)
      ) || devices.find(d => d.maxInputChannels >= 2 && !d.name.includes('Microphone') && !d.name.includes('마이크'));
      
      if (!loopbackDevice) {
        throw new Error('No loopback device found');
      }
      
      console.log(`[AudioService] Using audio device: ${loopbackDevice.name}`);
      
      this.audioIn = new naudiodon.AudioIO({
        inOptions: {
          channelCount: 2,
          sampleFormat: 16,
          sampleRate: 48000,
          deviceId: loopbackDevice.id,
          closeOnError: true
        }
      });
      
      this.audioIn.on('data', (chunk: Buffer) => {
        const processed = this.processor.process(chunk);
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
    
    if (this.audioIn) {
      this.audioIn.quit();
      this.audioIn = null;
    }
    
    this.streamClient.disconnect();
    this.isMonitoring = false;
    console.log('[AudioService] ✅ Audio monitoring stopped');
    
    this.broadcastStatus();
  }
  
  private handleServerResponse(response: AudioStreamResponse): void {
    console.log('[AudioService] Server response:', response);
    
    if (response.is_harmful) {
      console.log(`[AudioService] ⚠️ HARMFUL AUDIO DETECTED: ${response.text}`);
      
      // 렌더러에 유해 감지 이벤트 전송
      if (this.mainWindow) {
        this.mainWindow.webContents.send(IPC_CHANNELS.AUDIO_HARMFUL_DETECTED, {
          text: response.text,
          confidence: response.confidence,
          timestamp: response.timestamp
        });
      }
      
      // 볼륨 조절 또는 비프음 재생
      if (this.beepEnabled) {
        this.playBeep();
      } else {
        this.adjustVolume();
      }
    }
  }
  
  private adjustVolume(): void {
    // TODO: Windows 볼륨 API 호출 (Phase 5에서 구현)
    console.log(`[AudioService] 🔊 Adjusting volume to level: ${this.volumeLevel}`);
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
      beepEnabled: this.beepEnabled
    };
  }
  
  private broadcastStatus(): void {
    if (this.mainWindow) {
      this.mainWindow.webContents.send(IPC_CHANNELS.AUDIO_STATUS, this.getStatus());
    }
  }
}

