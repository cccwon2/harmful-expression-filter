# Task 25: 음성 Electron 연동 (Windows 오디오 캡처 및 서버 연동)

## ✅ 상태: 완료 (Completed)

**참고**: Phase 5 (Windows 볼륨 제어)는 T26으로 이동하여 앱별 볼륨 조절로 마이그레이션되었습니다.

## 📋 작업 개요

Windows 시스템 오디오(디스코드, 브라우저, 게임 등)를 실시간으로 캡처하여:
1. **오디오 스트림 캡처** (WASAPI Loopback)
2. **WebSocket을 통해 FastAPI 서버로 전송**
3. **서버 응답 수신** (유해성 판별 결과)
4. **유해 감지 시**: 해당 앱의 볼륨 조절 또는 비프음 재생

## 🎯 핵심 목표

- Windows 전역 오디오 캡처 (모든 앱의 소리)
- 실시간 WebSocket 스트리밍 (16kHz, mono, PCM 16-bit)
- 서버 응답 기반 볼륨 제어 (0~10 단계)
- **지연율 3초 이내** 유지

## 📦 필수 의존성

```json
// package.json에 추가
{
  "dependencies": {
    "naudiodon2": "^2.4.0",        // Windows WASAPI 오디오 캡처
    "ws": "^8.14.2",                // WebSocket 클라이언트
    "node-speaker": "^0.5.4"        // 비프음 재생용 (선택)
  },
  "devDependencies": {
    "@types/ws": "^8.5.8",
    "@types/node": "^20.0.0"
  }
}
```

**⚠️ Windows 빌드 도구 필요**:
```bash
# PowerShell (관리자 권한)
npm install --global --production windows-build-tools

# 또는
npm install --global node-gyp
```

## 📝 작업 체크리스트

### Phase 1: Windows 오디오 캡처 테스트 (독립 스크립트)

- [x] **1.1. naudiodon2 설치 및 테스트** ✅ 완료
  ```bash
  npm install naudiodon2
  ```
  
  ```typescript
  // electron/test/test_audio_capture.ts
  import naudiodon from 'naudiodon2';
  
  function testAudioCapture() {
    console.log('🎤 Testing Windows audio capture...');
    
    // WASAPI Loopback 디바이스 검색
    const devices = naudiodon.getDevices();
    console.log('Available devices:', devices);
    
    // Loopback 디바이스 찾기 (Windows는 보통 첫 번째가 기본 출력)
    const loopbackDevice = devices.find(d => d.name.includes('Speakers') || d.name.includes('Output'));
    
    if (!loopbackDevice) {
      console.error('❌ No loopback device found!');
      return;
    }
    
    console.log(`✅ Using device: ${loopbackDevice.name}`);
    
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
    
    audioIn.on('data', (chunk: Buffer) => {
      chunkCount++;
      if (chunkCount % 100 === 0) {
        console.log(`📊 Received ${chunkCount} chunks, size: ${chunk.length} bytes`);
      }
    });
    
    audioIn.on('error', (err: Error) => {
      console.error('❌ Audio capture error:', err);
    });
    
    audioIn.start();
    console.log('✅ Audio capture started! Press Ctrl+C to stop.');
    
    // 10초 후 종료
    setTimeout(() => {
      audioIn.quit();
      console.log('✅ Audio capture test completed!');
      process.exit(0);
    }, 10000);
  }
  
  testAudioCapture();
  ```
  
  **테스트 방법**:
  ```bash
  # 테스트 스크립트 실행
  npx tsx electron/test/test_audio_capture.ts
  
  # 성공 시: "Received XX chunks" 메시지 확인
  # 실패 시: 에러 메시지 확인 및 디바이스 목록 점검
  ```

- [x] **1.2. 오디오 리샘플링 및 모노 변환 구현** ✅ 완료
  ```typescript
  // electron/audio/audioProcessor.ts
  export class AudioProcessor {
    private inputSampleRate: number;
    private outputSampleRate: number;
    
    constructor(inputSampleRate = 48000, outputSampleRate = 16000) {
      this.inputSampleRate = inputSampleRate;
      this.outputSampleRate = outputSampleRate;
    }
    
    /**
     * 스테레오 → 모노 변환
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
      const monoBuffer = this.stereoToMono(stereoBuffer);
      const resampledBuffer = this.resample(monoBuffer);
      return resampledBuffer;
    }
  }
  ```
  
  **테스트 방법**:
  ```typescript
  // electron/test/test_audio_processor.ts
  import { AudioProcessor } from '../audio/audioProcessor';
  
  const processor = new AudioProcessor(48000, 16000);
  
  // 더미 스테레오 데이터 생성 (1초, 48kHz, 16-bit)
  const dummyStereo = Buffer.alloc(48000 * 2 * 2); // stereo = 2 channels
  for (let i = 0; i < dummyStereo.length; i++) {
    dummyStereo[i] = Math.floor(Math.random() * 256);
  }
  
  const processed = processor.process(dummyStereo);
  console.log(`✅ Input: ${dummyStereo.length} bytes (48kHz stereo)`);
  console.log(`✅ Output: ${processed.length} bytes (16kHz mono)`);
  console.log(`✅ Expected: ${16000 * 2} bytes`);
  
  if (Math.abs(processed.length - 16000 * 2) < 100) {
    console.log('✅ Audio processor test passed!');
  } else {
    console.error('❌ Size mismatch!');
  }
  ```

### Phase 2: WebSocket 클라이언트 구현 (서버 연결)

- [x] **2.1. WebSocket 오디오 스트리밍 클래스** ✅ 완료
  ```typescript
  // electron/audio/audioStreamClient.ts
  import WebSocket from 'ws';
  import { EventEmitter } from 'events';
  
  export interface AudioStreamResponse {
    text: string;
    is_harmful: boolean;
    confidence: number;
    timestamp: number;
  }
  
  export class AudioStreamClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private serverUrl: string;
    private isConnected = false;
    
    constructor(serverUrl = 'ws://localhost:8000/ws/audio') {
      super();
      this.serverUrl = serverUrl;
    }
    
    async connect(): Promise<void> {
      return new Promise((resolve, reject) => {
        this.ws = new WebSocket(this.serverUrl);
        
        this.ws.on('open', () => {
          console.log('✅ WebSocket connected to server');
          this.isConnected = true;
          resolve();
        });
        
        this.ws.on('message', (data: Buffer) => {
          try {
            const response: AudioStreamResponse = JSON.parse(data.toString());
            this.emit('response', response);
          } catch (err) {
            console.error('Failed to parse server response:', err);
          }
        });
        
        this.ws.on('error', (err) => {
          console.error('WebSocket error:', err);
          this.emit('error', err);
          reject(err);
        });
        
        this.ws.on('close', () => {
          console.log('WebSocket closed');
          this.isConnected = false;
          this.emit('close');
        });
      });
    }
    
    sendAudioChunk(audioBuffer: Buffer): void {
      if (this.ws && this.isConnected && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(audioBuffer);
      } else {
        console.warn('WebSocket not connected, cannot send audio');
      }
    }
    
    disconnect(): void {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
        this.isConnected = false;
      }
    }
  }
  ```

- [x] **2.2. 통합 테스트 (캡처 → WebSocket)** ✅ 완료
  ```typescript
  // electron/test/test_streaming.ts
  import naudiodon from 'naudiodon2';
  import { AudioProcessor } from '../audio/audioProcessor';
  import { AudioStreamClient } from '../audio/audioStreamClient';
  
  async function testStreaming() {
    const processor = new AudioProcessor(48000, 16000);
    const client = new AudioStreamClient('ws://localhost:8000/ws/audio');
    
    // 서버 응답 리스너
    client.on('response', (response) => {
      console.log('📨 Server response:', response);
      if (response.is_harmful) {
        console.log('⚠️ HARMFUL CONTENT DETECTED!');
        console.log(`Text: ${response.text}`);
        console.log(`Confidence: ${response.confidence}`);
      }
    });
    
    // WebSocket 연결
    await client.connect();
    
    // 오디오 캡처 시작
    const devices = naudiodon.getDevices();
    const loopbackDevice = devices.find(d => d.name.includes('Speakers'));
    
    const audioIn = new naudiodon.AudioIO({
      inOptions: {
        channelCount: 2,
        sampleFormat: 16,
        sampleRate: 48000,
        deviceId: loopbackDevice!.id,
        closeOnError: true
      }
    });
    
    audioIn.on('data', (chunk: Buffer) => {
      // 스테레오 48kHz → 모노 16kHz 변환
      const processed = processor.process(chunk);
      // 서버로 전송
      client.sendAudioChunk(processed);
    });
    
    audioIn.start();
    console.log('✅ Streaming test started! Play some audio and check server logs.');
    
    // 30초 후 종료
    setTimeout(() => {
      audioIn.quit();
      client.disconnect();
      console.log('✅ Streaming test completed!');
      process.exit(0);
    }, 30000);
  }
  
  testStreaming().catch(console.error);
  ```
  
  **테스트 방법**:
  ```bash
  # 터미널 1: FastAPI 서버 실행 (T24 완료 후)
  cd server
  uvicorn main:app --reload
  
  # 터미널 2: Electron 스트리밍 테스트
  npx tsx electron/test/test_streaming.ts
  
  # 터미널 3: 디스코드나 유튜브에서 음성 재생
  # 서버 로그에서 STT 결과 및 유해성 판별 확인
  ```

### Phase 3: IPC 및 Preload API 통합

- [x] **3.1. IPC 채널 추가** ✅ 완료
  ```typescript
  // electron/ipc/channels.ts (업데이트)
  export const IPC_CHANNELS = {
    // ... 기존 채널들
    AUDIO_START: 'audio:start',
    AUDIO_STOP: 'audio:stop',
    AUDIO_STATUS: 'audio:status',
    AUDIO_HARMFUL_DETECTED: 'audio:harmful-detected',
  } as const;
  
  export const AUDIO_CHANNELS = {
    START_MONITORING: 'audio:start-monitoring',
    STOP_MONITORING: 'audio:stop-monitoring',
    GET_STATUS: 'audio:get-status',
    SET_VOLUME_LEVEL: 'audio:set-volume-level',     // 볼륨 레벨 설정 (0~10)
    SET_BEEP_ENABLED: 'audio:set-beep-enabled',     // 비프음 활성화
  } as const;
  ```

- [x] **3.2. 오디오 서비스 구현 (메인 프로세스)** ✅ 완료
  ```typescript
  // electron/audio/audioService.ts
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
    }
    
    async startMonitoring(): Promise<void> {
      if (this.isMonitoring) {
        console.log('Audio monitoring already started');
        return;
      }
      
      try {
        // WebSocket 연결
        await this.streamClient.connect();
        
        // 오디오 캡처 시작
        const devices = naudiodon.getDevices();
        const loopbackDevice = devices.find(d => d.name.includes('Speakers') || d.name.includes('Output'));
        
        if (!loopbackDevice) {
          throw new Error('No loopback device found');
        }
        
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
          console.error('Audio capture error:', err);
          this.stopMonitoring();
        });
        
        this.audioIn.start();
        this.isMonitoring = true;
        console.log('✅ Audio monitoring started');
        
        // 렌더러에 상태 업데이트 전송
        this.broadcastStatus();
      } catch (err) {
        console.error('Failed to start audio monitoring:', err);
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
      console.log('✅ Audio monitoring stopped');
      
      this.broadcastStatus();
    }
    
    private handleServerResponse(response: AudioStreamResponse): void {
      console.log('Server response:', response);
      
      if (response.is_harmful) {
        console.log(`⚠️ HARMFUL AUDIO DETECTED: ${response.text}`);
        
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
      // TODO: Windows 볼륨 API 호출 (Phase 4에서 구현)
      console.log(`🔊 Adjusting volume to level: ${this.volumeLevel}`);
    }
    
    private playBeep(): void {
      // TODO: 비프음 재생 (Phase 4에서 구현)
      console.log('🔔 Playing beep sound');
    }
    
    setVolumeLevel(level: number): void {
      this.volumeLevel = Math.max(0, Math.min(10, level));
      console.log(`Volume level set to: ${this.volumeLevel}`);
    }
    
    setBeepEnabled(enabled: boolean): void {
      this.beepEnabled = enabled;
      console.log(`Beep enabled: ${this.beepEnabled}`);
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
  ```

- [x] **3.3. IPC 핸들러 등록** ✅ 완료
  ```typescript
  // electron/ipc/audioHandlers.ts
  import { ipcMain, BrowserWindow } from 'electron';
  import { AUDIO_CHANNELS } from './channels';
  import { AudioService } from '../audio/audioService';
  
  let audioService: AudioService | null = null;
  
  export function registerAudioHandlers(mainWindow: BrowserWindow) {
    audioService = new AudioService(mainWindow);
    
    ipcMain.handle(AUDIO_CHANNELS.START_MONITORING, async () => {
      try {
        await audioService!.startMonitoring();
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });
    
    ipcMain.handle(AUDIO_CHANNELS.STOP_MONITORING, () => {
      audioService!.stopMonitoring();
      return { success: true };
    });
    
    ipcMain.handle(AUDIO_CHANNELS.GET_STATUS, () => {
      return audioService!.getStatus();
    });
    
    ipcMain.handle(AUDIO_CHANNELS.SET_VOLUME_LEVEL, (_, level: number) => {
      audioService!.setVolumeLevel(level);
      return { success: true };
    });
    
    ipcMain.handle(AUDIO_CHANNELS.SET_BEEP_ENABLED, (_, enabled: boolean) => {
      audioService!.setBeepEnabled(enabled);
      return { success: true };
    });
  }
  ```
  
  ```typescript
  // electron/main.ts (업데이트)
  import { registerAudioHandlers } from './ipc/audioHandlers';
  
  app.whenReady().then(() => {
    const mainWindow = createMainWindow();
    
    // ... 기존 핸들러들
    registerAudioHandlers(mainWindow);
  });
  ```

- [x] **3.4. Preload API 확장** ✅ 완료
  ```typescript
  // electron/preload.ts (업데이트)
  import { AUDIO_CHANNELS, IPC_CHANNELS } from './ipc/channels';
  
  contextBridge.exposeInMainWorld('api', {
    // ... 기존 API들
    
    // 오디오 모니터링 API
    audio: {
      startMonitoring: () => ipcRenderer.invoke(AUDIO_CHANNELS.START_MONITORING),
      stopMonitoring: () => ipcRenderer.invoke(AUDIO_CHANNELS.STOP_MONITORING),
      getStatus: () => ipcRenderer.invoke(AUDIO_CHANNELS.GET_STATUS),
      setVolumeLevel: (level: number) => ipcRenderer.invoke(AUDIO_CHANNELS.SET_VOLUME_LEVEL, level),
      setBeepEnabled: (enabled: boolean) => ipcRenderer.invoke(AUDIO_CHANNELS.SET_BEEP_ENABLED, enabled),
      
      // 이벤트 리스너
      onStatusChange: (callback: (status: any) => void) => {
        ipcRenderer.on(IPC_CHANNELS.AUDIO_STATUS, (_, status) => callback(status));
      },
      onHarmfulDetected: (callback: (data: any) => void) => {
        ipcRenderer.on(IPC_CHANNELS.AUDIO_HARMFUL_DETECTED, (_, data) => callback(data));
      }
    }
  });
  ```
  
  ```typescript
  // renderer/src/global.d.ts (업데이트)
  interface Window {
    api: {
      // ... 기존 API들
      
      audio: {
        startMonitoring: () => Promise<{ success: boolean; error?: string }>;
        stopMonitoring: () => Promise<{ success: boolean }>;
        getStatus: () => Promise<{
          isMonitoring: boolean;
          volumeLevel: number;
          beepEnabled: boolean;
        }>;
        setVolumeLevel: (level: number) => Promise<{ success: boolean }>;
        setBeepEnabled: (enabled: boolean) => Promise<{ success: boolean }>;
        onStatusChange: (callback: (status: any) => void) => void;
        onHarmfulDetected: (callback: (data: any) => void) => void;
      };
    };
  }
  ```

### Phase 4: UI 컴포넌트 구현 (테스트 및 설정)

- [x] **4.1. 오디오 모니터링 제어 UI** ✅ 완료
  ```tsx
  // renderer/src/components/AudioMonitor.tsx
  import React, { useState, useEffect } from 'react';
  
  export function AudioMonitor() {
    const [status, setStatus] = useState({
      isMonitoring: false,
      volumeLevel: 5,
      beepEnabled: false
    });
    const [harmfulEvents, setHarmfulEvents] = useState<any[]>([]);
    
    useEffect(() => {
      // 상태 변경 리스너
      window.api.audio.onStatusChange((newStatus) => {
        setStatus(newStatus);
      });
      
      // 유해 감지 리스너
      window.api.audio.onHarmfulDetected((data) => {
        console.log('⚠️ Harmful detected:', data);
        setHarmfulEvents(prev => [...prev, data]);
      });
      
      // 초기 상태 로드
      window.api.audio.getStatus().then(setStatus);
    }, []);
    
    const handleStartStop = async () => {
      if (status.isMonitoring) {
        await window.api.audio.stopMonitoring();
      } else {
        await window.api.audio.startMonitoring();
      }
    };
    
    const handleVolumeChange = async (level: number) => {
      await window.api.audio.setVolumeLevel(level);
    };
    
    const handleBeepToggle = async () => {
      await window.api.audio.setBeepEnabled(!status.beepEnabled);
    };
    
    return (
      <div className="p-4 bg-gray-100 rounded-lg">
        <h2 className="text-xl font-bold mb-4">🎤 음성 모니터링</h2>
        
        {/* 시작/중지 버튼 */}
        <button
          onClick={handleStartStop}
          className={`px-4 py-2 rounded ${
            status.isMonitoring ? 'bg-red-500' : 'bg-green-500'
          } text-white font-bold`}
        >
          {status.isMonitoring ? '🛑 중지' : '▶️ 시작'}
        </button>
        
        {/* 볼륨 레벨 설정 */}
        <div className="mt-4">
          <label className="block mb-2">볼륨 레벨 (0~10): {status.volumeLevel}</label>
          <input
            type="range"
            min="0"
            max="10"
            value={status.volumeLevel}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            className="w-full"
          />
        </div>
        
        {/* 비프음 설정 */}
        <div className="mt-4">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={status.beepEnabled}
              onChange={handleBeepToggle}
              className="mr-2"
            />
            비프음 활성화
          </label>
        </div>
        
        {/* 유해 감지 로그 */}
        <div className="mt-4">
          <h3 className="font-bold mb-2">유해 감지 로그:</h3>
          <div className="bg-white p-2 rounded max-h-40 overflow-y-auto">
            {harmfulEvents.length === 0 ? (
              <p className="text-gray-500">감지된 유해 표현이 없습니다.</p>
            ) : (
              harmfulEvents.map((event, index) => (
                <div key={index} className="mb-2 p-2 bg-red-50 rounded">
                  <p className="text-sm font-semibold">{event.text}</p>
                  <p className="text-xs text-gray-600">
                    신뢰도: {(event.confidence * 100).toFixed(1)}%
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }
  ```

- [x] **4.2. 메인 앱에 AudioMonitor 추가** ✅ 완료
  ```tsx
  // renderer/src/App.tsx (업데이트)
  import { AudioMonitor } from './components/AudioMonitor';
  
  function App() {
    return (
      <div className="p-8">
        {/* ... 기존 컴포넌트들 */}
        <AudioMonitor />
      </div>
    );
  }
  ```

### Phase 5: Windows 볼륨 제어 구현

✅ **완료: T26으로 마이그레이션됨**

이 Phase는 **Task 26: 앱별 볼륨 조절 마이그레이션**으로 이동하여 완료되었습니다.
- 기존 `loudness` 패키지 제거
- `native-sound-mixer` 패키지로 마이그레이션
- `AppVolumeController` 구현 완료
- `AudioService` 마이그레이션 완료

**자세한 내용**: `@docs/26-app-volume-migration.md` 참조

#### 프로세스 아키텍처 이해

**왜 Renderer에서 직접 볼륨 제어가 불가능한가?**

```
[콘솔 테스트 - ✅ 작동]
Node.js 프로세스 → 네이티브 모듈 직접 호출 → 시스템 볼륨 제어

[Electron 앱 - ❌ 작동 안 함]
Renderer Process (샌드박스)
  ↓ Context Isolation: true
  ↓ Node Integration: false
  ↓ Sandbox: true
  ❌ 네이티브 시스템 API 접근 불가
  
  ↓ 해결: IPC 통신
  
Main Process
  ↓ 네이티브 모듈 호출 가능
  ✅ 시스템 볼륨 제어
```

**보안 요구사항 (PROJECT_SPEC.md 참조)**:
- Context Isolation: `true` - 렌더러와 Node.js 환경 분리
- Node Integration: `false` - 렌더러에서 Node.js API 사용 불가
- Sandbox: `true` - 시스템 리소스 접근 제한

#### 시스템 전체 볼륨 제어 (deprecated)

⚠️ **이 방식의 문제점**:
- Chrome에서 유해 음성 감지 시 → **모든 앱(Discord, 게임 등)** 볼륨도 조절됨
- 기획서 요구사항: "음성이 발생한 프로그램 오디오 크기 조절" 불만족
- 사용자 경험 저하 (게임 중 갑자기 모든 소리가 사라짐)

<details>
<summary>참고: 시스템 볼륨 제어 코드 (사용하지 마세요)</summary>

```typescript
// ❌ 사용 금지: 시스템 전체 볼륨 조절 (문제 있음)
// electron/audio/volumeController.ts
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class SystemVolumeController {
  async setMasterVolume(volume: number): Promise<void> {
    const normalizedVolume = Math.max(0, Math.min(100, volume));
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      $wshell = new-object -com wscript.shell
      1..50 | % { $wshell.SendKeys([char]174) }  # Volume down
    `;
    
    await execAsync(`powershell -Command "${psScript}"`);
  }
}
```

**IPC 통신 구조**:
```typescript
// electron/ipc/channels.ts
export const IPC_CHANNELS = {
  AUDIO_SET_VOLUME: 'audio:setVolume',
} as const;

// electron/ipc/audioHandlers.ts
ipcMain.handle(IPC_CHANNELS.AUDIO_SET_VOLUME, async (_event, volume: number) => {
  await volumeController.setMasterVolume(volume);
  return { success: true };
});

// electron/preload.ts
contextBridge.exposeInMainWorld('api', {
  audio: {
    setVolume: (volume: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO_SET_VOLUME, volume),
  },
});
```
</details>

#### 올바른 접근 방법

✅ **Task 26: 앱별 볼륨 조절 마이그레이션**을 진행하세요:
- `native-sound-mixer` 패키지 사용
- 특정 앱(Chrome, Discord 등)만 볼륨 조절
- 기획서 요구사항 충족: "음성이 발생한 프로그램 오디오 크기 조절"

**마이그레이션 가이드**: `@docs/26-app-volume-migration.md` 참조

#### 프로세스 아키텍처 핵심 포인트

**메인 프로세스에서 볼륨 제어를 해야 하는 이유**:

1. **보안 제약** - Renderer는 샌드박스 환경에서 실행
2. **네이티브 API 접근** - 시스템 볼륨은 네이티브 API 필요
3. **IPC 통신** - 안전한 브리지 역할

```
┌─────────────────────────────────────────────────┐
│  Renderer Process (React UI)                    │
│  - 샌드박스 환경 (Context Isolation)             │
│  - 네이티브 API 접근 불가                        │
│                                                   │
│  window.api.audio.setVolume(5) 호출              │
└────────────────┬────────────────────────────────┘
                 │ IPC (invoke)
                 ↓
┌─────────────────────────────────────────────────┐
│  Main Process (Electron)                        │
│  - 네이티브 모듈 호출 가능                       │
│  - 시스템 API 접근 가능                          │
│                                                   │
│  ipcMain.handle('audio:setVolume', ...)         │
│    ↓                                              │
│  volumeController.setVolume(5)                   │
│    ↓                                              │
│  [네이티브 모듈: native-sound-mixer]              │
│    ↓                                              │
│  Windows Audio Session API (WASAPI)              │
└─────────────────────────────────────────────────┘
```

- [ ] **5.2. 비프음 재생 구현** ⏸️ 보류 (선택 사항)
  ```typescript
  // electron/audio/beepPlayer.ts
  import { Howl } from 'howler';
  
  export class BeepPlayer {
    private beepSound: Howl;
    
    constructor() {
      // 비프음 파일 경로 (resources/ 폴더에 beep.mp3 추가)
      this.beepSound = new Howl({
        src: ['resources/beep.mp3'],
        volume: 0.5
      });
    }
    
    play(): void {
      this.beepSound.play();
      console.log('🔔 Beep sound played');
    }
  }
  ```

### Phase 6: 통합 테스트 및 성능 최적화

⏳ **T26 완료 후 진행 예정**

- [ ] **6.1. End-to-End 테스트**
  ```typescript
  // 테스트 시나리오:
  // 1. 앱 실행
  // 2. AudioMonitor에서 "시작" 버튼 클릭
  // 3. 디스코드/유튜브에서 한국어 음성 재생
  // 4. 유해 표현 포함 시 로그 확인 및 볼륨 조절 확인
  // 5. 3초 이내 서버 응답 확인
  ```

- [ ] **6.2. 지연율 측정 및 최적화**
  - [ ] 각 단계별 시간 측정 (캡처 → 리샘플링 → 전송 → STT → 분류 → 응답)
  - [ ] 버퍼 크기 조정 (현재 1초 → 0.5초로 줄이기)
  - [ ] GPU 사용 시 지연율 개선 확인

- [ ] **6.3. 메모리 누수 점검**
  ```bash
  # 장시간 실행 후 메모리 사용량 모니터링
  npm run dev
  # 30분 이상 실행하며 Windows 작업 관리자에서 메모리 확인
  ```

## 🔗 관련 파일

### 생성된 파일
- ✅ `electron/audio/audioProcessor.ts` - 오디오 리샘플링/모노 변환
- ✅ `electron/audio/audioStreamClient.ts` - WebSocket 클라이언트
- ✅ `electron/audio/audioService.ts` - 오디오 모니터링 서비스
- ✅ `electron/audio/appVolumeController.ts` - 앱별 볼륨 제어 (T26 마이그레이션)
- ✅ `electron/audio/volumeController.ts.backup` - 기존 볼륨 제어 백업
- ✅ `electron/audio/beepPlayer.ts` - 비프음 재생 (스텁)
- ✅ `electron/ipc/audioHandlers.ts` - IPC 핸들러
- ✅ `renderer/src/components/AudioMonitor.tsx` - UI 컴포넌트
- ✅ `electron/test/test_audio_capture.ts` - 오디오 캡처 테스트
- ✅ `electron/test/test_audio_processor.ts` - 오디오 프로세서 테스트
- ✅ `electron/test/test_streaming.ts` - 스트리밍 테스트
- ✅ `electron/test/test_native_sound_mixer.ts` - native-sound-mixer 테스트

### 수정된 파일
- ✅ `electron/ipc/channels.ts` - 오디오 IPC 채널 추가
- ✅ `electron/preload.ts` - 오디오 API 노출
- ✅ `renderer/src/global.d.ts` - 타입 정의 추가
- ✅ `electron/main.ts` - 메인 윈도우 생성 및 오디오 핸들러 등록
- ✅ `package.json` - 의존성 추가 (naudiodon2, ws, native-sound-mixer)
- ✅ `renderer/src/App.tsx` - AudioMonitor 컴포넌트 추가

## 📊 테스트 계획

| Phase | 테스트 항목 | 성공 기준 | 우선순위 |
|-------|-------------|-----------|----------|
| 1 | 오디오 캡처 | naudiodon2로 소리 캡처 확인 | High |
| 2 | 리샘플링 | 48kHz → 16kHz 변환 확인 | High |
| 3 | WebSocket 전송 | 서버에서 오디오 수신 확인 | High |
| 4 | 서버 응답 | 유해성 판별 결과 수신 | High |
| 5 | 볼륨 조절 | 유해 감지 시 볼륨 변경 (T26으로 마이그레이션됨) | High |
| 6 | 전체 파이프라인 | E2E 지연율 3초 이내 | Critical |

## ⚠️ 주의사항

1. **Windows 빌드 도구**
   - naudiodon2는 네이티브 모듈이므로 node-gyp 필요
   - 설치 실패 시: `npm install --global --production windows-build-tools`

2. **오디오 디바이스 권한**
   - Windows 마이크/오디오 권한 설정 확인
   - 일부 앱은 WASAPI Loopback을 차단할 수 있음

3. **리샘플링 품질**
   - 현재 Linear Interpolation 사용 (간단하지만 품질 낮음)
   - 프로덕션: `libsamplerate` 또는 `sox` 사용 권장

4. **WebSocket 재연결**
   - 서버 재시작 시 자동 재연결 로직 추가 필요

5. **메모리 관리**
   - 오디오 버퍼가 계속 쌓이지 않도록 주의
   - 모니터링 중지 시 모든 리소스 정리

## 📚 참고 문서

- [naudiodon2 GitHub](https://github.com/streampunk/naudiodon2)
- [WASAPI Loopback 설명](https://docs.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)
- [WebSocket Node.js Client](https://github.com/websockets/ws)

## 🔄 다음 작업

이 작업 완료 후:
- ✅ **T26: 앱별 볼륨 조절 마이그레이션** 완료
- ⏳ **Phase 6: 통합 테스트 및 성능 최적화** 진행 예정
- ⏳ **T16: 서버 알림 수신 및 블라인드 표시** 연동
  - 오디오와 텍스트(OCR) 유해성 감지 통합
  - 통합 알림 시스템 구축

---

**작업 시작 명령어 (Cursor Agent에게 제공)**:

```
작업: T25 - 음성 Electron 연동 (Windows 오디오 캡처 및 서버 연동)

1. **사전 준비**
   - T24 (음성 STT API) 완료 및 서버 실행 확인
   - @docs/PROJECT_SPEC.md에서 T25 요구사항 확인
   - @AISPNLP_종합_프로젝트_계획서.pdf의 "음성 필터 흐름도" 참조

2. **이 문서 참조**
   - @docs/25-audio-electron-integration.md의 체크리스트를 순차적으로 진행

3. **작업 지시**
   - Phase 1부터 시작: Windows 오디오 캡처 테스트
   - 각 Phase 완료 후 독립적으로 테스트 실행
   - 테스트 통과 확인 후 다음 Phase 진행
   - 최종 Phase 6에서 T24 서버와 통합 테스트
```
