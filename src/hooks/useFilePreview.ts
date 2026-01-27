import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface PreviewState {
    previewUrl: string | null;
    isLoading: boolean;
}

type FileType = 'video' | 'image' | 'none';

export function useFilePreview(filePath: string | null, type: FileType) {
    const [state, setState] = useState<PreviewState>({ previewUrl: null, isLoading: false });
    const timeoutRef = useRef<number | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (timeoutRef.current) {
                window.clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!filePath || type === 'none') {
            // Optimization: Prevent redundant updates if already cleared
            if (state.previewUrl !== null || state.isLoading !== false) {
                setState({ previewUrl: null, isLoading: false });
            }
            return;
        }

        // Clear previous timeout
        if (timeoutRef.current) {
            window.clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = window.setTimeout(async () => {
            if (!mountedRef.current) return;

            // Now set loading (this will trigger a render with "Loading...")
            setState(prev => ({ ...prev, isLoading: true }));

            try {
                let url = '';
                if (type === 'video') {
                    url = await invoke<string>('get_video_thumbnail', { path: filePath });
                } else if (type === 'image') {
                    // Use fast shell thumbnail (uses Windows cache) instead of reading whole file
                    url = await invoke<string>('get_thumbnail', { path: filePath, size: 1024 });
                }

                if (mountedRef.current) {
                    setState({ previewUrl: url, isLoading: false });
                }
            } catch (error) {
                console.error(`Failed to generate ${type} preview:`, error);
                if (mountedRef.current) {
                    setState({ previewUrl: null, isLoading: false });
                }
            }
        }, 100);

    }, [filePath, type]);

    return state;
}
