import { useMemo, memo, useState, useCallback } from 'react';
import { File, Folder, Info, Eye, PlayCircle, Loader2, Copy, Check } from 'lucide-react';

import { useFilePreview } from '../hooks/useFilePreview';

import { FileEntry } from '../types';

interface InfoPanelProps {
    selectedFiles: FileEntry[];
    width: number;
}

const InfoPanel = memo(({ selectedFiles, width }: InfoPanelProps) => {
    const [copied, setCopied] = useState(false);

    // Memoize to prevent recalculation on every render
    const firstSelected = useMemo(() =>
        selectedFiles.length === 1 ? selectedFiles[0] : null,
        [selectedFiles]
    );

    const copyToClipboard = useCallback(() => {
        if (firstSelected?.path) {
            navigator.clipboard.writeText(firstSelected.path);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    }, [firstSelected?.path]);

    // ... (rest of useMemos and hooks)

    // Memoize file type determination
    const fileType = useMemo((): 'video' | 'image' | 'none' => {
        if (firstSelected && !firstSelected.is_dir) {
            if (/\.(mp4|mkv|webm|avi|mov|wmv|flv|mpg|mpeg)$/i.test(firstSelected.name)) {
                return 'video';
            } else if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|ico)$/i.test(firstSelected.name)) {
                return 'image';
            }
        }
        return 'none';
    }, [firstSelected]);

    const { previewUrl, isLoading, source, dimensions } = useFilePreview(
        firstSelected?.path || null,
        fileType,
        firstSelected?.modified_timestamp || 0
    );

    if (selectedFiles.length === 0) {
        return (
            <aside
                className="flex flex-col bg-[var(--bg-surface)] border-l border-white/10 backdrop-blur-2xl items-center justify-center text-[var(--text-muted)] p-8 text-center"
                style={{ width }}
                onContextMenu={(e) => e.preventDefault()}
            >
                <Info size={48} className="opacity-10 mb-4" />
                <p className="text-sm font-bold tracking-tight">Select a file or folder to view its properties</p>
            </aside>
        );
    }

    if (selectedFiles.length > 1) {
        const totalSize = selectedFiles.reduce((acc, f) => acc + f.size, 0);
        const formatSize = (s: number) => {
            if (s < 1024) return `${s} B`;
            if (s < 1024 * 1024) return `${(s / 1024).toFixed(1)} KB`;
            return `${(s / (1024 * 1024)).toFixed(1)} MB`;
        };

        return (
            <aside
                className="flex flex-col bg-[var(--bg-surface)] border-l border-white/10 backdrop-blur-2xl h-full select-none"
                style={{ width }}
                onContextMenu={(e) => e.preventDefault()}
            >
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-gradient-to-b from-transparent to-[var(--accent-primary)]/5">
                    <div className="p-10 rounded-[2.5rem] bg-white/[0.04] border border-white/10 mb-8 shadow-[0_0_50px_rgba(99,102,241,0.15)] relative group transition-transform duration-500">
                        <div className="absolute -inset-4 bg-[var(--accent-primary)]/10 rounded-full blur-3xl opacity-40"></div>
                        <div className="relative">
                            <File size={64} className="text-[var(--accent-primary)] opacity-30 translate-x-3 -translate-y-3" />
                            <File size={64} className="text-[var(--accent-primary)] absolute inset-0 drop-shadow-[0_0_20px_var(--accent-primary)]" />
                        </div>
                    </div>
                    <h3 className="text-4xl font-bold text-white tracking-tight mb-2">
                        {selectedFiles.length}<span className="text-[var(--accent-primary)]">.</span> items
                    </h3>
                    <p className="text-[var(--accent-secondary)] text-[10px] font-black uppercase tracking-[0.3em] mt-4 opacity-80">
                        Global weight: {formatSize(totalSize)}
                    </p>
                </div>
            </aside>
        );
    }

    const selectedFile = selectedFiles[0];
    const displayDimensions = selectedFile.dimensions || dimensions;

    return (
        <aside
            className="flex flex-col bg-[var(--bg-surface)] border-l border-white/10 backdrop-blur-2xl h-full overflow-hidden select-none"
            style={{ width }}
            onContextMenu={(e) => e.preventDefault()}
        >
            <div
                className="flex-1 overflow-y-auto p-6 space-y-8 flex flex-col items-center"
            >
                {/* Details Section */}
                <div className="w-full space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="space-y-1">
                        <label className="text-[10px] font-black text-[var(--accent-secondary)] uppercase tracking-[0.2em]">Name</label>
                        <div className="text-sm font-bold text-zinc-100 break-all">{selectedFile.name}</div>
                    </div>
                    <div className="space-y-1 group/path">
                        <div className="flex items-center gap-2">
                            <label className="text-[10px] font-black text-[var(--accent-secondary)] uppercase tracking-[0.2em]">Path</label>
                            <button
                                onClick={copyToClipboard}
                                className="p-1.5 rounded-md hover:bg-white/5 text-zinc-500 hover:text-[var(--accent-primary)] transition-all duration-200"
                                title="Copy path"
                            >
                                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                            </button>
                        </div>
                        <div
                            onClick={copyToClipboard}
                            className="text-[10px] font-mono text-zinc-400 break-all p-3 bg-black/40 rounded-xl border border-white/10 shadow-inner leading-relaxed cursor-pointer hover:border-[var(--accent-primary)]/30 transition-colors group-hover/path:text-zinc-300"
                        >
                            {selectedFile.path}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                        {/* Left Column */}
                        <div className="space-y-6">
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-[var(--accent-secondary)] uppercase tracking-[0.2em]">Type</label>
                                <div className="text-xs text-zinc-100 font-bold flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]" />
                                    {selectedFile.file_type}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-[var(--accent-secondary)] uppercase tracking-[0.2em]">Created</label>
                                <div className="text-xs text-zinc-100 font-bold">{selectedFile.created_at}</div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-[var(--accent-secondary)] uppercase tracking-[0.2em]">Modified</label>
                                <div className="text-xs text-zinc-100 font-bold">{selectedFile.modified_at}</div>
                            </div>
                        </div>

                        {/* Right Column */}
                        <div className="space-y-6">
                            <div className="space-y-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-[var(--accent-secondary)] uppercase tracking-[0.2em]">Size</label>
                                    <div className="text-xs text-white font-mono font-black">{selectedFile.formatted_size || '-'}</div>
                                </div>
                                {displayDimensions && (
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-[var(--accent-secondary)] uppercase tracking-[0.2em]">Dimensions</label>
                                        <div className="text-xs text-zinc-100 font-medium">{displayDimensions}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Preview Section */}
                <div className="w-full pt-8 border-t border-white/10 flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="w-full flex-1 flex flex-col items-center justify-center min-h-[160px]">
                        {fileType !== 'none' ? (
                            <div className="relative group w-full flex justify-center">
                                {isLoading ? (
                                    <div className="w-full aspect-video bg-white/5 rounded-xl animate-pulse flex items-center justify-center border border-white/10 no-drag">
                                        <Loader2 size={32} className="animate-spin text-[var(--accent-primary)]" />
                                    </div>
                                ) : previewUrl ? (
                                    <>
                                        <div className="absolute -inset-4 bg-[var(--accent-primary)]/20 rounded-full blur-3xl opacity-40"></div>
                                        <div className="relative w-full mx-auto rounded-xl overflow-hidden shadow-2xl border border-white/10 group">
                                            <img
                                                src={previewUrl}
                                                className="w-full max-h-[45vh] h-auto object-contain bg-black/20 transition-transform duration-700"
                                                alt="Preview"
                                            />
                                            {source && (
                                                <div
                                                    title={source === 'native' ? 'Loaded via Windows Shell' : 'Generated via FFmpeg'}
                                                    className={`absolute top-3 right-3 w-2.5 h-2.5 rounded-full backdrop-blur-md border animate-in fade-in zoom-in duration-300 z-10
                                                    ${source === 'native'
                                                            ? 'bg-blue-500/40 border-blue-500/50 shadow-[0_0_8px_rgba(59,130,246,0.3)]'
                                                            : 'bg-orange-500/40 border-orange-500/50 shadow-[0_0_8px_rgba(249,115,22,0.3)]'
                                                        }`}
                                                />
                                            )}
                                            {fileType === 'video' && (
                                                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                                    <PlayCircle size={48} className="text-white drop-shadow-lg opacity-80" />
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex flex-col items-center text-zinc-500">
                                        <div className="p-6 rounded-2xl bg-white/[0.04] mb-3 border border-white/5">
                                            {fileType === 'video' ? <PlayCircle size={32} className="opacity-20" /> : <Eye size={32} className="opacity-20" />}
                                        </div>
                                        <p className="text-[10px] font-bold uppercase tracking-wider opacity-50">Preview unavailable</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center text-[var(--text-muted)]">
                                <div className="p-10 rounded-[2.5rem] bg-white/[0.04] border border-white/10 mb-6 relative group transform transition-transform duration-500">
                                    <div className="absolute inset-0 bg-white/5 rounded-[2.5rem] blur-xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                    <div className="relative">
                                        {selectedFile.is_dir ? (
                                            <Folder size={64} className="text-[var(--accent-primary)] opacity-40" />
                                        ) : selectedFile.is_shortcut ? (
                                            <div className="relative">
                                                <File size={64} className="text-blue-400 opacity-40" />
                                                <div className="absolute bottom-0 right-0 bg-blue-500 rounded-sm p-0.5">
                                                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="white" strokeWidth="4">
                                                        <path d="M5 12h14m-7-7l7 7-7 7" />
                                                    </svg>
                                                </div>
                                            </div>
                                        ) : (
                                            <File size={64} className="text-zinc-300 opacity-40" />
                                        )}
                                    </div>
                                </div>
                                <h3 className="text-2xl font-black text-white tracking-[0.2em] mb-1 uppercase opacity-80">
                                    {selectedFile.is_dir ? 'Folder' : selectedFile.is_shortcut ? 'Shortcut' : selectedFile.name.split('.').pop()}
                                </h3>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </aside>
    );
});

export default InfoPanel;
