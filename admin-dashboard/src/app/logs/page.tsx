'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Log {
    id: number;
    created_at: string;
    text: string;
    confidence: number;
    model_type: string;
    threshold_used: number;
    is_harmful: boolean;
    user_id: string | null;
}

export default function LogsPage() {
    const [logs, setLogs] = useState<Log[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchLogs();
    }, []);

    const fetchLogs = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('logs')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setLogs(data || []);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container mx-auto p-8">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-3xl font-bold">유해 표현 감지 로그</h1>
                <button
                    onClick={fetchLogs}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                    새로고침
                </button>
            </div>

            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                    {error}
                </div>
            )}

            {loading ? (
                <div>로딩 중...</div>
            ) : (
                <div className="grid gap-4">
                    {logs.map((log) => (
                        <Card key={log.id}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    {new Date(log.created_at).toLocaleString()}
                                </CardTitle>
                                <Badge variant={log.is_harmful ? "destructive" : "secondary"}>
                                    {log.is_harmful ? "유해" : "정상"}
                                </Badge>
                            </CardHeader>
                            <CardContent>
                                <p className="text-lg font-semibold mb-2">{log.text}</p>
                                <div className="text-sm text-gray-500 grid grid-cols-2 gap-2">
                                    <div>신뢰도: {(log.confidence * 100).toFixed(1)}%</div>
                                    <div>모델: {log.model_type}</div>
                                    <div>Threshold: {log.threshold_used}</div>
                                    <div>User ID: {log.user_id || '-'}</div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                    {logs.length === 0 && (
                        <div className="text-center text-gray-500 py-8">
                            로그가 없습니다.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
