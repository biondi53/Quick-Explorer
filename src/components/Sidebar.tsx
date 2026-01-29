import { useState, useEffect, memo } from 'react';
import { Home, Download, FileText, Image, HardDrive, ChevronRight, Monitor, Trash2, Trash } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { handleWindowDrag } from '../utils/windowDrag';
import { RecycleBinStatus } from '../types';

interface FileEntry {
    name: string;
    path: string;
    is_dir: boolean;
    file_type: string;
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
}

const SYSTEM_ORDER = ['desktop', 'home', 'downloads', 'documents', 'pictures', 'recycle-bin'];

const Sidebar = memo(({ onNavigate, onOpenInNewTab, onContextMenu, currentPath, quickAccess, width, onClearSelection, recycleBinStatus, onRefreshRecycleBin }: SidebarProps) => {
    const [drives, setDrives] = useState<FileEntry[]>([]);

    useEffect(() => {
        invoke<FileEntry[]>('list_files', { path: '', showHidden: false })
            .then(setDrives)
            .catch(console.error);
    }, []);

    const getSidebarItem = (id: string, label: string, icon: React.ReactNode, path: string) => {
        return { id, label, icon, path };
    };

    const getIcon = (id: string) => {
        switch (id) {
            case 'home': return <Home size={18} />;
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
                path: drive.path
            }))
        }
    ];

    return (
        <aside
            className="flex flex-col bg-[var(--bg-sidebar)] border-r border-white/10 backdrop-blur-2xl h-full select-none shadow-2xl"
            style={{ width }}
            onMouseEnter={onRefreshRecycleBin}
            onMouseDown={handleWindowDrag}
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
                        <div className="px-3 mb-2 flex items-center gap-2 text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] transition-colors group-hover:text-zinc-400">
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
                                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all duration-200 group relative overflow-hidden no-drag
                    ${currentPath.startsWith(item.path) && (item.path !== '' || currentPath === '')
                                            ? 'bg-[var(--accent-primary)]/10 text-white font-bold'
                                            : 'text-zinc-400 hover:bg-white/[0.05] hover:text-white'}
                  `}
                                >
                                    {currentPath.startsWith(item.path) && (item.path !== '' || currentPath === '') && (
                                        <div className="absolute left-0 top-2 bottom-2 w-1 bg-[var(--accent-primary)] rounded-full shadow-[0_0_12px_var(--accent-primary)]" />
                                    )}
                                    <span className={`transition-all duration-300 ${currentPath.startsWith(item.path) && (item.path !== '' || currentPath === '') ? 'text-[var(--accent-primary)] scale-110 drop-shadow-[0_0_8px_var(--accent-primary)]' : 'group-hover:text-[var(--text-main)] opacity-70 group-hover:opacity-100 group-hover:scale-110'}`}>
                                        {item.icon}
                                    </span>
                                    {item.label}
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
