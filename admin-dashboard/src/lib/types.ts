export type ServerStatus = 'ok' | 'error' | 'loading';

export interface DashboardStats {
    serverStatus: ServerStatus;
    modelInfo: {
        aiModel: string;
        sttService: string;
        mode: string;
    };
    lastChecked: Date | null;
}

export interface AnalysisResult {
    text: string;
    isHarmful: boolean;
    confidence: number;
    timestamp: Date;
}
