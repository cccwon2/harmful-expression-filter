import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ROI, SelectionState, OverlayMode, OverlayState } from './roiTypes';

export const OverlayApp: React.FC = () => {
  // 상태 머신: 모드, ROI, 유해함 상태
  const [mode, setMode] = useState<OverlayMode>('setup');
  const [roi, setRoi] = useState<ROI | undefined>(undefined);
  const [harmful, setHarmful] = useState<boolean>(false);
  const [isMonitoring, setIsMonitoring] = useState<boolean>(false);
  
  // 전역 변수로 상태를 window에 노출 (개발자 도구에서 접근 가능하도록)
  useEffect(() => {
    (window as any).__overlayState = { mode, roi, harmful };
  }, [mode, roi, harmful]);
  
  // ROI 선택 상태 (드래그 중인 임시 상태)
  const [selectionState, setSelectionState] = useState<SelectionState | null>(null);
  const [isSelectionComplete, setIsSelectionComplete] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  
  // 상태 변경 로그 출력
  useEffect(() => {
    const state: OverlayState = { mode, roi, harmful };
    console.log('[Overlay] state changed:', JSON.stringify(state, null, 2));
  }, [mode, roi, harmful]);

  // 모드 효과 적용 함수
  const applyModeEffects = useCallback((newMode: OverlayMode) => {
    console.log('[Overlay] Applying mode effects for mode:', newMode);

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const clickThrough = newMode !== 'setup';
    const maxAttempts = 10;

    const attempt = (attemptIndex: number) => {
      if (cancelled) {
        return;
      }

      if (window.api?.overlay?.setClickThrough) {
        console.log('[Overlay] Setting click-through to:', clickThrough, 'for mode:', newMode);
        window.api.overlay
          .setClickThrough(clickThrough)
          .then(() => {
            console.log('[Overlay] Click-through successfully set to:', clickThrough);
          })
          .catch((error) => {
            console.error('[Overlay] Error setting click-through:', error);
          });
        return;
      }

      if (attemptIndex >= maxAttempts) {
        console.error('[Overlay] Failed to set click-through - API unavailable after', maxAttempts, 'attempts');
        return;
      }

      console.warn(
        `[Overlay] window.api.overlay.setClickThrough is not available yet (attempt ${attemptIndex + 1}/${maxAttempts})`,
      );

      const delay = Math.min(100 * Math.pow(1.5, attemptIndex), 1000);
      timeoutId = setTimeout(() => attempt(attemptIndex + 1), delay);
    };

    attempt(0);

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
  }, []);
  
  // window.api 사용 가능 여부 확인 및 초기 상태 출력
  useEffect(() => {
    console.log('[Overlay] Component mounted');
    console.log('[Overlay] window.api available:', typeof window !== 'undefined' && typeof window.api !== 'undefined');
    if (typeof window !== 'undefined' && window.api) {
      console.log('[Overlay] window.api.editMode:', typeof window.api.editMode);
      console.log('[Overlay] window.api.overlay:', typeof window.api.overlay);
      console.log('[Overlay] window.api.overlay.setClickThrough:', typeof window.api.overlay?.setClickThrough);
    }
    
    // 초기 상태 출력
    const state: OverlayState = { mode, roi, harmful };
    console.log('[Overlay] init state:', JSON.stringify(state, null, 2));
    
    // 초기 모드 효과 적용 (약간의 지연 후)
    let cleanupApply: (() => void) | null = null;
    const timeoutId1 = setTimeout(() => {
      console.log('[Overlay] Applying initial mode effects');
      cleanupApply = applyModeEffects(mode);
    }, 200);
    
    return () => {
      clearTimeout(timeoutId1);
      cleanupApply?.();
      cleanupApply = null;
    };
  }, []); // 초기 마운트 시에만 실행
  
  // 모드 변경 시 효과 적용
  useEffect(() => {
    console.log('[Overlay] Mode changed to:', mode);
    const cleanup = applyModeEffects(mode);
    return () => {
      cleanup?.();
    };
  }, [mode, applyModeEffects]);
  
  // 모드 변경 시 상태 업데이트 (순환 참조 방지)
  const handleModeChange = useCallback((newMode: OverlayMode) => {
    setMode(newMode);
  }, []);

  // IPC로 모드 변경 수신 (메인 프로세스에서 전송)
  const createOverlayApiWaiter = useCallback(
    <T extends (...args: any[]) => any>(
      getter: (api: NonNullable<typeof window.api>['overlay']) => T | undefined,
      register: (fn: T) => () => void,
      debugLabel: string,
    ) => {
      const maxAttempts = 20;
      const baseDelay = 100;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let cancelled = false;
      let cleanup: (() => void) | null = null;

      const attempt = (attemptIndex: number) => {
        if (cancelled) {
          return;
        }

        const overlayApi = window.api?.overlay;
        const targetFn = overlayApi ? getter(overlayApi) : undefined;

        if (targetFn) {
          console.log('[Overlay] Registering', debugLabel, 'listener');
          cleanup = register(targetFn);
          return;
        }

        if (attemptIndex >= maxAttempts) {
          console.error(
            `[Overlay] Failed to register ${debugLabel} listener - API unavailable after ${maxAttempts} attempts`,
          );
          return;
        }

        const delay = Math.min(baseDelay * Math.pow(1.5, attemptIndex), 1000);
        console.warn(
          `[Overlay] ${debugLabel} API not available yet (attempt ${attemptIndex + 1}/${maxAttempts})`,
        );
        timeoutId = setTimeout(() => attempt(attemptIndex + 1), delay);
      };

      attempt(0);

      return () => {
        cancelled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (cleanup) {
          console.log('[Overlay] Unregistering', debugLabel, 'listener');
          cleanup();
          cleanup = null;
        }
      };
    },
    [],
  );

  useEffect(() => {
    return createOverlayApiWaiter(
      (api) => api.onModeChange,
      (onModeChange) =>
        onModeChange((nextMode: OverlayMode) => {
          console.log('[Overlay] Mode change received from main process:', nextMode);
          setMode(nextMode);
        }),
      'onModeChange',
    );
  }, [createOverlayApiWaiter]);

  useEffect(() => {
    return createOverlayApiWaiter(
      (api) => api.onStatePush,
      (onStatePush) =>
        onStatePush((state: OverlayState) => {
          console.log('[Overlay] State push received from main process:', state);
          if (state.mode) {
            setMode(state.mode);
            applyModeEffects(state.mode);
          }
          if (typeof state.harmful === 'boolean') {
            setHarmful(state.harmful);
          }
          if (state.roi) {
            setRoi(state.roi);
          }
        }),
      'onStatePush',
    );
  }, [createOverlayApiWaiter, applyModeEffects]);

  useEffect(() => {
    return createOverlayApiWaiter(
      (api) => api.onStopMonitoring,
      (onStopMonitoring) =>
        onStopMonitoring(() => {
          console.log('[Overlay] Stop monitoring signal received from main process');
          setIsMonitoring(false);
          setIsSelectionComplete(false);
          setSelectionState(null);
          setRoi(undefined);
          setMode('setup');
        }),
      'onStopMonitoring',
    );
  }, [createOverlayApiWaiter]);

  // 키보드 단축키 처리
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 개발자 도구가 열려 있으면 오버레이 창의 키보드 이벤트를 개발자 도구로 전달
      // (개발자 도구 콘솔에서 입력 가능하도록)
      const isDevToolsOpen = (window as any).__devToolsOpen || false;
      if (isDevToolsOpen && document.activeElement !== overlayRef.current) {
        // 개발자 도구가 열려 있고 오버레이가 포커스를 받지 않았으면 이벤트를 전달하지 않음
        return;
      }
      
      console.log('[Overlay] Key pressed:', e.key, 'Ctrl:', e.ctrlKey, 'Alt:', e.altKey, 'Shift:', e.shiftKey);
      
      // ESC: ROI 선택 취소/리셋만 (Edit Mode 종료하지 않음)
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        e.stopPropagation();
        console.log('[Overlay] ESC key detected - ROI selection only');
        
        // ROI 선택 중이면 선택 취소
        if (selectionState?.isSelecting) {
          console.log('[Overlay] Cancelling ROI selection');
          setSelectionState(null);
          setIsSelectionComplete(false);
          if (window.api?.roi) {
            window.api.roi.sendCancelSelection();
          }
          return;
        }
        
        // ROI 선택 완료 상태면 다시 선택 가능하도록 리셋
        if (isSelectionComplete) {
          console.log('[Overlay] Resetting ROI selection');
          setIsSelectionComplete(false);
          setSelectionState(null);
          if (window.api?.roi) {
            window.api.roi.sendCancelSelection();
          }
          // Edit Mode는 유지
          return;
        }
        
        if (isMonitoring || mode !== 'setup') {
          console.log('[Overlay] ESC pressed - requesting monitoring stop');
          if (window.api?.overlay?.stopMonitoring) {
            window.api.overlay.stopMonitoring();
          }
          setIsMonitoring(false);
          setSelectionState(null);
          setIsSelectionComplete(false);
          setMode('setup');
          return;
        }
        
        // ROI 선택이 없으면 ESC는 아무 동작도 하지 않음 (Edit Mode 유지)
        console.log('[Overlay] ESC pressed but no active ROI selection - no action');
      }
      
      // Ctrl+E/Q는 메인 프로세스에서 처리 (before-input-event)
      // renderer에서는 처리하지 않음
    };

    // document와 window 모두에 이벤트 리스너 추가
    document.addEventListener('keydown', handleKeyDown, true); // capture phase
    window.addEventListener('keydown', handleKeyDown, true);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [selectionState, isSelectionComplete, isMonitoring, mode]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // 개발자 도구 콘솔에 상세한 이벤트 정보 출력
      console.log('[Overlay] Mouse down event:', {
        x: e.clientX,
        y: e.clientY,
        isSelectionComplete,
        mode,
        hasRoi: !!roi,
        timestamp: new Date().toISOString(),
      });
      
      // setup 모드가 아니면 마우스 이벤트 무시
      if (mode !== 'setup') {
        console.log('[Overlay] Not in setup mode, ignoring mouse down. Current mode:', mode);
        return;
      }
      
      // 선택 완료 후에는 마우스 이벤트 무시 (클릭-스루)
      if (isSelectionComplete) {
        console.log('[Overlay] Selection already complete, ignoring mouse down');
        return;
      }

      console.log('[Overlay] Starting ROI selection');
      setIsMonitoring(false);
      setRoi(undefined);
      setSelectionState({
        isSelecting: true,
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
      });

      // IPC로 선택 시작 알림
      if (window.api?.roi) {
        console.log('[Overlay] Calling window.api.roi.sendStartSelection()');
        window.api.roi.sendStartSelection();
      } else {
        console.error('[Overlay] window.api.roi is not available');
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!selectionState?.isSelecting) return;

      const newState = {
        ...selectionState,
        currentX: e.clientX,
        currentY: e.clientY,
      };
      
      // 현재 선택 영역 좌표 계산 및 콘솔 출력 (드래그 중 좌표 변화 추적)
      const currentRect: ROI = {
        x: Math.min(newState.startX, newState.currentX),
        y: Math.min(newState.startY, newState.currentY),
        width: Math.abs(newState.currentX - newState.startX),
        height: Math.abs(newState.currentY - newState.startY),
      };
      // 콘솔 출력은 성능을 위해 throttle하지 않음 (디버깅 목적)
      // 개발자 도구 콘솔에서 확인 가능하도록 로그 출력
      console.log('[Overlay] ROI selection in progress:', {
        rect: currentRect,
        mode,
        timestamp: new Date().toISOString(),
      });

      setSelectionState(newState);
    };

    const handleMouseUp = () => {
      if (!selectionState?.isSelecting) return;

      // ROI 좌표 계산 (화면 좌상단(0,0) 기준)
      const rect: ROI = {
        x: Math.min(selectionState.startX, selectionState.currentX),
        y: Math.min(selectionState.startY, selectionState.currentY),
        width: Math.abs(selectionState.currentX - selectionState.startX),
        height: Math.abs(selectionState.currentY - selectionState.startY),
      };

      // ROI 좌표 콘솔 출력 (디버깅용)
      console.log('[Overlay] ROI calculated:', rect);

      // 드래그 최소 크기 체크 (4px 이하 무시)
      if (rect.width < 4 || rect.height < 4) {
        console.log('[Overlay] ROI too small, ignoring:', rect);
        setSelectionState(null);
        // IPC로 선택 취소 알림
        if (window.api?.roi) {
          window.api.roi.sendCancelSelection();
        }
        return;
      }

      if (window.api?.roi) {
        window.api.roi.sendSelected(rect);
      }
      console.log('[Overlay] ROI selected and sent:', rect);
      
      // ROI 저장 (로컬 상태에 저장)
      setRoi(rect);
      console.log('[Overlay] ROI saved to local state:', rect);

      // 즉시 감지 모드로 전환 시도 (메인 프로세스 확인까지 대기)
      setMode('detect');
      console.log('[Overlay] Mode locally set to detect (awaiting main process confirmation)');
      applyModeEffects('detect');

      if (window.api?.overlay?.startMonitoring) {
        window.api.overlay.startMonitoring();
        setIsMonitoring(true);
      } else {
        console.warn('[Overlay] overlay.startMonitoring is not available');
      }
      
      // 메인 프로세스에서도 ROI 저장 후 OVERLAY_SET_MODE/STATE_PUSH를 재전송하므로
      // 위의 로컬 모드 전환은 Fail-safe 용도이며, 최종 상태는 메인 프로세스 브로드캐스트에 맞춰진다.
      
      // 선택 완료 상태 설정 (ESC 키로 다시 선택 가능하도록)
      // 중요: setIsSelectionComplete(true)를 먼저 호출하여 상태를 확실히 설정
      setIsSelectionComplete(true);
      // selectionState는 null로 설정 (선택 완료 후에는 드래그 영역이 없음)
      setSelectionState(null);
      console.log('[Overlay] ROI selection complete - waiting for detect mode from main process');
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [selectionState, isSelectionComplete, handleModeChange, mode, roi]);

  // ROI 선택 영역 계산
  const selectionRect = selectionState
    ? {
        left: Math.min(selectionState.startX, selectionState.currentX),
        top: Math.min(selectionState.startY, selectionState.currentY),
        width: Math.abs(selectionState.currentX - selectionState.startX),
        height: Math.abs(selectionState.currentY - selectionState.startY),
      }
    : null;

  // 오버레이가 마운트되면 포커스를 받을 수 있도록 설정
  useEffect(() => {
    if (overlayRef.current) {
      overlayRef.current.focus();
      console.log('[Overlay] Overlay ref focused');
    }
    
    // 오버레이가 다시 표시될 때 상태 리셋
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Overlay] Overlay became visible, resetting state');
        setSelectionState(null);
        setIsSelectionComplete(false);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return (
    <div
      ref={overlayRef}
      tabIndex={-1}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'transparent', // 완전히 투명
        pointerEvents: isSelectionComplete || isMonitoring ? 'none' : 'auto',
        cursor: selectionState?.isSelecting ? 'crosshair' : 'default',
        outline: 'none', // 포커스 시 outline 제거
        // 투명도 보장
        opacity: 1,
        // 개발 모드에서도 시각적 힌트 제거 (완전히 투명하게)
      }}
      onFocus={() => {
        console.log('[Overlay] Overlay div focused');
      }}
    >
      {/* 선택 영역 표시 (반투명 배경 + 테두리) */}
      {selectionRect && (
        <div
          style={{
            position: 'absolute',
            left: `${selectionRect.left}px`,
            top: `${selectionRect.top}px`,
            width: `${selectionRect.width}px`,
            height: `${selectionRect.height}px`,
            border: '2px solid #00ff00',
            backgroundColor: 'rgba(0, 255, 0, 0.1)', // 반투명 배경
            pointerEvents: 'none',
            zIndex: 1000,
            boxSizing: 'border-box',
          }}
        />
      )}

      {/* 선택 완료 메시지 */}
      {isSelectionComplete && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 20px',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: '#00ff00',
            borderRadius: '5px',
            fontSize: '14px',
            zIndex: 1001,
            pointerEvents: 'none',
          }}
        >
          ROI 선택 완료. ESC 키를 눌러 다시 선택하거나 Ctrl+E/Q로 Edit Mode를 종료하세요.
        </div>
      )}

      {isMonitoring && roi && (
        <div
          style={{
            position: 'absolute',
            left: `${roi.x}px`,
            top: `${roi.y}px`,
            width: `${roi.width}px`,
            height: `${roi.height}px`,
            border: '3px solid #ff0000',
            pointerEvents: 'none',
            zIndex: 1002,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '-32px',
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: 'rgba(255, 0, 0, 0.85)',
              color: '#ffffff',
              padding: '4px 12px',
              borderRadius: '16px',
              fontSize: '14px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              pointerEvents: 'none',
            }}
          >
            <span role="img" aria-label="monitoring">
              🔴
            </span>
            감시 중
          </div>
        </div>
      )}

      {/* 사용 안내 - Edit Mode일 때만 표시 */}
      {!selectionState && !isSelectionComplete && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 20px',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: '#ffffff',
            borderRadius: '5px',
            fontSize: '14px',
            zIndex: 1001,
            pointerEvents: 'none',
            textAlign: 'center',
          }}
        >
          <div>Edit Mode: 마우스를 드래그하여 ROI 영역을 선택하세요</div>
          <div style={{ fontSize: '12px', marginTop: '5px', opacity: 0.7 }}>
            Ctrl+E 또는 Ctrl+Q: Edit Mode 종료 | ESC: ROI 선택 취소
          </div>
        </div>
      )}
    </div>
  );
};

