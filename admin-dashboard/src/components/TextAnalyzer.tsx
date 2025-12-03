'use client';

import { useState } from 'react';
import { analyzeText, type AnalyzeResponse } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle, Search, Loader2 } from 'lucide-react';

export function TextAnalyzer() {
    const [text, setText] = useState('');
    const [userId, setUserId] = useState('');
    const [result, setResult] = useState<AnalyzeResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleAnalyze = async () => {
        if (!text.trim()) return;

        try {
            setLoading(true);
            setError(null);
            const data = await analyzeText(text, userId || undefined);
            setResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Analysis failed');
            setResult(null);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card className="h-full">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Search className="h-5 w-5" />
                    Text Analysis Test
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <input
                        type="text"
                        value={userId}
                        onChange={(e) => setUserId(e.target.value)}
                        placeholder="User ID (optional)"
                        className="w-full p-2 border rounded text-sm"
                    />
                    <Textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Enter text to analyze..."
                        className="min-h-[120px]"
                    />
                    <Button
                        onClick={handleAnalyze}
                        disabled={loading || !text.trim()}
                        className="w-full"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Analyzing...
                            </>
                        ) : (
                            'Analyze Text'
                        )}
                    </Button>
                </div>

                {error && (
                    <div className="p-4 rounded-lg bg-red-50 text-red-600 text-sm">
                        Error: {error}
                    </div>
                )}

                {result && (
                    <div className="p-4 rounded-lg bg-slate-50 border space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="font-medium text-sm text-gray-600">Result</span>
                            <Badge
                                variant={result.has_violation ? "destructive" : "default"}
                                className={result.has_violation ? "bg-red-500" : "bg-green-500"}
                            >
                                {result.has_violation ? (
                                    <span className="flex items-center gap-1">
                                        <AlertCircle className="h-3 w-3" /> Harmful
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1">
                                        <CheckCircle className="h-3 w-3" /> Safe
                                    </span>
                                )}
                            </Badge>
                        </div>

                        {result.ai_analysis && (
                            <div className="space-y-2 pt-2 border-t">
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Confidence</span>
                                    <span className="font-mono">{(result.ai_analysis.confidence * 100).toFixed(2)}%</span>
                                </div>
                                {result.ai_analysis.threshold_used !== undefined && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Threshold Used</span>
                                        <span className="font-mono">{result.ai_analysis.threshold_used}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
