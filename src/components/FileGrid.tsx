import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { invoke } from '@tauri-apps/api/core';
import {
    Link as LinkIcon,
    Play
} from 'lucide-react';
import { getIconComponent } from '../utils/fileIcons';

import { FileEntry, ClipboardInfo } from '../types';
import { startDrag } from '@crabnebula/tauri-plugin-drag';
import { resolveResource } from '@tauri-apps/api/path';
import GlowCard from './ui/GlowCard';

interface FileGridProps {
    files: FileEntry[];
    currentPath: string; // For cancellation on folder change
    selectedFiles: FileEntry[];
    lastSelectedFile: FileEntry | null;
    onSelectMultiple: (files: FileEntry[], lastOne: FileEntry | null) => void;
    onOpen: (file: FileEntry) => void;
    onOpenInNewTab: (file: FileEntry) => void;
    onContextMenu: (e: React.MouseEvent, file: FileEntry | null) => void;
    onClearSelection: () => void;
    renamingPath: string | null;
    onRenameSubmit: (file: FileEntry, newName: string) => void;
    onRenameCancel: () => void;
    clipboardInfo: ClipboardInfo | null;
    onInternalDragStart?: (paths: string[]) => void;
    onInternalDragEnd?: (caller: string) => void;
}

const ITEM_SIZE = 160;
const GAP = 8;
const MAX_CONCURRENT = 6;
const THUMBNAIL_TIMEOUT = 10000;

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'avif'];
const VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'mpg', 'mpeg'];

// Load thumbnails for images and videos (IShellItemImageFactory handles both)
const shouldLoadThumbnail = (file: FileEntry) => {
    if (file.is_dir) return false;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return IMAGE_EXTS.includes(ext) || VIDEO_EXTS.includes(ext);
};

// ===== THUMBNAIL MANAGER WITH CANCELLATION =====
let currentSessionId = 0;
let activeRequests = 0;

interface ThumbnailResult {
    data: string;
    source: string;
}

interface ThumbnailRequest {
    path: string;
    is_video: boolean;
    modified: number;
    sessionId: number;
    callback: (result: ThumbnailResult | null) => void;
}

const pendingQueue: ThumbnailRequest[] = [];

const processNext = () => {
    if (activeRequests >= MAX_CONCURRENT || pendingQueue.length === 0) return;

    const request = pendingQueue.shift()!;

    // Skip if session changed (folder changed)
    if (request.sessionId !== currentSessionId) {
        processNext();
        return;
    }

    activeRequests++;

    const command = request.is_video ? 'get_video_thumbnail' : 'get_thumbnail';
    const thumbnailPromise = invoke<ThumbnailResult>(command, { path: request.path, size: 256, modified: request.modified });
    const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), THUMBNAIL_TIMEOUT)
    );

    Promise.race([thumbnailPromise, timeoutPromise])
        .then(res => {
            if (request.sessionId === currentSessionId) {
                request.callback(res);
            }
        })
        .catch(() => {
            if (request.sessionId === currentSessionId) {
                request.callback(null);
            }
        })
        .finally(() => {
            activeRequests = Math.max(0, activeRequests - 1);
            processNext();
        });
};

const requestThumbnail = (path: string, is_video: boolean, modified: number, callback: (result: ThumbnailResult | null) => void) => {
    pendingQueue.push({ path, is_video, modified, sessionId: currentSessionId, callback });
    processNext();
};

const cancelAllPending = () => {
    currentSessionId++;
    pendingQueue.length = 0;
    // Note: activeRequests is NOT reset to 0 here because pending promises
    // will decrement it correctly as they finish.
};
// ===== END THUMBNAIL MANAGER =====

interface GridItemProps {
    file: FileEntry;
    isSelected: boolean;
    onMouseDown: (file: FileEntry, event: React.MouseEvent) => void;
    onClick: (file: FileEntry, event: React.MouseEvent) => void;
    onOpen: (file: FileEntry) => void;
    onOpenInNewTab: (file: FileEntry) => void;
    onContextMenu: (e: React.MouseEvent, file: FileEntry | null) => void;
    isRenaming: boolean;
    onRenameSubmit: (file: FileEntry, newName: string) => void;
    onRenameCancel: () => void;
    isClipboardItem: boolean;
}

const GridItem = memo(({ file, isSelected, onMouseDown, onClick, onOpen, onOpenInNewTab, onContextMenu, isRenaming, onRenameSubmit, onRenameCancel, isClipboardItem }: GridItemProps) => {
    const [thumbnail, setThumbnail] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [editValue, setEditValue] = useState("");
    const editInputRef = useRef<HTMLInputElement>(null);
    const requestedRef = useRef(false);
    const submittingRef = useRef(false);

    useEffect(() => {
        // Reset on file change
        requestedRef.current = false;
        submittingRef.current = false;
        setThumbnail(null);
        setLoading(false);
    }, [file.path, file.modified_timestamp]);

    useEffect(() => {
        if (isRenaming && editInputRef.current) {
            submittingRef.current = false;
            setEditValue(file.name);
            const lastDot = file.name.lastIndexOf('.');
            const selectionEnd = (!file.is_dir && lastDot > 0) ? lastDot : file.name.length;

            setTimeout(() => {
                if (editInputRef.current) {
                    editInputRef.current.focus();
                    editInputRef.current.setSelectionRange(0, selectionEnd);
                }
            }, 50);
        }
    }, [isRenaming]); // Only trigger when isRenaming state changes

    useEffect(() => {
        if (requestedRef.current || thumbnail || !shouldLoadThumbnail(file)) return;

        requestedRef.current = true;
        setLoading(true);

        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const isVideo = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'mpg', 'mpeg'].includes(ext);

        requestThumbnail(file.path, isVideo, file.modified_timestamp, (result) => {
            if (result) {
                setThumbnail(result.data);
            }
            setLoading(false);
        });
    }, [file.path, file.modified_timestamp, thumbnail]);

    const Icon = getIconComponent(file);

    return (
        <GlowCard className="rounded-xl" glowColor="rgba(var(--accent-rgb), 0.15)">
            <div
                className={`
                    flex flex-col items-center justify-center p-2 rounded-xl cursor-default
                    transition-all duration-150 group h-full w-full
                    ${isClipboardItem ? 'opacity-40' : 'opacity-100'}
                    ${isSelected
                        ? 'bg-[var(--accent-primary)]/20 ring-2 ring-[var(--accent-primary)]/50'
                        : 'hover:bg-white/5'
                    }
                `}
                onMouseDown={(e) => {
                    if (e.button === 1) { e.preventDefault(); return; } // Prevent autoscroll
                    if (e.button !== 0) return;
                    onMouseDown(file, e);
                }}
                onClick={(e) => {
                    if (e.button !== 0) return;
                    onClick(file, e);
                }}
                onDoubleClick={() => onOpen(file)}
                onAuxClick={(e) => {
                    if (e.button === 1 && file.is_dir) {
                        e.preventDefault();
                        onOpenInNewTab(file);
                    }
                }}
                onContextMenu={(e) => onContextMenu(e, file)}
                style={{ width: ITEM_SIZE, height: ITEM_SIZE }}
            >
                <div className="w-28 h-28 flex items-center justify-center mb-2 relative">
                    {thumbnail ? (
                        <>
                            <img
                                src={thumbnail}
                                alt={file.name}
                                className="w-full h-full object-cover rounded-lg shadow-md"
                            />
                            {/* Thumbnail source indicator commented out for now */}
                        </>
                    ) : loading ? (
                        <div className="w-12 h-12 rounded-lg bg-white/5 animate-pulse" />
                    ) : (
                        <Icon
                            size={80}
                            className={`
                                ${file.is_dir ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'}
                                group-hover:scale-110 transition-transform
                            `}
                            fill={file.is_dir ? 'rgba(var(--accent-rgb), 0.2)' : 'none'}
                        />
                    )}

                    {file.is_shortcut && (
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-zinc-800 rounded-full flex items-center justify-center border border-zinc-600">
                            <LinkIcon size={10} className="text-blue-400" />
                        </div>
                    )}

                    {/* Video Indicator */}
                    {!file.is_dir && VIDEO_EXTS.includes(file.name.split('.').pop()?.toLowerCase() || '') && (
                        <div className="absolute bottom-1 right-1 bg-zinc-900/80 text-white p-1 rounded-full shadow-md border border-white/30 flex items-center justify-center backdrop-blur-sm">
                            <Play size={10} fill="currentColor" className="ml-[1px]" />
                        </div>
                    )}
                </div>

                {isRenaming ? (
                    <input
                        ref={editInputRef}
                        className="mt-1 bg-[var(--accent-primary)]/20 border border-[var(--accent-primary)]/50 rounded px-1.5 py-0.5 text-[11px] text-white outline-none w-full text-center"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => {
                            if (submittingRef.current) return;
                            submittingRef.current = true;
                            onRenameSubmit(file, editValue);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                if (submittingRef.current) return;
                                submittingRef.current = true;
                                onRenameSubmit(file, editValue);
                            } else if (e.key === 'Escape') {
                                onRenameCancel();
                            }
                        }}
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <span
                        className={`
                            text-[11px] text-center leading-tight line-clamp-2 w-full px-1 mt-1
                            ${isSelected ? 'text-white font-medium' : 'text-[var(--text-dim)]'}
                        `}
                        title={file.name}
                    >
                        {file.name}
                    </span>
                )}
            </div>
        </GlowCard>
    );
});

export default function FileGrid({
    files,
    currentPath,
    selectedFiles,
    lastSelectedFile,
    onSelectMultiple,
    onOpen,
    onOpenInNewTab,
    onContextMenu,
    onClearSelection,
    renamingPath,
    onRenameSubmit,
    onRenameCancel,
    clipboardInfo,
    onInternalDragStart,
    onInternalDragEnd
}: FileGridProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(800);
    const [dragIconPath, setDragIconPath] = useState<string | null>(null);
    const selectedBeforeDownRef = useRef<boolean>(false);

    useEffect(() => {
        resolveResource('icons/32x32.png')
            .then(path => {
                console.log('[FileGrid] Resolved drag icon path:', path);
                setDragIconPath(path);
            })
            .catch(err => {
                console.error('[FileGrid] Failed to resolve drag icon:', err);
                // Fallback attempt for development
                setDragIconPath('icons/32x32.png');
            });
    }, []);

    const lastPathRef = useRef<string | null>(null);
    if (lastPathRef.current !== currentPath) {
        cancelAllPending();
        lastPathRef.current = currentPath;
    }

    // Still keep this for completeness/unmount
    useEffect(() => {
        return () => cancelAllPending();
    }, []);

    const columns = useMemo(() => {
        return Math.max(1, Math.floor((containerWidth + GAP) / (ITEM_SIZE + GAP)));
    }, [containerWidth]);

    const rowCount = useMemo(() => {
        return Math.ceil(files.length / columns);
    }, [files.length, columns]);

    const rowVirtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => containerRef.current,
        estimateSize: () => ITEM_SIZE + GAP,
        overscan: 2,
    });

    useEffect(() => {
        if (!containerRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });

        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    const selectedPaths = useMemo(() => {
        return new Set(selectedFiles.map(f => f.path));
    }, [selectedFiles]);

    // Auto-scroll to last selected file
    useEffect(() => {
        if (lastSelectedFile) {
            const index = files.findIndex(f => f.path === lastSelectedFile.path);
            if (index !== -1) {
                const rowIndex = Math.floor(index / columns);
                rowVirtualizer.scrollToIndex(rowIndex, { align: 'auto' });
            }
        }
    }, [lastSelectedFile, files, columns, rowVirtualizer]);

    const handleContainerClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClearSelection();
        }
    }, [onClearSelection]);

    const handleContainerContextMenu = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onContextMenu(e, null);
        }
    }, [onContextMenu]);

    const getRowItems = useCallback((rowIndex: number) => {
        const startIndex = rowIndex * columns;
        return files.slice(startIndex, startIndex + columns);
    }, [files, columns]);

    const dragThresholdRef = useRef<{ x: number, y: number, paths: string[] } | null>(null);

    // Native drag handler using manual threshold
    const handleDragStart = useCallback((paths: string[]) => {
        if (paths.length === 0) return;

        console.log('[FileGrid] Starting drag for paths:', paths);
        console.log('[FileGrid] Using icon path:', dragIconPath);

        if (onInternalDragStart) {
            onInternalDragStart(paths);
        }

        if (!dragIconPath) return;

        // @ts-ignore - 'icon' is required in types.
        startDrag({
            item: paths,
            icon: dragIconPath,
            // @ts-ignore
            mode: 'copy'
        }).then(() => {
            console.log('[FileGrid] Native drag completed successfully');
            if (onInternalDragEnd) onInternalDragEnd('promise-success');
        }).catch((err) => {
            console.error('[FileGrid] Native drag failed or cancelled:', err);
            if (onInternalDragEnd) onInternalDragEnd('promise-error');
        });
    }, [dragIconPath, onInternalDragStart]);

    // Handler for mousedown on items - handles immediate selection and prepares drag
    const handleItemMouseDown = useCallback((file: FileEntry, e: React.MouseEvent) => {
        const isSelectedAtStart = selectedPaths.has(file.path);
        selectedBeforeDownRef.current = isSelectedAtStart;

        // If item is NOT selected, select it immediately (for visual feedback)
        if (!isSelectedAtStart && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
            onSelectMultiple([file], file);
        } else if (!isSelectedAtStart && (e.ctrlKey || e.metaKey)) {
            onSelectMultiple([...selectedFiles, file], file);
        } else if (!isSelectedAtStart && e.shiftKey && lastSelectedFile) {
            const lastIndex = files.findIndex(f => f.path === lastSelectedFile.path);
            const currentIndex = files.findIndex(f => f.path === file.path);
            if (lastIndex !== -1 && currentIndex !== -1) {
                const start = Math.min(lastIndex, currentIndex);
                const end = Math.max(lastIndex, currentIndex);
                onSelectMultiple(files.slice(start, end + 1), lastSelectedFile);
            }
        }

        // Prepare for potential drag
        const pathsToDrag = (isSelectedAtStart || e.ctrlKey || e.metaKey || e.shiftKey)
            ? (isSelectedAtStart ? Array.from(selectedPaths) : [...Array.from(selectedPaths), file.path])
            : [file.path];

        dragThresholdRef.current = { x: e.clientX, y: e.clientY, paths: pathsToDrag };

        // IMMEDIATE HANDSHAKE (v7.0): Set lock on mousedown to preempt OS race conditions
        // @ts-ignore
        window.__SPEED_EXPLORER_DND_LOCK = true;

        const onMouseMove = (moveEvent: MouseEvent) => {
            if (!dragThresholdRef.current) return;
            const dx = moveEvent.clientX - dragThresholdRef.current.x;
            const dy = moveEvent.clientY - dragThresholdRef.current.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 5) { // 5px threshold
                const finalPaths = dragThresholdRef.current.paths;
                dragThresholdRef.current = null;
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                handleDragStart(finalPaths);
            }
        };

        const onMouseUp = () => {
            // If we are here, threshold wasn't met -> Release lock if it wasn't a real drag
            if (dragThresholdRef.current) {
                // @ts-ignore
                window.__SPEED_EXPLORER_DND_LOCK = false;
            }
            dragThresholdRef.current = null;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, [selectedPaths, selectedFiles, files, lastSelectedFile, onSelectMultiple, handleDragStart]);

    // Handler for click on items - handles deselection logic for already-selected items
    const handleItemClick = useCallback((file: FileEntry, e: React.MouseEvent) => {
        const isSelected = selectedPaths.has(file.path);

        // Handle click on an already-selected item (user released without dragging)
        if (isSelected) {
            if (e.ctrlKey || e.metaKey) {
                // Ctrl+click on selected: remove from selection if it was selected BEFORE mousedown
                if (selectedBeforeDownRef.current) {
                    onSelectMultiple(selectedFiles.filter(f => f.path !== file.path), lastSelectedFile);
                }
            } else if (!e.shiftKey) {
                // Plain click on selected item in multi-selection: select only this item
                onSelectMultiple([file], file);
            }
        }
        // For unselected items, selection was already handled in onMouseDown
    }, [selectedPaths, selectedFiles, lastSelectedFile, onSelectMultiple]);

    return (
        <div
            ref={containerRef}
            className="flex-1 overflow-auto p-4 outline-none focus:ring-0"
            tabIndex={0}
            onClick={handleContainerClick}
            onContextMenu={handleContainerContextMenu}
            onKeyDown={(e) => {
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                    e.preventDefault();
                    if (files.length === 0) return;

                    const anchorIndex = lastSelectedFile ? files.findIndex(f => f.path === lastSelectedFile.path) : -1;
                    if (anchorIndex === -1) {
                        const firstFile = files[0];
                        onSelectMultiple([firstFile], firstFile);
                        return;
                    }

                    // Infer current focus from selection
                    let currentFocusIndex = anchorIndex;
                    if (selectedFiles.length > 1) {
                        let minIdx = files.length;
                        let maxIdx = -1;
                        selectedFiles.forEach(f => {
                            const idx = files.findIndex(file => file.path === f.path);
                            if (idx !== -1) {
                                minIdx = Math.min(minIdx, idx);
                                maxIdx = Math.max(maxIdx, idx);
                            }
                        });
                        // Focus is the end furthest from anchor
                        currentFocusIndex = (anchorIndex === minIdx) ? maxIdx : minIdx;
                    }

                    let nextIndex = currentFocusIndex;
                    if (e.key === 'ArrowDown') nextIndex = Math.min(currentFocusIndex + columns, files.length - 1);
                    else if (e.key === 'ArrowUp') nextIndex = Math.max(currentFocusIndex - columns, 0);
                    else if (e.key === 'ArrowRight') nextIndex = Math.min(currentFocusIndex + 1, files.length - 1);
                    else if (e.key === 'ArrowLeft') nextIndex = Math.max(currentFocusIndex - 1, 0);

                    const nextFile = files[nextIndex];

                    if (e.shiftKey) {
                        const start = Math.min(anchorIndex, nextIndex);
                        const end = Math.max(anchorIndex, nextIndex);
                        const newSelection = files.slice(start, end + 1);
                        onSelectMultiple(newSelection, lastSelectedFile);
                    } else {
                        onSelectMultiple([nextFile], nextFile);
                    }
                }

                // Shift+Home/End: Select range to start/end
                if ((e.key === 'Home' || e.key === 'End') && e.shiftKey) {
                    e.preventDefault();
                    if (files.length === 0) return;

                    const anchorIndex = lastSelectedFile
                        ? files.findIndex(f => f.path === lastSelectedFile.path)
                        : 0;
                    const targetIndex = e.key === 'Home' ? 0 : files.length - 1;
                    const start = Math.min(anchorIndex, targetIndex);
                    const end = Math.max(anchorIndex, targetIndex);

                    onSelectMultiple(files.slice(start, end + 1), lastSelectedFile);

                    // Scroll to edge
                    const container = containerRef.current;
                    if (container) {
                        if (e.key === 'Home') {
                            container.scrollTop = 0;
                        } else {
                            container.scrollTop = container.scrollHeight;
                        }
                    }
                }
            }}
        >
            <div
                style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                }}
            >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const rowItems = getRowItems(virtualRow.index);

                    return (
                        <div
                            key={virtualRow.key}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: `${virtualRow.size}px`,
                                transform: `translateY(${virtualRow.start}px)`,
                            }}
                            className="flex gap-2"
                        >
                            {rowItems.map((file) => (
                                <GridItem
                                    key={file.path}
                                    file={file}
                                    isSelected={selectedPaths.has(file.path)}
                                    onMouseDown={handleItemMouseDown}
                                    onClick={handleItemClick}
                                    onOpen={onOpen}
                                    onOpenInNewTab={onOpenInNewTab}
                                    onContextMenu={onContextMenu}
                                    isRenaming={renamingPath === file.path}
                                    onRenameSubmit={onRenameSubmit}
                                    onRenameCancel={onRenameCancel}
                                    isClipboardItem={clipboardInfo?.paths.includes(file.path) || false}
                                />
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
