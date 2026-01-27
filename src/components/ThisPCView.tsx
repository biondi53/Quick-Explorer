import { useMemo } from 'react';
import { HardDrive } from 'lucide-react';
import { FileEntry } from '../types';

interface ThisPCViewProps {
    files: FileEntry[];
    onOpen: (file: FileEntry) => void;
    onOpenInNewTab: (file: FileEntry) => void;
    onContextMenu: (e: React.MouseEvent, file: FileEntry | null) => void;
    selectedFiles: FileEntry[];
    onSelectMultiple: (files: FileEntry[], lastOne: FileEntry | null) => void;
}


const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const value = bytes / Math.pow(k, i);

    // Omit decimals if value is >= 100 GB
    if (i > 3 || (i === 3 && value >= 100)) {
        return Math.round(value) + ' ' + sizes[i];
    }

    return parseFloat(value.toFixed(2)) + ' ' + sizes[i];
};

export default function ThisPCView({
    files,
    onOpen,
    onOpenInNewTab,
    onContextMenu,
    selectedFiles,
    onSelectMultiple
}: ThisPCViewProps) {
    const drives = useMemo(() => {
        return files.filter(f => f.file_type === 'Drive');
    }, [files]);

    const isSelected = (path: string) => selectedFiles.some(f => f.path === path);

    return (
        <div className="flex-1 overflow-auto p-6 space-y-12 select-none" onContextMenu={(e) => onContextMenu(e, null)}>

            {/* Drives Section */}
            {drives.length > 0 && (
                <section>
                    <div className="flex items-center gap-2 mb-4 px-2">
                        <div className="i-lucide-chevron-down size-4 text-zinc-500" />
                        <h2 className="text-sm font-semibold text-zinc-400">Devices and drives ({drives.length})</h2>
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
                        {drives.map(drive => {
                            const info = drive.disk_info;
                            const selected = isSelected(drive.path);
                            const usagePercent = info ? ((info.total_space - info.available_space) / info.total_space) * 100 : 0;
                            const isLowSpace = usagePercent > 90;

                            return (
                                <div
                                    key={drive.path}
                                    onMouseDown={(e) => {
                                        if (e.button === 1) {
                                            e.preventDefault();
                                            onOpenInNewTab(drive);
                                        }
                                    }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onSelectMultiple([drive], drive);
                                    }}
                                    onDoubleClick={() => onOpen(drive)}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        onContextMenu(e, drive);
                                    }}
                                    className={`flex items-center gap-4 p-4 rounded-xl transition-all border border-transparent
                                        ${selected ? 'bg-[var(--accent-primary)]/20 border-[var(--accent-primary)]/40 shadow-[0_0_15px_rgba(var(--accent-rgb),0.1)]' : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05]'}`}
                                >
                                    <div className="p-3 rounded-xl bg-zinc-800/50 shadow-inner">
                                        <HardDrive size={32} className={isLowSpace ? 'text-red-400' : 'text-zinc-400'} />
                                    </div>
                                    <div className="flex-1 min-w-0 space-y-1.5">
                                        <div className={`text-sm truncate font-bold ${selected ? 'text-white' : 'text-zinc-100'}`}>
                                            {drive.name}
                                        </div>
                                        {info && (
                                            <>
                                                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden shadow-inner">
                                                    <div
                                                        className={`h-full transition-all duration-1000 ease-out rounded-full shadow-[0_0_8px_rgba(255,255,255,0.1)]
                                                            ${isLowSpace ? 'bg-gradient-to-r from-red-500 to-rose-600' : 'bg-gradient-to-r from-blue-500 to-indigo-600'}`}
                                                        style={{ width: `${usagePercent}%` }}
                                                    />
                                                </div>
                                                <div className="text-xs text-zinc-500 font-medium">
                                                    {formatSize(info.available_space)} free of {formatSize(info.total_space)}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}
