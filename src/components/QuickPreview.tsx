import React, { useEffect, useState, useRef, useCallback } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { Trash, RotateCw, Lock } from 'lucide-react';
import { FileEntry } from '../types';
import { useTranslation } from '../i18n/useTranslation';
import { IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS, TEXT_EXTS } from '../utils/previewUtils';

interface QuickPreviewProps {
    file: FileEntry;
    onClose: () => void;
    onNavigate: (direction: 'next' | 'prev') => void;
    onDelete: () => Promise<boolean>;
}

interface PreviewTextResult {
    content: string;
    is_truncated: boolean;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 5.0;
const ZOOM_STEP = 0.1;
const CLICK_ZOOM_STEP = 0.5;

const QuickPreview: React.FC<QuickPreviewProps> = ({ file, onClose, onNavigate, onDelete }) => {
    const { t } = useTranslation();
    const [textContent, setTextContent] = useState<string | null>(null);
    const [isTruncated, setIsTruncated] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [scale, setScale] = useState(1.0);
    const [showZoomIndicator, setShowZoomIndicator] = useState(false);
    const [translate, setTranslate] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [rotation, setRotation] = useState(0);
    const [mediaAspect, setMediaAspect] = useState(1);

    const containerRef = useRef<HTMLDivElement>(null);
    const lastScrollTime = useRef<number>(0);
    const zoomIndicatorTimer = useRef<number | undefined>(undefined);
    const videoSettings = useRef({ muted: true, volume: 1.0 });
    const dragStart = useRef({ x: 0, y: 0 });
    const mouseDownPos = useRef({ x: 0, y: 0 });
    const textContentRef = useRef<HTMLDivElement>(null);
    const mediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null);
    const lastRightClickTime = useRef<number>(0);

    const ext = file.path.split('.').pop()?.toLowerCase() || '';

    const isImage = IMAGE_EXTS.includes(ext);
    const isVideo = VIDEO_EXTS.includes(ext);
    const isAudio = AUDIO_EXTS.includes(ext);
    const isText = TEXT_EXTS.includes(ext);
    const isZoomable = isImage || (isVideo && ext !== 'ogg'); // Selective zoom for video, ogg might be audio-only

    // Reset state when file changes
    useEffect(() => {
        let isMounted = true;

        setIsLoading(true);
        setTextContent(null);
        setError(null);
        setIsTruncated(false);
        setScale(1.0);
        setShowZoomIndicator(false);
        setTranslate({ x: 0, y: 0 });
        setIsDragging(false);
        setRotation(0);
        setMediaAspect(1);

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

    const triggerZoomIndicator = useCallback(() => {
        setShowZoomIndicator(true);
        if (zoomIndicatorTimer.current) window.clearTimeout(zoomIndicatorTimer.current);
        zoomIndicatorTimer.current = window.setTimeout(() => {
            setShowZoomIndicator(false);
        }, 1200);
    }, []);

    // Handle click outside to close
    const handleBackdropClick = (e: React.MouseEvent) => {
        // Prevent closing if we are currently dragging a zoomed image
        if (isDragging) return;

        if (e.target === e.currentTarget || e.target === containerRef.current) {
            onClose();
        }
    };

    // Helper to calculate delta instead of absolute position for smooth panning
    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging || scale <= 1) return;

        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;

        setTranslate({ x: dx, y: dy });
    }, [isDragging, scale]);

    const handleMouseUp = useCallback(() => {
        if (isDragging) setIsDragging(false);
    }, [isDragging]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        // Only start drag if clicking on the media itself, and we are zoomed
        if (scale > 1 && isZoomable) {
            mouseDownPos.current = { x: e.clientX, y: e.clientY };
            if (e.target instanceof HTMLImageElement || e.target instanceof HTMLVideoElement) {
                e.preventDefault(); // Prevent default image drag
                setIsDragging(true);
                dragStart.current = {
                    x: e.clientX - translate.x,
                    y: e.clientY - translate.y
                };
            }
        }
    }, [scale, isZoomable, translate]);

    const handleManualZoom = useCallback((delta: number) => {
        if (!isZoomable) return;

        setScale(prev => {
            const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, parseFloat((prev + delta).toFixed(2))));
            if (next === 1.0) {
                setTranslate({ x: 0, y: 0 });
            }
            return next;
        });
        triggerZoomIndicator();
    }, [isZoomable, triggerZoomIndicator]);

    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
        if (!isZoomable) return;
        e.preventDefault();
        handleManualZoom(CLICK_ZOOM_STEP);
    }, [isZoomable, handleManualZoom]);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        if (!isZoomable) return;

        const now = Date.now();
        const timespan = now - lastRightClickTime.current;
        lastRightClickTime.current = now;

        if (timespan < 300) {
            // Double right click detected
            e.preventDefault();
            handleManualZoom(-CLICK_ZOOM_STEP);
        }
    }, [isZoomable, handleManualZoom]);

    const handleAuxClick = useCallback((e: React.MouseEvent) => {
        if (e.button === 1) { // Middle-click
            e.preventDefault();
            e.stopPropagation();
            onClose();
        }
    }, [onClose]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (scale !== 1.0 || rotation !== 0) {
                    setScale(1.0);
                    setTranslate({ x: 0, y: 0 });
                    setRotation(0);
                    triggerZoomIndicator();
                } else {
                    onClose();
                }
            } else if (e.key === 'Delete') {
                e.preventDefault();
                e.stopPropagation();
                handleDelete(e as any);
            }
        };
        window.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, [onClose, scale, triggerZoomIndicator, file.path]);

    const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await onDelete();
        } catch (error) {
            console.error("Error deleting file:", error);
        }
    };

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
        // Ctrl+Scroll: zoom for images and videos
        if (e.ctrlKey && isZoomable) {
            e.preventDefault();
            const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
            setScale(prev => {
                const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, parseFloat((prev + delta).toFixed(2))));
                if (next === 1.0) {
                    setTranslate({ x: 0, y: 0 });
                }
                return next;
            });
            triggerZoomIndicator();
            return;
        }

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

    const getCompensationScale = () => {
        if (rotation % 180 === 0) return 1;
        const cw = window.innerWidth - 64;
        const ch = window.innerHeight - 110;

        let a = mediaAspect;
        if (mediaRef.current) {
            if (mediaRef.current instanceof HTMLImageElement && mediaRef.current.naturalWidth) {
                a = mediaRef.current.naturalWidth / mediaRef.current.naturalHeight;
            } else if (mediaRef.current instanceof HTMLVideoElement && mediaRef.current.videoWidth) {
                a = mediaRef.current.videoWidth / mediaRef.current.videoHeight;
            }
        }

        const fit = Math.min(cw / a, ch / 1);
        const rw = a * fit;
        const rh = 1 * fit;
        const rad = (rotation * Math.PI) / 180;
        const absCos = Math.abs(Math.cos(rad));
        const absSin = Math.abs(Math.sin(rad));
        const boundingW = rw * absCos + rh * absSin;
        const boundingH = rw * absSin + rh * absCos;
        const scaleX = cw / boundingW;
        const scaleY = ch / boundingH;
        return Math.min(1, scaleX, scaleY);
    };

    const renderFallback = (f: FileEntry) => (
        <div className="bg-white/5 p-10 rounded-2xl border border-white/10 backdrop-blur-md flex flex-col items-center gap-4 max-w-md w-full shadow-2xl transform transition-transform duration-300 cursor-default" onClick={(e) => e.stopPropagation()}>
            <div className="text-8xl mb-4 drop-shadow-lg">{getFileIcon(f.name, f.is_dir)}</div>
            <h2 className="text-white font-bold text-2xl text-center break-all mb-2 leading-tight">{f.name}</h2>

            <div className="w-full space-y-3 mt-4 text-sm text-white/70">
                <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-white/50">{t('preview.type')}</span>
                    <span>{file.is_dir
                        ? t('files.folder')
                        : file.is_shortcut
                            ? t('preview.shortcut')
                            : file.file_type.endsWith(' File')
                                ? `${file.file_type.replace(' File', '')} ${t('files.file').toLowerCase()}`
                                : file.file_type === 'File' ? t('files.file') : file.file_type
                    }</span>
                </div>
                {!f.is_dir && (
                    <div className="flex justify-between border-b border-white/5 pb-2">
                        <span className="text-white/50">{t('preview.size')}</span>
                        <span>{f.formatted_size}</span>
                    </div>
                )}
                <div className="flex justify-between pb-2">
                    <span className="text-white/50">{t('preview.modified')}</span>
                    <span>{f.modified_at}</span>
                </div>
            </div>
        </div>
    );

    const renderContent = () => {
        const compScale = getCompensationScale();
        if (file.is_dir) {
            return renderFallback(file);
        }

        if (isLoading) {
            return <div className="text-white/50 text-xl animate-pulse">{t('preview.loading')}</div>;
        }

        if (error) {
            const isAccessDenied = error.toLowerCase().includes('acceso denegado') || error.toLowerCase().includes('os error 5');

            if (isAccessDenied) {
                return (
                    <div className="bg-white/5 p-10 rounded-2xl border border-white/10 backdrop-blur-md flex flex-col items-center gap-4 max-w-md w-full shadow-2xl transform transition-transform duration-300 cursor-default" onClick={(e) => e.stopPropagation()}>
                        <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-2">
                            <Lock size={40} className="text-red-400" />
                        </div>
                        <h2 className="text-white font-bold text-xl text-center break-all mb-1 leading-tight">
                            {t('preview.access_denied_title')}
                        </h2>
                        <p className="text-white/60 text-sm text-center leading-relaxed">
                            {t('preview.access_denied_msg')}
                        </p>

                        <div className="w-full h-px bg-white/5 my-2" />

                        <div className="w-full text-xs text-white/30 font-mono text-center overflow-hidden text-ellipsis whitespace-nowrap">
                            {file.name}
                        </div>
                    </div>
                );
            }

            return (
                <div className="text-red-400 bg-red-400/10 p-6 rounded-lg border border-red-400/20">
                    <h3 className="text-lg font-bold mb-2">{t('preview.error_title')}</h3>
                    <p>{error}</p>
                </div>
            );
        }

        if (isImage) {
            const src = convertFileSrc(file.path);
            return (
                <img
                    ref={mediaRef as React.Ref<HTMLImageElement>}
                    src={src}
                    alt={file.name}
                    onLoad={(e) => setMediaAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
                    onDoubleClick={handleDoubleClick}
                    onContextMenu={handleContextMenu}
                    className="rounded drop-shadow-2xl"
                    style={{
                        height: '100%',
                        transform: `scale(${scale * compScale}) translate(${translate.x / scale}px, ${translate.y / scale}px) rotate(${rotation}deg)`,
                        transformOrigin: 'center center',
                        transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                        maxWidth: '100%',
                        maxHeight: '100%',
                        objectFit: 'contain',
                        outline: 'none',
                        cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
                    }}
                    draggable={false}
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
                    loop
                    onClickCapture={(e) => {
                        if (scale > 1) {
                            const dx = e.clientX - mouseDownPos.current.x;
                            const dy = e.clientY - mouseDownPos.current.y;
                            const distance = Math.sqrt(dx * dx + dy * dy);
                            if (distance > 5) {
                                e.stopPropagation();
                                e.preventDefault();
                            }
                        }
                    }}
                    onVolumeChange={(e) => {
                        videoSettings.current.muted = e.currentTarget.muted;
                        videoSettings.current.volume = e.currentTarget.volume;
                    }}
                    ref={(el) => {
                        if (el) {
                            el.muted = videoSettings.current.muted;
                            el.volume = videoSettings.current.volume;
                        }
                        mediaRef.current = el;
                    }}
                    onLoadedMetadata={(e) => setMediaAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight)}
                    onDoubleClick={handleDoubleClick}
                    onContextMenu={handleContextMenu}
                    className="rounded drop-shadow-2xl bg-black/50"
                    style={{
                        height: '100%',
                        objectFit: 'contain',
                        transform: `scale(${scale * compScale}) translate(${translate.x / scale}px, ${translate.y / scale}px) rotate(${rotation}deg)`,
                        transformOrigin: 'center center',
                        transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                        maxWidth: '100%',
                        maxHeight: '100%',
                        outline: 'none',
                        cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
                    }}
                />
            );
        }

        if (isAudio) {
            const src = convertFileSrc(file.path);
            return (
                <div className="bg-white/5 p-8 rounded-xl border border-white/10 backdrop-blur-md flex flex-col items-center gap-6 min-w-[300px]">
                    <div className="text-6xl">🎵</div>
                    <p className="text-white font-medium text-lg leading-tight text-center break-all">{file.name}</p>
                    <audio src={src} controls autoPlay loop className="w-full" />
                </div>
            );
        }

        if (isText && textContent !== null) {
            return (
                <div
                    className="w-full max-w-5xl h-full max-h-[85vh] flex flex-col bg-[#1e1e1e] rounded-xl border border-white/10 shadow-2xl overflow-hidden cursor-default"
                    onClick={(e) => e.stopPropagation()}
                    onWheel={(e) => {
                        if (textContentRef.current) {
                            const { scrollHeight, clientHeight } = textContentRef.current;
                            // Only stop propagation (preventing navigation) if there is actual content to scroll
                            if (scrollHeight > clientHeight) {
                                e.stopPropagation();
                            }
                        }
                    }}
                >
                    <div className="bg-black/40 border-b border-white/5 px-4 py-2 flex justify-end items-center text-sm font-mono text-white/70">
                        {isTruncated && <span className="text-yellow-500/80 bg-yellow-500/10 px-2 py-0.5 rounded text-xs">{t('preview.truncated')}</span>}
                    </div>
                    <div
                        className="flex-1 overflow-auto p-4 text-white/90 font-mono text-sm leading-relaxed whitespace-pre-wrap"
                        ref={textContentRef}
                    >
                        {textContent || <span className="text-white/30 italic">{t('preview.empty_file')}</span>}
                    </div>
                </div>
            );
        }

        // Fallback for unsupported types
        return renderFallback(file);
    };

    return (
        <div
            className="fixed inset-0 z-[9999] overflow-hidden flex items-center justify-center bg-black/60 backdrop-blur-sm p-8 animate-in fade-in duration-200"
            onMouseDown={(e) => {
                handleMouseDown(e);
                handleBackdropClick(e);
            }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            onAuxClick={handleAuxClick}
        >
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2 bg-black/40 rounded-xl backdrop-blur-md border border-white/10 shadow-xl animate-in zoom-in-95 duration-200">
                <span className="text-white/90 font-medium text-lg pointer-events-none select-none drop-shadow-md">
                    {file.name}
                </span>
                {isZoomable && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setRotation(r => r + 90);
                        }}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all duration-200 border border-white/5 backdrop-blur-sm outline-none"
                        title={t('preview.rotate')}
                    >
                        <RotateCw size={18} />
                    </button>
                )}
                <button
                    onClick={handleDelete}
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/80 text-white/70 hover:text-white transition-all duration-200 border border-white/5 hover:border-red-400/50 backdrop-blur-sm outline-none"
                    title={t('preview.move_to_trash')}
                >
                    <Trash size={18} />
                </button>
            </div>

            <div
                className="flex-1 w-full h-full flex items-center justify-center pt-20 relative animate-in zoom-in-95 duration-200"
                ref={containerRef}
            >
                {renderContent()}

                {/* Zoom indicator */}
                {isZoomable && (
                    <div
                        className="absolute bottom-4 right-4 z-10 px-3 py-1.5 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg text-white/90 text-sm font-mono select-none pointer-events-none transition-opacity duration-300"
                        style={{ opacity: showZoomIndicator ? 1 : 0 }}
                    >
                        {Math.round(scale * 100)}%
                        {scale !== 1 && <span className="text-white/40 ml-2 text-xs">{t('preview.esc_to_reset')}</span>}
                    </div>
                )}
            </div>
        </div>
    );
};

export default QuickPreview;
