import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { ChevronUp, ChevronDown, Check } from 'lucide-react';
import { getIconComponent } from '../utils/fileIcons';

import { FileEntry, ClipboardInfo } from '../types';

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
}

const ITEM_HEIGHT = 42;
const HEADER_HEIGHT = 44;
const BUFFER_ITEMS = 40;

const COLUMN_CONFIG: Record<SortColumn, { label: string, width: string, minWidth?: string, align?: 'left' | 'right' }> = {
    name: { label: 'Name', width: '1fr' },
    modified_at: { label: 'Date modified', width: '110px' },
    created_at: { label: 'Date created', width: '110px' },
    file_type: { label: 'Type', width: '80px' },
    size: { label: 'Size', width: '60px', align: 'right' }
};

interface ColumnMenuProps {
    x: number;
    y: number;
    visibleColumns: SortColumn[];
    onToggle: (col: SortColumn) => void;
    onClose: () => void;
}

const ColumnMenu = ({ x, y, visibleColumns, onToggle, onClose }: ColumnMenuProps) => {
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
            className="fixed z-[100] w-64 bg-[#0f111a]/95 backdrop-blur-3xl border border-white/10 rounded-xl py-2 shadow-[0_10px_35px_rgba(0,0,0,0.7)] animate-in fade-in zoom-in-95 duration-100"
            style={{ left: x, top: y }}
        >
            <div className="px-3 mb-2 text-[11px] font-black text-zinc-500 uppercase tracking-widest">Visible Columns</div>
            {(Object.keys(COLUMN_CONFIG) as SortColumn[]).map(col => (
                <button
                    key={col}
                    onClick={() => onToggle(col)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-zinc-300 hover:bg-[var(--accent-primary)]/20 hover:text-white transition-all group"
                >
                    <span>{COLUMN_CONFIG[col].label}</span>
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
    clipboardInfo
}: FileTableProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [renderWindow, setRenderWindow] = useState({ start: 0, end: BUFFER_ITEMS * 2, translateY: 0 });
    const [editValue, setEditValue] = useState("");
    const editInputRef = useRef<HTMLInputElement>(null);
    const [containerHeight, setContainerHeight] = useState(800);
    const autoFocusRef = useRef(false);
    const [headerMenu, setHeaderMenu] = useState<{ x: number, y: number } | null>(null);

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
            if (customWidth) return `${customWidth}px`;
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

    // RESET SCROLL AND WINDOW ON PATH CHANGE
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = 0;
            updateWindowImmediate(0, containerHeight);
        }
    }, [currentPath]);

    // SYNC WINDOW ON FILES OR HEIGHT CHANGE
    useEffect(() => {
        if (containerRef.current) {
            const scrollTop = containerRef.current.scrollTop;
            updateWindowImmediate(scrollTop, containerHeight);
        }
    }, [containerHeight, files]);

    const rafRef = useRef<number | null>(null);
    const pendingScrollRef = useRef<{ scrollTop: number, height: number } | null>(null);

    const updateWindowImmediate = (scrollTop: number, height: number) => {
        const effectiveScrollTop = Math.max(0, scrollTop - HEADER_HEIGHT);
        const start = Math.max(0, Math.floor(effectiveScrollTop / ITEM_HEIGHT) - BUFFER_ITEMS);
        const end = Math.min(
            files.length,
            Math.ceil((scrollTop + height) / ITEM_HEIGHT) + BUFFER_ITEMS
        );
        const translateY = start * ITEM_HEIGHT;

        setRenderWindow(prev => {
            if (prev.start === start && prev.end === end) return prev;
            return { start, end, translateY };
        });
    };

    const updateWindow = (scrollTop: number, height: number) => {
        pendingScrollRef.current = { scrollTop, height };
        if (rafRef.current === null) {
            rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null;
                if (pendingScrollRef.current) {
                    updateWindowImmediate(pendingScrollRef.current.scrollTop, pendingScrollRef.current.height);
                    pendingScrollRef.current = null;
                }
            });
        }
    };

    useEffect(() => {
        if (!containerRef.current) return;
        const measureHeight = () => {
            if (containerRef.current) {
                const height = containerRef.current.clientHeight;
                if (height > 0) {
                    setContainerHeight(height);
                    updateWindow(containerRef.current.scrollTop, height);
                }
            }
        };

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const height = entry.contentRect.height || (entry.target as HTMLElement).clientHeight;
                if (height > 0) {
                    setContainerHeight(height);
                    if (containerRef.current) {
                        updateWindow(containerRef.current.scrollTop, height);
                    }
                }
            }
        });

        observer.observe(containerRef.current);
        measureHeight();
        window.addEventListener('resize', measureHeight);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', measureHeight);
        };
    }, []);

    useEffect(() => {
        if (renamingPath && editInputRef.current) {
            const file = files.find(f => f.path === renamingPath);
            if (file) {
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
        }
    }, [renamingPath, files]);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        updateWindow(e.currentTarget.scrollTop, containerHeight);
    };

    const visibleFiles = useMemo(() => {
        return files.slice(renderWindow.start, renderWindow.end);
    }, [files, renderWindow]);

    const handleHeaderContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setHeaderMenu({ x: e.clientX, y: e.clientY });
    };

    if (files.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-600" onContextMenu={(e) => onContextMenu(e, null)}>
                {(() => {
                    const FolderIcon = getIconComponent({ name: '', is_dir: true, is_shortcut: false });
                    return <FolderIcon size={48} className="opacity-10 mb-4" />;
                })()}
                <p className="text-sm">This folder is empty</p>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            onScroll={handleScroll}
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onClearSelection();
                }
            }}
            className="flex-1 overflow-y-auto overflow-x-hidden bg-transparent select-none relative outline-none focus:ring-0"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (files.length === 0) return;
                    const now = performance.now();
                    if (now - (containerRef.current as any)?._lastNavTime < 16) return;
                    (containerRef.current as any)._lastNavTime = now;

                    let nextIndex = 0;
                    if (selectedFiles.length > 0 && lastSelectedFile) {
                        const currentIndex = files.findIndex(f => f.path === lastSelectedFile.path);
                        if (currentIndex !== -1) {
                            if (e.key === 'ArrowDown') nextIndex = Math.min(currentIndex + 1, files.length - 1);
                            else nextIndex = Math.max(currentIndex - 1, 0);
                        }
                    }
                    const nextFile = files[nextIndex];
                    if (lastSelectedFile && nextFile.path === lastSelectedFile.path && selectedFiles.length === 1) return;

                    if (containerRef.current) {
                        const container = containerRef.current;
                        const rowTop = HEADER_HEIGHT + (nextIndex * ITEM_HEIGHT);
                        const rowBottom = rowTop + ITEM_HEIGHT;
                        if (rowTop < container.scrollTop + HEADER_HEIGHT) container.scrollTop = rowTop - HEADER_HEIGHT;
                        else if (rowBottom > container.scrollTop + container.clientHeight) container.scrollTop = rowBottom - container.clientHeight;
                    }
                    onSelectMultiple([nextFile], nextFile);
                }
            }}
            onContextMenu={(e) => {
                if (!e.defaultPrevented) onContextMenu(e, null);
            }}
        >
            {/* Table Header */}
            <div
                className="sticky top-0 bg-[var(--bg-deep)]/80 backdrop-blur-2xl z-20 border-b border-white/10 px-2 h-11 shrink-0 grid items-center gap-2"
                style={{ gridTemplateColumns: gridTemplate }}
                onContextMenu={handleHeaderContextMenu}
            >
                {visibleColumns.map((col) => (
                    <div
                        key={col}
                        className="relative h-full flex items-center group/header"
                    >
                        <div
                            className={`flex-1 text-[11px] font-bold text-zinc-400 hover:text-zinc-200 cursor-pointer flex items-center gap-1.5 truncate h-full ${COLUMN_CONFIG[col].align === 'right' ? 'justify-end' : ''}`}
                            onClick={() => onSort(col)}
                        >
                            {COLUMN_CONFIG[col].label}
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

            {/* Total Height Spacing */}
            <div style={{ height: files.length * ITEM_HEIGHT }} onClick={(e) => { if (e.target === e.currentTarget) onClearSelection(); }}>
                <div style={{ transform: `translateY(${renderWindow.translateY}px)` }} className="flex flex-col">
                    {visibleFiles.map((file) => {
                        const isSelected = selectedFiles.some(f => f.path === file.path);
                        const isClipboardItem = clipboardInfo?.paths.includes(file.path);
                        return (
                            <div
                                key={file.path}
                                onClick={(e) => {
                                    let newSelection: FileEntry[] = [];
                                    let newLastSelected = file;
                                    if (e.ctrlKey) {
                                        if (isSelected) newSelection = selectedFiles.filter(f => f.path !== file.path);
                                        else newSelection = [...selectedFiles, file];
                                    } else if (e.shiftKey && lastSelectedFile) {
                                        const lastIndex = files.findIndex(f => f.path === lastSelectedFile.path);
                                        const currentIndex = files.findIndex(f => f.path === file.path);
                                        if (lastIndex !== -1 && currentIndex !== -1) {
                                            const start = Math.min(lastIndex, currentIndex);
                                            const end = Math.max(lastIndex, currentIndex);
                                            newSelection = files.slice(start, end + 1);
                                            newLastSelected = lastSelectedFile;
                                        } else newSelection = [file];
                                    } else newSelection = [file];
                                    onSelectMultiple(newSelection, newLastSelected);
                                }}
                                onMouseDown={(e) => {
                                    if (e.button === 1) e.preventDefault(); // Prevent autoscroll
                                }}
                                onDoubleClick={() => onOpen(file)}
                                onAuxClick={(e) => { if (e.button === 1 && file.is_dir) { e.preventDefault(); onOpenInNewTab(file); } }}
                                onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, file); }}
                                className={`grid items-center h-[42px] px-2 file-row group cursor-default border-b border-white/[0.02] transition-opacity duration-300 gap-2
                                    ${isClipboardItem ? 'opacity-40' : 'opacity-100'}
                                    ${isSelected ? 'bg-[var(--accent-primary)]/15 border-l-2 border-l-[var(--accent-primary)]' : 'hover:bg-white/[0.04]'}`}
                                style={{ gridTemplateColumns: gridTemplate }}
                            >
                                {visibleColumns.map(col => (
                                    <div key={col} className={`min-w-0 truncate ${COLUMN_CONFIG[col].align === 'right' ? 'text-right font-mono font-bold' : ''}`}>
                                        {col === 'name' ? (
                                            <div className="flex items-center gap-3">
                                                <div className="flex-shrink-0 w-[18px] h-[18px] flex items-center justify-center">
                                                    {(() => {
                                                        const IconComponent = getIconComponent(file);
                                                        return <IconComponent size={16} className={`${file.is_dir ? 'text-amber-400' : 'text-zinc-400'} ${isSelected ? 'text-white' : 'group-hover:text-zinc-200'}`} fill={file.is_dir ? 'rgba(251, 191, 36, 0.2)' : 'none'} />;
                                                    })()}
                                                </div>
                                                {renamingPath === file.path ? (
                                                    <input ref={editInputRef} className="bg-[var(--accent-primary)]/20 border border-[var(--accent-primary)]/50 rounded px-1.5 py-0.5 text-sm text-white outline-none w-full" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={() => onRenameSubmit(file, editValue)} onKeyDown={(e) => { if (e.key === 'Enter') onRenameSubmit(file, editValue); else if (e.key === 'Escape') onRenameCancel(); }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} />
                                                ) : (
                                                    <span className={`text-sm truncate transition-colors ${isSelected ? 'text-white font-bold' : 'text-zinc-300 group-hover:text-white'}`}>{file.name}</span>
                                                )}
                                            </div>
                                        ) : (
                                            <span className={`text-xs ${col === 'size' ? 'text-zinc-400 font-mono' : 'text-zinc-400 font-medium'}`}>
                                                {col === 'modified_at' && file.modified_at}
                                                {col === 'created_at' && file.created_at}
                                                {col === 'file_type' && file.file_type}
                                                {col === 'size' && file.formatted_size}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>
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
