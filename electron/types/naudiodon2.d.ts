/**
 * naudiodon2 타입 선언 (임시)
 * 
 * naudiodon2 패키지가 설치되면 이 파일은 삭제하거나 실제 타입 정의로 교체할 수 있습니다.
 */

declare module 'naudiodon2' {
  export interface AudioDevice {
    id: number;
    name: string;
    maxInputChannels: number;
    maxOutputChannels: number;
    defaultSampleRate: number;
    defaultLowInputLatency: number;
    defaultLowOutputLatency: number;
    defaultHighInputLatency: number;
    defaultHighOutputLatency: number;
  }

  export interface AudioIOOptions {
    inOptions?: {
      channelCount?: number;
      sampleFormat?: number;
      sampleRate?: number;
      deviceId?: number;
      closeOnError?: boolean;
    };
    outOptions?: {
      channelCount?: number;
      sampleFormat?: number;
      sampleRate?: number;
      deviceId?: number;
      closeOnError?: boolean;
    };
  }

  export class AudioIO {
    constructor(options: AudioIOOptions);
    start(): void;
    quit(): void;
    on(event: 'data', callback: (chunk: Buffer) => void): void;
    on(event: 'error', callback: (error: Error) => void): void;
  }

  export function getDevices(): AudioDevice[];
}

