/**
 * Phase 4: 오디오 모니터링 UI 컴포넌트
 * 
 * 사용자가 오디오 모니터링을 제어할 수 있는 UI를 제공합니다.
 */

import React, { useState, useEffect } from 'react';

interface AudioStatus {
  isMonitoring: boolean;
  volumeLevel: number;
  beepEnabled: boolean;
}

interface HarmfulEvent {
  text: string;
  confidence: number;
  timestamp: number;
}

export function AudioMonitor() {
  const [status, setStatus] = useState<AudioStatus>({
    isMonitoring: false,
    volumeLevel: 5,
    beepEnabled: false
  });
  const [harmfulEvents, setHarmfulEvents] = useState<HarmfulEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    // 상태 변경 리스너
    window.api.audio.onStatusChange((newStatus: AudioStatus) => {
      setStatus(newStatus);
    });
    
    // 유해 감지 리스너
    window.api.audio.onHarmfulDetected((data: HarmfulEvent) => {
      console.log('⚠️ Harmful detected:', data);
      setHarmfulEvents(prev => [...prev, data]);
    });
    
    // 초기 상태 로드
    window.api.audio.getStatus().then(setStatus).catch((err) => {
      console.error('Failed to get audio status:', err);
      setError('오디오 상태를 불러올 수 없습니다.');
    });
  }, []);
  
  const handleStartStop = async () => {
    try {
      setError(null);
      if (status.isMonitoring) {
        const result = await window.api.audio.stopMonitoring();
        if (!result.success) {
          setError('모니터링 중지 실패');
        }
      } else {
        const result = await window.api.audio.startMonitoring();
        if (!result.success) {
          setError(result.error || '모니터링 시작 실패');
        }
      }
    } catch (err: any) {
      console.error('Failed to start/stop monitoring:', err);
      setError(err.message || '오류가 발생했습니다.');
    }
  };
  
  const handleVolumeChange = async (level: number) => {
    try {
      await window.api.audio.setVolumeLevel(level);
    } catch (err) {
      console.error('Failed to set volume level:', err);
    }
  };
  
  const handleBeepToggle = async () => {
    try {
      await window.api.audio.setBeepEnabled(!status.beepEnabled);
    } catch (err) {
      console.error('Failed to toggle beep:', err);
    }
  };
  
  return (
    <div className="p-4 bg-gray-100 rounded-lg">
      <h2 className="text-xl font-bold mb-4">🎤 음성 모니터링</h2>
      
      {error && (
        <div className="mb-4 p-2 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}
      
      {/* 시작/중지 버튼 */}
      <button
        onClick={handleStartStop}
        className={`px-4 py-2 rounded font-bold text-white ${
          status.isMonitoring ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
        }`}
      >
        {status.isMonitoring ? '🛑 중지' : '▶️ 시작'}
      </button>
      
      {/* 상태 표시 */}
      <div className="mt-4">
        <p className="text-sm text-gray-600">
          상태: {status.isMonitoring ? (
            <span className="text-green-600 font-semibold">모니터링 중</span>
          ) : (
            <span className="text-gray-500">중지됨</span>
          )}
        </p>
      </div>
      
      {/* 볼륨 레벨 설정 */}
      <div className="mt-4">
        <label className="block mb-2 text-sm font-semibold">
          볼륨 레벨 (0~10): {status.volumeLevel}
        </label>
        <input
          type="range"
          min="0"
          max="10"
          value={status.volumeLevel}
          onChange={(e) => handleVolumeChange(Number(e.target.value))}
          className="w-full"
          disabled={!status.isMonitoring}
        />
        <p className="text-xs text-gray-500 mt-1">
          유해 표현 감지 시 볼륨을 이 레벨로 조절합니다.
        </p>
      </div>
      
      {/* 비프음 설정 */}
      <div className="mt-4">
        <label className="flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={status.beepEnabled}
            onChange={handleBeepToggle}
            className="mr-2"
            disabled={!status.isMonitoring}
          />
          <span className="text-sm font-semibold">비프음 활성화</span>
        </label>
        <p className="text-xs text-gray-500 mt-1">
          체크 시 볼륨 조절 대신 비프음을 재생합니다.
        </p>
      </div>
      
      {/* 유해 감지 로그 */}
      <div className="mt-4">
        <h3 className="font-bold mb-2 text-sm">유해 감지 로그:</h3>
        <div className="bg-white p-2 rounded max-h-40 overflow-y-auto border border-gray-300">
          {harmfulEvents.length === 0 ? (
            <p className="text-gray-500 text-sm">감지된 유해 표현이 없습니다.</p>
          ) : (
            harmfulEvents.map((event, index) => (
              <div key={index} className="mb-2 p-2 bg-red-50 rounded border border-red-200">
                <p className="text-sm font-semibold text-red-800">{event.text}</p>
                <p className="text-xs text-gray-600 mt-1">
                  신뢰도: {(event.confidence * 100).toFixed(1)}% | 
                  시간: {new Date(event.timestamp).toLocaleTimeString()}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

