import { useMemo } from 'react';
import { HardDrive } from 'lucide-react';
import { FileEntry } from '../types';
import GlowCard from './ui/GlowCard';

interface ThisPCViewProps {
    files: FileEntry[];
    onOpen: (file: FileEntry) => void;
    onOpenInNewTab: (file: FileEntry) => void;
    onContextMenu: (e: React.MouseEvent, file: FileEntry | null) => void;
    selectedFiles: FileEntry[];
    onSelectMultiple: (files: FileEntry[], lastOne: FileEntry | null) => void;
}


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
                        <div className="i-lucide-chevron-down size-4 text-[var(--text-muted)]" />
                        <h2 className="text-sm font-semibold text-[var(--text-muted)]">Devices and drives ({drives.length})</h2>
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
                        {drives.map(drive => {
                            const info = drive.disk_info;
                            const selected = isSelected(drive.path);
                            const usagePercent = info ? (Number(info.total_space - info.available_space) / Number(info.total_space)) * 100 : 0;
                            const isLowSpace = usagePercent > 90;

                            return (
                                <GlowCard
                                    key={drive.path}
                                    className="rounded-xl"
                                    glowColor="rgba(var(--accent-rgb), 0.15)"
                                >
                                    <div
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
                                        className={`relative group/card flex items-center gap-4 p-4 rounded-xl transition-all duration-300 border overflow-hidden
                                            ${selected
                                                ? 'bg-[var(--accent-primary)]/20 border-[var(--accent-primary)]/40 shadow-[0_0_20px_rgba(var(--accent-rgb),0.15)]'
                                                : 'bg-white/[0.03] border-white/5 hover:border-white/10 hover:shadow-lg hover:shadow-black/20'
                                            }`}
                                    >
                                        {/* Dynamic Background Mesh */}
                                        {!selected && (
                                            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                                                <div className="absolute -right-10 -top-10 w-40 h-40 bg-[var(--accent-primary)]/5 rounded-full blur-3xl" />
                                                <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-[var(--accent-secondary)]/5 rounded-full blur-3xl" />
                                            </div>
                                        )}
                                        <div className="relative z-10 p-3 rounded-xl bg-zinc-800/50 shadow-inner">
                                            <HardDrive size={32} className={isLowSpace ? 'text-red-400' : 'text-[var(--text-muted)]'} />
                                        </div>
                                        <div className="relative z-10 flex-1 min-w-0 space-y-1.5">
                                            <div className={`text-sm truncate font-bold ${selected ? 'text-white' : 'text-zinc-100'}`}>
                                                {drive.name}
                                            </div>
                                            {info && (
                                                <>
                                                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden shadow-inner">
                                                        <div
                                                            className={`h-full transition-all duration-1000 ease-out rounded-full shadow-[0_0_8px_rgba(0,0,0,0.2)]
                                                                ${isLowSpace ? 'bg-gradient-to-r from-rose-600 to-red-500' : 'bg-gradient-to-r from-[var(--accent-secondary)] to-[var(--accent-primary)]'}`}
                                                            style={{ width: `${usagePercent}%` }}
                                                        />
                                                    </div>
                                                    <div className="flex justify-between items-center text-xs text-[var(--text-muted)] font-medium">
                                                        <span>{formatSize(info.available_space)} free of {formatSize(info.total_space)}</span>
                                                        <span>{Math.floor(usagePercent)}%</span>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </GlowCard>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}
