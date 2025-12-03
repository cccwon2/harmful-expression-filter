const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface HealthResponse {
    status: string;
    stt_service: string;
    ai_model: string;
    mode: string;
    threshold?: number;
    threshold_source?: string;
}

export interface AnalyzeRequest {
    text: string;
    user_id?: string;
}

export interface AnalyzeResponse {
    has_violation: boolean;
    ai_analysis: {
        is_harmful: boolean;
        confidence: number;
        threshold_used?: number;
    } | null;
}

export interface KeywordsResponse {
    keywords: string[];
}

/**
 * 서버 상태 확인
 */
export async function fetchHealth(): Promise<HealthResponse> {
    const response = await fetch(`${API_URL}/health`);
    if (!response.ok) {
        throw new Error(`Health check failed: ${response.statusText}`);
    }
    return response.json();
}

/**
 * 텍스트 분석
 */
export async function analyzeText(text: string, userId?: string): Promise<AnalyzeResponse> {
    const response = await fetch(`${API_URL}/analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text, user_id: userId }),
    });

    if (!response.ok) {
        throw new Error(`Analysis failed: ${response.statusText}`);
    }

    const data = await response.json();

    // 서버 응답(Flat structure)을 프론트엔드 구조(Nested structure)로 매핑
    return {
        has_violation: data.is_harmful,
        ai_analysis: {
            is_harmful: data.is_harmful,
            confidence: data.confidence,
            threshold_used: data.threshold_used
        }
    };
}

/**
 * 키워드 목록 조회
 */
export async function getKeywords(): Promise<KeywordsResponse> {
    const response = await fetch(`${API_URL}/keywords`);
    if (!response.ok) {
        throw new Error(`Keywords fetch failed: ${response.statusText}`);
    }
    return response.json();
}
