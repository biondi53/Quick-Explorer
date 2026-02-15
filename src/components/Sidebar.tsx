import { useState, useEffect, memo } from 'react';
import { Download, FileText, Image, HardDrive, ChevronRight, Monitor, Trash2, Trash } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

import { RecycleBinStatus } from '../types';

import { FileEntry } from '../types';

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

const Sidebar = memo(({ onNavigate, onOpenInNewTab, onContextMenu, currentPath, quickAccess, width, onClearSelection, recycleBinStatus, onRefreshRecycleBin }: SidebarProps) => {
    const [drives, setDrives] = useState<FileEntry[]>([]);

    const refreshDrives = () => {
        invoke<FileEntry[]>('list_files', { path: '', showHidden: false })
            .then(setDrives)
            .catch(console.error);
    };

    useEffect(() => {
        refreshDrives();
    }, []);

    const getSidebarItem = (id: string, label: string, icon: React.ReactNode, path: string) => {
        return { id, label, icon, path };
    };

    const getIcon = (id: string) => {
        switch (id) {
            case 'home': return <Monitor size={18} />;
            case 'downloads': return <Download size={18} />;
            case 'documents': return <FileText size={18} />;
            case 'pictures': return <Image size={18} />;
            case 'desktop': return <Monitor size={18} />;
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
    const systemItems = SYSTEM_ORDER
        .map(id => pinnedFolders.find(f => f.id === id))
        .filter((f): f is NonNullable<typeof f> => !!f && f.enabled !== false)
        .map(f => getSidebarItem(f.id, f.name, getIcon(f.id), f.path));

    // Get custom folders
    const customItems = pinnedFolders
        .filter(f => !SYSTEM_ORDER.includes(f.id))
        .map(f => getSidebarItem(f.id, f.name, <ChevronRight size={18} />, f.path));

    const sections = [
        {
            label: 'Quick access',
            items: [...systemItems, ...customItems]
        },
        {
            label: 'Devices and drives',
            items: drives.map(drive => ({
                id: drive.path,
                label: drive.name,
                icon: <HardDrive size={18} />,
                path: drive.path,
                disk_info: drive.disk_info
            }))
        }
    ];

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
                            {section.items.map((item) => (
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
                                    className={`w-full flex ${!!(item as any).disk_info ? 'flex-col items-start gap-1' : 'items-center gap-3'} px-3 py-2 rounded-xl text-sm transition-all duration-200 group relative overflow-hidden no-drag
                    ${currentPath.startsWith(item.path) && (item.path !== '' || currentPath === '')
                                            ? 'bg-[var(--accent-primary)]/10 text-white font-bold'
                                            : 'text-[var(--text-muted)] hover:bg-white/[0.05] hover:text-white'}
                  `}
                                >
                                    {currentPath.startsWith(item.path) && (item.path !== '' || currentPath === '') && (
                                        <div className="absolute left-0 top-2 bottom-2 w-1 bg-[var(--accent-primary)] rounded-full shadow-[0_0_12px_var(--accent-primary)]" />
                                    )}
                                    {!!(item as any).disk_info ? (
                                        <div className="flex flex-col gap-1 w-full min-w-0">
                                            <div className="flex items-center gap-3">
                                                <span className={`transition-all duration-300 ${currentPath.startsWith(item.path) && (item.path !== '' || currentPath === '') ? 'text-[var(--accent-primary)] scale-110 drop-shadow-[0_0_8px_var(--accent-primary)]' : 'group-hover:text-[var(--text-main)] opacity-70 group-hover:opacity-100 group-hover:scale-110'}`}>
                                                    {item.icon}
                                                </span>
                                                <span className="truncate font-medium text-left flex-1">{item.label}</span>
                                            </div>
                                            <div className="pl-[30px] pr-1 flex flex-col gap-1 w-full">
                                                <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all duration-500 shadow-[0_0_4px_rgba(0,0,0,0.1)]
                                                            ${Number((item as any).disk_info.total_space - (item as any).disk_info.available_space) / Number((item as any).disk_info.total_space) > 0.9
                                                                ? 'bg-gradient-to-r from-rose-600 to-red-500'
                                                                : 'bg-gradient-to-r from-[var(--accent-secondary)] to-[var(--accent-primary)]'
                                                            }`}
                                                        style={{ width: `${(Number((item as any).disk_info.total_space - (item as any).disk_info.available_space) / Number((item as any).disk_info.total_space)) * 100}%` }}
                                                    />
                                                </div>
                                                <div className="flex justify-between items-center text-[11px] text-[var(--text-dim)] font-medium leading-none">
                                                    <span>{formatSize((item as any).disk_info.available_space)} free</span>
                                                    <span>{Math.floor((Number((item as any).disk_info.total_space - (item as any).disk_info.available_space) / Number((item as any).disk_info.total_space)) * 100)}%</span>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <span className={`transition-all duration-300 ${currentPath.startsWith(item.path) && (item.path !== '' || currentPath === '') ? 'text-[var(--accent-primary)] scale-110 drop-shadow-[0_0_8px_var(--accent-primary)]' : 'group-hover:text-[var(--text-main)] opacity-70 group-hover:opacity-100 group-hover:scale-110'}`}>
                                                {item.icon}
                                            </span>
                                            {item.label}
                                        </>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </aside>
    );
});

export default Sidebar;
