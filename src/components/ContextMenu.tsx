import { useEffect, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ExternalLink, Copy, Trash, FileSearch, Scissors, Clipboard, Pin, PinOff, Pencil, FolderOpen, ArrowRight } from 'lucide-react';
import { RecycleBinStatus, Tab } from '../types';

interface ContextMenuProps {
    x: number;
    y: number;
    selectedFiles: any[];
    pinnedFolders: Array<{ id: string, name: string, path: string, enabled?: boolean }>;
    allowRename?: boolean;
    onClose: () => void;
    onAction: (action: string, data?: any) => void;
    recycleBinStatus: RecycleBinStatus;
    tabs: Tab[];
    activeTabId: string;
}

interface MenuItem {
    id?: string;
    label?: string;
    icon?: React.ReactNode;
    type?: 'separator';
    hidden?: boolean;
    disabled?: boolean;
    textColor?: string;
    hasSubmenu?: boolean;
}

export default function ContextMenu({ x, y, selectedFiles, pinnedFolders, onClose, onAction, allowRename, fromSidebar, recycleBinStatus, tabs, activeTabId }: ContextMenuProps & { fromSidebar?: boolean }) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [canPaste, setCanPaste] = useState(false);
    const [pos, setPos] = useState({ left: x, top: y, opacity: 0 });
    const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);

    const file = selectedFiles.length === 1 ? selectedFiles[0] : null;
    const isMultiple = selectedFiles.length > 1;
    const isSystemFolder = file && pinnedFolders.some(f => f.path === file.path && ['desktop', 'downloads', 'documents', 'pictures', 'recycle-bin', 'home'].includes(f.id));
    const isDrive = file?.file_type === 'Drive';

    const normalizePath = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();

    const otherTabs = tabs.filter(t => {
        if (t.id === activeTabId) return false;
        if (!t.path || t.path === 'shell:RecycleBin') return false;

        const normalizedTabPath = normalizePath(t.path);

        // Don't move to a tab that is one of the selected items (e.g. moving a folder into itself)
        if (selectedFiles.some(f => normalizePath(f.path) === normalizedTabPath)) return false;

        // Don't move to a tab that is the PARENT of the selected items (already there)
        const firstFile = selectedFiles[0];
        if (firstFile) {
            const lastSlash = firstFile.path.lastIndexOf('\\');
            let parent = firstFile.path.substring(0, lastSlash);
            if (parent.endsWith(':')) parent += '\\';
            if (normalizePath(parent) === normalizedTabPath) return false;
        }

        return true;
    });

    const checkClipboard = useCallback(async () => {
        try {
            const info = await invoke<any>('get_clipboard_info');
            setCanPaste(info.has_files || info.has_image);
        } catch (err) {
            setCanPaste(false);
        }
    }, []);

    useEffect(() => {
        checkClipboard();
    }, [checkClipboard]);

    useLayoutEffect(() => {
        if (menuRef.current) {
            const rect = menuRef.current.getBoundingClientRect();
            const margin = 12;
            let finalX = x;
            let finalY = y;

            if (x + rect.width > window.innerWidth - margin) {
                finalX = x - rect.width;
            }
            if (y + rect.height > window.innerHeight - margin) {
                finalY = y - rect.height;
            }

            setPos({ left: finalX, top: finalY, opacity: 1 });
        }
    }, [x, y]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        window.addEventListener('mousedown', handleClickOutside);
        return () => window.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    const getTabName = (path: string) => {
        if (!path) return 'This PC';
        if (path === 'shell:RecycleBin') return 'Recycle Bin';
        const parts = path.split('\\').filter(Boolean);
        return parts[parts.length - 1] || path;
    };

    const items: MenuItem[] = isMultiple ? [
        { id: 'copy', label: 'Copy', icon: <Copy size={20} />, hidden: fromSidebar && isSystemFolder },
        { id: 'cut', label: 'Cut', icon: <Scissors size={20} />, hidden: fromSidebar && isSystemFolder },
        { id: 'move-to', label: 'Move to', icon: <ArrowRight size={20} />, disabled: otherTabs.length === 0, hasSubmenu: true, hidden: fromSidebar && isSystemFolder },
        { id: 'separator-1', type: 'separator', hidden: fromSidebar && isSystemFolder },
        { id: 'delete', label: 'Delete', icon: <Trash size={20} className="text-red-400" />, textColor: 'text-red-400', hidden: fromSidebar || (!fromSidebar && file?.is_dir && pinnedFolders.some(f => f.path === file.path && ['desktop', 'recycle-bin', 'downloads', 'documents', 'pictures'].includes(f.id))) },
    ] : (file ? [
        { id: 'open', label: 'Open', icon: <ExternalLink size={20} />, hidden: fromSidebar && isSystemFolder },
        { id: 'open-with', label: 'Open with...', icon: <ExternalLink size={20} />, hidden: (fromSidebar && isSystemFolder) || file.is_dir || isDrive },
        { id: 'open-location', label: 'Open file location', icon: <FolderOpen size={20} />, hidden: (fromSidebar && isSystemFolder) || !file.is_shortcut || isDrive },
        { id: 'rename', label: 'Rename (F2)', icon: <Pencil size={20} />, hidden: (fromSidebar && isSystemFolder) || !allowRename },
        { id: 'separator-0', type: 'separator', hidden: (fromSidebar && isSystemFolder) || isDrive },
        { id: 'copy', label: 'Copy', icon: <Copy size={20} />, hidden: (fromSidebar && isSystemFolder) || isDrive },
        { id: 'cut', label: 'Cut', icon: <Scissors size={20} />, hidden: (fromSidebar && isSystemFolder) || isDrive },
        { id: 'paste', label: 'Paste', icon: <Clipboard size={20} />, disabled: !canPaste, hidden: (fromSidebar && isSystemFolder) || isDrive },
        { id: 'move-to', label: 'Move to', icon: <ArrowRight size={20} />, disabled: otherTabs.length === 0, hidden: (fromSidebar && isSystemFolder) || isDrive, hasSubmenu: true },
        { id: 'separator-1', type: 'separator', hidden: (fromSidebar && isSystemFolder) || isDrive },
        {
            id: 'delete',
            label: 'Delete',
            icon: <Trash size={20} className="text-red-400" />,
            textColor: 'text-red-400',
            hidden: fromSidebar || isDrive || (!fromSidebar && file.is_dir && pinnedFolders.some(f => f.path === file.path && ['desktop', 'recycle-bin', 'downloads', 'documents', 'pictures'].includes(f.id)))
        },
        {
            id: 'empty-recycle-bin',
            label: 'Empty Recycle Bin',
            icon: <Trash size={20} />,
            disabled: recycleBinStatus.is_empty,
            hidden: !fromSidebar || pinnedFolders.find(f => f.path === file.path)?.id !== 'recycle-bin' || isDrive
        },
        {
            id: 'separator-rb',
            type: 'separator',
            hidden: !fromSidebar || pinnedFolders.find(f => f.path === file.path)?.id !== 'recycle-bin' || isDrive
        },
        {
            id: (() => {
                if (!file.is_dir || isDrive) return 'none';
                const pinned = pinnedFolders.find(f => f.path === file.path);
                if (!pinned) return 'pin';
                const isDefault = ['downloads', 'documents', 'pictures', 'desktop', 'recycle-bin'].includes(pinned.id);
                if (fromSidebar && isDefault) return 'unpin';
                return isDefault ? 'none' : 'unpin';
            })(),
            label: pinnedFolders.some(f => f.path === file.path) ? 'Unpin from Quick access' : 'Pin to Quick access',
            icon: pinnedFolders.some(f => f.path === file.path) ? <PinOff size={20} /> : <Pin size={20} />,
            hidden: !file.is_dir || isDrive || (!fromSidebar && (() => {
                const pinned = pinnedFolders.find(f => f.path === file.path);
                return pinned && ['downloads', 'documents', 'pictures', 'desktop', 'recycle-bin'].includes(pinned.id);
            })())
        },
        { id: 'separator-2', type: 'separator', hidden: fromSidebar && isSystemFolder },
        { id: 'properties', label: 'Properties', icon: <FileSearch size={20} />, hidden: fromSidebar && isSystemFolder },
    ] : [
        { id: 'paste', label: 'Paste', icon: <Clipboard size={20} />, disabled: !canPaste },
        { id: 'separator-2', type: 'separator' },
        { id: 'properties', label: 'Properties', icon: <FileSearch size={20} /> },
    ]);

    return (
        <div
            ref={menuRef}
            className="fixed z-50 w-64 bg-[#0f111a]/95 backdrop-blur-3xl border border-white/10 rounded-xl py-1.5 shadow-[0_10px_35px_rgba(0,0,0,0.7),0_0_15px_var(--accent-glow)] animate-in fade-in zoom-in-95 duration-100 ease-out select-none transition-opacity"
            style={{ left: pos.left, top: pos.top, opacity: pos.opacity }}
        >
            {items.filter(item => !item.hidden).map((item, idx) => (
                item.type === 'separator' ? (
                    <div key={`sep-${idx}`} className="h-px bg-white/5 my-1 mx-2" />
                ) : (
                    <div key={item.id} className="relative group/item"
                        onMouseEnter={() => item.hasSubmenu && !item.disabled && setActiveSubmenu(item.id || null)}
                        onMouseLeave={() => item.hasSubmenu && setActiveSubmenu(null)}
                    >
                        <button
                            onClick={() => {
                                if (item.id && !item.hasSubmenu) {
                                    onAction(item.id);
                                    onClose();
                                }
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-all rounded-lg mx-1 w-[calc(100%-8px)] group
                  ${item.disabled ? 'text-zinc-600 cursor-not-allowed' : 'hover:bg-[var(--accent-primary)]/20 hover:text-white ' + (item.textColor || 'text-zinc-300')}
                `}
                            disabled={!!item.disabled}
                        >
                            <div className="flex items-center gap-2.5">
                                <span className={`transition-all duration-300 ${item.disabled ? 'opacity-30' : 'opacity-60 group-hover:opacity-100 group-hover:scale-105 group-hover:text-[var(--accent-primary)]'}`}>
                                    {item.icon}
                                </span>
                                <span className="font-semibold tracking-tight">{item.label}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                {item.hasSubmenu && !item.disabled && (
                                    <ArrowRight size={14} className="text-zinc-600 group-hover:text-white" />
                                )}
                                <span className="text-xs text-zinc-600 font-mono opacity-80 group-hover:opacity-100 transition-opacity">
                                    {item.id === 'open' ? 'Enter' : ''}
                                    {item.id === 'cut' ? 'Ctrl+X' : ''}
                                    {item.id === 'copy' ? 'Ctrl+C' : ''}
                                    {item.id === 'paste' ? 'Ctrl+V' : ''}
                                    {item.id === 'delete' ? 'Del' : ''}
                                    {item.id === 'select-all' ? 'Ctrl+A' : ''}
                                </span>
                            </div>
                        </button>

                        {/* Submenu */}
                        {item.hasSubmenu && activeSubmenu === item.id && (
                            <div
                                className="absolute left-[calc(100%-4px)] top-0 w-64 bg-[#0f111a]/95 backdrop-blur-3xl border border-white/10 rounded-xl py-1.5 shadow-[0_10px_35px_rgba(0,0,0,0.7),0_0_15px_var(--accent-glow)] animate-in fade-in slide-in-from-left-2 duration-100"
                            >
                                {otherTabs.map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => {
                                            onAction('move-to-tab', { tabId: tab.id, targetPath: tab.path });
                                            onClose();
                                        }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-zinc-300 hover:bg-[var(--accent-primary)]/20 hover:text-white transition-all rounded-lg mx-1 w-[calc(100%-8px)] group/sub"
                                    >
                                        <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)] opacity-40 group-hover/sub:opacity-100 shadow-[0_0_8px_var(--accent-primary)]" />
                                        <span className="font-semibold tracking-tight truncate">{getTabName(tab.path)}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )
            ))}
        </div>
    );
}
