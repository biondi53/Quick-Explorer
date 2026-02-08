
import { getCurrentWindow } from '@tauri-apps/api/window';

export const isDragSafe = (e: React.MouseEvent): boolean => {
    // Check if the target is interactive or explicitly marked no-drag
    const target = e.target as HTMLElement;

    // Check if we clicked on or inside a no-drag element or interactive element
    const noDragElement = target.closest('.no-drag, button, a, [role="button"], input, textarea, select');

    // Return true if NO interactive element was found
    return !noDragElement;
};

export const handleWindowDrag = (e: React.MouseEvent) => {
    // Only drag on left click
    if (e.button !== 0) return;

    // Don't drag if default was prevented (handled by child)
    if (e.defaultPrevented) return;

    // Use our helper to check if it's safe to drag
    if (!isDragSafe(e)) {
        return;
    }

    // Start the native window drag
    getCurrentWindow().startDragging();
};
