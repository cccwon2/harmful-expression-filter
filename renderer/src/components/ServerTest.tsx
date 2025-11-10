import React, { useState } from 'react';

type EmptyObject = Record<string, never>;

export const ServerTest: React.FC<EmptyObject> = () => {
  const [healthStatus, setHealthStatus] = useState<string>('');
  const [testText, setTestText] = useState<string>('');
  const [analyzeResult, setAnalyzeResult] = useState<string>('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const handleHealthCheck = async () => {
    setLoading(true);
    try {
      const result = await window.api.server.healthCheck();

      if ('error' in result) {
        setHealthStatus(`ERROR: ${result.message}`);
      } else {
        const lines = [
          'Server status: OK',
          `Keywords loaded: ${result.keywords_loaded}`,
          `STT engine: ${result.stt_loaded ? 'enabled' : 'disabled'}`,
          `AI model: ${result.ai_model_loaded ? 'enabled' : 'disabled'}`,
        ];
        setHealthStatus(lines.join('\n'));
      }
    } catch (error) {
      setHealthStatus(`EXCEPTION: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!testText.trim()) {
      window.alert('분석할 텍스트를 입력하세요.');
      return;
    }

    setLoading(true);
    try {
      const result = await window.api.server.analyzeText(testText);

      if ('error' in result) {
        setAnalyzeResult(`ERROR: ${result.message}`);
      } else {
        const verdict = result.has_violation ? 'ALERT: Harmful expression detected.' : 'OK: Safe.';
        const confidence = `Confidence: ${(result.confidence * 100).toFixed(0)}%`;
        const matches = `Matched keywords: ${result.matched_keywords.join(', ') || 'none'}`;
        const duration = `Processing time: ${result.processing_time.toFixed(2)} ms`;
        const method = `Method: ${result.method}`;
        setAnalyzeResult([verdict, confidence, matches, duration, method].join('\n'));
      }
    } catch (error) {
      setAnalyzeResult(`EXCEPTION: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGetKeywords = async () => {
    setLoading(true);
    try {
      const result = await window.api.server.getKeywords();

      if ('error' in result) {
        window.alert(`오류: ${result.message}`);
      } else {
        setKeywords(result.keywords);
      }
    } catch (error) {
      window.alert(`예외 발생: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: 'monospace' }}>
      <h1>Server connectivity diagnostics</h1>

      <section style={{ marginBottom: 24 }}>
        <h2>1. Health check</h2>
        <button onClick={handleHealthCheck} disabled={loading} style={{ padding: '10px 18px' }}>
          {loading ? 'Checking...' : 'Check server'}
        </button>
        {healthStatus && (
          <pre
            style={{
              marginTop: 12,
              padding: 12,
              background: '#f0f0f0',
              whiteSpace: 'pre-wrap',
            }}
          >
            {healthStatus}
          </pre>
        )}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>2. Text analysis</h2>
        <div style={{ marginBottom: 12 }}>
          <input
            type="text"
            value={testText}
            onChange={(event) => setTestText(event.target.value)}
            placeholder="텍스트를 입력하세요..."
            style={{ width: '100%', padding: 10, fontSize: 16, marginBottom: 8 }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                handleAnalyze();
              }
            }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setTestText('안녕하세요')}>정상 예시</button>
            <button onClick={() => setTestText('욕설 테스트')}>유해 예시</button>
            <button onClick={() => setTestText('욕설 비방 혐오')}>복합 예시</button>
          </div>
        </div>
        <button
          onClick={handleAnalyze}
          disabled={loading || !testText.trim()}
          style={{ padding: '10px 18px' }}
        >
          {loading ? 'Analyzing...' : 'Analyze'}
        </button>
        {analyzeResult && (
          <pre
            style={{
              marginTop: 12,
              padding: 12,
              background: analyzeResult.startsWith('ALERT') ? '#ffe0e0' : '#e0ffe0',
              whiteSpace: 'pre-wrap',
            }}
          >
            {analyzeResult}
          </pre>
        )}
      </section>

      <section>
        <h2>3. Keyword list</h2>
        <button onClick={handleGetKeywords} disabled={loading} style={{ padding: '10px 18px' }}>
          {loading ? 'Loading...' : 'Fetch keywords'}
        </button>
        {keywords.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p>
              <strong>Total {keywords.length} keywords</strong>
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {keywords.map((kw) => (
                <span
                  key={kw}
                  style={{
                    padding: '4px 8px',
                    background: '#d14343',
                    color: '#ffffff',
                    borderRadius: 4,
                    fontSize: 14,
                  }}
                >
                  {kw}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

