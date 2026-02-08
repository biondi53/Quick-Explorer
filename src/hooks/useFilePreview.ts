import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface PreviewResult {
    data: string;
    source: string;
}

interface PreviewState {
    previewUrl: string | null;
    isLoading: boolean;
    source?: string | null;
    dimensions?: string | null;
}

type FileType = 'video' | 'image' | 'none';

export function useFilePreview(filePath: string | null, type: FileType, modified: number = 0) {
    const [state, setState] = useState<PreviewState>({ previewUrl: null, isLoading: false, source: null, dimensions: null });
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
                setState({ previewUrl: null, isLoading: false, dimensions: null });
            }
            return;
        }

        // Clear previous timeout
        if (timeoutRef.current) {
            window.clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = window.setTimeout(async () => {
            if (!mountedRef.current) return;

            // Now set loading
            setState(prev => ({ ...prev, isLoading: true }));

            try {
                // Fetch thumbnail and dimensions in parallel
                const [thumbResult, dimsResult] = await Promise.all([
                    type === 'video'
                        ? invoke<PreviewResult>('get_video_thumbnail', { path: filePath, size: 256, modified })
                        : invoke<PreviewResult>('get_thumbnail', { path: filePath, size: 256, modified }),
                    invoke<string | null>('get_file_dimensions', { path: filePath })
                ]);

                if (mountedRef.current) {
                    setState({
                        previewUrl: thumbResult.data,
                        isLoading: false,
                        source: thumbResult.source,
                        dimensions: dimsResult
                    });
                }
            } catch (error) {
                console.error(`Failed to generate ${type} preview:`, error);
                if (mountedRef.current) {
                    setState({ previewUrl: null, isLoading: false, source: null, dimensions: null });
                }
            }
        }, 20);

    }, [filePath, type, modified]);

    return state;
}
