/**
 * FastAPI 서버 유해 표현 분석 클라이언트
 * 
 * STT 결과 텍스트를 FastAPI 서버로 전송하여 유해 표현을 분석합니다.
 * 
 * 사용 예:
 *   const result = await sendTextForAnalysis("테스트 텍스트");
 *   if (result.isHarmful) {
 *     console.log("유해 표현 감지:", result.matchedKeywords);
 *   }
 */

import axios, { AxiosError } from 'axios';

const SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:8000';
const REQUEST_TIMEOUT = 5000;

export interface AnalysisResult {
  /** 유해 표현이 감지되었는지 여부 */
  isHarmful: boolean;
  /** 신뢰도 (0.0 ~ 1.0) */
  confidence: number;
  /** 매칭된 키워드 목록 */
  matchedKeywords: string[];
  /** 분석 방법 (예: "keyword", "ai", "empty_text") */
  method: string;
  /** 처리 시간 (밀리초) */
  processingTime: number;
}

export interface AnalysisError {
  error: true;
  message: string;
  code?: string;
  status?: number;
}

/**
 * 텍스트를 FastAPI 서버로 전송하여 유해 표현 분석 수행
 * 
 * @param text 분석할 텍스트
 * @param useAI AI 모델 사용 여부 (기본값: false, 키워드 기반만 사용)
 * @param filterMode 필터 모드 ('ocr' | 'voice', 기본값: 'voice')
 * @returns 분석 결과 또는 에러
 */
export async function sendTextForAnalysis(
  text: string,
  useAI: boolean = false,
  filterMode: "ocr" | "voice" = "voice"
): Promise<AnalysisResult | AnalysisError> {
  try {
    // 빈 텍스트 처리
    if (!text || text.trim().length === 0) {
      return {
        isHarmful: false,
        confidence: 0.0,
        matchedKeywords: [],
        method: 'empty_text',
        processingTime: 0,
      };
    }

    // ✅ UUID 헤더 추가
    const { getDeviceId } = require("../utils/deviceId");
    const deviceId = getDeviceId();
    const headers = {
      'Content-Type': 'application/json',
      'UUID': deviceId,  // 헤더 키를 UUID로 전달
    };
    
    const response = await axios.post<{
      has_violation: boolean;
      confidence: number;
      matched_keywords: string[];
      method: string;
      processing_time: number;
    }>(
      `${SERVER_URL}/analyze`,
      { text: text.trim(), use_ai: useAI, filter_mode: filterMode },
      {
        timeout: REQUEST_TIMEOUT,
        headers,
      }
    );

    const result: AnalysisResult = {
      isHarmful: response.data.has_violation,
      confidence: response.data.confidence,
      matchedKeywords: response.data.matched_keywords,
      method: response.data.method,
      processingTime: response.data.processing_time,
    };

    console.log('[HarmfulAnalysis] 텍스트 분석 완료:', {
      text: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      isHarmful: result.isHarmful,
      matchedKeywords: result.matchedKeywords,
      processingTime: `${result.processingTime.toFixed(2)}ms`,
    });

    return result;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      console.error('[HarmfulAnalysis] 서버 요청 실패:', {
        message: axiosError.message,
        code: axiosError.code,
        status: axiosError.response?.status,
        url: axiosError.config?.url,
      });

      return {
        error: true,
        message: axiosError.message,
        code: axiosError.code,
        status: axiosError.response?.status,
      };
    }

    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[HarmfulAnalysis] 알 수 없는 오류:', err);
    return {
      error: true,
      message: err.message,
    };
  }
}

/**
 * 서버 연결 상태 확인
 * 
 * @returns 서버가 정상적으로 응답하는지 여부
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const response = await axios.get<{
      status: string;
      keywords_loaded: number;
      stt_loaded: boolean;
      ai_model_loaded: boolean;
    }>(`${SERVER_URL}/health`, {
      timeout: 2000,
    });

    const isOk = response.data.status === 'ok';
    if (isOk) {
      console.log('[HarmfulAnalysis] 서버 상태 정상:', {
        keywords: response.data.keywords_loaded,
        stt: response.data.stt_loaded,
        ai: response.data.ai_model_loaded,
      });
    } else {
      console.warn('[HarmfulAnalysis] 서버 상태가 "ok"가 아님:', response.data);
    }

    return isOk;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      console.error('[HarmfulAnalysis] 서버 연결 실패:', {
        message: axiosError.message,
        code: axiosError.code,
        status: axiosError.response?.status,
      });
    } else {
      console.error('[HarmfulAnalysis] 서버 연결 실패 (알 수 없는 오류):', error);
    }
    return false;
  }
}

