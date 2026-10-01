import { useCallback, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export const DRAG_THRESHOLD_PX = 5;

/**
 * Starts a native window drag only when the pointer moves past a small
 * threshold while the left button is held down. A plain click (no movement)
 * keeps working normally, so the same element can be both clickable and draggable
 * (same pattern Chrome uses for its tab strip).
 */
export function useThresholdWindowDrag(thresholdPx = DRAG_THRESHOLD_PX) {
    const pressStartRef = useRef<{ x: number; y: number } | null>(null);
    const didDragRef = useRef(false);

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0 || e.defaultPrevented) return;

        const target = e.target as HTMLElement;
        if (target.closest('button, a, input, textarea, select, [role="button"]')) return;

        const start = { x: e.clientX, y: e.clientY };
        pressStartRef.current = start;
        didDragRef.current = false;

        const thresholdSq = thresholdPx * thresholdPx;

        const cleanup = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('blur', onBlur);
            pressStartRef.current = null;
        };
        const onMouseMove = (ev: MouseEvent) => {
            if (!pressStartRef.current) return;
            const dx = ev.clientX - start.x;
            const dy = ev.clientY - start.y;
            if (dx * dx + dy * dy < thresholdSq) return;

            didDragRef.current = true;
            cleanup();

            void getCurrentWindow().startDragging();
        };
        const onMouseUp = () => cleanup();
        const onBlur = () => cleanup();

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        window.addEventListener('blur', onBlur);
    }, [thresholdPx]);

    /** Returns true when the pending click was produced by a drag and must be ignored. */
    const shouldSwallowClick = useCallback(() => {
        if (!didDragRef.current) return false;
        didDragRef.current = false;
        return true;
    }, []);

    return { onMouseDown, shouldSwallowClick };
}