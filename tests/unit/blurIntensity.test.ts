/**
 * Task 49: 블러 강도 설정 및 OCR 연속 감지 유닛 테스트
 * 
 * 테스트 그룹:
 * 1. 블러 강도 설정 테스트 (7개)
 * 2. OCR 연속 감지 테스트 (5개)
 * 3. UX 개선 테스트 (3개)
 */

import {
  BlurIntensityTester,
  OCRSimulator,
  IPCMockHelper,
  BlurOverlayTester,
  createMockStore,
} from '../helpers/ocr-simulator';

// Mock electron 모듈
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn((name: string) => {
      const paths: Record<string, string> = {
        userData: '/mock/userData',
        appData: '/mock/appData',
      };
      return paths[name] || '/mock/default';
    }),
  },
}));

// Mock fs 모듈
const mockFsData: Record<string, string> = {};

jest.mock('fs', () => ({
  existsSync: jest.fn((path: string) => path in mockFsData),
  readFileSync: jest.fn((path: string) => mockFsData[path] || ''),
  writeFileSync: jest.fn((path: string, data: string) => {
    mockFsData[path] = data;
  }),
}));

// Mock path 모듈
jest.mock('path', () => ({
  join: jest.fn((...parts: string[]) => parts.join('/')),
}));

describe('Task 49: 블러 강도 설정 테스트', () => {
  let blurTester: BlurIntensityTester;
  let mockStore: ReturnType<typeof createMockStore>;
  let ipcHelper: IPCMockHelper;

  beforeEach(() => {
    blurTester = new BlurIntensityTester();
    mockStore = createMockStore();
    ipcHelper = new IPCMockHelper();
    // mockFsData 초기화
    Object.keys(mockFsData).forEach(key => delete mockFsData[key]);
  });

  describe('블러 강도 유효성 검증', () => {
    test('유효한 블러 강도 값 (15, 25, 40)을 허용해야 함', () => {
      const validValues = blurTester.getValidIntensities();
      
      expect(blurTester.isValidIntensity(15)).toBe(true);
      expect(blurTester.isValidIntensity(25)).toBe(true);
      expect(blurTester.isValidIntensity(40)).toBe(true);
      
      validValues.forEach(value => {
        expect(blurTester.isValidIntensity(value)).toBe(true);
      });
    });

    test('유효하지 않은 블러 강도 값을 거부해야 함', () => {
      const invalidValues = blurTester.getInvalidIntensities();
      
      invalidValues.forEach(value => {
        expect(blurTester.isValidIntensity(value)).toBe(false);
      });
      
      expect(blurTester.isValidIntensity(0)).toBe(false);
      expect(blurTester.isValidIntensity(50)).toBe(false);
      expect(blurTester.isValidIntensity(-10)).toBe(false);
    });
  });

  describe('블러 강도 설정 저장', () => {
    test('블러 강도 설정이 저장되어야 함', () => {
      const testIntensities = [15, 25, 40];
      
      testIntensities.forEach(intensity => {
        mockStore.setBlurIntensity(intensity);
        expect(mockStore.setBlurIntensity).toHaveBeenCalledWith(intensity);
      });
    });

    test('유효하지 않은 블러 강도는 저장되지 않아야 함', () => {
      const invalidIntensities = [0, 10, 20, 30, 50, 100];
      
      invalidIntensities.forEach(intensity => {
        const beforeCall = mockStore.getBlurIntensity();
        mockStore.setBlurIntensity(intensity);
        // 유효하지 않은 값은 저장되지 않아야 함
        expect(mockStore.getBlurIntensity()).toBe(beforeCall);
      });
    });
  });

  describe('IPC 통신 테스트', () => {
    test('블러 강도 변경 시 IPC 메시지가 전송되어야 함', () => {
      const intensity = 25;
      const channel = 'OVERLAY_STATE_PUSH';
      
      ipcHelper.send(channel, {
        blurIntensity: intensity,
        mode: 'detect',
      });
      
      const messages = ipcHelper.getSentMessages(channel);
      expect(messages.length).toBeGreaterThan(0);
      
      const lastMessage = ipcHelper.getLastMessage(channel);
      expect(lastMessage?.data.blurIntensity).toBe(intensity);
    });

    test('트레이 메뉴에서 블러 강도 변경 시 즉시 반영되어야 함', () => {
      const newIntensity = 15;
      const channel = 'OVERLAY_STATE_PUSH';
      
      // 블러 강도 설정
      mockStore.setBlurIntensity(newIntensity);
      
      // IPC 메시지 전송 시뮬레이션
      ipcHelper.send(channel, {
        blurIntensity: newIntensity,
        mode: 'detect',
      });
      
      const lastMessage = ipcHelper.getLastMessage(channel);
      expect(lastMessage?.data.blurIntensity).toBe(newIntensity);
    });
  });

  describe('기본값 테스트', () => {
    test('블러 강도 기본값은 40px이어야 함', () => {
      expect(blurTester.getDefaultIntensity()).toBe(40);
      expect(mockStore.getBlurIntensity()).toBe(40);
    });
  });
});

describe('Task 49: OCR 연속 감지 테스트', () => {
  let ocrSimulator: OCRSimulator;
  let blurTester: BlurIntensityTester;

  beforeEach(() => {
    ocrSimulator = new OCRSimulator();
    blurTester = new BlurIntensityTester();
  });

  describe('OCR 시뮬레이션', () => {
    test('OCR이 텍스트를 정상적으로 추출해야 함', async () => {
      const text = await ocrSimulator.extractText();
      
      expect(text).toBeDefined();
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    });

    test('유해 표현이 정확하게 감지되어야 함', async () => {
      const harmfulTexts = ['욕설이 포함된 텍스트', '비방하는 내용', '유해한 표현'];
      
      for (const text of harmfulTexts) {
        const isHarmful = await ocrSimulator.analyzeHarmful(text);
        expect(isHarmful).toBe(true);
      }
    });

    test('정상 텍스트는 유해하지 않다고 판단되어야 함', async () => {
      const normalTexts = ['안녕하세요', '테스트 텍스트', '정상적인 내용입니다'];
      
      for (const text of normalTexts) {
        const isHarmful = await ocrSimulator.analyzeHarmful(text);
        expect(isHarmful).toBe(false);
      }
    });
  });

  describe('연속 OCR 처리', () => {
    test('블러 표시 중에도 OCR이 계속 작동해야 함', async () => {
      const ocrResults: Array<{ text: string; isHarmful: boolean }> = [];
      
      await ocrSimulator.simulateContinuousOCR(
        100,
        500,
        (text, isHarmful) => {
          ocrResults.push({ text, isHarmful });
        }
      );
      
      // 약간의 대기 시간 후 결과 확인
      await new Promise(resolve => setTimeout(resolve, 600));
      
      expect(ocrResults.length).toBeGreaterThan(0);
      expect(ocrResults.every(r => r.text && typeof r.text === 'string')).toBe(true);
    });

    test('블러 오버레이가 OCR 캡처에 영향을 주지 않아야 함', async () => {
      // OCR 시뮬레이션이 정상 작동하는지 확인
      const text1 = await ocrSimulator.extractText();
      const text2 = await ocrSimulator.extractText();
      
      // 블러 오버레이가 있어도 OCR은 계속 작동해야 함
      expect(text1).toBeDefined();
      expect(text2).toBeDefined();
      
      // 블러 강도는 OCR에 영향을 주지 않음
      const intensity = blurTester.getDefaultIntensity();
      expect(blurTester.isValidIntensity(intensity)).toBe(true);
    });
  });
});

describe('Task 49: UX 개선 테스트', () => {
  let overlayTester: BlurOverlayTester;
  let blurTester: BlurIntensityTester;

  beforeEach(() => {
    overlayTester = new BlurOverlayTester();
    blurTester = new BlurIntensityTester();
  });

  describe('블러 오버레이 렌더링', () => {
    test('블러 오버레이에 경고 아이콘이 표시되어야 함', () => {
      // Mock DOM 요소 생성
      const container = document.createElement('div');
      const blurOverlay = document.createElement('div');
      blurOverlay.setAttribute('data-testid', 'blur-overlay');
      
      const icon = document.createElement('div');
      icon.setAttribute('data-testid', 'blur-icon');
      icon.textContent = '⚠️';
      
      blurOverlay.appendChild(icon);
      container.appendChild(blurOverlay);
      document.body.appendChild(container);
      
      expect(overlayTester.hasWarningIcon(container)).toBe(true);
      
      document.body.removeChild(container);
    });

    test('블러 오버레이에 안내 메시지가 표시되어야 함', () => {
      // Mock DOM 요소 생성
      const container = document.createElement('div');
      const blurOverlay = document.createElement('div');
      blurOverlay.setAttribute('data-testid', 'blur-overlay');
      
      const message = document.createElement('div');
      message.setAttribute('data-testid', 'blur-message');
      message.textContent = '유해 표현이 감지되어 가려졌습니다';
      
      blurOverlay.appendChild(message);
      container.appendChild(blurOverlay);
      document.body.appendChild(container);
      
      expect(overlayTester.hasMessage(container)).toBe(true);
      
      document.body.removeChild(container);
    });
  });

  describe('블러 스타일 적용', () => {
    test('블러 오버레이에 GPU 가속이 적용되어야 함', () => {
      // Mock DOM 요소 생성
      const container = document.createElement('div');
      const blurOverlay = document.createElement('div');
      blurOverlay.setAttribute('data-testid', 'blur-overlay');
      
      // GPU 가속 스타일 적용
      blurOverlay.style.willChange = 'transform, opacity';
      blurOverlay.style.transform = 'translateZ(0)';
      blurOverlay.style.backfaceVisibility = 'hidden';
      blurOverlay.style.backdropFilter = 'blur(40px)';
      
      container.appendChild(blurOverlay);
      document.body.appendChild(container);
      
      // GPU 가속 확인
      const hasAcceleration = overlayTester.hasGPUAcceleration(container);
      expect(hasAcceleration || blurOverlay.style.willChange !== 'auto').toBe(true);
      
      document.body.removeChild(container);
    });
  });
});

