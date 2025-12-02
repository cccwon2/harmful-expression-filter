import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ROI, SelectionState, OverlayMode } from "./roiTypes";

// ==========================================
// 1. 하위 컴포넌트 분리 및 메모이제이션
// ==========================================

// 스타일 상수
const STYLES = {
  container: {
    position: "fixed" as const,
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    backgroundColor: "transparent",
    outline: "none",
    // 🔥 [최적화] GPU 가속 힌트 및 렌더링 최적화
    willChange: "transform" as const, // 브라우저에게 변경 예상 속성 알림
    backfaceVisibility: "hidden" as const, // 뒷면 렌더링 방지 (GPU 가속 트리거)
    transform: "translateZ(0)", // 하드웨어 가속 강제 활성화
  },
  selectionBox: {
    position: "absolute" as const,
    border: "2px solid #00ff00",
    backgroundColor: "rgba(0, 255, 0, 0.1)",
    zIndex: 1000,
    pointerEvents: "none" as const, // 드래그 중 간섭 방지
    // 🔥 [최적화] 선택 박스는 위치와 크기가 자주 변함
    willChange: "left, top, width, height" as const,
    backfaceVisibility: "hidden" as const,
    transform: "translateZ(0)", // GPU 가속 활성화
  },
  blurOverlay: {
    position: "absolute" as const,
    // 1. 블러 강도 대폭 증가
    backdropFilter: "blur(40px)",
    WebkitBackdropFilter: "blur(40px)",
    // 2. 배경을 어둡고 진하게 변경
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    // 3. 테두리
    border: "2px solid rgba(255, 0, 0, 0.5)",
    // 4. 그림자
    boxShadow: "0 0 20px rgba(0, 0, 0, 0.5)",
    zIndex: 1003,
    // 🔥 [Task 49] 애니메이션 효과: 부드러운 페이드인 및 스케일 효과
    transition: "opacity 0.3s ease, transform 0.3s ease",
    pointerEvents: "none" as const,
    // 🔥 [최적화] GPU 가속 (backdrop-filter는 이미 GPU 가속 활용)
    willChange: "transform, opacity" as const,
    backfaceVisibility: "hidden" as const,
    transform: "translateZ(0)",
    // 🔥 [Task 49] UX 개선: 중앙 정렬을 위한 flex 설정
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
  },
  blurIcon: {
    fontSize: "32px",
    marginBottom: "12px",
    filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
  },
  blurMessage: {
    color: "white",
    fontWeight: "bold",
    textShadow: "0 2px 4px rgba(0,0,0,0.5)",
    textAlign: "center" as const,
    fontSize: "14px",
    padding: "0 16px",
  },
  monitoringBadge: {
    position: "absolute" as const,
    border: "3px solid #ff0000",
    pointerEvents: "none" as const,
    zIndex: 1002,
    // 🔥 [최적화] GPU 가속
    willChange: "transform" as const,
    backfaceVisibility: "hidden" as const,
    transform: "translateZ(0)",
  },
  toast: {
    position: "fixed" as const,
    top: 20,
    left: "50%",
    transform: "translateX(-50%)",
    padding: "12px 20px",
    backgroundColor: "rgba(16, 185, 129, 0.9)",
    color: "white",
    borderRadius: 8,
    fontWeight: "bold",
    zIndex: 1001,
    textAlign: "center" as const,
  },
  badgeText: {
    position: "absolute" as const,
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
    position: "fixed" as const,
    top: 20,
    left: "50%",
    transform: "translateX(-50%)",
    padding: "16px 24px",
    backgroundColor: "rgba(37, 99, 235, 0.9)",
    color: "white",
    borderRadius: 8,
    zIndex: 1001,
    textAlign: "center" as const,
  },
};

// [Component] 드래그 중인 선택 영역 (가장 빈번하게 렌더링됨)
const SelectionBox = React.memo(({ rect }: { rect: { left: number; top: number; width: number; height: number } | null }) => {
  if (!rect) return null;

  return (
    <div
      style={{
        ...STYLES.selectionBox,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
});

// [Component] 유해 감지 블러 오버레이 (Task 49: UX 개선 + 애니메이션 + 동적 블러 강도)
const BlurOverlay = React.memo(({ roi, blurIntensity = 40 }: { roi: ROI; blurIntensity?: number }) => {
  const [isVisible, setIsVisible] = React.useState(false);

  // 🔥 [Task 49] 애니메이션: 마운트 시 부드러운 페이드인 효과
  React.useEffect(() => {
    // 다음 프레임에서 opacity를 1로 변경하여 페이드인 효과
    const timer = requestAnimationFrame(() => {
      setIsVisible(true);
    });
    return () => cancelAnimationFrame(timer);
  }, []);

  // 🔥 [Task 49] 동적 블러 강도 적용
  const blurValue = `${blurIntensity}px`;

  return (
    <div
      style={{
        ...STYLES.blurOverlay,
        left: roi.x,
        top: roi.y,
        width: roi.width,
        height: roi.height,
        // 🔥 [Task 49] 동적 블러 강도 적용
        backdropFilter: `blur(${blurValue})`,
        WebkitBackdropFilter: `blur(${blurValue})`,
        // 🔥 [Task 49] 애니메이션: 초기 opacity 0에서 1로 페이드인
        opacity: isVisible ? 1 : 0,
        // 🔥 [Task 49] 애니메이션: 약간의 스케일 효과
        transform: isVisible ? "translateZ(0) scale(1)" : "translateZ(0) scale(0.95)",
      }}
    >
      <div style={STYLES.blurIcon}>⚠️</div>
      <div style={STYLES.blurMessage}>
        유해 표현이 감지되어 가려졌습니다
      </div>
    </div>
  );
});

// [Component] 감시 중 표시 (빨간 테두리)
const MonitoringOverlay = React.memo(({ roi }: { roi: ROI }) => {
  return (
    <div
      style={{
        ...STYLES.monitoringBadge,
        left: roi.x,
        top: roi.y,
        width: roi.width,
        height: roi.height,
      }}
    >
      <div style={STYLES.badgeText}>🔴 감시 중</div>
    </div>
  );
});

// [Component] 안내 메시지
const InstructionMessage = React.memo(() => (
  <div style={STYLES.instruction}>
    🖱️ 마우스를 드래그하여 영역을 선택하세요
    <div style={{ fontSize: "0.8em", marginTop: 5, opacity: 0.8 }}>ESC: 취소 / Ctrl+Q: 종료</div>
  </div>
));

// [Component] 완료 토스트
const SuccessToast = React.memo(() => (
  <div style={STYLES.toast}>
    ✅ ROI 영역 선택 완료 <br />
    <span style={{ fontSize: "0.8em", opacity: 0.8 }}>ESC로 취소</span>
  </div>
));

// ==========================================
// 2. Main Component
// ==========================================

export const OverlayApp: React.FC = () => {
  // --- State Definitions ---
  const [mode, setMode] = useState<OverlayMode>("setup");
  const [roi, setRoi] = useState<ROI | undefined>(undefined);
  const [harmful, setHarmful] = useState<boolean>(false);
  const [isMonitoring, setIsMonitoring] = useState<boolean>(false);
  // 🔥 [Task 49] 블러 강도 설정 (기본값: 40px)
  const [blurIntensity, setBlurIntensity] = useState<number>(40);

  // ROI 선택 상태
  const [selectionState, setSelectionState] = useState<SelectionState | null>(null);
  const [isSelectionComplete, setIsSelectionComplete] = useState(false);

  // Refs for DOM & Timer
  const overlayRef = useRef<HTMLDivElement>(null);
  const blindTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const BLIND_DURATION_MS = 3000;
  
  // 마우스 위치 추적을 위한 ref (성능 최적화)
  const mousePositionRef = useRef<{ x: number; y: number } | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const isSelectingRef = useRef<boolean>(false);
  // 선택 상태를 ref에도 저장 (null 체크 방지)
  const selectionStateRef = useRef<SelectionState | null>(null);

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
  
  // selectionState ref 동기화
  useEffect(() => {
    selectionStateRef.current = selectionState;
  }, [selectionState]);

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
          // 🔥 [Task 49] 블러 강도 설정 업데이트
          if (state.blurIntensity !== undefined) {
            setBlurIntensity(state.blurIntensity);
          }
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
        
        if (isSelectingRef.current) {
          console.log("[Overlay] ROI 선택 중 취소");
          setSelectionState(null);
          selectionStateRef.current = null;
          setIsSelectionComplete(false);
          isSelectingRef.current = false;
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
  }, []); // selectionState 의존성 제거 - ref 사용

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const current = latestStateRef.current;
      if (current.mode !== "setup" || current.isSelectionComplete || e.button !== 0) return;

      setIsMonitoring(false);
      setRoi(undefined);
      isSelectingRef.current = true;
      const newSelectionState = {
        isSelecting: true,
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
      };
      selectionStateRef.current = newSelectionState;
      setSelectionState(newSelectionState);
      window.api?.roi?.sendStartSelection();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isSelectingRef.current) return;
      
      // 마우스 위치를 ref에 저장 (상태 업데이트 없이)
      mousePositionRef.current = { x: e.clientX, y: e.clientY };
      
      // requestAnimationFrame으로 상태 업데이트 스케줄링 (렌더링 최적화)
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          if (mousePositionRef.current && isSelectingRef.current && selectionStateRef.current) {
            const updatedState = {
              ...selectionStateRef.current,
              currentX: mousePositionRef.current.x,
              currentY: mousePositionRef.current.y,
            };
            selectionStateRef.current = updatedState;
            setSelectionState(updatedState);
          }
          rafIdRef.current = null;
        });
      }
    };

    const handleMouseUp = () => {
      if (!isSelectingRef.current) return;
      const currentSelectionState = selectionStateRef.current;
      if (!currentSelectionState) {
        console.warn('[Overlay] handleMouseUp: selectionState가 null입니다');
        isSelectingRef.current = false;
        return;
      }
      isSelectingRef.current = false;
      const rect: ROI = {
        x: Math.min(currentSelectionState.startX, currentSelectionState.currentX),
        y: Math.min(currentSelectionState.startY, currentSelectionState.currentY),
        width: Math.abs(currentSelectionState.currentX - currentSelectionState.startX),
        height: Math.abs(currentSelectionState.currentY - currentSelectionState.startY),
      };

      if (rect.width < 10 || rect.height < 10) {
        setSelectionState(null);
        selectionStateRef.current = null;
        isSelectingRef.current = false;
        window.api?.roi?.sendCancelSelection();
        return;
      }
      setRoi(rect);
      window.api?.roi?.sendSelected(rect);
      setMode("detect");
      setIsSelectionComplete(true);
      setSelectionState(null);
      selectionStateRef.current = null;
      isSelectingRef.current = false;
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
      // cleanup: pending requestAnimationFrame 취소
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      mousePositionRef.current = null;
      isSelectingRef.current = false;
      selectionStateRef.current = null;
    };
  }, []); // selectionState 의존성 제거 - ref 사용으로 클로저 문제 해결

  // --- Render Helpers (useMemo) ---
  // 선택 영역 좌표 계산 최적화
  const selectionRect = useMemo(() => {
    if (!selectionState) return null;

    return {
      left: Math.min(selectionState.startX, selectionState.currentX),
      top: Math.min(selectionState.startY, selectionState.currentY),
      width: Math.abs(selectionState.currentX - selectionState.startX),
      height: Math.abs(selectionState.currentY - selectionState.startY),
    };
  }, [selectionState]);

  // 포인터 이벤트 제어
  const containerPointerEvents = isSelectionComplete || isMonitoring ? "none" : "auto";
  const containerCursor = selectionState?.isSelecting ? "crosshair" : "default";

  return (
    <div
      ref={overlayRef}
      tabIndex={-1}
      style={{
        ...STYLES.container,
        pointerEvents: containerPointerEvents,
        cursor: containerCursor,
      }}
    >
      {/* 1. 선택 영역 박스 (자주 변경됨) */}
      <SelectionBox rect={selectionRect} />

      {/* 2. 완료 메시지 */}
      {isSelectionComplete && <SuccessToast />}

      {/* 3. 감시 중 표시 */}
      {isMonitoring && roi && mode !== "alert" && <MonitoringOverlay roi={roi} />}

      {/* 4. 블러 오버레이 */}
      {mode === "alert" && roi && <BlurOverlay roi={roi} blurIntensity={blurIntensity} />}

      {/* 5. Setup 안내 */}
      {mode === "setup" && !selectionState && !isSelectionComplete && <InstructionMessage />}
    </div>
  );
};
