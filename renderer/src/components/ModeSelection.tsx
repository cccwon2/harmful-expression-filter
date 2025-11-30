import React from 'react';

type Mode = 'ocr' | 'voice';

export const ModeSelection: React.FC = () => {
  const [selectedMode, setSelectedMode] = React.useState<Mode | null>(null);
  const [hoveredMode, setHoveredMode] = React.useState<Mode | null>(null);

  const handleModeSelect = (mode: Mode) => {
    console.log('[ModeSelection] 모드 선택 시도:', mode);
    
    if (window.api?.dashboard?.selectMode) {
      console.log('[ModeSelection] selectMode 호출:', mode);
      window.api.dashboard.selectMode(mode);
      setSelectedMode(mode);
    } else {
      console.error('[ModeSelection] selectMode API를 사용할 수 없습니다');
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
          background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)',
          color: '#ffffff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '8px', fontWeight: 600 }}>
            {selectedMode === 'ocr' ? '👁️ OCR 모드' : '🎙️ 음성 모드'} 활성화됨
          </h2>
          <p style={{ color: '#9ca3af', fontSize: '0.75rem', margin: 0 }}>필터링이 시작되었습니다.</p>
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
        background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%)',
        color: '#ffffff',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        padding: '16px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 배경 장식 */}
      <div
        style={{
          position: 'absolute',
          top: '-50%',
          left: '-50%',
          width: '200%',
          height: '200%',
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.1) 0%, transparent 70%)',
          animation: 'pulse 8s ease-in-out infinite',
        }}
      />
      
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1) rotate(0deg); opacity: 0.5; }
          50% { transform: scale(1.1) rotate(180deg); opacity: 0.8; }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
      `}</style>

      <header
        style={{
          textAlign: 'center',
          marginBottom: '20px',
          zIndex: 1,
        }}
      >
        <h1
          style={{
            fontSize: '1.25rem',
            fontWeight: 800,
            margin: '0 0 4px 0',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '-0.02em',
          }}
        >
          OnVoice
        </h1>
        <p style={{ fontSize: '0.65rem', color: '#9ca3af', margin: 0, fontWeight: 500 }}>
          필터링 모드 선택
        </p>
      </header>

      <div
        style={{
          display: 'flex',
          gap: '12px',
          width: '100%',
          maxWidth: '320px',
          zIndex: 1,
        }}
      >
        {/* OCR 모드 선택 */}
        <button
          onClick={() => handleModeSelect('ocr')}
          onMouseEnter={() => setHoveredMode('ocr')}
          onMouseLeave={() => setHoveredMode(null)}
          style={{
            flex: 1,
            padding: '14px 10px',
            background: hoveredMode === 'ocr' 
              ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)'
              : 'rgba(255, 255, 255, 0.05)',
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            border: hoveredMode === 'ocr'
              ? '1.5px solid rgba(99, 102, 241, 0.6)'
              : '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            cursor: 'pointer',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            color: '#ffffff',
            fontSize: '0.75rem',
            transform: hoveredMode === 'ocr' ? 'translateY(-3px) scale(1.02)' : 'translateY(0) scale(1)',
            boxShadow: hoveredMode === 'ocr'
              ? '0 6px 24px rgba(99, 102, 241, 0.3), 0 0 0 1px rgba(99, 102, 241, 0.1)'
              : '0 3px 12px rgba(0, 0, 0, 0.2)',
          }}
        >
          <div
            style={{
              fontSize: '1.5rem',
              filter: hoveredMode === 'ocr' ? 'drop-shadow(0 0 6px rgba(99, 102, 241, 0.6))' : 'none',
              transition: 'all 0.3s ease',
              animation: hoveredMode === 'ocr' ? 'float 2s ease-in-out infinite' : 'none',
            }}
          >
            👁️
          </div>
          <div style={{ textAlign: 'center' }}>
            <h2
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                margin: '0 0 2px 0',
                letterSpacing: '-0.01em',
              }}
            >
              OCR
            </h2>
            <p
              style={{
                fontSize: '0.6rem',
                color: '#9ca3af',
                margin: 0,
                lineHeight: '1.3',
              }}
            >
              화면 텍스트<br />실시간 감지
            </p>
          </div>
        </button>

        {/* 음성 모드 선택 */}
        <button
          onClick={() => handleModeSelect('voice')}
          onMouseEnter={() => setHoveredMode('voice')}
          onMouseLeave={() => setHoveredMode(null)}
          style={{
            flex: 1,
            padding: '14px 10px',
            background: hoveredMode === 'voice'
              ? 'linear-gradient(135deg, rgba(236, 72, 153, 0.2) 0%, rgba(219, 39, 119, 0.2) 100%)'
              : 'rgba(255, 255, 255, 0.05)',
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            border: hoveredMode === 'voice'
              ? '1.5px solid rgba(236, 72, 153, 0.6)'
              : '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            cursor: 'pointer',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            color: '#ffffff',
            fontSize: '0.75rem',
            transform: hoveredMode === 'voice' ? 'translateY(-3px) scale(1.02)' : 'translateY(0) scale(1)',
            boxShadow: hoveredMode === 'voice'
              ? '0 6px 24px rgba(236, 72, 153, 0.3), 0 0 0 1px rgba(236, 72, 153, 0.1)'
              : '0 3px 12px rgba(0, 0, 0, 0.2)',
          }}
        >
          <div
            style={{
              fontSize: '1.5rem',
              filter: hoveredMode === 'voice' ? 'drop-shadow(0 0 6px rgba(236, 72, 153, 0.6))' : 'none',
              transition: 'all 0.3s ease',
              animation: hoveredMode === 'voice' ? 'float 2s ease-in-out infinite' : 'none',
            }}
          >
            🎙️
          </div>
          <div style={{ textAlign: 'center' }}>
            <h2
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                margin: '0 0 2px 0',
                letterSpacing: '-0.01em',
              }}
            >
              음성
            </h2>
            <p
              style={{
                fontSize: '0.6rem',
                color: '#9ca3af',
                margin: 0,
                lineHeight: '1.3',
              }}
            >
              음성 채팅<br />실시간 감지
            </p>
          </div>
        </button>
      </div>
    </div>
  );
};
