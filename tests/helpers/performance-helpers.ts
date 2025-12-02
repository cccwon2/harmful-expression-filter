/**
 * 성능 테스트 헬퍼 유틸리티
 * Task 48 성능 최적화 테스트 지원
 */

// IPC 통신 최적화 테스터 클래스
export class IPCPerformanceTester {
  private sentMessages: Array<{ channel: string; data: any; timestamp: number }> = [];
  private lastSentState: string | null = null;

  /**
   * IPC 메시지 전송 시뮬레이션 (중복 전송 방지 로직 포함)
   */
  sendWithDeduplication(channel: string, data: any): boolean {
    // 상태 직렬화
    const serializedState = JSON.stringify(data);

    // 중복 체크
    if (serializedState === this.lastSentState) {
      // 중복된 상태는 전송하지 않음
      return false;
    }

    // 메시지 전송
    this.sentMessages.push({
      channel,
      data,
      timestamp: Date.now(),
    });

    this.lastSentState = serializedState;
    return true;
  }

  /**
   * IPC 메시지 스로틀링 테스트
   */
  sendWithThrottling(channel: string, data: any, intervalMs: number = 100): boolean {
    const messages = this.getSentMessages(channel);
    
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      const timeSinceLastMessage = Date.now() - lastMessage.timestamp;
      
      if (timeSinceLastMessage < intervalMs) {
        // 스로틀링 제한에 걸림
        return false;
      }
    }

    this.sentMessages.push({
      channel,
      data,
      timestamp: Date.now(),
    });
    return true;
  }

  /**
   * 전송된 메시지 가져오기
   */
  getSentMessages(channel?: string): Array<{ channel: string; data: any; timestamp: number }> {
    if (channel) {
      return this.sentMessages.filter(msg => msg.channel === channel);
    }
    return [...this.sentMessages];
  }

  /**
   * 중복 전송 방지 효과 측정
   */
  measureDeduplicationEffect(
    channel: string,
    dataGenerator: () => any,
    iterations: number = 100
  ): { sent: number; blocked: number; efficiency: number } {
    this.clearMessages();
    
    let sent = 0;
    let blocked = 0;

    for (let i = 0; i < iterations; i++) {
      const data = dataGenerator();
      const wasSent = this.sendWithDeduplication(channel, data);
      
      if (wasSent) {
        sent++;
      } else {
        blocked++;
      }
    }

    const efficiency = (blocked / iterations) * 100;

    return { sent, blocked, efficiency };
  }

  /**
   * 스로틀링 효과 측정
   */
  measureThrottlingEffect(
    channel: string,
    dataGenerator: () => any,
    intervalMs: number = 100,
    durationMs: number = 1000
  ): { sent: number; blocked: number; avgInterval: number } {
    this.clearMessages();
    
    let sent = 0;
    let blocked = 0;
    const startTime = Date.now();

    while (Date.now() - startTime < durationMs) {
      const data = dataGenerator();
      const wasSent = this.sendWithThrottling(channel, data, intervalMs);
      
      if (wasSent) {
        sent++;
      } else {
        blocked++;
      }
      
      // 작은 딜레이로 빠른 연속 호출 시뮬레이션
      if (!wasSent) {
        // 스로틀링으로 막혔을 때는 대기
        const messages = this.getSentMessages(channel);
        if (messages.length > 0) {
          const lastMessage = messages[messages.length - 1];
          const waitTime = intervalMs - (Date.now() - lastMessage.timestamp);
          if (waitTime > 0) {
            // 실제로는 await 하지 않고, 단순히 blocked 카운트만 증가
          }
        }
      }
    }

    const messages = this.getSentMessages(channel);
    const intervals: number[] = [];
    for (let i = 1; i < messages.length; i++) {
      intervals.push(messages[i].timestamp - messages[i - 1].timestamp);
    }
    const avgInterval = intervals.length > 0
      ? intervals.reduce((a, b) => a + b, 0) / intervals.length
      : 0;

    return { sent, blocked, avgInterval };
  }

  /**
   * 전송된 메시지 초기화
   */
  clearMessages(): void {
    this.sentMessages = [];
    this.lastSentState = null;
  }
}

// React 렌더링 성능 테스터 클래스
export class ReactPerformanceTester {
  private renderCounts: Map<string, number> = new Map();
  private renderTimestamps: Map<string, number[]> = new Map();

  /**
   * 렌더링 카운트 증가
   */
  incrementRenderCount(componentName: string): void {
    const current = this.renderCounts.get(componentName) || 0;
    this.renderCounts.set(componentName, current + 1);

    const timestamps = this.renderTimestamps.get(componentName) || [];
    timestamps.push(Date.now());
    this.renderTimestamps.set(componentName, timestamps);
  }

  /**
   * 렌더링 카운트 가져오기
   */
  getRenderCount(componentName: string): number {
    return this.renderCounts.get(componentName) || 0;
  }

  /**
   * 렌더링 주기 계산 (ms)
   */
  getAverageRenderInterval(componentName: string): number {
    const timestamps = this.renderTimestamps.get(componentName) || [];
    if (timestamps.length < 2) return 0;

    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    return intervals.reduce((a, b) => a + b, 0) / intervals.length;
  }

  /**
   * 모든 카운트 초기화
   */
  reset(): void {
    this.renderCounts.clear();
    this.renderTimestamps.clear();
  }
}

// OCR 성능 테스터 클래스
export class OCRPerformanceTester {
  private captureTimestamps: number[] = [];
  private intervals: number[] = [];
  private lastText: string | null = null;
  private currentInterval: number = 500; // 최소 간격 (ms)
  private readonly MIN_INTERVAL_MS = 500;
  private readonly MAX_INTERVAL_MS = 2000;
  private readonly IDLE_INCREMENT_MS = 200;
  private consecutiveIdleCount = 0;

  /**
   * 적응형 인터벌 OCR 캡처 시뮬레이션
   */
  captureWithAdaptiveInterval(text: string | null): number {
    const now = Date.now();
    this.captureTimestamps.push(now);

    // 텍스트 변경 감지
    const isTextChanged = text !== this.lastText;
    this.lastText = text;

    if (isTextChanged && text) {
      // 텍스트가 변경되면 활성 상태: 최소 간격으로 리셋
      this.currentInterval = this.MIN_INTERVAL_MS;
      this.consecutiveIdleCount = 0;
    } else if (!text || text === this.lastText) {
      // 텍스트가 없거나 동일하면 유휴 상태: 간격 증가
      this.consecutiveIdleCount++;
      this.currentInterval = Math.min(
        this.MIN_INTERVAL_MS + (this.consecutiveIdleCount * this.IDLE_INCREMENT_MS),
        this.MAX_INTERVAL_MS
      );
    }

    // 간격 기록
    if (this.captureTimestamps.length > 1) {
      const lastIndex = this.captureTimestamps.length - 1;
      const interval = this.captureTimestamps[lastIndex] - this.captureTimestamps[lastIndex - 1];
      this.intervals.push(interval);
    }

    return this.currentInterval;
  }

  /**
   * 평균 캡처 간격 계산 (ms)
   */
  getAverageInterval(): number {
    if (this.intervals.length === 0) return 0;
    return this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length;
  }

  /**
   * 최소/최대 간격 확인
   */
  getIntervalRange(): { min: number; max: number; current: number } {
    return {
      min: this.MIN_INTERVAL_MS,
      max: this.MAX_INTERVAL_MS,
      current: this.currentInterval,
    };
  }

  /**
   * 초기화
   */
  reset(): void {
    this.captureTimestamps = [];
    this.intervals = [];
    this.lastText = null;
    this.currentInterval = this.MIN_INTERVAL_MS;
    this.consecutiveIdleCount = 0;
  }
}

// GPU 가속 테스터 클래스
export class GPUAccelerationTester {
  /**
   * GPU 가속 CSS 속성 확인
   */
  hasGPUAcceleration(element: HTMLElement | null): boolean {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    
    return (
      style.willChange !== 'auto' ||
      style.transform !== 'none' ||
      style.backfaceVisibility === 'hidden'
    );
  }

  /**
   * GPU 가속 속성 상세 확인
   */
  getGPUAccelerationDetails(element: HTMLElement | null): {
    willChange: string;
    transform: string;
    backfaceVisibility: string;
    hasAcceleration: boolean;
  } {
    if (!element) {
      return {
        willChange: 'auto',
        transform: 'none',
        backfaceVisibility: 'visible',
        hasAcceleration: false,
      };
    }

    const style = window.getComputedStyle(element);
    // jsdom 환경에서는 getComputedStyle로 일부 속성을 가져올 수 없을 수 있음
    // 인라인 스타일에서 먼저 확인하고, 없으면 computed style 사용
    const backfaceVisibility = element.style.backfaceVisibility || style.backfaceVisibility || 'visible';
    
    return {
      willChange: style.willChange || element.style.willChange || 'auto',
      transform: style.transform || element.style.transform || 'none',
      backfaceVisibility,
      hasAcceleration: this.hasGPUAcceleration(element),
    };
  }

  /**
   * requestAnimationFrame 사용 확인 (간접 측정)
   */
  async measureRAFPerformance(callback: () => void, iterations: number = 100): Promise<{
    avgFrameTime: number;
    framesPerSecond: number;
  }> {
    const frameTimes: number[] = [];
    let lastTime = performance.now();

    return new Promise((resolve) => {
      let count = 0;

      const measureFrame = () => {
        const currentTime = performance.now();
        const frameTime = currentTime - lastTime;
        frameTimes.push(frameTime);
        lastTime = currentTime;

        callback();
        count++;

        if (count < iterations) {
          requestAnimationFrame(measureFrame);
        } else {
          const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
          const framesPerSecond = 1000 / avgFrameTime;
          resolve({ avgFrameTime, framesPerSecond });
        }
      };

      requestAnimationFrame(measureFrame);
    });
  }
}

// 메모리 누수 테스터 클래스
export class MemoryLeakTester {
  private eventListeners: Map<string, Function[]> = new Map();
  private timers: Set<ReturnType<typeof setTimeout>> = new Set();
  private rafIds: Set<number> = new Set();

  /**
   * 이벤트 리스너 등록
   */
  addEventListener(target: EventTarget, event: string, handler: Function): () => void {
    const key = `${target.constructor.name}-${event}`;
    if (!this.eventListeners.has(key)) {
      this.eventListeners.set(key, []);
    }
    this.eventListeners.get(key)!.push(handler);

    target.addEventListener(event, handler as EventListener);

    // cleanup 함수 반환
    return () => {
      target.removeEventListener(event, handler as EventListener);
      const handlers = this.eventListeners.get(key);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
        if (handlers.length === 0) {
          this.eventListeners.delete(key);
        }
      }
    };
  }

  /**
   * 타이머 등록
   */
  addTimer(timerId: ReturnType<typeof setTimeout>): void {
    this.timers.add(timerId);
  }

  /**
   * requestAnimationFrame ID 등록
   */
  addRAFId(rafId: number): void {
    this.rafIds.add(rafId);
  }

  /**
   * 모든 리스너 정리 확인
   */
  verifyCleanup(): {
    eventListeners: number;
    timers: number;
    rafIds: number;
    isClean: boolean;
  } {
    return {
      eventListeners: this.eventListeners.size,
      timers: this.timers.size,
      rafIds: this.rafIds.size,
      isClean: this.eventListeners.size === 0 && this.timers.size === 0 && this.rafIds.size === 0,
    };
  }

  /**
   * 초기화
   */
  reset(): void {
    this.eventListeners.clear();
    this.timers.clear();
    this.rafIds.clear();
  }
}

// 유틸리티 함수
export const createPerformanceTestHelpers = () => ({
  ipc: new IPCPerformanceTester(),
  react: new ReactPerformanceTester(),
  ocr: new OCRPerformanceTester(),
  gpu: new GPUAccelerationTester(),
  memory: new MemoryLeakTester(),
});

