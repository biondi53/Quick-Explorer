import { useState, useEffect, memo, useMemo } from 'react';
import { Download, FileText, Image, HardDrive, ChevronRight, Monitor, Trash2, Trash, Layout } from 'lucide-react';
import { WindowsIcon } from './ui/WindowsIcon';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from '../i18n/useTranslation';

import { RecycleBinStatus, DiskInfo } from '../types';

import { FileEntry } from '../types';

interface SidebarItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    path: string;
    disk_info?: DiskInfo;
}

interface SidebarProps {
    onNavigate: (path: string) => void;
    onOpenInNewTab: (path: string) => void;
    onContextMenu: (e: React.MouseEvent, path: string, name: string) => void;
    currentPath: string;
    quickAccess: {
        pinnedFolders: Array<{ id: string, name: string, path: string, enabled?: boolean }>;
    };
    width: number;
    onClearSelection: () => void;
    recycleBinStatus: RecycleBinStatus;
    onRefreshRecycleBin: () => void;
    renamingPath?: string | null;
    onRenameSubmit?: (file: FileEntry, newName: string) => void;
    onRenameCancel?: () => void;
}

const SYSTEM_ORDER = ['desktop', 'home', 'downloads', 'documents', 'pictures', 'recycle-bin'];

const formatSize = (bytes: number | bigint) => {
    const b = Number(bytes);
    if (b === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    const value = b / Math.pow(k, i);
    // Omit decimals if value is >= 100 GB
    if (i > 3 || (i === 3 && value >= 100)) {
        return Math.round(value) + ' ' + sizes[i];
    }
    return parseFloat(value.toFixed(1)) + ' ' + sizes[i];
};

const Sidebar = memo(({ onNavigate, onOpenInNewTab, onContextMenu, currentPath, quickAccess, width, onClearSelection, recycleBinStatus, onRefreshRecycleBin, renamingPath, onRenameSubmit, onRenameCancel }: SidebarProps) => {
    const { t } = useTranslation();
    const [drives, setDrives] = useState<FileEntry[]>([]);

    const refreshDrives = () => {
        invoke<FileEntry[]>('list_files', { path: '', showHidden: false })
            .then(setDrives)
            .catch(console.error);
    };

    useEffect(() => {
        refreshDrives();
    }, []);

    useEffect(() => {
        // Refresh drives when a rename might have happened (via custom event from App.tsx or just when renamingPath clears)
        if (!renamingPath) {
            refreshDrives();
        }
    }, [renamingPath]);

    const getSidebarItem = (id: string, label: string, icon: React.ReactNode, path: string): SidebarItem => {
        return { id, label, icon, path };
    };

    const getIcon = (id: string) => {
        switch (id) {
            case 'home': return <Monitor size={18} />;
            case 'downloads': return <Download size={18} />;
            case 'documents': return <FileText size={18} />;
            case 'pictures': return <Image size={18} />;
            case 'desktop': return <Layout size={18} />;
            case 'recycle-bin': {
                if (recycleBinStatus.is_empty) {
                    return <Trash size={18} className="transition-colors duration-500" />;
                } else {
                    return <Trash2 size={18} className="text-[var(--accent-primary)] animate-pulse filter drop-shadow-[0_0_3px_var(--accent-primary)] transition-all duration-500" />;
                }
            }
            default: return <ChevronRight size={18} />;
        }
    };

    const pinnedFolders = quickAccess?.pinnedFolders || [];

    // Sort and filter system folders
    const getSystemLabel = (id: string, fallback: string) => {
        const key = id === 'recycle-bin' ? 'recycle_bin' : id === 'home' ? 'this_pc' : id;
        const translated = t(`sidebar.${key}`);
        return translated === `sidebar.${key}` ? fallback : translated; // Return translated or original if not found
    };

    const systemItems = SYSTEM_ORDER
        .map(id => pinnedFolders.find(f => f.id === id))
        .filter((f): f is NonNullable<typeof f> => !!f && f.enabled !== false)
        .map(f => getSidebarItem(f.id, getSystemLabel(f.id, f.name), getIcon(f.id), f.path));

    // Get custom folders
    const customItems = pinnedFolders
        .filter(f => !SYSTEM_ORDER.includes(f.id))
        .map(f => getSidebarItem(f.id, f.name, <ChevronRight size={18} />, f.path));

    const sections = [
        {
            label: t('sidebar.pinned'),
            items: [...systemItems, ...customItems] as SidebarItem[]
        },
        {
            label: t('sidebar.drives'),
            items: drives.map((drive): SidebarItem => ({
                id: drive.path,
                label: drive.name.includes('Local Disk')
                    ? drive.name.replace('Local Disk', t('sidebar.local_disk'))
                    : drive.name,
                icon: <HardDrive size={18} />,
                path: drive.path,
                disk_info: drive.disk_info || undefined
            }))
        }
    ];

    // Calculate the most specific (longest) match for pinned items only
    const bestPinnedMatch = useMemo(() => {
        const pinnedPaths = sections[0].items.map(i => i.path);
        let best = '';
        for (const p of pinnedPaths) {
            // Check if currentPath starts with p and is longer than current best
            const normP = p.toLowerCase().replace(/[\\/]+$/, '');
            const normCurr = currentPath.toLowerCase().replace(/[\\/]+$/, '');

            if ((normCurr === normP || normCurr.startsWith(normP + '\\')) && p.length > best.length) {
                best = p;
            }
        }
        return best;
    }, [sections, currentPath]);

    const isItemActive = (item: SidebarItem) => {
        if (item.disk_info) {
            // For drives, use the classic startsWith logic (as requested: "se entiende?")
            const normP = item.path.toLowerCase().replace(/[\\/]+$/, '');
            const normCurr = currentPath.toLowerCase().replace(/[\\/]+$/, '');
            return normCurr === normP || normCurr.startsWith(normP + '\\');
        }
        // For pinned folders, only highlight if it's the BEST match
        return item.path === bestPinnedMatch && (item.path !== '' || currentPath === '');
    };

    return (
        <aside
            className="flex flex-col bg-[var(--bg-sidebar)] border-r border-white/10 backdrop-blur-2xl h-full select-none shadow-2xl"
            style={{ width }}
            onMouseEnter={() => {
                onRefreshRecycleBin();
                refreshDrives();
            }}
            onContextMenu={(e) => e.preventDefault()}
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onClearSelection();
                }
            }}
        >
            <div
                className="flex-1 overflow-y-auto py-4 px-3 space-y-6"
                onClick={(e) => {
                    if (e.target === e.currentTarget) {
                        onClearSelection();
                    }
                }}
            >
                {sections.map((section) => (
                    <div key={section.label}>
                        <div className="px-3 mb-2 flex items-center gap-2 text-[10px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em] transition-colors group-hover:text-[var(--text-dim)]">
                            <ChevronRight size={12} className="rotate-90 opacity-20" />
                            {section.label}
                        </div>
                        <div className="space-y-0.5">
                            {section.items.map((item) => {
                                const active = isItemActive(item);
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => onNavigate(item.path)}
                                        onMouseDown={(e) => {
                                            if (e.button === 1) {
                                                e.preventDefault(); // Prevent autoscroll mode
                                            }
                                        }}
                                        onAuxClick={(e) => {
                                            if (e.button === 1) {
                                                onOpenInNewTab(item.path);
                                            }
                                        }}
                                        onContextMenu={(e) => {
                                            // item.path could be empty for 'home', so we should allow it if we want context menu on Home
                                            onContextMenu(e, item.path, item.label);
                                        }}
                                        className={`w-full flex ${item.disk_info ? 'flex-col items-start gap-1' : 'items-center gap-3'} px-3 py-2 rounded-xl text-sm transition-all duration-200 group relative overflow-hidden no-drag
                    ${active
                                                ? 'bg-[var(--accent-primary)]/10 text-white font-bold'
                                                : 'text-[var(--text-muted)] hover:bg-white/[0.05] hover:text-white'}
                  `}
                                    >
                                        {active && (
                                            <div className="absolute left-0 top-2 bottom-2 w-1 bg-[var(--accent-primary)] rounded-full shadow-[0_0_12px_var(--accent-primary)]" />
                                        )}
                                        {renamingPath === item.path ? (
                                            <div className="flex items-center gap-3 w-full" onClick={e => e.stopPropagation()}>
                                                <span className="text-[var(--accent-primary)] shrink-0">
                                                    {item.icon}
                                                </span>
                                                <input
                                                    autoFocus
                                                    onFocus={e => e.currentTarget.select()}
                                                    className="bg-black/40 border border-[var(--accent-primary)]/50 rounded-md px-1 py-0.5 w-full text-white text-sm outline-none focus:ring-2 ring-[var(--accent-primary)]/20"
                                                    defaultValue={item.label}
                                                    onBlur={() => onRenameCancel?.()}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            const newName = e.currentTarget.value.trim();
                                                            if (newName) {
                                                                const mockFile: FileEntry = {
                                                                    name: item.label,
                                                                    path: item.path,
                                                                    is_dir: true,
                                                                    size: 0,
                                                                    formatted_size: '',
                                                                    file_type: item.disk_info ? 'Drive' : 'Folder',
                                                                    created_at: '',
                                                                    modified_at: '',
                                                                    is_shortcut: false,
                                                                    disk_info: item.disk_info || null,
                                                                    modified_timestamp: 0,
                                                                    created_timestamp: 0,
                                                                    dimensions: null
                                                                };
                                                                onRenameSubmit?.(mockFile, newName);
                                                            } else {
                                                                onRenameCancel?.();
                                                            }
                                                        } else if (e.key === 'Escape') {
                                                            onRenameCancel?.();
                                                        }
                                                    }}
                                                />
                                            </div>
                                        ) : item.disk_info ? (
                                            <div className="flex items-center gap-3 w-full min-w-0">
                                                <span className={`relative shrink-0 transition-all duration-300 ${currentPath.startsWith(item.path) && (item.path !== '' || currentPath === '') ? 'text-[var(--accent-primary)] scale-110 drop-shadow-[0_0_8px_var(--accent-primary)]' : 'group-hover:text-[var(--text-main)] opacity-70 group-hover:opacity-100 group-hover:scale-110'}`}>
                                                    {item.disk_info?.is_system ? (
                                                        <div className="flex items-center justify-center w-[18px] h-[18px]">
                                                            <WindowsIcon size={20} className="text-[#00a4ef]" />
                                                        </div>
                                                    ) : (
                                                        item.icon
                                                    )}
                                                </span>
                                                <div className="flex flex-col gap-1 min-w-0 flex-1">
                                                    <span className="truncate font-medium text-left">{item.label}</span>
                                                    <div className="flex flex-col gap-1 w-full">
                                                        <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all duration-500 shadow-[0_0_4px_rgba(0,0,0,0.1)]
                                                                ${Number(item.disk_info.total_space - item.disk_info.available_space) / Number(item.disk_info.total_space) > 0.9
                                                                        ? 'bg-gradient-to-r from-rose-600 to-red-500'
                                                                        : 'bg-gradient-to-r from-[var(--accent-secondary)] to-[var(--accent-primary)]'
                                                                    }`}
                                                                style={{ width: `${(Number(item.disk_info.total_space - item.disk_info.available_space) / Number(item.disk_info.total_space)) * 100}%` }}
                                                            />
                                                        </div>
                                                        <div className="flex justify-between items-center text-[11px] text-[var(--text-dim)] font-medium leading-none">
                                                            <span>{formatSize(item.disk_info.available_space)} {t('files.free')}</span>
                                                            <span>{Math.floor((Number(item.disk_info.total_space - item.disk_info.available_space) / Number(item.disk_info.total_space)) * 100)}%</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <span className={`transition-all duration-300 ${active ? 'text-[var(--accent-primary)] scale-110 drop-shadow-[0_0_8px_var(--accent-primary)]' : 'group-hover:text-[var(--text-main)] opacity-70 group-hover:opacity-100 group-hover:scale-110'}`}>
                                                    {item.icon}
                                                </span>
                                                <span className="truncate flex-1 text-left">{item.label}</span>
                                            </>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </aside>
    );
});

export default Sidebar;
