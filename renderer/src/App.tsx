import React, { useEffect, useState } from 'react';
import { ServerTest } from './components/ServerTest';
import { AudioMonitor } from './components/AudioMonitor';

export const App: React.FC = () => {
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    // window.api?.appVersion 접근 테스트
    if (window.api?.appVersion) {
      setAppVersion(window.api.appVersion);
    }
  }, []);

  return (
    <div
      style={{
        padding: '32px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        gap: '32px',
        minHeight: '100vh',
        backgroundColor: '#f5f5f5',
      }}
    >
      <header
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
        }}
      >
        <h1 style={{ fontSize: '2.4rem', color: '#2563eb', fontWeight: 700, margin: 0 }}>
          Harmful Expression Filter
        </h1>
        <p style={{ fontSize: '1.1rem', color: '#555', margin: 0 }}>Vite + React + TypeScript</p>
        {appVersion && (
          <p style={{ fontSize: '0.95rem', color: '#2563eb', fontWeight: 500, margin: 0 }}>
            App Version: {appVersion}
          </p>
        )}
      </header>

      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '32px',
        }}
      >
        <div
          style={{
            background: '#ffffff',
            borderRadius: 12,
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.08)',
          }}
        >
          <ServerTest />
        </div>
        
        <div
          style={{
            background: '#ffffff',
            borderRadius: 12,
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.08)',
          }}
        >
          <AudioMonitor />
        </div>
      </main>
    </div>
  );
};

