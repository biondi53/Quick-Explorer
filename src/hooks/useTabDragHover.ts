
import { useRef, useCallback } from 'react';

export function useTabDragHover(onSwitchTab: (tabId: string) => void, delay = 400) {
    const hoverTimeoutRef = useRef<number | null>(null);
    const lastHoveredTabRef = useRef<string | null>(null);

    const handleDragOver = useCallback((e: React.DragEvent, tabId: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';

        if (lastHoveredTabRef.current !== tabId) {
            // New tab hovered
            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
            }
            lastHoveredTabRef.current = tabId;
            hoverTimeoutRef.current = window.setTimeout(() => {
                onSwitchTab(tabId);
                hoverTimeoutRef.current = null;
            }, delay);
        }
    }, [onSwitchTab, delay]);

    const handleDragLeave = useCallback(() => {
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }
        lastHoveredTabRef.current = null;
    }, []);


    return { handleDragOver, handleDragLeave };
}
