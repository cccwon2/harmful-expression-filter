import React from 'react';

type Mode = 'ocr' | 'voice';

export const ModeSelection: React.FC = () => {
  const [selectedMode, setSelectedMode] = React.useState<Mode | null>(null);

  const handleModeSelect = (mode: Mode) => {
    if (window.api?.dashboard?.selectMode) {
      window.api.dashboard.selectMode(mode);
      setSelectedMode(mode);
    }
  };

  // 이미 모드가 선택된 경우 선택 화면을 숨김
  if (selectedMode) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#121212',
          color: '#ffffff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '16px' }}>
            {selectedMode === 'ocr' ? '👁️ OCR 모드' : '🎙️ 음성 모드'} 활성화됨
          </h2>
          <p style={{ color: '#9ca3af' }}>필터링이 시작되었습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#121212',
        color: '#ffffff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '32px',
      }}
    >
      <header
        style={{
          textAlign: 'center',
          marginBottom: '64px',
        }}
      >
        <h1
          style={{
            fontSize: '3rem',
            fontWeight: 700,
            margin: '0 0 16px 0',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          OnVoice
        </h1>
        <p style={{ fontSize: '1.25rem', color: '#9ca3af', margin: 0 }}>
          필터링 모드를 선택하세요
        </p>
      </header>

      <div
        style={{
          display: 'flex',
          gap: '32px',
          flexWrap: 'wrap',
          justifyContent: 'center',
          maxWidth: '800px',
        }}
      >
        {/* OCR 모드 선택 */}
        <button
          onClick={() => handleModeSelect('ocr')}
          style={{
            flex: '1',
            minWidth: '300px',
            padding: '48px 32px',
            backgroundColor: '#1f2937',
            border: '2px solid #374151',
            borderRadius: '16px',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
            color: '#ffffff',
            fontSize: '1.1rem',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#374151';
            e.currentTarget.style.borderColor = '#4b5563';
            e.currentTarget.style.transform = 'translateY(-4px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#1f2937';
            e.currentTarget.style.borderColor = '#374151';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <span style={{ fontSize: '4rem' }}>👁️</span>
          <div style={{ textAlign: 'center' }}>
            <h2
              style={{
                fontSize: '1.5rem',
                fontWeight: 600,
                margin: '0 0 8px 0',
              }}
            >
              OCR 필터링
            </h2>
            <p
              style={{
                fontSize: '0.95rem',
                color: '#9ca3af',
                margin: 0,
                lineHeight: '1.5',
              }}
            >
              화면의 텍스트를 실시간으로 감지하고
              <br />
              유해 표현을 차단합니다
            </p>
          </div>
        </button>

        {/* 음성 모드 선택 */}
        <button
          onClick={() => handleModeSelect('voice')}
          style={{
            flex: '1',
            minWidth: '300px',
            padding: '48px 32px',
            backgroundColor: '#1f2937',
            border: '2px solid #374151',
            borderRadius: '16px',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
            color: '#ffffff',
            fontSize: '1.1rem',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#374151';
            e.currentTarget.style.borderColor = '#4b5563';
            e.currentTarget.style.transform = 'translateY(-4px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#1f2937';
            e.currentTarget.style.borderColor = '#374151';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <span style={{ fontSize: '4rem' }}>🎙️</span>
          <div style={{ textAlign: 'center' }}>
            <h2
              style={{
                fontSize: '1.5rem',
                fontWeight: 600,
                margin: '0 0 8px 0',
              }}
            >
              음성 필터링
            </h2>
            <p
              style={{
                fontSize: '0.95rem',
                color: '#9ca3af',
                margin: 0,
                lineHeight: '1.5',
              }}
            >
              음성 채팅을 실시간으로 감지하고
              <br />
              유해 표현을 차단합니다
            </p>
          </div>
        </button>
      </div>
    </div>
  );
};

