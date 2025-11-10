import { ipcMain } from 'electron';
import axios, { AxiosError } from 'axios';
import { SERVER_CHANNELS } from './channels';

const SERVER_URL = 'http://127.0.0.1:8000';
const REQUEST_TIMEOUT = 5000;

interface HealthResponse {
  status: string;
  keywords_loaded: number;
  stt_loaded: boolean;
  ai_model_loaded: boolean;
}

interface AnalyzeResponse {
  has_violation: boolean;
  confidence: number;
  matched_keywords: string[];
  method: string;
  processing_time: number;
}

interface KeywordsResponse {
  total: number;
  keywords: string[];
}

type ErrorResponse = {
  error: true;
  message: string;
  code?: string;
  status?: number;
};

function handleServerError(error: unknown, context: string): ErrorResponse {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    console.error(`[${context}] 서버 오류:`, {
      message: axiosError.message,
      code: axiosError.code,
      status: axiosError.response?.status,
      data: axiosError.response?.data,
    });

    return {
      error: true,
      message: axiosError.message,
      code: axiosError.code,
      status: axiosError.response?.status,
    };
  }

  console.error(`[${context}] 알 수 없는 오류:`, error);
  return {
    error: true,
    message: error instanceof Error ? error.message : 'Unknown error',
  };
}

export function registerServerHandlers(): void {
  console.log('[IPC] 서버 IPC 핸들러 등록 중...');

  ipcMain.handle(
    SERVER_CHANNELS.HEALTH_CHECK,
    async (): Promise<HealthResponse | ErrorResponse> => {
      try {
        const response = await axios.get<HealthResponse>(`${SERVER_URL}/health`, {
          timeout: REQUEST_TIMEOUT,
        });
        console.log('[IPC] 서버 헬스 체크 성공:', response.data);
        return response.data;
      } catch (error) {
        return handleServerError(error, 'Health Check');
      }
    },
  );

  ipcMain.handle(
    SERVER_CHANNELS.ANALYZE_TEXT,
    async (_event, text: string): Promise<AnalyzeResponse | ErrorResponse> => {
      try {
        if (!text || text.trim().length === 0) {
          return {
            has_violation: false,
            confidence: 0.0,
            matched_keywords: [],
            method: 'empty_text',
            processing_time: 0,
          };
        }

        const response = await axios.post<AnalyzeResponse>(
          `${SERVER_URL}/analyze`,
          { text, use_ai: false },
          {
            timeout: REQUEST_TIMEOUT,
            headers: { 'Content-Type': 'application/json' },
          },
        );

        console.log('[IPC] 텍스트 분석 완료:', {
          violation: response.data.has_violation,
          matched: response.data.matched_keywords,
          time: `${response.data.processing_time.toFixed(2)}ms`,
        });

        return response.data;
      } catch (error) {
        return handleServerError(error, 'Analyze Text');
      }
    },
  );

  ipcMain.handle(
    SERVER_CHANNELS.GET_KEYWORDS,
    async (): Promise<KeywordsResponse | ErrorResponse> => {
      try {
        const response = await axios.get<KeywordsResponse>(`${SERVER_URL}/keywords`, {
          timeout: REQUEST_TIMEOUT,
        });
        console.log(`[IPC] 키워드 ${response.data.total}개 로드 완료`);
        return response.data;
      } catch (error) {
        return handleServerError(error, 'Get Keywords');
      }
    },
  );

  console.log('[IPC] 서버 IPC 핸들러 등록 완료');
}

export async function checkServerConnection(): Promise<boolean> {
  try {
    const response = await axios.get<HealthResponse>(`${SERVER_URL}/health`, {
      timeout: 2000,
    });
    return response.data.status === 'ok';
  } catch (error) {
    console.error('[IPC] 서버 연결 실패:', error);
    return false;
  }
}

