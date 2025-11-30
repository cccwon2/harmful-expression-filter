import React, { useEffect, useState } from 'react';
import { ServerTest } from './components/ServerTest';
import { AudioMonitor } from './components/AudioMonitor';

export const App: React.FC = () => {
  const [appVersion, setAppVersion] = useState<string>('');
  const [isOcrEnabled, setIsOcrEnabled] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [windowStatus, setWindowStatus] = useState<{
    isOcrEnabled: boolean;
    isVoiceEnabled: boolean;
    isOverlayVisible: boolean;
  } | null>(null);

  useEffect(() => {
    // window.api?.appVersion 접근 테스트
    if (window.api?.appVersion) {
      setAppVersion(window.api.appVersion);
    }

    // 초기 윈도우 상태 조회
    if (window.api?.dashboard?.getWindowStatus) {
      window.api.dashboard.getWindowStatus().then((status) => {
        setWindowStatus(status);
        setIsOcrEnabled(status.isOcrEnabled);
        setIsVoiceEnabled(status.isVoiceEnabled);
      });
    }
  }, []);

  const toggleOCR = (enabled: boolean) => {
    if (window.api?.dashboard?.toggleOCR) {
      window.api.dashboard.toggleOCR(enabled);
      setIsOcrEnabled(enabled);
    }
  };

  const toggleVoice = (enabled: boolean) => {
    if (window.api?.dashboard?.toggleVoice) {
      window.api.dashboard.toggleVoice(enabled);
      setIsVoiceEnabled(enabled);
    }
  };

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
          OnVoice Dashboard
        </h1>
        <p style={{ fontSize: '1.1rem', color: '#555', margin: 0 }}>음성 및 화면 필터링 제어</p>
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
        {/* 기능 토글 섹션 */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: 12,
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.08)',
            padding: '24px',
          }}
        >
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '0 0 20px 0' }}>
            필터링 제어
          </h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* 음성 필터링 토글 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '1.5rem' }}>🎙️</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '1rem' }}>음성 필터링</div>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    실시간 음성 채팅 필터링
                  </div>
                </div>
              </div>
              <label
                style={{
                  position: 'relative',
                  display: 'inline-block',
                  width: '52px',
                  height: '28px',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={isVoiceEnabled}
                  onChange={(e) => toggleVoice(e.target.checked)}
                  style={{
                    opacity: 0,
                    width: 0,
                    height: 0,
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: isVoiceEnabled ? '#2563eb' : '#d1d5db',
                    borderRadius: '28px',
                    transition: 'background-color 0.3s',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      content: '""',
                      height: '22px',
                      width: '22px',
                      left: '3px',
                      bottom: '3px',
                      backgroundColor: 'white',
                      borderRadius: '50%',
                      transition: 'transform 0.3s',
                      transform: isVoiceEnabled ? 'translateX(24px)' : 'translateX(0)',
                    }}
                  />
                </span>
              </label>
            </div>

            {/* OCR 필터링 토글 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '1.5rem' }}>👁️</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '1rem' }}>화면 (OCR) 필터링</div>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    화면 텍스트 실시간 감지 및 필터링
                  </div>
                </div>
              </div>
              <label
                style={{
                  position: 'relative',
                  display: 'inline-block',
                  width: '52px',
                  height: '28px',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={isOcrEnabled}
                  onChange={(e) => toggleOCR(e.target.checked)}
                  style={{
                    opacity: 0,
                    width: 0,
                    height: 0,
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: isOcrEnabled ? '#2563eb' : '#d1d5db',
                    borderRadius: '28px',
                    transition: 'background-color 0.3s',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      content: '""',
                      height: '22px',
                      width: '22px',
                      left: '3px',
                      bottom: '3px',
                      backgroundColor: 'white',
                      borderRadius: '50%',
                      transition: 'transform 0.3s',
                      transform: isOcrEnabled ? 'translateX(24px)' : 'translateX(0)',
                    }}
                  />
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* 상태 카드 섹션 */}
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

