/**
 * OnVoice COM Bridge Module
 * 
 * OnVoiceAudioBridge.OnVoiceCapture COM 객체를 Node.js에서 사용하기 위한 재사용 가능한 브리지 모듈
 * winax를 사용하여 COM 이벤트를 처리하고 PCM 오디오 데이터를 콜백으로 전달합니다.
 */

import * as winax from 'winax';

export interface CreateOnVoiceCaptureOptions {
  /** COM 객체 ProgID (기본값: "OnVoiceAudioBridge.OnVoiceCapture") */
  progId?: string;
  /** 
   * 프로세스 ID 찾기 방법
   * - 'edge': Edge 프로세스 자동 검색 (FindEdgeProcess)
   * - 'chrome': Chrome 프로세스 자동 검색 (FindChromeProcess)
   * - 'discord': Discord 프로세스 자동 검색 (FindDiscordProcess)
   * - number: 직접 PID 지정
   * - function: 커스텀 검색 함수
   */
  findPid?: 'edge' | 'chrome' | 'discord' | number | ((capture: any) => number);
  /** PCM 오디오 데이터 수신 콜백 (Buffer) */
  onData: (buf: Buffer) => void;
  /** 에러 콜백 (선택) */
  onError?: (err: Error) => void;
}

export interface OnVoiceCaptureHandle {
  /** 캡처 시작 */
  start(): void;
  /** 캡처 중지 */
  stop(): void;
  /** 리소스 정리 (stop + unadvise + release + clearInterval) */
  dispose(): void;
  /** 원본 COM 객체 참조 */
  capture: any;
  /** 현재 캡처 상태 */
  isCapturing: boolean;
}

/**
 * OnVoice COM 객체를 생성하고 이벤트를 구독하는 함수
 * 
 * @param options 설정 옵션
 * @returns OnVoiceCaptureHandle 인스턴스
 */
export function createOnVoiceCapture(
  options: CreateOnVoiceCaptureOptions
): OnVoiceCaptureHandle {
  const {
    progId = 'OnVoiceAudioBridge.OnVoiceCapture',
    findPid = 'edge',
    onData,
    onError,
  } = options;

  let capture: any = null;
  let connectionPoint: any = null;
  let cookie: number | null = null;
  let messagePumpInterval: NodeJS.Timeout | null = null;
  let isCapturing = false;

  // COM 객체 생성
  try {
    capture = new winax.Object(progId);
    console.log(`[OnVoiceBridge] COM 객체 생성 성공: ${progId}`);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[OnVoiceBridge] COM 객체 생성 실패:`, error);
    if (onError) {
      onError(error);
    }
    throw error;
  }

  // Connection Points 검사
  const connectionPoints = winax.getConnectionPoints(capture);
  if (!connectionPoints || connectionPoints.length === 0) {
    const error = new Error('Connection Points를 찾을 수 없습니다. COM 객체가 이벤트를 지원하지 않습니다.');
    console.error(`[OnVoiceBridge] ${error.message}`);
    if (onError) {
      onError(error);
    }
    throw error;
  }

  connectionPoint = connectionPoints[0];
  console.log(`[OnVoiceBridge] Connection Point 발견: ${connectionPoints.length}개`);

  // 이벤트 리스너 객체
  const eventSink = {
    OnAudioData: (data: any) => {
      try {
        if (!data) return;

        // 데이터를 Buffer로 정규화
        let buf: Buffer;
        if (Buffer.isBuffer(data)) {
          buf = data;
        } else if (Array.isArray(data)) {
          buf = Buffer.from(data);
        } else if (data.buffer) {
          // TypedArray인 경우
          buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        } else {
          // 기타 경우
          buf = Buffer.from(data);
        }

        if (buf.length > 0) {
          onData(buf);
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('[OnVoiceBridge] OnAudioData 이벤트 처리 오류:', error);
        if (onError) {
          onError(error);
        }
      }
    },
  };

  // 이벤트 구독 (advise)
  try {
    cookie = connectionPoint.advise(eventSink);
    console.log(`[OnVoiceBridge] 이벤트 구독 성공 (Cookie: ${cookie})`);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[OnVoiceBridge] 이벤트 구독 실패:', error);
    if (onError) {
      onError(error);
    }
    throw error;
  }

  // COM 메시지 펌프 시작 (50ms 간격)
  messagePumpInterval = setInterval(() => {
    try {
      winax.peekAndDispatchMessages();
    } catch (err) {
      console.error('[OnVoiceBridge] peekAndDispatchMessages 오류:', err);
    }
  }, 50);

  // PID 찾기 함수
  const resolvePid = (): number => {
    if (typeof findPid === 'number') {
      return findPid;
    } else if (typeof findPid === 'function') {
      return findPid(capture);
    } else if (findPid === 'edge') {
      try {
        const pid = capture.FindEdgeProcess();
        console.log(`[OnVoiceBridge] Edge 프로세스 PID: ${pid}`);
        return pid;
      } catch (err) {
        console.error('[OnVoiceBridge] FindEdgeProcess 실패:', err);
        return 0;
      }
    } else if (findPid === 'chrome') {
      // Chrome 프로세스 찾기
      try {
        const pid = capture.FindChromeProcess();
        console.log(`[OnVoiceBridge] Chrome 프로세스 PID: ${pid}`);
        return pid;
      } catch (err) {
        console.error('[OnVoiceBridge] FindChromeProcess 실패:', err);
        return 0;
      }
    } else if (findPid === 'discord') {
      // Discord 프로세스 찾기
      try {
        const pid = capture.FindDiscordProcess();
        console.log(`[OnVoiceBridge] Discord 프로세스 PID: ${pid}`);
        return pid;
      } catch (err) {
        console.error('[OnVoiceBridge] FindDiscordProcess 실패:', err);
        return 0;
      }
    }
    return 0;
  };

  // 캡처 시작
  const start = (): void => {
    if (isCapturing) {
      console.log('[OnVoiceBridge] 이미 캡처 중입니다.');
      return;
    }

    try {
      const pid = resolvePid();
      if (pid <= 0) {
        const error = new Error(`프로세스를 찾을 수 없습니다. (PID: ${pid})`);
        console.error(`[OnVoiceBridge] ${error.message}`);
        if (onError) {
          onError(error);
        }
        return;
      }

      capture.StartCapture(pid);
      isCapturing = true;
      console.log(`[OnVoiceBridge] 캡처 시작 (PID: ${pid})`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[OnVoiceBridge] StartCapture 실패:', error);
      isCapturing = false;
      if (onError) {
        onError(error);
      }
    }
  };

  // 캡처 중지
  const stop = (): void => {
    if (!isCapturing) {
      return;
    }

    try {
      capture.StopCapture();
      isCapturing = false;
      console.log('[OnVoiceBridge] 캡처 중지');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[OnVoiceBridge] StopCapture 실패:', error);
      if (onError) {
        onError(error);
      }
    }
  };

  // 리소스 정리
  const dispose = (): void => {
    stop();

    // 이벤트 구독 해제
    if (cookie !== null && connectionPoint && typeof connectionPoint.unadvise === 'function') {
      try {
        connectionPoint.unadvise(cookie);
        console.log('[OnVoiceBridge] 이벤트 구독 해제 완료');
      } catch (err) {
        console.warn('[OnVoiceBridge] unadvise 오류 (무시 가능):', err);
      }
      cookie = null;
    }

    // 메시지 펌프 중지
    if (messagePumpInterval) {
      clearInterval(messagePumpInterval);
      messagePumpInterval = null;
      console.log('[OnVoiceBridge] 메시지 펌프 중지');
    }

    // COM 객체 해제
    if (capture) {
      try {
        winax.release(capture);
        console.log('[OnVoiceBridge] COM 객체 해제 완료');
      } catch (err) {
        console.warn('[OnVoiceBridge] COM 객체 해제 오류:', err);
      }
      capture = null;
    }
  };

  return {
    start,
    stop,
    dispose,
    capture,
    get isCapturing() {
      return isCapturing;
    },
  };
}

