import { ipcMain } from "electron";
import axios, { AxiosError } from "axios";
import { SERVER_CHANNELS } from "./channels";
import { getThreshold } from "../store";

// SERVER_URL은 main.ts에서 dotenv로 로드된 환경 변수 사용
const REQUEST_TIMEOUT = 5000;

function getServerUrl(): string {
  return process.env.SERVER_URL || "http://127.0.0.1:8000";
}

interface HealthResponse {
  status: string;
  keywords_loaded?: number;
  stt_loaded?: boolean;
  ai_model_loaded?: boolean;
  stt_service?: string;
  ai_model?: string;
  mode?: string;
  threshold?: number;
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
    message: error instanceof Error ? error.message : "Unknown error",
  };
}

export function registerServerHandlers(): void {
  console.log("[IPC] 서버 IPC 핸들러 등록 중...");

  const resolvedServerUrl = getServerUrl();
  console.log("[ServerHandlers] SERVER_URL:", resolvedServerUrl);
  console.log("[ServerHandlers] process.env.SERVER_URL:", process.env.SERVER_URL || "(설정 안 됨)");
  console.log("[ServerHandlers] NODE_ENV:", process.env.NODE_ENV || "(설정 안 됨)");

  ipcMain.handle(SERVER_CHANNELS.HEALTH_CHECK, async (): Promise<HealthResponse | ErrorResponse> => {
    // ✅ 수정됨: 변수 선언을 try 블록 밖으로 이동하여 catch 블록에서도 접근 가능하게 함
    const serverUrl = getServerUrl();

    try {
      const url = `${serverUrl}/health`;
      console.log("[IPC] 헬스 체크 요청:", url);
      console.log("[IPC] 현재 SERVER_URL:", serverUrl);
      const response = await axios.get<HealthResponse>(url, {
        timeout: REQUEST_TIMEOUT,
      });
      console.log("[IPC] 서버 헬스 체크 성공:", response.data);
      return response.data;
    } catch (error) {
      console.error("[IPC] 헬스 체크 실패:", error);
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        console.error("[IPC] 에러 상세:", {
          message: axiosError.message,
          code: axiosError.code,
          status: axiosError.response?.status,
          url: axiosError.config?.url,
          serverUrl: serverUrl, // ✅ 이제 여기서 접근 가능합니다.
        });
        if (axiosError.code === "ECONNREFUSED") {
          console.error("[IPC] ⚠️ 서버 연결 거부 - 서버가 실행 중인지 확인하세요");
        }
      }
      return handleServerError(error, "Health Check");
    }
  });

  ipcMain.handle(
    SERVER_CHANNELS.ANALYZE_TEXT,
    async (_event, text: string, userId?: string, filterMode?: "ocr" | "voice"): Promise<AnalyzeResponse | ErrorResponse> => {
      try {
        if (!text || text.trim().length === 0) {
          return {
            has_violation: false,
            confidence: 0.0,
            matched_keywords: [],
            method: "empty_text",
            processing_time: 0,
          };
        }

        const serverUrl = getServerUrl();
        
        // 저장된 threshold 값 가져오기
        const threshold = getThreshold();
        const url = threshold !== null
          ? `${serverUrl}/analyze?threshold=${threshold}`
          : `${serverUrl}/analyze`;
        
        // ✅ Header에 user_id 추가 (서버에서 detection_logs에 저장하기 위해)
        const { getDeviceId } = require("../utils/deviceId");
        const deviceId = getDeviceId();
        const finalUserId = userId || deviceId;
        const headers = {
          "Content-Type": "application/json",
          "user_id": finalUserId,  // 전달된 userId 우선, 없으면 deviceId 사용
        };
        
        console.log("[IPC] 📤 Header에 user_id 추가:", finalUserId);

        const response = await axios.post<AnalyzeResponse>(
          url,
          {
            text,
            user_id: userId || deviceId,  // Request Body에도 포함 (하위 호환성)
            // ✅ 필터 모드(ocr / voice 등)를 함께 전달
            filter_mode: filterMode,
          },
          {
            timeout: REQUEST_TIMEOUT,
            headers,
          }
        );

        console.log("[IPC] 텍스트 분석 완료:", {
          violation: response.data.has_violation,
          matched: response.data.matched_keywords,
          time: `${response.data.processing_time.toFixed(2)}ms`,
        });

        return response.data;
      } catch (error) {
        return handleServerError(error, "Analyze Text");
      }
    }
  );

  ipcMain.handle(SERVER_CHANNELS.GET_KEYWORDS, async (): Promise<KeywordsResponse | ErrorResponse> => {
    try {
      const serverUrl = getServerUrl();
      const response = await axios.get<KeywordsResponse>(`${serverUrl}/keywords`, {
        timeout: REQUEST_TIMEOUT,
      });
      console.log(`[IPC] 키워드 ${response.data.total}개 로드 완료`);
      return response.data;
    } catch (error) {
      return handleServerError(error, "Get Keywords");
    }
  });

  // Threshold 값 가져오기 (서버의 /health 엔드포인트에서 threshold 값 추출)
  ipcMain.handle(SERVER_CHANNELS.GET_THRESHOLD, async (): Promise<number | ErrorResponse> => {
    try {
      const serverUrl = getServerUrl();
      const response = await axios.get<HealthResponse>(`${serverUrl}/health`, {
        timeout: REQUEST_TIMEOUT,
      });
      
      // 서버에서 threshold 값 가져오기
      if (response.data.threshold !== undefined && response.data.threshold !== null) {
        const serverThreshold = response.data.threshold;
        console.log(`[IPC] 서버 Threshold 값: ${serverThreshold}`);
        return serverThreshold;
      }
      
      // 서버에 threshold 값이 없으면 로컬 스토어에서 가져오기
      const localThreshold = getThreshold();
      if (localThreshold !== null) {
        console.log(`[IPC] 로컬 Threshold 값: ${localThreshold}`);
        return localThreshold;
      }
      
      // 둘 다 없으면 기본값 반환
      console.log(`[IPC] Threshold 값 없음, 기본값 0.5 반환`);
      return 0.5;
    } catch (error) {
      console.error("[IPC] Threshold 가져오기 실패:", error);
      // 에러가 발생하면 로컬 스토어에서 가져오기 시도
      const localThreshold = getThreshold();
      if (localThreshold !== null) {
        return localThreshold;
      }
      return handleServerError(error, "Get Threshold");
    }
  });

  // OCR 전용 핸들러 (서버 PaddleOCR 사용)
  ipcMain.handle(
    SERVER_CHANNELS.OCR_IMAGE,
    async (_event, imageBuffer: Buffer): Promise<{ success: boolean; data?: any; error?: string }> => {
      try {
        const FormData = require("form-data");
        const serverUrl = getServerUrl();

        console.log("[IPC] 서버 OCR 요청:", imageBuffer.length, "bytes");

        const formData = new FormData();
        formData.append("file", imageBuffer, {
          filename: "screenshot.png",
          contentType: "image/png",
        });

        const response = await axios.post(`${serverUrl}/api/ocr`, formData, {
          headers: formData.getHeaders(),
          timeout: REQUEST_TIMEOUT * 3, // OCR은 더 오래 걸릴 수 있으므로 타임아웃 연장
        });

        return {
          success: true,
          data: response.data,
        };
      } catch (error: any) {
        console.error("[IPC] 서버 OCR 요청 실패:", error.message);
        const errorResponse = handleServerError(error, "OCR");
        return {
          success: false,
          error: errorResponse.message,
        };
      }
    }
  );

  // OCR + 유해성 분석 통합 핸들러 (서버 PaddleOCR 사용)
  ipcMain.handle(
    SERVER_CHANNELS.OCR_AND_ANALYZE,
    async (
      _event,
      imageBuffer: Buffer,
      roi?: { x: number; y: number; width: number; height: number }
    ): Promise<{ success: boolean; data?: any; error?: string }> => {
      try {
        const FormData = require("form-data");
        const serverUrl = getServerUrl();

        console.log("[IPC] 서버 OCR + 분석 요청:", imageBuffer.length, "bytes");

        const formData = new FormData();
        formData.append("file", imageBuffer, {
          filename: "screenshot.png",
          contentType: "image/png",
        });

        // ✅ Header에 user_id 추가 (서버에서 detection_logs에 저장하기 위해)
        const { getDeviceId } = require("../utils/deviceId");
        const deviceId = getDeviceId();
        console.log("[IPC] 📤 OCR+Analyze 요청 - Header에 user_id 추가:", deviceId);
        const headers = {
          ...formData.getHeaders(),
          "user_id": deviceId,
        };

        const response = await axios.post(`${serverUrl}/api/ocr-and-analyze`, formData, {
          headers,
          timeout: REQUEST_TIMEOUT * 3, // OCR + 분석은 더 오래 걸릴 수 있으므로 타임아웃 연장
        });

        return {
          success: true,
          data: response.data,
        };
      } catch (error: any) {
        console.error("[IPC] 서버 OCR+분석 요청 실패:", error.message);
        const errorResponse = handleServerError(error, "OCR+Analyze");
        return {
          success: false,
          error: errorResponse.message,
        };
      }
    }
  );

  console.log("[IPC] 서버 IPC 핸들러 등록 완료");
}

export async function checkServerConnection(): Promise<boolean> {
  try {
    const serverUrl = getServerUrl();
    const url = `${serverUrl}/health`;
    console.log("[IPC] 서버 연결 확인 시도:", url);
    const response = await axios.get<HealthResponse>(url, {
      timeout: 2000,
    });
    console.log("[IPC] 서버 응답:", response.data);
    const isOk = response.data.status === "ok";
    if (!isOk) {
      console.warn('[IPC] 서버 상태가 "ok"가 아님:', response.data);
    }
    return isOk;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      console.error("[IPC] 서버 연결 실패:", {
        message: axiosError.message,
        code: axiosError.code,
        status: axiosError.response?.status,
        statusText: axiosError.response?.statusText,
        url: axiosError.config?.url,
      });
    } else {
      console.error("[IPC] 서버 연결 실패 (알 수 없는 오류):", error);
    }
    return false;
  }
}
