import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronUp, ChevronDown, Check } from 'lucide-react';
import { getIconComponent } from '../utils/fileIcons';

import { FileEntry, ClipboardInfo } from '../types';
import { startDrag } from '@crabnebula/tauri-plugin-drag';
import { resolveResource } from '@tauri-apps/api/path';

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
}

const ITEM_HEIGHT = 42;

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
            <div className="px-3 mb-2 text-[11px] font-black text-[var(--text-muted)] uppercase tracking-widest">Visible Columns</div>
            {(Object.keys(COLUMN_CONFIG) as SortColumn[]).map(col => (
                <button
                    key={col}
                    onClick={() => onToggle(col)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-[var(--text-dim)] hover:bg-[var(--accent-primary)]/20 hover:text-white transition-all group"
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
    clipboardInfo,
    onInternalDragStart,
    onInternalDragEnd
}: FileTableProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [editValue, setEditValue] = useState("");
    const editInputRef = useRef<HTMLInputElement>(null);
    const autoFocusRef = useRef(false);
    const submittingRef = useRef(false);
    const [headerMenu, setHeaderMenu] = useState<{ x: number, y: number } | null>(null);
    const [dragIconPath, setDragIconPath] = useState<string | null>(null);

    useEffect(() => {
        resolveResource('icons/32x32.png')
            .then(path => {
                console.log('[FileTable] Resolved drag icon path:', path);
                setDragIconPath(path);
            })
            .catch(err => {
                console.error('[FileTable] Failed to resolve drag icon:', err);
                // Fallback attempt for development
                setDragIconPath('icons/32x32.png');
            });
    }, []);

    // Native drag support
    const dragThresholdRef = useRef<{ x: number, y: number, paths: string[] } | null>(null);

    const selectedPaths = useMemo(() => {
        return new Set(selectedFiles.map(f => f.path));
    }, [selectedFiles]);

    const handleDragStart = (paths: string[]) => {
        if (paths.length === 0) return;

        console.log('[FileTable] Starting drag for paths:', paths);
        console.log('[FileTable] Using icon path:', dragIconPath);

        // If we don't have a valid image icon yet, and paths[0] is not a dir, we can try paths[0]
        // But to be 100% safe from the crash, if dragIconPath is null, we should probably 
        // use a string path that we KNOW exists and is an image, or just skip drag initiation
        // until we have the icon.
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

    // RESET SCROLL ON PATH CHANGE
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = 0;
        }
        rowVirtualizer.scrollToOffset(0);
        submittingRef.current = false;
    }, [currentPath, rowVirtualizer]);

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

    if (files.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)]" onContextMenu={(e) => onContextMenu(e, null)}>
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
                            className={`flex-1 text-[11px] font-bold text-[var(--text-muted)] hover:text-white cursor-pointer flex items-center gap-1.5 truncate h-full ${COLUMN_CONFIG[col].align === 'right' ? 'justify-end' : ''}`}
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
                            className={`grid items-center h-[42px] px-2 file-row group cursor-default border-b border-white/[0.02] transition-opacity duration-300 gap-2
                                ${isClipboardItem ? 'opacity-40' : 'opacity-100'}
                                ${isSelected ? 'bg-[var(--accent-primary)]/15 border-l-2 border-l-[var(--accent-primary)]' : 'hover:bg-white/[0.04]'}`}
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

                                // If item is NOT selected, select it immediately (for visual feedback)
                                if (!isSelected && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
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
                            }}
                            onClick={(e) => {
                                if (e.button !== 0) return;
                                // Handle click on an already-selected item (user released without dragging)
                                if (isSelected) {
                                    if (e.ctrlKey || e.metaKey) {
                                        // Ctrl+click on selected: remove from selection
                                        onSelectMultiple(selectedFiles.filter(f => f.path !== file.path), lastSelectedFile);
                                    } else if (!e.shiftKey) {
                                        // Plain click on selected item in multi-selection: select only this item
                                        onSelectMultiple([file], file);
                                    }
                                }
                                // For unselected items, selection was already handled in onMouseDown
                            }}
                            onDoubleClick={() => onOpen(file)}
                            onAuxClick={(e) => { if (e.button === 1 && file.is_dir) { e.preventDefault(); onOpenInNewTab(file); } }}
                            onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, file); }}
                        >
                            {visibleColumns.map(col => (
                                <div key={col} className={`min-w-0 truncate ${COLUMN_CONFIG[col].align === 'right' ? 'text-right font-mono font-bold' : ''}`}>
                                    {col === 'name' ? (
                                        <div className="flex items-center gap-3">
                                            <div className="flex-shrink-0 w-[18px] h-[18px] flex items-center justify-center">
                                                {(() => {
                                                    const IconComponent = getIconComponent(file);
                                                    return <IconComponent size={16} className={`${file.is_dir ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'} ${isSelected ? 'text-white' : 'group-hover:text-white'}`} fill={file.is_dir ? 'rgba(var(--accent-rgb), 0.2)' : 'none'} />;
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
                                                        if (e.key === 'Enter') {
                                                            if (submittingRef.current) return;
                                                            submittingRef.current = true;
                                                            onRenameSubmit(file, editValue);
                                                        } else if (e.key === 'Escape') {
                                                            onRenameCancel();
                                                        }
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onDoubleClick={(e) => e.stopPropagation()}
                                                />
                                            ) : (
                                                <span className={`text-sm truncate transition-colors ${isSelected ? 'text-white font-bold' : 'text-[var(--text-dim)] font-medium group-hover:text-white'}`}>{file.name}</span>
                                            )}
                                        </div>
                                    ) : (
                                        <span className={`text-xs ${col === 'size' ? 'text-[var(--text-muted)] font-mono' : 'text-[var(--text-muted)] font-light'}`}>
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
