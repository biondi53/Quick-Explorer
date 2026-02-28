import React, { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { FileEntry } from '../types';

interface QuickPreviewProps {
    file: FileEntry;
    onClose: () => void;
    onNavigate: (direction: 'next' | 'prev') => void;
}

interface PreviewTextResult {
    content: string;
    is_truncated: boolean;
}

const QuickPreview: React.FC<QuickPreviewProps> = ({ file, onClose, onNavigate }) => {
    const [textContent, setTextContent] = useState<string | null>(null);
    const [isTruncated, setIsTruncated] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const containerRef = useRef<HTMLDivElement>(null);
    const lastScrollTime = useRef<number>(0);

    const ext = file.path.split('.').pop()?.toLowerCase() || '';

    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
    const isVideo = ['mp4', 'webm', 'ogg'].includes(ext);
    const isAudio = ['mp3', 'wav', 'ogg'].includes(ext);
    const isText = ['txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'json', 'css', 'html', 'rs', 'py', 'log', 'ini', 'cfg', 'csv'].includes(ext);

    useEffect(() => {
        let isMounted = true;

        // Reset state when file changes
        setIsLoading(true);
        setTextContent(null);
        setError(null);
        setIsTruncated(false);

        const loadContent = async () => {
            if (isText) {
                try {
                    const result = await invoke<PreviewTextResult>('read_preview_text', { path: file.path });
                    if (isMounted) {
                        setTextContent(result.content);
                        setIsTruncated(result.is_truncated);
                    }
                } catch (err) {
                    if (isMounted) setError(String(err));
                } finally {
                    if (isMounted) setIsLoading(false);
                }
            } else {
                // Images and Media don't need explicit loading through rust for base V1, browser handles it via asset/src
                setIsLoading(false);
            }
        };

        if (!file.is_dir) {
            loadContent();
        } else {
            setIsLoading(false);
        }

        return () => {
            isMounted = false;
        };
    }, [file.path, isText, file.is_dir]);

    // Handle click outside to close
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget || e.target === containerRef.current) {
            onClose();
        }
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, [onClose]);

    const getFileIcon = (fileName: string, isDir: boolean) => {
        if (isDir) return '📁';
        const ext = fileName.split('.').pop()?.toLowerCase();
        switch (ext) {
            case 'pdf': return '📄';
            case 'zip': case 'rar': case '7z': return '🗜️';
            case 'exe': case 'msi': return '⚙️';
            default: return '📄';
        }
    };

    const handleWheel = (e: React.WheelEvent) => {
        if (isText) return; // Allow normal scrolling for text

        const now = Date.now();
        if (now - lastScrollTime.current < 150) return; // Throttle to prevent skipping multiple files

        if (e.deltaY > 0) {
            onNavigate('next');
            lastScrollTime.current = now;
        } else if (e.deltaY < 0) {
            onNavigate('prev');
            lastScrollTime.current = now;
        }
    };

    const renderContent = () => {
        if (file.is_dir) {
            return renderFallback(file);
        }

        if (isLoading) {
            return <div className="text-white/50 text-xl animate-pulse">Loading preview...</div>;
        }

        if (error) {
            return (
                <div className="text-red-400 bg-red-400/10 p-6 rounded-lg border border-red-400/20">
                    <h3 className="text-lg font-bold mb-2">Preview Error</h3>
                    <p>{error}</p>
                </div>
            );
        }

        if (isImage) {
            const src = convertFileSrc(file.path);
            return (
                <img
                    src={src}
                    alt={file.name}
                    className="max-w-full max-h-full object-contain rounded drop-shadow-2xl"
                />
            );
        }

        if (isVideo) {
            const src = convertFileSrc(file.path);
            return (
                <video
                    src={src}
                    controls
                    autoPlay
                    className="max-w-full max-h-[85vh] rounded drop-shadow-2xl bg-black/50"
                />
            );
        }

        if (isAudio) {
            const src = convertFileSrc(file.path);
            return (
                <div className="bg-white/5 p-8 rounded-xl border border-white/10 backdrop-blur-md flex flex-col items-center gap-6 min-w-[300px]">
                    <div className="text-6xl">🎵</div>
                    <p className="text-white font-medium text-lg leading-tight text-center break-all">{file.name}</p>
                    <audio src={src} controls autoPlay className="w-full" />
                </div>
            );
        }

        if (isText && textContent !== null) {
            return (
                <div className="w-full max-w-5xl h-full max-h-[85vh] flex flex-col bg-[#1e1e1e] rounded-xl border border-white/10 shadow-2xl overflow-hidden cursor-default" onClick={(e) => e.stopPropagation()}>
                    <div className="bg-black/40 border-b border-white/5 px-4 py-3 flex justify-between items-center text-sm font-mono text-white/70">
                        <span className="truncate">{file.name}</span>
                        {isTruncated && <span className="text-yellow-500/80 bg-yellow-500/10 px-2 py-0.5 rounded text-xs">Preview Truncated</span>}
                    </div>
                    <div className="flex-1 overflow-auto p-4 text-white/90 font-mono text-sm leading-relaxed whitespace-pre-wrap">
                        {textContent || <span className="text-white/30 italic">Empty file</span>}
                    </div>
                </div>
            );
        }

        // Fallback for unsupported types
        return renderFallback(file);
    };

    const renderFallback = (f: FileEntry) => (
        <div className="bg-white/5 p-10 rounded-2xl border border-white/10 backdrop-blur-md flex flex-col items-center gap-4 max-w-md w-full shadow-2xl transform transition-transform duration-300 cursor-default" onClick={(e) => e.stopPropagation()}>
            <div className="text-8xl mb-4 drop-shadow-lg">{getFileIcon(f.name, f.is_dir)}</div>
            <h2 className="text-white font-bold text-2xl text-center break-all mb-2 leading-tight">{f.name}</h2>

            <div className="w-full space-y-3 mt-4 text-sm text-white/70">
                <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-white/50">Type</span>
                    <span>{f.file_type}</span>
                </div>
                {!f.is_dir && (
                    <div className="flex justify-between border-b border-white/5 pb-2">
                        <span className="text-white/50">Size</span>
                        <span>{f.formatted_size}</span>
                    </div>
                )}
                <div className="flex justify-between pb-2">
                    <span className="text-white/50">Modified</span>
                    <span>{f.modified_at}</span>
                </div>
            </div>
        </div>
    );

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-8 animate-in fade-in duration-200"
            onMouseDown={handleBackdropClick}
            onWheel={handleWheel}
        >
            <div
                ref={containerRef}
                className="relative flex items-center justify-center w-full h-full animate-in zoom-in-95 duration-200"
                onMouseDown={handleBackdropClick}
            >
                <div className="absolute top-0 left-0 text-white/90 font-medium text-lg drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] pointer-events-none select-none z-10 px-4 py-2 bg-black/20 rounded-lg backdrop-blur-md border border-white/10">
                    {file.name}
                </div>
                {renderContent()}
            </div>
        </div>
    );
};

export default QuickPreview;
