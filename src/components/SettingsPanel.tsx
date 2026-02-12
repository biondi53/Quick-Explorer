import { useState } from 'react';
import { Settings, Folder, Check, X, ChevronRight, SlidersHorizontal, Monitor, Home, Download, FileText, Image, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface PinnedFolder {
    id: string;
    name: string;
    path: string;
    enabled?: boolean;
}

interface QuickAccessConfig {
    pinnedFolders: PinnedFolder[];
}

type SortColumn = 'name' | 'modified_at' | 'created_at' | 'file_type' | 'size';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
    column: SortColumn;
    direction: SortDirection;
}

interface SettingsPanelProps {
    config: QuickAccessConfig;
    sortConfig: SortConfig;
    showHiddenFiles: boolean;
    autoSearchOnKey: boolean;
    focusNewTabOnMiddleClick: boolean;
    onSave: (newConfig: QuickAccessConfig, newSortConfig?: SortConfig, showHiddenFiles?: boolean, autoSearchOnKey?: boolean, focusNewTabOnMiddleClick?: boolean) => void;
    onReset: () => void;
    onCancel: () => void;
}

const SORT_COLUMNS: { value: SortColumn; label: string }[] = [
    { value: 'name', label: 'Name' },
    { value: 'modified_at', label: 'Date modified' },
    { value: 'created_at', label: 'Date created' },
    { value: 'file_type', label: 'Type' },
    { value: 'size', label: 'Size' },
];

const SORT_DIRECTIONS: { value: SortDirection; label: string }[] = [
    { value: 'asc', label: 'Ascending' },
    { value: 'desc', label: 'Descending' },
];

const SYSTEM_FOLDER_IDS = ['desktop', 'downloads', 'documents', 'pictures', 'recycle-bin', 'home'];

export default function SettingsPanel({ config, sortConfig, showHiddenFiles, autoSearchOnKey, focusNewTabOnMiddleClick, onSave, onReset, onCancel }: SettingsPanelProps) {
    const [localConfig, setLocalConfig] = useState<QuickAccessConfig>(() => ({
        pinnedFolders: config?.pinnedFolders || []
    }));
    const [localSortConfig, setLocalSortConfig] = useState<SortConfig>(() => ({
        column: sortConfig?.column || 'name',
        direction: sortConfig?.direction || 'asc'
    }));
    const [localShowHidden, setLocalShowHidden] = useState(!!showHiddenFiles);
    const [localAutoSearch, setLocalAutoSearch] = useState(!!autoSearchOnKey);
    const [localFocusNewTab, setLocalFocusNewTab] = useState(!!focusNewTabOnMiddleClick);
    const [activeSection, setActiveSection] = useState('general');

    const handleSave = () => {
        onSave(localConfig, localSortConfig, localShowHidden, localAutoSearch, localFocusNewTab);
    };

    const toggleFolder = (id: string) => {
        const newPins = localConfig.pinnedFolders.map(f =>
            f.id === id ? { ...f, enabled: !f.enabled } : f
        );
        setLocalConfig({ ...localConfig, pinnedFolders: newPins });
    };

    const updatePath = (id: string, path: string) => {
        const newPins = localConfig.pinnedFolders.map(f =>
            f.id === id ? { ...f, path } : f
        );
        setLocalConfig({ ...localConfig, pinnedFolders: newPins });
    };

    const systemFolders = localConfig.pinnedFolders.filter(f => SYSTEM_FOLDER_IDS.includes(f.id));
    const customFolders = localConfig.pinnedFolders.filter(f => !SYSTEM_FOLDER_IDS.includes(f.id));

    const getIcon = (id: string) => {
        switch (id) {
            case 'desktop': return <Monitor size={16} />;
            case 'home': return <Home size={16} />;
            case 'downloads': return <Download size={16} />;
            case 'documents': return <FileText size={16} />;
            case 'pictures': return <Image size={16} />;
            case 'recycle-bin': return <Trash2 size={16} />;
            default: return <Folder size={16} />;
        }
    };

    return (
        <div className="flex-1 flex bg-[#0b0b0b] animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
            {/* Settings Sidebar */}
            <aside className="w-64 border-r border-white/5 bg-[#141414]/50 backdrop-blur-3xl flex flex-col p-4 z-10">
                <div className="flex items-center gap-3 px-3 py-4 mb-6">
                    <Settings size={20} className="text-[var(--text-dim)]" />
                    <h2 className="text-lg font-bold text-white tracking-tight">Settings</h2>
                </div>

                <nav className="space-y-1 relative">
                    <button
                        onClick={() => setActiveSection('general')}
                        className={`w-full relative flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all z-10
              ${activeSection === 'general'
                                ? 'text-white font-semibold'
                                : 'text-[var(--text-muted)] hover:bg-white/5 hover:text-zinc-300'}`}
                    >
                        <div className="flex items-center gap-3">
                            <SlidersHorizontal size={18} />
                            General
                        </div>
                        <ChevronRight size={14} className="opacity-30" />
                        {activeSection === 'general' && (
                            <motion.div
                                layoutId="activeSetting"
                                className="absolute inset-0 bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20 rounded-xl -z-10"
                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            />
                        )}
                    </button>
                    <button
                        onClick={() => setActiveSection('quick-access')}
                        className={`w-full relative flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all z-10
              ${activeSection === 'quick-access'
                                ? 'text-white font-semibold'
                                : 'text-[var(--text-muted)] hover:bg-white/5 hover:text-zinc-300'}`}
                    >
                        <div className="flex items-center gap-3">
                            <Folder size={18} />
                            Quick access
                        </div>
                        <ChevronRight size={14} className="opacity-30" />
                        {activeSection === 'quick-access' && (
                            <motion.div
                                layoutId="activeSetting"
                                className="absolute inset-0 bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20 rounded-xl -z-10"
                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            />
                        )}
                    </button>
                </nav>
            </aside>

            {/* Settings Content */}
            <main className="flex-1 flex flex-col min-w-0 mica-container relative overflow-hidden">
                <AnimatePresence mode="wait">
                    {activeSection === 'general' ? (
                        <motion.div
                            key="general"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.2 }}
                            className="flex-1 overflow-y-auto min-w-0 h-full min-h-0"
                        >
                            <header className="px-10 pt-10 pb-6">
                                <h1 className="text-3xl font-bold text-white mb-2">General</h1>
                                <p className="text-sm text-[var(--text-muted)]">Configure the default behavior of the explorer.</p>
                            </header>

                            <div className="px-10 space-y-8 max-w-2xl pb-10">
                                <div className="space-y-6">
                                    <div className="grid gap-2">
                                        <label className="text-xs font-bold text-[var(--text-dim)] uppercase tracking-widest pl-1">Default Sort Column</label>
                                        <select
                                            value={localSortConfig.column}
                                            onChange={(e) => setLocalSortConfig({ ...localSortConfig, column: e.target.value as SortColumn })}
                                            className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30 transition-all cursor-pointer"
                                        >
                                            {SORT_COLUMNS.map((col) => (
                                                <option key={col.value} value={col.value} className="bg-zinc-900">
                                                    {col.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="grid gap-2">
                                        <label className="text-xs font-bold text-[var(--text-dim)] uppercase tracking-widest pl-1">Default Sort Direction</label>
                                        <select
                                            value={localSortConfig.direction}
                                            onChange={(e) => setLocalSortConfig({ ...localSortConfig, direction: e.target.value as SortDirection })}
                                            className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30 transition-all cursor-pointer"
                                        >
                                            {SORT_DIRECTIONS.map((dir) => (
                                                <option key={dir.value} value={dir.value} className="bg-zinc-900">
                                                    {dir.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="flex items-center gap-3 py-2">
                                        <input
                                            type="checkbox"
                                            id="showHidden"
                                            checked={localShowHidden}
                                            onChange={(e) => setLocalShowHidden(e.target.checked)}
                                            style={{ accentColor: 'var(--accent-primary)' }}
                                            className="w-5 h-5 rounded-md bg-white/[0.03] border border-white/10 cursor-pointer"
                                        />
                                        <label htmlFor="showHidden" className="text-sm text-zinc-300 cursor-pointer">
                                            Show hidden files and folders
                                        </label>
                                    </div>

                                    <div className="flex items-center gap-3 py-2">
                                        <input
                                            type="checkbox"
                                            id="autoSearch"
                                            checked={localAutoSearch}
                                            onChange={(e) => setLocalAutoSearch(e.target.checked)}
                                            style={{ accentColor: 'var(--accent-primary)' }}
                                            className="w-5 h-5 rounded-md bg-white/[0.03] border border-white/10 cursor-pointer"
                                        />
                                        <label htmlFor="autoSearch" className="text-sm text-zinc-300 cursor-pointer">
                                            Type to search automatically
                                        </label>
                                    </div>

                                    <div className="flex items-center gap-3 py-2">
                                        <input
                                            type="checkbox"
                                            id="focusNewTab"
                                            checked={localFocusNewTab}
                                            onChange={(e) => setLocalFocusNewTab(e.target.checked)}
                                            style={{ accentColor: 'var(--accent-primary)' }}
                                            className="w-5 h-5 rounded-md bg-white/[0.03] border border-white/10 cursor-pointer"
                                        />
                                        <label htmlFor="focusNewTab" className="text-sm text-zinc-300 cursor-pointer">
                                            Focus new tabs opened with middle click
                                        </label>
                                    </div>

                                    <div className="pt-8 border-t border-white/5 space-y-4">
                                        <div className="space-y-1">
                                            <h3 className="text-sm font-bold text-white">Maintenance</h3>
                                            <p className="text-xs text-[var(--text-muted)]">Restore the application to its original configuration.</p>
                                        </div>
                                        <button
                                            onClick={onReset}
                                            className="px-4 py-2 bg-zinc-900 border border-white/10 hover:border-red-500/50 hover:bg-red-500/10 text-[var(--text-dim)] hover:text-red-400 text-xs font-bold rounded-lg transition-all active:scale-95"
                                        >
                                            Reset to Defaults
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="quick-access"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.2 }}
                            className="flex-1 overflow-y-auto min-w-0 h-full min-h-0"
                        >
                            <header className="px-10 pt-10 pb-6">
                                <h1 className="text-3xl font-bold text-white mb-2">Quick access</h1>
                                <p className="text-sm text-[var(--text-muted)]">Manage system and custom folders in your sidebar.</p>
                            </header>

                            <div className="px-10 space-y-10 max-w-3xl pb-10">
                                {/* System Folders Section */}
                                <section className="space-y-4">
                                    <div className="space-y-1">
                                        <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest pl-1">Fixed Quick Access Items</h3>
                                        <p className="text-xs text-[var(--text-muted)] pl-1 border-l-2 border-[var(--accent-primary)]/30">Enable or disable core system locations in your sidebar.</p>
                                    </div>
                                    <div className="grid gap-3 bg-white/[0.02] border border-white/5 rounded-2xl p-4 shadow-inner">
                                        {systemFolders.map((folder) => (
                                            <div key={folder.id} className="group flex items-center gap-4 bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all rounded-xl p-3">
                                                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/5 text-[var(--text-dim)] group-hover:text-[var(--accent-primary)] group-hover:bg-[var(--accent-primary)]/10 transition-colors">
                                                    {getIcon(folder.id)}
                                                </div>
                                                <div className="flex-1 space-y-1.5">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs font-bold text-zinc-200">{folder.name}</span>
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => toggleFolder(folder.id)}
                                                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-black ${folder.enabled ? 'bg-[var(--accent-primary)] shadow-[0_0_15px_var(--accent-glow)]' : 'bg-zinc-700'}`}
                                                            >
                                                                <span className={`absolute h-4 w-4 rounded-full bg-white shadow-md transition-all duration-300 ease-spring ${folder.enabled ? 'left-[24px]' : 'left-[4px]'}`} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <input
                                                        type="text"
                                                        value={folder.path}
                                                        onChange={(e) => updatePath(folder.id, e.target.value)}
                                                        disabled={folder.id === 'recycle-bin'}
                                                        title={folder.id === 'recycle-bin' ? "The Recycle Bin path is managed by the system" : ""}
                                                        className={`w-full bg-black/20 border border-white/5 rounded-lg px-3 py-1.5 text-xs transition-all font-mono
                                                            ${folder.id === 'recycle-bin' ? 'text-zinc-600 cursor-not-allowed opacity-50' : 'text-zinc-400 focus:outline-none focus:border-[var(--accent-primary)]/50'}`}
                                                        placeholder="Path not set"
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                <div className="h-px bg-white/5" />

                                {/* Custom Folders Section */}
                                <section className="space-y-4">
                                    <div className="space-y-1">
                                        <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest pl-1">Custom Folders</h3>
                                        <p className="text-xs text-[var(--text-muted)] pl-1 border-l-2 border-[var(--accent-primary)]/30">Configure paths for your manually pinned folders.</p>
                                    </div>
                                    <div className="space-y-3">
                                        {customFolders.length > 0 ? customFolders.map((folder) => (
                                            <div key={folder.id} className="grid gap-2 bg-white/[0.02] border border-white/5 rounded-xl p-4">
                                                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-1">{folder.name}</label>
                                                <input
                                                    type="text"
                                                    value={folder.path}
                                                    onChange={(e) => updatePath(folder.id, e.target.value)}
                                                    className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30 transition-all font-mono"
                                                    placeholder="Enter full path..."
                                                />
                                            </div>
                                        )) : (
                                            <div className="flex flex-col items-center justify-center py-10 border-2 border-dashed border-white/5 rounded-2xl">
                                                <Folder className="text-zinc-700 mb-2 opacity-20" size={32} />
                                                <p className="text-xs text-zinc-600 font-medium">No custom folders pinned yet.</p>
                                            </div>
                                        )}
                                    </div>
                                </section>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Action Footer */}
                <footer className="p-10 flex items-center gap-4 bg-[#0b0b0b]/40 backdrop-blur-md border-t border-white/5 mt-auto z-20">
                    <button
                        onClick={handleSave}
                        className="flex items-center justify-center gap-2 px-6 py-2.5 bg-[var(--accent-primary)] hover:opacity-90 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-[rgba(var(--accent-rgb),0.2)] active:scale-95"
                    >
                        <Check size={18} /> Accept
                    </button>
                    <button
                        onClick={onCancel}
                        className="flex items-center justify-center gap-2 px-6 py-2.5 bg-white/5 hover:bg-white/10 text-zinc-300 text-sm font-semibold rounded-xl transition-all active:scale-95"
                    >
                        <X size={18} /> Cancel
                    </button>
                </footer>
            </main>

            <style>{`
                .ease-spring { transition-timing-function: cubic-bezier(0.175, 0.885, 0.32, 1.275); }
            `}</style>
        </div>
    );
}
