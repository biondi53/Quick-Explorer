import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronUp, ChevronDown, Check, SearchX, Search } from 'lucide-react';
import { getIconComponent } from '../utils/fileIcons';
import { useTranslation } from '../i18n/useTranslation';
import { isPreviewable } from '../utils/previewUtils';

import { FileEntry, ClipboardInfo } from '../types';
import { startDrag } from '@crabnebula/tauri-plugin-drag';
import { DRAG_ICON_BASE64 } from '../utils/dragIcon';

type SortColumn = 'name' | 'modified_at' | 'created_at' | 'file_type' | 'size';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
    column: SortColumn;
    direction: SortDirection;
}

interface FileTableProps {
    files: FileEntry[];
    currentPath: string;
    selectedFiles: FileEntry[];
    lastSelectedFile: FileEntry | null;
    onSelectMultiple: (files: FileEntry[], lastOne: FileEntry | null) => void;
    onOpen: (file: FileEntry) => void;
    onOpenInNewTab: (file: FileEntry) => void;
    onContextMenu: (e: React.MouseEvent, file: FileEntry | null) => void;
    onClearSelection: () => void;
    sortConfig: SortConfig;
    onSort: (column: SortColumn) => void;
    renamingPath: string | null;
    onRenameSubmit: (file: FileEntry, newName: string) => void;
    onRenameCancel: () => void;
    visibleColumns: SortColumn[];
    onToggleColumn: (column: SortColumn) => void;
    columnWidths: Partial<Record<SortColumn, number>>;
    onColumnsResize: (updates: Partial<Record<SortColumn, number>>) => void;
    clipboardInfo: ClipboardInfo | null;
    onInternalDragStart?: (paths: string[]) => void;
    onInternalDragEnd?: (caller: string) => void;
    forceScrollToSelected?: number;
    initialScrollIndex: number;
    onScrollChange: (index: number) => void;
    activeTabId: string;
    onOpenPreview?: (file: FileEntry) => void;
    onVisibleFilesChange?: (indices: number[]) => void;
    isDeepSearch?: boolean;
    isSearchActive?: boolean;
    isDeepSearching?: boolean;
    deepSearchStatus?: string;
}

const ITEM_HEIGHT = 42;

const COLUMN_CONFIG: Record<SortColumn, { key: string, width: string, minWidth?: string, align?: 'left' | 'right' }> = {
    name: { key: 'files.name', width: '1fr' },
    modified_at: { key: 'files.date_modified', width: '110px' },
    created_at: { key: 'files.date_created', width: '110px' },
    file_type: { key: 'files.type', width: '80px' },
    size: { key: 'files.size', width: '90px', align: 'right' }
};

interface ColumnMenuProps {
    x: number;
    y: number;
    visibleColumns: SortColumn[];
    onToggle: (col: SortColumn) => void;
    onClose: () => void;
}

const ColumnMenu = ({ x, y, visibleColumns, onToggle, onClose }: ColumnMenuProps) => {
    const { t } = useTranslation();
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        window.addEventListener('mousedown', handleClickOutside);
        return () => window.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    return (
        <div
            ref={menuRef}
            className="fixed z-[100] w-64 bg-[#05060f]/98 backdrop-blur-3xl rounded-xl py-2 shadow-[0_10px_40px_rgba(0,0,0,0.8)] animate-in fade-in zoom-in-95 duration-100"
            style={{ left: x, top: y }}
        >
            <div className="px-3 mb-2 text-[11px] font-black text-[var(--text-muted)] uppercase tracking-widest">{t('settings.visible_columns')}</div>
            {(Object.keys(COLUMN_CONFIG) as SortColumn[]).map(col => (
                <button
                    key={col}
                    onClick={() => onToggle(col)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-[var(--text-dim)] hover:bg-[var(--accent-primary)]/20 hover:text-white transition-all group"
                >
                    <span>{t(COLUMN_CONFIG[col].key as any)}</span>
                    {visibleColumns.includes(col) && <Check size={20} className="text-[var(--accent-primary)]" />}
                </button>
            ))}
        </div>
    );
};

const FileTable = memo(({
    files,
    currentPath,
    selectedFiles,
    lastSelectedFile,
    sortConfig,
    onSort,
    onSelectMultiple,
    onOpen,
    onOpenInNewTab,
    onContextMenu,
    onClearSelection,
    renamingPath,
    onRenameSubmit,
    onRenameCancel,
    visibleColumns,
    onToggleColumn,
    columnWidths,
    onColumnsResize,
    clipboardInfo,
    onInternalDragStart,
    onInternalDragEnd,
    forceScrollToSelected,
    initialScrollIndex,
    onScrollChange,
    activeTabId,
    onOpenPreview,
    onVisibleFilesChange,
    isDeepSearch,
    isSearchActive,
    isDeepSearching,
    deepSearchStatus
}: FileTableProps) => {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const [editValue, setEditValue] = useState("");
    const editInputRef = useRef<HTMLInputElement>(null);
    const autoFocusRef = useRef(false);
    const submittingRef = useRef(false);
    const [headerMenu, setHeaderMenu] = useState<{ x: number, y: number } | null>(null);

    // Native drag support
    const dragThresholdRef = useRef<{ x: number, y: number, paths: string[], element: HTMLElement } | null>(null);
    const selectedBeforeDownRef = useRef<boolean>(false);

    const selectedPaths = useMemo(() => {
        return new Set(selectedFiles.map(f => f.path));
    }, [selectedFiles]);

    const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'avif'];
    const VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'mpg', 'mpeg'];

    const handleDragStart = async (paths: string[], element?: HTMLElement) => {
        if (paths.length === 0) return;

        console.log('[FileTable] Starting drag for paths:', paths);

        if (onInternalDragStart) {
            onInternalDragStart(paths);
        }

        // Generate dynamic ghost icon
        const primaryFile = files.find(f => f.path === paths[0]);
        let iconBase64 = DRAG_ICON_BASE64;
        if (primaryFile) {
            const { createGhostIcon } = await import('../utils/ghostIcon');

            // JIT Thumbnail: Try to fetch a real thumbnail within 150ms for images/videos
            let thumbnailBase64: string | undefined;
            if (!primaryFile.is_dir) {
                const ext = primaryFile.name.split('.').pop()?.toLowerCase() || '';
                const isImage = IMAGE_EXTS.includes(ext);
                const isVideo = VIDEO_EXTS.includes(ext);
                if (isImage || isVideo) {
                    try {
                        const protocolUrl = `http://thumbnail.localhost/?path=${encodeURIComponent(primaryFile.path)}&s=256&m=${primaryFile.modified_timestamp}`;
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 150);
                        const response = await fetch(protocolUrl, { signal: controller.signal });
                        clearTimeout(timeoutId);
                        if (response.ok) {
                            const blob = await response.blob();
                            thumbnailBase64 = await new Promise<string>((resolve) => {
                                const reader = new FileReader();
                                reader.onloadend = () => resolve(reader.result as string);
                                reader.readAsDataURL(blob);
                            });
                        }
                    } catch {
                        // Timeout or shell error: fall back to generic icon
                    }
                }
            }

            iconBase64 = await createGhostIcon({
                name: primaryFile.name,
                isDir: primaryFile.is_dir,
                element: element,
                count: paths.length,
                thumbnailBase64,
            });
        }

        // @ts-ignore - 'icon' is required in types.
        startDrag({
            item: paths,
            icon: iconBase64,
            // @ts-ignore
            mode: 'copy'
        }).then(() => {
            console.log('[FileTable] Native drag completed successfully');
            if (onInternalDragEnd) onInternalDragEnd('promise-success');
        }).catch((err) => {
            console.error('[FileTable] Native drag failed or cancelled:', err);
            if (onInternalDragEnd) onInternalDragEnd('promise-error');
        });
    };


    // useVirtualizer for row virtualization
    const rowVirtualizer = useVirtualizer({
        count: files.length,
        getScrollElement: () => containerRef.current,
        estimateSize: () => ITEM_HEIGHT,
        overscan: 20,
    });

    // Robust Scroll Restoration using Index
    const initialScrollIndexRef = useRef(initialScrollIndex);
    const restoredTabIdRef = useRef<string | null>(null);
    const isRestoringRef = useRef(false);
    const [isReadyToRender, setIsReadyToRender] = useState(false);

    useEffect(() => {
        initialScrollIndexRef.current = initialScrollIndex;
    }, [initialScrollIndex]);

    useEffect(() => {
        if (restoredTabIdRef.current !== activeTabId) {
            restoredTabIdRef.current = null;
            setIsReadyToRender(false);
        }

        if (restoredTabIdRef.current === null && files.length > 0) {
            isRestoringRef.current = true;
            const t = setTimeout(() => {
                if (initialScrollIndexRef.current > 0) {
                    try {
                        rowVirtualizer.scrollToIndex(initialScrollIndexRef.current, { align: 'start' });
                    } catch (e) {
                        // ignore
                    }
                } else {
                    if (containerRef.current) {
                        containerRef.current.scrollTop = 0;
                    }
                }
                restoredTabIdRef.current = activeTabId;
                setIsReadyToRender(true);

                // Release shield after a short delay to allow browser to settle
                setTimeout(() => {
                    isRestoringRef.current = false;
                }, 150);
            }, 0);
            return () => clearTimeout(t);
        } else if (files.length === 0) {
            setIsReadyToRender(true);
        }
    }, [activeTabId, files.length, rowVirtualizer]);

    // Calculate grid template
    const gridTemplate = useMemo(() => {
        // Find if we have at least one flexible column currently visible.
        // If not, we make the first visible column '1fr' to take up space.
        return visibleColumns.map((col) => {
            const config = COLUMN_CONFIG[col];
            if (col === 'name') {
                return 'minmax(0, 1fr)';
            }
            const customWidth = columnWidths[col];
            if (customWidth) {
                if (col === 'size' && customWidth < 90) return '90px';
                return `${customWidth}px`;
            }
            return config.width;
        }).join(' ');
    }, [visibleColumns, columnWidths]);

    const isResizingRef = useRef<SortColumn | null>(null);
    const startXRef = useRef(0);

    const handleResizeStart = (e: React.MouseEvent, column: SortColumn) => {
        e.stopPropagation();
        e.preventDefault();

        // Find current column index and next visible column
        const colIdx = visibleColumns.indexOf(column);
        const nextCol = visibleColumns[colIdx + 1] || null;

        isResizingRef.current = column;
        startXRef.current = e.clientX;

        // Use more robust element selection via data attributes or careful parent traversal
        const headerRow = e.currentTarget.closest('[style*="grid-template-columns"]') as HTMLElement;
        if (!headerRow) return;

        const headerElements = Array.from(headerRow.children) as HTMLElement[];
        const currentHeader = headerElements[colIdx];

        const startWidth = currentHeader.getBoundingClientRect().width;

        if (!nextCol) {
            // Last column: independent resize
            const handleMouseMoveLast = (moveEvent: MouseEvent) => {
                if (isResizingRef.current) {
                    const delta = moveEvent.clientX - startXRef.current;
                    const newWidth = Math.max(60, startWidth + delta);
                    onColumnsResize({
                        [isResizingRef.current]: newWidth
                    });
                }
            };

            const handleMouseUpLast = () => {
                isResizingRef.current = null;
                window.removeEventListener('mousemove', handleMouseMoveLast);
                window.removeEventListener('mouseup', handleMouseUpLast);
                document.body.style.cursor = 'default';
            };

            document.body.style.cursor = 'col-resize';
            window.addEventListener('mousemove', handleMouseMoveLast);
            window.addEventListener('mouseup', handleMouseUpLast);
            return;
        }

        const nextHeader = headerElements[colIdx + 1];
        const nextColStartWidth = nextHeader.getBoundingClientRect().width;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (isResizingRef.current) {
                const delta = moveEvent.clientX - startXRef.current;

                // Neighbor Swap: Current grows, Next shrinks
                // Ensure both maintain a minimum width (e.g., 60px)
                const minWidth = 60;
                let actualDelta = delta;

                if (startWidth + delta < minWidth) {
                    actualDelta = minWidth - startWidth;
                } else if (nextColStartWidth - delta < minWidth) {
                    actualDelta = nextColStartWidth - minWidth;
                }

                const finalCurrentWidth = startWidth + actualDelta;
                const finalNextWidth = nextColStartWidth - actualDelta;

                onColumnsResize({
                    [isResizingRef.current]: finalCurrentWidth,
                    [nextCol]: finalNextWidth
                });
            }
        };

        const handleMouseUp = () => {
            isResizingRef.current = null;
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'default';
        };

        document.body.style.cursor = 'col-resize';
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    useEffect(() => {
        if (files.length > 0 && !autoFocusRef.current) {
            if (document.activeElement === document.body || document.activeElement === null) {
                containerRef.current?.focus({ preventScroll: true });
            }
            autoFocusRef.current = true;
        }
    }, [files]);

    // Auto-scroll to last selected file
    const lastScrolledFileRef = useRef<string | null>(lastSelectedFile?.path || null);
    const lastScrolledTabIdRef = useRef<string>(activeTabId);
    const prevForceScrollRef = useRef(forceScrollToSelected);

    useEffect(() => {
        // DETECT TAB SWITCH: If we switched tabs, we don't want to auto-scroll to selection
        // because we want to prioritize the restored scroll position.
        const tabChanged = lastScrolledTabIdRef.current !== activeTabId;
        if (tabChanged) {
            lastScrolledFileRef.current = lastSelectedFile?.path || null;
            lastScrolledTabIdRef.current = activeTabId;
            // No return here, just proceed with updated refs so we don't scroll
        }

        const forceTriggered = forceScrollToSelected !== undefined && forceScrollToSelected !== prevForceScrollRef.current;
        if (forceTriggered) {
            prevForceScrollRef.current = forceScrollToSelected;
        }

        if (lastSelectedFile && (lastSelectedFile.path !== lastScrolledFileRef.current || forceTriggered)) {
            const index = files.findIndex(f => f.path === lastSelectedFile.path);
            if (index !== -1) {
                try {
                    rowVirtualizer.scrollToIndex(index, { align: 'auto' });
                    lastScrolledFileRef.current = lastSelectedFile.path;
                } catch (e) {
                    // Ignore initialization errors
                }
            }
        } else if (!lastSelectedFile) {
            lastScrolledFileRef.current = null;
        }
    }, [lastSelectedFile, files, rowVirtualizer, forceScrollToSelected, activeTabId]);

    // Smart Reset: Only reset to top when navigating within the SAME tab
    const lastResetTabIdRef = useRef(activeTabId);
    const lastResetPathRef = useRef(currentPath);

    useEffect(() => {
        const tabChanged = lastResetTabIdRef.current !== activeTabId;
        const pathChanged = lastResetPathRef.current !== currentPath;

        if (pathChanged && !tabChanged) {
            if (containerRef.current) {
                containerRef.current.scrollTop = 0;
            }
            try {
                rowVirtualizer.scrollToOffset(0);
            } catch (e) {
                // Ignore
            }
        }

        lastResetTabIdRef.current = activeTabId;
        lastResetPathRef.current = currentPath;
    }, [currentPath, activeTabId, rowVirtualizer]);
    
    // Visibility Tracking
    const visibleItems = rowVirtualizer.getVirtualItems();
    const visibleIndices = useMemo(() => visibleItems.map(item => item.index), [visibleItems]);

    useEffect(() => {
        if (onVisibleFilesChange) {
            onVisibleFilesChange(visibleIndices);
        }
    }, [visibleIndices, onVisibleFilesChange]);

    // Reset submitting ref when renaming path changes
    useEffect(() => {
        submittingRef.current = false;
        if (renamingPath) {
            const fileToRename = files.find(f => f.path === renamingPath);
            if (fileToRename) {
                setEditValue(fileToRename.name);
                const lastDot = fileToRename.name.lastIndexOf('.');
                const selectionEnd = (!fileToRename.is_dir && lastDot > 0) ? lastDot : fileToRename.name.length;

                setTimeout(() => {
                    if (editInputRef.current) {
                        editInputRef.current.focus();
                        editInputRef.current.setSelectionRange(0, selectionEnd);
                    }
                }, 50);
            }
        }
    }, [renamingPath]); // Removed 'files' to avoid overwriting user typing on refresh



    const handleHeaderContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setHeaderMenu({ x: e.clientX, y: e.clientY });
    };

    const scrollTimeoutRef = useRef<any>(null);

    useEffect(() => {
        return () => {
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        };
    }, []);

    if (files.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)]" onContextMenu={(e) => onContextMenu(e, null)}>
                {(() => {
                    if (isDeepSearching) {
                        return <Search size={80} className="animate-pulse mb-4 text-[var(--accent-primary)]" />;
                    }
                    if (isSearchActive) {
                        return <SearchX size={80} className="mb-4" />;
                    }
                    const FolderIcon = getIconComponent({ name: '', is_dir: true, is_shortcut: false });
                    return <FolderIcon size={80} className="mb-4" />;
                })()}
                <p className="text-lg font-bold">
                    {isDeepSearching 
                        ? (deepSearchStatus && deepSearchStatus !== 'Search ready' ? `${t('toolbar.deep_search_active')} (${deepSearchStatus === 'Indexing HDD...' ? t('files.indexing_hdd') : deepSearchStatus})` : t('toolbar.deep_search_active'))
                        : (isSearchActive ? t('files.no_search_results') : t('files.empty_folder'))
                    }
                </p>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onClearSelection();
                }
            }}
            onScroll={(e) => {
                const scrollTop = e.currentTarget.scrollTop;
                if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

                // ESCUDO: Ignore programmatic scrolls during restoration
                if (isRestoringRef.current) return;

                scrollTimeoutRef.current = setTimeout(() => {
                    const virtualItems = rowVirtualizer.getVirtualItems();
                    // REVERSION: Use center-based detection for "natural" manual scroll feel.
                    // The "Restoration Shield" (isRestoringRef) already handles the drift.
                    const firstVisible = virtualItems.find(item => (item.start + (item.size / 2)) > scrollTop);
                    if (firstVisible) {
                        onScrollChange(firstVisible.index);
                    } else if (scrollTop === 0) {
                        onScrollChange(0);
                    }
                }, 150);
            }}
            className={`flex-1 overflow-y-auto overflow-x-hidden bg-transparent select-none relative outline-none focus:ring-0 transition-opacity duration-150 ${isReadyToRender ? 'opacity-100' : 'opacity-0'}`}
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (files.length === 0) return;

                    const now = performance.now();
                    const container = containerRef.current;
                    if (now - (container as any)?._lastNavTime < 16) return;
                    (container as any)._lastNavTime = now;

                    const anchorIndex = lastSelectedFile ? files.findIndex(f => f.path === lastSelectedFile.path) : -1;

                    if (anchorIndex === -1) {
                        const firstFile = files[0];
                        onSelectMultiple([firstFile], firstFile);
                        return;
                    }

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
                        currentFocusIndex = (anchorIndex === minIdx) ? maxIdx : minIdx;
                    }

                    let nextIndex = 0;
                    if (e.key === 'ArrowDown') nextIndex = Math.min(currentFocusIndex + 1, files.length - 1);
                    else nextIndex = Math.max(currentFocusIndex - 1, 0);

                    const nextFile = files[nextIndex];

                    if (container) {
                        rowVirtualizer.scrollToIndex(nextIndex, { align: 'auto' });
                    }

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
            onContextMenu={(e) => {
                if (!e.defaultPrevented) onContextMenu(e, null);
            }}
        >
            {/* Table Header */}
            <div
                className="sticky top-0 bg-[var(--bg-deep)] z-20 px-2 h-11 shrink-0 grid items-center gap-2"
                style={{ gridTemplateColumns: gridTemplate }}
                onContextMenu={handleHeaderContextMenu}
            >
                {visibleColumns.map((col) => (
                    <div
                        key={col}
                        className="relative h-full flex items-center group/header"
                    >
                        <div
                            className={`flex-1 text-[11px] font-bold text-[var(--text-muted)] hover:text-white cursor-pointer flex items-center gap-1.5 truncate h-full ${COLUMN_CONFIG[col].align === 'right' ? 'justify-end' : ''}`}
                            onClick={() => onSort(col)}
                        >
                            {t(COLUMN_CONFIG[col].key as any)}
                            {sortConfig.column === col && (
                                sortConfig.direction === 'asc' ? <ChevronUp size={12} className="text-[var(--accent-primary)]" /> : <ChevronDown size={12} className="text-[var(--accent-primary)]" />
                            )}
                        </div>

                        {/* Resizer handle */}
                        <div
                            className="absolute right-0 top-0 bottom-0 w-4 -mr-2 cursor-col-resize z-30 group"
                            onMouseDown={(e) => handleResizeStart(e, col)}
                        >
                            <div className="absolute right-2 top-3 bottom-3 w-[1px] bg-white/5 group-hover:bg-[var(--accent-primary)]/40 transition-colors" />
                        </div>
                    </div>
                ))}
            </div>

            {/* Virtualized Rows Container */}
            <div
                style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                }}
                onClick={(e) => { if (e.target === e.currentTarget) onClearSelection(); }}
            >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const file = files[virtualRow.index];
                    if (!file) return null;
                    const isSelected = selectedFiles.some(f => f.path === file.path);
                    const isClipboardItem = clipboardInfo?.paths.includes(file.path);
                    return (
                        <div
                            key={file.path}
                            className={`grid items-center h-[42px] px-2 file-row group cursor-default transition-all duration-200 gap-2
                                ${isClipboardItem ? 'opacity-40' : 'opacity-100'}
                                ${isSelected ? 'bg-[var(--accent-primary)]/10 text-white' : 'hover:bg-white/[0.04] text-[var(--text-dim)]'}`}
                            style={{
                                gridTemplateColumns: gridTemplate,
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: `${virtualRow.size}px`,
                                transform: `translateY(${virtualRow.start}px)`,
                            }}
                            onMouseDown={(e) => {
                                if (e.button === 1) { e.preventDefault(); return; } // Prevent autoscroll
                                if (e.button !== 0) return;

                                const isSelectedAtStart = selectedPaths.has(file.path);
                                selectedBeforeDownRef.current = isSelectedAtStart;

                                // If item is NOT selected, select it immediately (for visual feedback)
                                if (!isSelectedAtStart && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
                                    onSelectMultiple([file], file);
                                } else if (!isSelected && (e.ctrlKey || e.metaKey)) {
                                    onSelectMultiple([...selectedFiles, file], file);
                                } else if (!isSelected && e.shiftKey && lastSelectedFile) {
                                    const lastIndex = files.findIndex(f => f.path === lastSelectedFile.path);
                                    const currentIndex = virtualRow.index;
                                    if (lastIndex !== -1 && currentIndex !== -1) {
                                        const start = Math.min(lastIndex, currentIndex);
                                        const end = Math.max(lastIndex, currentIndex);
                                        onSelectMultiple(files.slice(start, end + 1), lastSelectedFile);
                                    }
                                }

                                // Prepare for potential drag
                                const pathsToDrag = (isSelected || e.ctrlKey || e.metaKey || e.shiftKey)
                                    ? (isSelected ? Array.from(selectedPaths) : [...Array.from(selectedPaths), file.path])
                                    : [file.path];

                                dragThresholdRef.current = {
                                    x: e.clientX,
                                    y: e.clientY,
                                    paths: pathsToDrag,
                                    element: e.currentTarget as HTMLElement
                                };

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
                                        const element = dragThresholdRef.current.element;
                                        dragThresholdRef.current = null;
                                        window.removeEventListener('mousemove', onMouseMove);
                                        window.removeEventListener('mouseup', onMouseUp);
                                        handleDragStart(finalPaths, element);
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
                            }}
                            onClick={(e) => {
                                if (e.button !== 0) return;
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
                            }}
                            onDoubleClick={() => {
                                if (renamingPath !== file.path) {
                                    onOpen(file);
                                }
                            }}
                            onAuxClick={(e) => {
                                if (e.button === 1) {
                                    e.preventDefault();
                                    if (file.is_dir) {
                                        onOpenInNewTab(file);
                                    } else if (onOpenPreview && isPreviewable(file)) {
                                        onOpenPreview(file);
                                    }
                                }
                            }}
                            onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, file); }}
                        >
                            {visibleColumns.map(col => (
                                <div key={col} className={`min-w-0 truncate ${COLUMN_CONFIG[col].align === 'right' ? 'text-right font-mono font-bold' : ''}`}>
                                    {col === 'name' ? (
                                        <div className="flex items-center gap-3">
                                            <div className="flex-shrink-0 w-[18px] h-[18px] flex items-center justify-center">
                                                {(() => {
                                                    const IconComponent = getIconComponent(file);
                                                    return <IconComponent size={16} className={`${file.is_dir ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'} ${isSelected ? 'text-white' : 'group-hover:text-white'} transition-colors duration-200`} />;
                                                })()}
                                            </div>
                                            {renamingPath === file.path ? (
                                                <input
                                                    ref={editInputRef}
                                                    className="bg-[var(--accent-primary)]/20 border border-[var(--accent-primary)]/50 rounded px-1.5 py-0.5 text-sm text-white outline-none w-full"
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    onBlur={() => {
                                                        if (submittingRef.current) return;
                                                        submittingRef.current = true;
                                                        onRenameSubmit(file, editValue);
                                                    }}
                                                    onKeyDown={(e) => {
                                                        e.stopPropagation(); // Prevent grid navigation
                                                        if (e.key === 'Enter') {
                                                            if (submittingRef.current) return;
                                                            submittingRef.current = true;
                                                            onRenameSubmit(file, editValue);
                                                        } else if (e.key === 'Escape') {
                                                            onRenameCancel();
                                                        }
                                                    }}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onDoubleClick={(e) => {
                                                        e.stopPropagation();
                                                        // Default behavior for double click on text is to select the word
                                                    }}
                                                />
                                            ) : (
                                                <span className={`text-sm truncate transition-colors ${isSelected ? 'text-white font-bold' : 'text-[var(--text-dim)] font-medium group-hover:text-white'}`}>
                                                    {file.name}
                                                    {isDeepSearch && (
                                                        <span className="ml-2 opacity-50 text-[10px] font-normal leading-none">
                                                            ({file.path.substring(0, file.path.lastIndexOf('\\'))})
                                                        </span>
                                                    )}
                                                </span>
                                            )}
                                        </div>
                                    ) : (
                                        <span className={`text-xs ${col === 'size' ? 'text-[var(--text-muted)] font-mono' : 'text-[var(--text-muted)] font-light'}`}>
                                            {col === 'modified_at' && file.modified_at}
                                            {col === 'created_at' && file.created_at}
                                            {col === 'file_type' && (
                                                file.is_dir
                                                    ? t('files.folder')
                                                    : file.is_shortcut
                                                        ? t('preview.shortcut')
                                                        : file.file_type.endsWith(' File')
                                                            ? `${file.file_type.replace(' File', '')} ${t('files.file').toLowerCase()}`
                                                            : file.file_type === 'File' ? t('files.file') : file.file_type
                                            )}
                                            {col === 'size' && (
                                                file.is_calculating_size ? (
                                                    <div className="relative overflow-hidden rounded px-1 py-0.5 inline-flex items-center justify-center min-w-[75px]">
                                                        <div className="absolute inset-0 animate-progress-indeterminate rounded bg-black/5"></div>
                                                        <span className="relative z-10 text-[var(--accent-primary)] text-[10px] uppercase font-bold tracking-wide opacity-90 animate-pulse w-full text-center">
                                                            {t('preview.calculating') || 'Calculando...'}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    file.formatted_size
                                                )
                                            )}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>

            {
                headerMenu && (
                    <ColumnMenu
                        x={headerMenu.x}
                        y={headerMenu.y}
                        visibleColumns={visibleColumns}
                        onToggle={onToggleColumn}
                        onClose={() => setHeaderMenu(null)}
                    />
                )
            }
        </div >
    );
});

export default FileTable;
