'use client';

import { useEffect, useState } from 'react';
import { fetchHealth, type HealthResponse } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Server, Cpu, Mic } from 'lucide-react';

export function DashboardStats() {
    const [health, setHealth] = useState<HealthResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadHealth = async () => {
            try {
                setLoading(true);
                const data = await fetchHealth();
                setHealth(data);
                setError(null);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Unknown error');
            } finally {
                setLoading(false);
            }
        };

        loadHealth();

        // 30초마다 자동 갱신
        const interval = setInterval(loadHealth, 30000);
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return <div className="p-4 text-center">Loading server stats...</div>;
    }

    if (error) {
        return (
            <Card className="border-red-200 bg-red-50">
                <CardContent className="pt-6">
                    <div className="text-red-500 flex items-center gap-2">
                        <Server className="h-5 w-5" />
                        <span>Connection Error: {error}</span>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (!health) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Server Status
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-500">Status</span>
                        <Badge variant={health.status === 'ok' ? 'default' : 'destructive'} className={health.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}>
                            {health.status.toUpperCase()}
                        </Badge>
                    </div>

                    <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-500 flex items-center gap-1">
                            <Cpu className="h-4 w-4" /> AI Model
                        </span>
                        <span className="font-medium">{health.ai_model}</span>
                    </div>

                    <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-500 flex items-center gap-1">
                            <Mic className="h-4 w-4" /> STT Service
                        </span>
                        <span className="font-medium">{health.stt_service}</span>
                    </div>

                    <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-500">Mode</span>
                        <span className="font-medium">{health.mode}</span>
                    </div>

                    {health.threshold !== undefined && (
                        <div className="flex justify-between items-center pt-2 border-t">
                            <span className="text-sm font-medium text-gray-500">Threshold</span>
                            <Badge variant="outline">{health.threshold}</Badge>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
