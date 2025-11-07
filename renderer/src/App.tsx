import React, { useEffect, useState } from 'react';

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
        padding: '40px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f5f5f5',
      }}
    >
      <h1
        style={{
          fontSize: '2.5rem',
          color: '#2563eb',
          marginBottom: '1rem',
          fontWeight: 'bold',
        }}
      >
        Hello from Renderer
      </h1>
      <p
        style={{
          fontSize: '1.2rem',
          color: '#666',
          marginBottom: '0.5rem',
        }}
      >
        Vite + React + TypeScript
      </p>
      {appVersion && (
        <p
          style={{
            fontSize: '1rem',
            color: '#2563eb',
            fontWeight: '500',
          }}
        >
          App Version: {appVersion}
        </p>
      )}
    </div>
  );
};

