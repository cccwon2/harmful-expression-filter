import React, { useState, useEffect, useRef } from 'react';
import { ROIRect, SelectionState } from './roiTypes';

export const OverlayApp: React.FC = () => {
  const [selectionState, setSelectionState] = useState<SelectionState | null>(null);
  const [isSelectionComplete, setIsSelectionComplete] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // ESC 키로 선택 취소 처리
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectionState(null);
        setIsSelectionComplete(false);
        window.electronAPI.sendROICancelSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // 선택 완료 후에는 마우스 이벤트 무시 (클릭-스루)
      if (isSelectionComplete) return;

      setSelectionState({
        isSelecting: true,
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
      });

      window.electronAPI.sendROIStartSelection();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!selectionState?.isSelecting) return;

      setSelectionState((prev) =>
        prev
          ? {
              ...prev,
              currentX: e.clientX,
              currentY: e.clientY,
            }
          : null
      );
    };

    const handleMouseUp = () => {
      if (!selectionState?.isSelecting) return;

      const rect: ROIRect = {
        x: Math.min(selectionState.startX, selectionState.currentX),
        y: Math.min(selectionState.startY, selectionState.currentY),
        width: Math.abs(selectionState.currentX - selectionState.startX),
        height: Math.abs(selectionState.currentY - selectionState.startY),
      };

      // ROI가 너무 작으면 취소
      if (rect.width < 10 || rect.height < 10) {
        setSelectionState(null);
        window.electronAPI.sendROICancelSelection();
        return;
      }

      // ROI 좌표 전송
      window.electronAPI.sendROISelected(rect);
      setIsSelectionComplete(true);

      // 선택 완료 후 클릭-스루 활성화 요청 (main 프로세스에서 처리)
      // 오버레이 창에 setIgnoreMouseEvents 호출 필요
      setSelectionState(null);
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [selectionState, isSelectionComplete]);

  // ROI 선택 영역 계산
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
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: isSelectionComplete ? 'none' : 'auto',
        cursor: selectionState?.isSelecting ? 'crosshair' : 'default',
      }}
    >
      {/* 선택 영역 표시 */}
      {selectionRect && (
        <div
          style={{
            position: 'absolute',
            left: `${selectionRect.left}px`,
            top: `${selectionRect.top}px`,
            width: `${selectionRect.width}px`,
            height: `${selectionRect.height}px`,
            border: '2px solid #00ff00',
            backgroundColor: 'rgba(0, 255, 0, 0.1)',
            pointerEvents: 'none',
            zIndex: 1000,
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
          ROI 선택 완료. ESC 키를 눌러 다시 선택하세요.
        </div>
      )}

      {/* 사용 안내 */}
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
          }}
        >
          마우스를 드래그하여 ROI 영역을 선택하세요
        </div>
      )}
    </div>
  );
};

