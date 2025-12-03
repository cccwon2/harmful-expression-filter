/**
 * 테스트 헬퍼 유틸리티
 * Task 49 블러 강도 및 OCR 연속 감지 테스트 지원
 */

// OCR 시뮬레이터 클래스
export class OCRSimulator {
  private textHistory: string[] = [];
  private harmfulPatterns: string[] = ['욕설', '비방', '유해'];

  /**
   * OCR 텍스트 추출 시뮬레이션
   */
  async extractText(screenshot?: Buffer): Promise<string> {
    // 실제 OCR 대신 랜덤 텍스트 생성 (테스트용)
    const texts = [
      '안녕하세요',
      '테스트 텍스트',
      '정상적인 내용입니다',
      '욕설이 포함된 텍스트',
      '비방하는 내용',
      '유해한 표현',
    ];
    return texts[Math.floor(Math.random() * texts.length)];
  }

  /**
   * 유해 표현 분석 시뮬레이션
   */
  async analyzeHarmful(text: string): Promise<boolean> {
    this.textHistory.push(text);
    return this.harmfulPatterns.some(pattern => text.includes(pattern));
  }

  /**
   * 연속 OCR 시뮬레이션
   */
  async simulateContinuousOCR(
    interval: number = 100,
    duration: number = 1000,
    callback: (text: string, isHarmful: boolean) => void
  ): Promise<void> {
    const startTime = Date.now();
    const intervalId = setInterval(async () => {
      if (Date.now() - startTime >= duration) {
        clearInterval(intervalId);
        return;
      }

      const text = await this.extractText();
      const isHarmful = await this.analyzeHarmful(text);
      callback(text, isHarmful);
    }, interval);

    // duration 후 정리
    setTimeout(() => {
      clearInterval(intervalId);
    }, duration + 100);
  }

  /**
   * 텍스트 히스토리 가져오기
   */
  getTextHistory(): string[] {
    return [...this.textHistory];
  }

  /**
   * 텍스트 히스토리 초기화
   */
  clearHistory(): void {
    this.textHistory = [];
  }

  /**
   * 유해 패턴 추가
   */
  addHarmfulPattern(pattern: string): void {
    if (!this.harmfulPatterns.includes(pattern)) {
      this.harmfulPatterns.push(pattern);
    }
  }
}

// 블러 강도 테스터 클래스
export class BlurIntensityTester {
  private validIntensities = [15, 25, 40];

  /**
   * 블러 강도 유효성 검증
   */
  isValidIntensity(intensity: number): boolean {
    return this.validIntensities.includes(intensity);
  }

  /**
   * 유효한 블러 강도 값들 반환
   */
  getValidIntensities(): number[] {
    return [...this.validIntensities];
  }

  /**
   * 유효하지 않은 블러 강도 값 생성
   */
  getInvalidIntensities(): number[] {
    return [0, 10, 20, 30, 50, 100, -10];
  }

  /**
   * 블러 강도 기본값 확인
   */
  getDefaultIntensity(): number {
    return 40;
  }

  /**
   * CSS 블러 값 생성
   */
  getBlurCSS(intensity: number): string {
    if (!this.isValidIntensity(intensity)) {
      return 'blur(40px)'; // 기본값
    }
    return `blur(${intensity}px)`;
  }

  /**
   * 블러 강도별 스타일 객체 생성
   */
  getBlurStyles(intensity: number): {
    backdropFilter: string;
    WebkitBackdropFilter: string;
  } {
    const blurValue = this.getBlurCSS(intensity);
    return {
      backdropFilter: blurValue,
      WebkitBackdropFilter: blurValue,
    };
  }
}

// IPC 모킹 헬퍼 클래스
export class IPCMockHelper {
  private messageHandlers: Map<string, Function[]> = new Map();
  private sentMessages: Array<{ channel: string; data: any }> = [];

  /**
   * IPC 메시지 전송 시뮬레이션
   */
  send(channel: string, data: any): void {
    this.sentMessages.push({ channel, data });
    
    // 핸들러가 있으면 실행
    const handlers = this.messageHandlers.get(channel);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  /**
   * IPC 메시지 수신 핸들러 등록
   */
  on(channel: string, handler: Function): void {
    if (!this.messageHandlers.has(channel)) {
      this.messageHandlers.set(channel, []);
    }
    this.messageHandlers.get(channel)!.push(handler);
  }

  /**
   * 전송된 메시지 가져오기
   */
  getSentMessages(channel?: string): Array<{ channel: string; data: any }> {
    if (channel) {
      return this.sentMessages.filter(msg => msg.channel === channel);
    }
    return [...this.sentMessages];
  }

  /**
   * 특정 채널의 마지막 메시지 가져오기
   */
  getLastMessage(channel: string): { channel: string; data: any } | null {
    const messages = this.getSentMessages(channel);
    return messages.length > 0 ? messages[messages.length - 1] : null;
  }

  /**
   * 전송된 메시지 초기화
   */
  clearMessages(): void {
    this.sentMessages = [];
  }

  /**
   * 핸들러 초기화
   */
  clearHandlers(): void {
    this.messageHandlers.clear();
  }

  /**
   * 전체 초기화
   */
  reset(): void {
    this.clearMessages();
    this.clearHandlers();
  }
}

// 블러 오버레이 테스터 클래스
export class BlurOverlayTester {
  /**
   * 블러 오버레이 요소 확인
   */
  hasBlurOverlay(element: HTMLElement | null): boolean {
    if (!element) return false;
    
    const blurOverlay = element.querySelector('[data-testid="blur-overlay"]') as HTMLElement;
    if (!blurOverlay) return false;

    const style = window.getComputedStyle(blurOverlay);
    return (
      style.backdropFilter.includes('blur') ||
      (style as any).WebkitBackdropFilter?.includes('blur')
    );
  }

  /**
   * 블러 강도 확인
   */
  getBlurIntensity(element: HTMLElement | null): number | null {
    if (!element) return null;
    
    const blurOverlay = element.querySelector('[data-testid="blur-overlay"]') as HTMLElement;
    if (!blurOverlay) return null;

    const style = window.getComputedStyle(blurOverlay);
    const blurValue = style.backdropFilter || (style as any).WebkitBackdropFilter;
    
    if (!blurValue) return null;
    
    const match = blurValue.match(/blur\((\d+)px\)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * 경고 아이콘 확인
   */
  hasWarningIcon(element: HTMLElement | null): boolean {
    if (!element) return false;
    
    const icon = element.querySelector('[data-testid="blur-icon"]');
    return icon !== null;
  }

  /**
   * 안내 메시지 확인
   */
  hasMessage(element: HTMLElement | null): boolean {
    if (!element) return false;
    
    const message = element.querySelector('[data-testid="blur-message"]');
    return message !== null && message.textContent?.includes('유해 표현') === true;
  }

  /**
   * GPU 가속 확인 (will-change 속성 체크)
   */
  hasGPUAcceleration(element: HTMLElement | null): boolean {
    if (!element) return false;
    
    const blurOverlay = element.querySelector('[data-testid="blur-overlay"]') as HTMLElement;
    if (!blurOverlay) return false;

    const style = window.getComputedStyle(blurOverlay);
    return (
      style.willChange !== 'auto' ||
      style.transform !== 'none' ||
      style.backfaceVisibility === 'hidden'
    );
  }
}

// 유틸리티 함수 내보내기
export const createMockStore = () => {
  let storeData: any = {
    blurIntensity: 40,
    roi: null,
    mode: 'setup',
  };

  return {
    getBlurIntensity: jest.fn(() => storeData.blurIntensity),
    setBlurIntensity: jest.fn((intensity: number) => {
      if ([15, 25, 40].includes(intensity)) {
        storeData.blurIntensity = intensity;
      }
    }),
    getROI: jest.fn(() => storeData.roi),
    getMode: jest.fn(() => storeData.mode),
    setMode: jest.fn((mode: string) => {
      storeData.mode = mode;
    }),
    reset: () => {
      storeData = {
        blurIntensity: 40,
        roi: null,
        mode: 'setup',
      };
    },
  };
};

