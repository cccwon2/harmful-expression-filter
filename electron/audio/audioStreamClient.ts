/**
 * Phase 2: WebSocket 오디오 스트리밍 클라이언트
 * 
 * FastAPI 서버로 오디오 데이터를 전송하고 응답을 수신합니다.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface AudioStreamResponse {
  status?: string;
  text?: string;
  is_harmful?: boolean | number; // 서버는 int로 보냄 (0 또는 1)
  confidence?: number;
  timestamp?: number;
  raw_text?: string;
  audio_duration_sec?: number;
  processing_time_ms?: number;
  detail?: string; // 에러 메시지
}

export class AudioStreamClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // 1초
  
  constructor(serverUrl = 'ws://localhost:8000/ws/audio') {
    super();
    this.serverUrl = serverUrl;
  }
  
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl);
        
        this.ws.on('open', () => {
          console.log('✅ WebSocket connected to server');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          resolve();
        });
        
        this.ws.on('message', (data: Buffer) => {
          try {
            const text = data.toString();
            // 서버가 연결 시 "Connected" 텍스트를 보낼 수 있음
            if (text === 'Connected' || text.trim() === 'Connected') {
              console.log('[AudioStreamClient] Server connection confirmed');
              return;
            }
            const response: AudioStreamResponse = JSON.parse(text);
            this.emit('response', response);
          } catch (err) {
            console.error('Failed to parse server response:', err);
            console.error('Raw data:', data.toString().substring(0, 100));
          }
        });
        
        this.ws.on('error', (err) => {
          console.error('WebSocket error:', err);
          this.emit('error', err);
          if (!this.isConnected) {
            reject(err);
          }
        });
        
        this.ws.on('close', () => {
          console.log('WebSocket closed');
          this.isConnected = false;
          this.emit('close');
          
          // 자동 재연결 시도
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            setTimeout(() => {
              this.connect().catch(console.error);
            }, this.reconnectDelay * this.reconnectAttempts);
          }
        });
      } catch (err) {
        reject(err);
      }
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
  
  getConnectionStatus(): boolean {
    return this.isConnected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

