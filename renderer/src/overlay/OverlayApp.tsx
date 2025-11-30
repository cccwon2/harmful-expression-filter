import React, { useState, useEffect, useRef, useCallback } from "react";
import { ROI, SelectionState, OverlayMode } from "./roiTypes";

export const OverlayApp: React.FC = () => {
  // --- State Definitions ---
  const [mode, setMode] = useState<OverlayMode>("setup");
  const [roi, setRoi] = useState<ROI | undefined>(undefined);
  const [harmful, setHarmful] = useState<boolean>(false);
  const [isMonitoring, setIsMonitoring] = useState<boolean>(false);

  // ROI 선택 상태
  const [selectionState, setSelectionState] = useState<SelectionState | null>(null);
  const [isSelectionComplete, setIsSelectionComplete] = useState(false);

  // Refs for DOM & Timer
  const overlayRef = useRef<HTMLDivElement>(null);
  const blindTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const BLIND_DURATION_MS = 3000;

  // 최신 상태를 항상 참조할 수 있는 Ref
  const latestStateRef = useRef({
    mode,
    roi,
    harmful,
    isMonitoring,
    isSelectionComplete,
  });

  // 상태 동기화
  useEffect(() => {
    latestStateRef.current = {
      mode,
      roi,
      harmful,
      isMonitoring,
      isSelectionComplete,
    };
    (window as any).__overlayState = { mode, roi, harmful };
  }, [mode, roi, harmful, isMonitoring, isSelectionComplete]);

  // --- Logging ---
  useEffect(() => {
    const state = { mode, roi, harmful };
    if (harmful) {
      console.warn("[Overlay] ⚠️ State changed (harmful=true):", JSON.stringify(state));
    }
  }, [mode, roi, harmful]);

  // --- Helper: API Waiter ---
  const createOverlayApiWaiter = useCallback(
    <T extends (...args: any[]) => any>(
      getter: (api: NonNullable<typeof window.api>["overlay"]) => T | undefined,
      register: (fn: T) => () => void,
      debugLabel: string
    ) => {
      const maxAttempts = 20;
      const baseDelay = 100;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let cancelled = false;
      let cleanup: (() => void) | null = null;

      const attempt = (attemptIndex: number) => {
        if (cancelled) return;
        const overlayApi = window.api?.overlay;
        const targetFn = overlayApi ? getter(overlayApi) : undefined;

        if (targetFn) {
          console.log(`[Overlay] Registering ${debugLabel} listener (Once)`);
          cleanup = register(targetFn);
          return;
        }

        if (attemptIndex >= maxAttempts) return;
        const delay = Math.min(baseDelay * Math.pow(1.5, attemptIndex), 1000);
        timeoutId = setTimeout(() => attempt(attemptIndex + 1), delay);
      };

      attempt(0);

      return () => {
        cancelled = true;
        if (timeoutId) clearTimeout(timeoutId);
        if (cleanup) cleanup();
      };
    },
    []
  );

  // --- Mode Effects (Click-through) ---
  const applyModeEffects = useCallback((targetMode: OverlayMode) => {
    const clickThrough = targetMode !== "setup";
    if (window.api?.overlay?.setClickThrough) {
      window.api.overlay.setClickThrough(clickThrough).catch(console.error);
    }
  }, []);

  useEffect(() => {
    applyModeEffects(mode);

    const monitoringActive = mode === "detect" || mode === "alert";
    setIsMonitoring((prev) => (prev !== monitoringActive ? monitoringActive : prev));

    if (!monitoringActive) {
      setIsSelectionComplete(false);
      setSelectionState(null);
    }

    if (mode === "setup") {
      if (blindTimerRef.current) {
        clearTimeout(blindTimerRef.current);
        blindTimerRef.current = null;
      }
      setHarmful(false);
    }
  }, [mode, applyModeEffects]);

  // --- IPC Listeners ---

  // 1. onModeChange
  useEffect(() => {
    return createOverlayApiWaiter(
      (api) => api.onModeChange,
      (onModeChange) => onModeChange((nextMode) => setMode(nextMode)),
      "onModeChange"
    );
  }, [createOverlayApiWaiter]);

  // 2. onStatePush
  useEffect(() => {
    return createOverlayApiWaiter(
      (api) => api.onStatePush,
      (onStatePush) =>
        onStatePush((state) => {
          if (state.roi) setRoi(state.roi);
        }),
      "onStatePush"
    );
  }, [createOverlayApiWaiter]);

  // 3. onStopMonitoring
  useEffect(() => {
    return createOverlayApiWaiter(
      (api) => api.onStopMonitoring,
      (onStopMonitoring) =>
        onStopMonitoring(() => {
          if (blindTimerRef.current) clearTimeout(blindTimerRef.current);
          setIsMonitoring(false);
          setIsSelectionComplete(false);
          setSelectionState(null);
          setRoi(undefined);
          setMode("setup");
          setHarmful(false);
        }),
      "onStopMonitoring"
    );
  }, [createOverlayApiWaiter]);

  // 4. onServerAlert (Timer Logic Included)
  useEffect(() => {
    return createOverlayApiWaiter(
      (api) => api.onServerAlert,
      (onServerAlert) => {
        const handler = (nextHarmful: boolean) => {
          const current = latestStateRef.current;

          if (!current.isMonitoring || !current.roi) {
            if (blindTimerRef.current) clearTimeout(blindTimerRef.current);
            return;
          }

          if (nextHarmful) {
            // 유해 감지: 타이머 취소, 즉시 블러 처리
            console.warn(`[Overlay] 🚨 유해 표현 감지 - 블러 처리 시작`);
            if (blindTimerRef.current) {
              clearTimeout(blindTimerRef.current);
              blindTimerRef.current = null;
            }
            setHarmful(true);
            setMode("alert");
          } else {
            // 비유해 감지: harmful 해제, 타이머 시작 (로그 없음)
            setHarmful(false);
            if (current.mode === "alert" && !blindTimerRef.current) {
              blindTimerRef.current = setTimeout(() => {
                const cleanState = latestStateRef.current;
                if (!cleanState.harmful && cleanState.mode === "alert") {
                  setMode("detect");
                  blindTimerRef.current = null;
                }
              }, BLIND_DURATION_MS);
            }
          }
        };
        return onServerAlert(handler);
      },
      "onServerAlert"
    );
  }, [createOverlayApiWaiter]);

  // --- Event Handlers ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Esc") {
        e.preventDefault();
        console.log("[Overlay] ESC 키 감지됨");
        
        if (selectionState?.isSelecting) {
          console.log("[Overlay] ROI 선택 중 취소");
          setSelectionState(null);
          setIsSelectionComplete(false);
          window.api?.roi?.sendCancelSelection();
          return;
        }
        
        console.log("[Overlay] Setup 모드로 재진입");
        
        // 타이머 정리
        if (blindTimerRef.current) clearTimeout(blindTimerRef.current);
        
        // 상태 리셋
        setIsMonitoring(false);
        setHarmful(false);
        setSelectionState(null);
        setIsSelectionComplete(false);
        setRoi(undefined);
        
        // 모니터링 중지 (메인 프로세스에 알림)
        if (window.api?.overlay?.stopMonitoring) {
          window.api.overlay.stopMonitoring();
        }
        
        // 모드 변경
        setMode("setup");
        
        // 메인 프로세스에 모드 변경 알림
        if ((window.api?.overlay as any)?.sendModeChange) {
          (window.api.overlay as any).sendModeChange("setup");
        }
        
        // 클릭 투루 비활성화하여 ROI 선택 가능하도록
        if (window.api?.overlay?.setClickThrough) {
          window.api.overlay.setClickThrough(false).then(() => {
            console.log("[Overlay] 클릭 투루 비활성화됨 - ROI 선택 가능");
          }).catch(console.error);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [selectionState]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const current = latestStateRef.current;
      if (current.mode !== "setup" || current.isSelectionComplete || e.button !== 0) return;

      setIsMonitoring(false);
      setRoi(undefined);
      setSelectionState({
        isSelecting: true,
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
      });
      window.api?.roi?.sendStartSelection();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!selectionState?.isSelecting) return;
      setSelectionState((prev) => (prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null));
    };

    const handleMouseUp = () => {
      if (!selectionState?.isSelecting) return;
      const rect: ROI = {
        x: Math.min(selectionState.startX, selectionState.currentX),
        y: Math.min(selectionState.startY, selectionState.currentY),
        width: Math.abs(selectionState.currentX - selectionState.startX),
        height: Math.abs(selectionState.currentY - selectionState.startY),
      };

      if (rect.width < 10 || rect.height < 10) {
        setSelectionState(null);
        window.api?.roi?.sendCancelSelection();
        return;
      }
      setRoi(rect);
      window.api?.roi?.sendSelected(rect);
      setMode("detect");
      setIsSelectionComplete(true);
      setSelectionState(null);
      window.api?.overlay?.startMonitoring?.();
      setIsMonitoring(true);
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [selectionState]);

  const selectionRect = selectionState
    ? {
        left: Math.min(selectionState.startX, selectionState.currentX),
        top: Math.min(selectionState.startY, selectionState.currentY),
        width: Math.abs(selectionState.currentX - selectionState.startX),
        height: Math.abs(selectionState.currentY - selectionState.startY),
      }
    : null;

  return (
    <div
      ref={overlayRef}
      tabIndex={-1}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        backgroundColor: "transparent",
        pointerEvents: isSelectionComplete || isMonitoring ? "none" : "auto",
        cursor: selectionState?.isSelecting ? "crosshair" : "default",
        outline: "none",
      }}
    >
      {/* 선택 영역 드래그 박스 */}
      {selectionRect && (
        <div
          style={{
            position: "absolute",
            left: selectionRect.left,
            top: selectionRect.top,
            width: selectionRect.width,
            height: selectionRect.height,
            border: "2px solid #00ff00",
            backgroundColor: "rgba(0, 255, 0, 0.1)",
            zIndex: 1000,
          }}
        />
      )}

      {/* 선택 완료 메시지 */}
      {isSelectionComplete && (
        <div style={styles.toast}>
          ✅ ROI 영역 선택 완료 <br />
          <span style={{ fontSize: "0.8em", opacity: 0.8 }}>ESC로 취소</span>
        </div>
      )}

      {/* 감시 중 표시 (Detect 모드) */}
      {isMonitoring && roi && mode !== "alert" && (
        <div
          style={{
            position: "absolute",
            left: roi.x,
            top: roi.y,
            width: roi.width,
            height: roi.height,
            border: "3px solid #ff0000",
            pointerEvents: "none",
            zIndex: 1002,
          }}
        >
          <div style={styles.badge}>🔴 감시 중</div>
        </div>
      )}

      {/* 🔥 [수정됨] 블러 효과 오버레이 (Alert 모드) */}
      {mode === "alert" && roi && (
        <div
          style={{
            position: "absolute",
            left: roi.x,
            top: roi.y,
            width: roi.width,
            height: roi.height,

            // 1. 블러 강도 대폭 증가 (15px -> 40px)
            // 글자가 거의 식별 불가능하게 뭉개집니다.
            backdropFilter: "blur(40px)",
            WebkitBackdropFilter: "blur(40px)",

            // 2. 배경을 어둡고 진하게 변경 (흰색 -> 검은색 투명도 60%)
            backgroundColor: "rgba(0, 0, 0, 0.6)",

            // 3. 테두리는 유지하되 약간 더 선명하게 (영역 구분용)
            border: "2px solid rgba(255, 0, 0, 0.5)",

            // 4. 그림자 효과로 깊이감 추가
            boxShadow: "0 0 20px rgba(0, 0, 0, 0.5)",

            zIndex: 1003,
            transition: "all 0.3s ease",
            pointerEvents: "none",

            // 이모티콘 제거로 인해 flex 관련 속성 삭제
          }}
        />
      )}

      {/* Setup 안내 */}
      {mode === "setup" && !selectionState && !isSelectionComplete && (
        <div style={styles.instruction}>
          🖱️ 마우스를 드래그하여 영역을 선택하세요
          <div style={{ fontSize: "0.8em", marginTop: 5, opacity: 0.8 }}>ESC: 취소 / Ctrl+Q: 종료</div>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  toast: {
    position: "fixed",
    top: 20,
    left: "50%",
    transform: "translateX(-50%)",
    padding: "12px 20px",
    backgroundColor: "rgba(16, 185, 129, 0.9)",
    color: "white",
    borderRadius: 8,
    fontWeight: "bold",
    zIndex: 1001,
    textAlign: "center",
  },
  badge: {
    position: "absolute",
    top: -30,
    left: "50%",
    transform: "translateX(-50%)",
    backgroundColor: "red",
    color: "white",
    padding: "2px 8px",
    borderRadius: 12,
    fontSize: 12,
  },
  instruction: {
    position: "fixed",
    top: 20,
    left: "50%",
    transform: "translateX(-50%)",
    padding: "16px 24px",
    backgroundColor: "rgba(37, 99, 235, 0.9)",
    color: "white",
    borderRadius: 8,
    zIndex: 1001,
    textAlign: "center",
  },
};
