import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { invoke } from '@tauri-apps/api/core';
import {
    Link as LinkIcon
} from 'lucide-react';
import { getIconComponent } from '../utils/fileIcons';

import { FileEntry, ClipboardInfo } from '../types';

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
}

const ITEM_SIZE = 120;
const GAP = 8;
const MAX_CONCURRENT = 6;
const THUMBNAIL_TIMEOUT = 10000;

// Load thumbnails for images and videos (IShellItemImageFactory handles both)
const shouldLoadThumbnail = (file: FileEntry) => {
    if (file.is_dir) return false;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'avif'];
    const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'mpg', 'mpeg'];
    return imageExts.includes(ext) || videoExts.includes(ext);
};

// ===== THUMBNAIL MANAGER WITH CANCELLATION =====
let currentSessionId = 0;
let activeRequests = 0;

interface ThumbnailRequest {
    path: string;
    sessionId: number;
    callback: (data: string | null) => void;
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

    const thumbnailPromise = invoke<string>('get_thumbnail', { path: request.path, size: 128 });
    const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), THUMBNAIL_TIMEOUT)
    );

    Promise.race([thumbnailPromise, timeoutPromise])
        .then(data => {
            if (request.sessionId === currentSessionId) {
                request.callback(data);
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

const requestThumbnail = (path: string, callback: (data: string | null) => void) => {
    pendingQueue.push({ path, sessionId: currentSessionId, callback });
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
    onSelect: (file: FileEntry, event: React.MouseEvent) => void;
    onOpen: (file: FileEntry) => void;
    onOpenInNewTab: (file: FileEntry) => void;
    onContextMenu: (e: React.MouseEvent, file: FileEntry | null) => void;
    isRenaming: boolean;
    onRenameSubmit: (file: FileEntry, newName: string) => void;
    onRenameCancel: () => void;
    isClipboardItem: boolean;
}

const GridItem = memo(({ file, isSelected, onSelect, onOpen, onOpenInNewTab, onContextMenu, isRenaming, onRenameSubmit, onRenameCancel, isClipboardItem }: GridItemProps) => {
    const [thumbnail, setThumbnail] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [editValue, setEditValue] = useState("");
    const editInputRef = useRef<HTMLInputElement>(null);
    const requestedRef = useRef(false);

    useEffect(() => {
        // Reset on file change
        requestedRef.current = false;
        setThumbnail(null);
        setLoading(false);
    }, [file.path]);

    useEffect(() => {
        if (isRenaming && editInputRef.current) {
            setEditValue(file.name);
            const lastDot = file.name.lastIndexOf('.');
            const selectionEnd = (!file.is_dir && lastDot > 0) ? lastDot : file.name.length;

            setTimeout(() => {
                if (editInputRef.current) {
                    editInputRef.current.focus();
                    editInputRef.current.setSelectionRange(0, selectionEnd);
                }
            }, 0);
        }
    }, [isRenaming, file.name, file.is_dir]);

    useEffect(() => {
        if (requestedRef.current || thumbnail || !shouldLoadThumbnail(file)) return;

        requestedRef.current = true;
        setLoading(true);

        requestThumbnail(file.path, (data) => {
            setThumbnail(data);
            setLoading(false);
        });
    }, [file.path, thumbnail]);

    const Icon = getIconComponent(file);

    return (
        <div
            className={`
                flex flex-col items-center justify-center p-2 rounded-xl cursor-pointer
                transition-all duration-150 group
                ${isClipboardItem ? 'opacity-40' : 'opacity-100'}
                ${isSelected
                    ? 'bg-[var(--accent-primary)]/20 ring-2 ring-[var(--accent-primary)]/50'
                    : 'hover:bg-white/5'
                }
            `}
            onClick={(e) => onSelect(file, e)}
            onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault(); // Prevent autoscroll
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
            <div className="w-16 h-16 flex items-center justify-center mb-2 relative">
                {thumbnail ? (
                    <img
                        src={thumbnail}
                        alt={file.name}
                        className="w-full h-full object-cover rounded-lg shadow-md"
                    />
                ) : loading ? (
                    <div className="w-12 h-12 rounded-lg bg-white/5 animate-pulse" />
                ) : (
                    <Icon
                        size={48}
                        className={`
                            ${file.is_dir ? 'text-amber-400' : 'text-zinc-400'}
                            group-hover:scale-110 transition-transform
                        `}
                        fill={file.is_dir ? 'rgba(251, 191, 36, 0.2)' : 'none'}
                    />
                )}

                {file.is_shortcut && (
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-zinc-800 rounded-full flex items-center justify-center border border-zinc-600">
                        <LinkIcon size={10} className="text-blue-400" />
                    </div>
                )}
            </div>

            {isRenaming ? (
                <input
                    ref={editInputRef}
                    className="mt-1 bg-[var(--accent-primary)]/20 border border-[var(--accent-primary)]/50 rounded px-1.5 py-0.5 text-[11px] text-white outline-none w-full text-center"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => onRenameSubmit(file, editValue)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
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
                        ${isSelected ? 'text-white font-medium' : 'text-zinc-300'}
                    `}
                    title={file.name}
                >
                    {file.name}
                </span>
            )}
        </div>
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
    clipboardInfo
}: FileGridProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(800);

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

    const handleSelect = useCallback((file: FileEntry, event: React.MouseEvent) => {
        event.stopPropagation();

        if (event.ctrlKey || event.metaKey) {
            const isSelected = selectedPaths.has(file.path);
            if (isSelected) {
                onSelectMultiple(selectedFiles.filter(f => f.path !== file.path), file);
            } else {
                onSelectMultiple([...selectedFiles, file], file);
            }
        } else if (event.shiftKey && lastSelectedFile) {
            const lastIndex = files.findIndex(f => f.path === lastSelectedFile.path);
            const currentIndex = files.findIndex(f => f.path === file.path);

            if (lastIndex !== -1 && currentIndex !== -1) {
                const start = Math.min(lastIndex, currentIndex);
                const end = Math.max(lastIndex, currentIndex);
                const range = files.slice(start, end + 1);
                onSelectMultiple(range, file);
            }
        } else {
            onSelectMultiple([file], file);
        }
    }, [selectedFiles, files, lastSelectedFile, onSelectMultiple, selectedPaths]);

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

    return (
        <div
            ref={containerRef}
            className="flex-1 overflow-auto p-4"
            onClick={handleContainerClick}
            onContextMenu={handleContainerContextMenu}
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
                                    onSelect={handleSelect}
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
