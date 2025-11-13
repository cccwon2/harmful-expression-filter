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
  
  constructor(serverUrl = 'ws://127.0.0.1:8000/ws/audio') {
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
            const response: AudioStreamResponse = JSON.parse(text);
            
            // 연결 확인 메시지 처리
            if (response.status === 'connected') {
              console.log('[AudioStreamClient] Server connection confirmed:', response.message || 'Connected');
              return;
            }
            
            // 일반 응답 처리
            this.emit('response', response);
          } catch (err) {
            // JSON 파싱 실패 시 에러 로그 출력
            const text = data.toString();
            // 텍스트 메시지인 경우 (이전 버전 호환성)
            if (text.trim().startsWith('Connected')) {
              console.log('[AudioStreamClient] Server connection confirmed (text message):', text.trim());
              return;
            }
            console.error('Failed to parse server response:', err);
            console.error('Raw data:', text.substring(0, 100));
          }
        });
        
        this.ws.on('error', (err) => {
          console.error('WebSocket error:', err);
          this.emit('error', err);
          if (!this.isConnected) {
            reject(err);
          }
        });
        
        this.ws.on('close', (code: number, reason: Buffer) => {
          const reasonStr = reason ? reason.toString() : 'Unknown';
          console.log(`[AudioStreamClient] WebSocket closed: code=${code}, reason=${reasonStr}`);
          this.isConnected = false;
          this.emit('close');
          
          // 자동 재연결 시도 (정상 종료가 아닌 경우만)
          // 1000 = Normal Closure, 1001 = Going Away, 1005 = No Status
          if (code !== 1000 && code !== 1001 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`[AudioStreamClient] Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            setTimeout(() => {
              this.connect().catch(console.error);
            }, this.reconnectDelay * this.reconnectAttempts);
          } else if (code === 1000 || code === 1001) {
            console.log('[AudioStreamClient] WebSocket closed normally, not reconnecting');
            this.reconnectAttempts = 0; // 재연결 카운터 리셋
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }
  
  sendAudioChunk(audioBuffer: Buffer): void {
    if (this.ws && this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      try {
        // 오디오 버퍼 크기 확인 (디버깅)
        if (audioBuffer.length === 0) {
          console.warn('[AudioStreamClient] ⚠️ Attempted to send empty audio buffer');
          return;
        }
        
        this.ws.send(audioBuffer);
      } catch (err) {
        console.error('[AudioStreamClient] Error sending audio chunk:', err);
        // 연결이 끊어진 경우 상태 업데이트
        if (this.ws.readyState !== WebSocket.OPEN) {
          this.isConnected = false;
          this.emit('close');
        }
      }
    } else {
      // 연결이 끊어진 경우 경고만 출력 (너무 많은 로그 방지)
      if (this.ws?.readyState === WebSocket.CLOSING || this.ws?.readyState === WebSocket.CLOSED) {
        this.isConnected = false;
      }
    }
  }
  
  disconnect(): void {
    if (this.ws) {
      try {
        // 정상적인 close 프레임 전송
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.close(1000, 'Client disconnect'); // 1000 = Normal Closure
        } else {
          this.ws.terminate(); // 강제 종료
        }
      } catch (err) {
        console.error('[AudioStreamClient] Error during disconnect:', err);
      } finally {
        this.ws = null;
        this.isConnected = false;
      }
    }
  }
  
  getConnectionStatus(): boolean {
    return this.isConnected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

