import { useState } from 'react';
import { Settings, Folder, Check, X, ChevronRight, SlidersHorizontal, Monitor, Home, Download, FileText, Image, Trash2 } from 'lucide-react';

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
    onSave: (newConfig: QuickAccessConfig, newSortConfig?: SortConfig, showHiddenFiles?: boolean, autoSearchOnKey?: boolean) => void;
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

export default function SettingsPanel({ config, sortConfig, showHiddenFiles, autoSearchOnKey, onSave, onReset, onCancel }: SettingsPanelProps) {
    const [localConfig, setLocalConfig] = useState<QuickAccessConfig>(() => ({
        pinnedFolders: config?.pinnedFolders || []
    }));
    const [localSortConfig, setLocalSortConfig] = useState<SortConfig>(() => ({
        column: sortConfig?.column || 'name',
        direction: sortConfig?.direction || 'asc'
    }));
    const [localShowHidden, setLocalShowHidden] = useState(!!showHiddenFiles);
    const [localAutoSearch, setLocalAutoSearch] = useState(!!autoSearchOnKey);
    const [activeSection, setActiveSection] = useState('general');

    const handleSave = () => {
        onSave(localConfig, localSortConfig, localShowHidden, localAutoSearch);
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
        <div className="flex-1 flex bg-[#0b0b0b] animate-in fade-in zoom-in-95 duration-200">
            {/* Settings Sidebar */}
            <aside className="w-64 border-r border-white/5 bg-[#141414]/50 backdrop-blur-3xl flex flex-col p-4">
                <div className="flex items-center gap-3 px-3 py-4 mb-6">
                    <Settings size={20} className="text-zinc-400" />
                    <h2 className="text-lg font-bold text-white tracking-tight">Settings</h2>
                </div>

                <nav className="space-y-1">
                    <button
                        onClick={() => setActiveSection('general')}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all
              ${activeSection === 'general'
                                ? 'bg-blue-500/10 text-blue-400 font-semibold border border-blue-500/10'
                                : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'}`}
                    >
                        <div className="flex items-center gap-3">
                            <SlidersHorizontal size={18} />
                            General
                        </div>
                        <ChevronRight size={14} className="opacity-30" />
                    </button>
                    <button
                        onClick={() => setActiveSection('quick-access')}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all
              ${activeSection === 'quick-access'
                                ? 'bg-blue-500/10 text-blue-400 font-semibold border border-blue-500/10'
                                : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'}`}
                    >
                        <div className="flex items-center gap-3">
                            <Folder size={18} />
                            Quick access
                        </div>
                        <ChevronRight size={14} className="opacity-30" />
                    </button>
                </nav>
            </aside>

            {/* Settings Content */}
            <main className="flex-1 flex flex-col min-w-0 mica-container">
                {activeSection === 'general' && (
                    <>
                        <header className="px-10 pt-10 pb-6">
                            <h1 className="text-3xl font-bold text-white mb-2">General</h1>
                            <p className="text-sm text-zinc-500">Configure the default behavior of the explorer.</p>
                        </header>

                        <div className="flex-1 overflow-y-auto px-10 space-y-8 max-w-2xl">
                            <div className="space-y-6">
                                <div className="grid gap-2">
                                    <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Default Sort Column</label>
                                    <select
                                        value={localSortConfig.column}
                                        onChange={(e) => setLocalSortConfig({ ...localSortConfig, column: e.target.value as SortColumn })}
                                        className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all cursor-pointer"
                                    >
                                        {SORT_COLUMNS.map((col) => (
                                            <option key={col.value} value={col.value} className="bg-zinc-900">
                                                {col.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="grid gap-2">
                                    <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Default Sort Direction</label>
                                    <select
                                        value={localSortConfig.direction}
                                        onChange={(e) => setLocalSortConfig({ ...localSortConfig, direction: e.target.value as SortDirection })}
                                        className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all cursor-pointer"
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
                                        className="w-5 h-5 rounded-md bg-white/[0.03] border border-white/10 checked:bg-blue-500 checked:border-blue-500 cursor-pointer accent-blue-500"
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
                                        className="w-5 h-5 rounded-md bg-white/[0.03] border border-white/10 checked:bg-blue-500 checked:border-blue-500 cursor-pointer accent-blue-500"
                                    />
                                    <label htmlFor="autoSearch" className="text-sm text-zinc-300 cursor-pointer">
                                        Type to search automatically
                                    </label>
                                </div>

                                <div className="pt-8 border-t border-white/5 space-y-4">
                                    <div className="space-y-1">
                                        <h3 className="text-sm font-bold text-white">Maintenance</h3>
                                        <p className="text-xs text-zinc-500">Restore the application to its original configuration.</p>
                                    </div>
                                    <button
                                        onClick={onReset}
                                        className="px-4 py-2 bg-zinc-900 border border-white/10 hover:border-red-500/50 hover:bg-red-500/10 text-zinc-400 hover:text-red-400 text-xs font-bold rounded-lg transition-all active:scale-95"
                                    >
                                        Reset to Defaults
                                    </button>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {activeSection === 'quick-access' && (
                    <>
                        <header className="px-10 pt-10 pb-6">
                            <h1 className="text-3xl font-bold text-white mb-2">Quick access</h1>
                            <p className="text-sm text-zinc-500">Manage system and custom folders in your sidebar.</p>
                        </header>

                        <div className="flex-1 overflow-y-auto px-10 space-y-10 max-w-3xl pb-10">
                            {/* System Folders Section */}
                            <section className="space-y-4">
                                <div className="space-y-1">
                                    <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest pl-1">Fixed Quick Access Items</h3>
                                    <p className="text-xs text-zinc-500 pl-1 border-l-2 border-blue-500/30">Enable or disable core system locations in your sidebar.</p>
                                </div>
                                <div className="grid gap-3 bg-white/[0.02] border border-white/5 rounded-2xl p-4 shadow-inner">
                                    {systemFolders.map((folder) => (
                                        <div key={folder.id} className="group flex items-center gap-4 bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all rounded-xl p-3">
                                            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/5 text-zinc-400 group-hover:text-blue-400 group-hover:bg-blue-400/10 transition-colors">
                                                {getIcon(folder.id)}
                                            </div>
                                            <div className="flex-1 space-y-1.5">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs font-bold text-zinc-200">{folder.name}</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-[10px] uppercase tracking-tighter transition-colors ${folder.enabled ? 'text-emerald-500 font-black' : 'text-zinc-600'}`}>
                                                            {folder.enabled ? 'Enabled' : 'Disabled'}
                                                        </span>
                                                        <button
                                                            onClick={() => toggleFolder(folder.id)}
                                                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${folder.enabled ? 'bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]' : 'bg-zinc-700'}`}
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
                                                        ${folder.id === 'recycle-bin' ? 'text-zinc-600 cursor-not-allowed opacity-50' : 'text-zinc-400 focus:outline-none focus:border-blue-500/50'}`}
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
                                    <p className="text-xs text-zinc-500 pl-1 border-l-2 border-zinc-700">Configure paths for your manually pinned folders.</p>
                                </div>
                                <div className="space-y-3">
                                    {customFolders.length > 0 ? customFolders.map((folder) => (
                                        <div key={folder.id} className="grid gap-2 bg-white/[0.02] border border-white/5 rounded-xl p-4">
                                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-1">{folder.name}</label>
                                            <input
                                                type="text"
                                                value={folder.path}
                                                onChange={(e) => updatePath(folder.id, e.target.value)}
                                                className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all font-mono"
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
                    </>
                )}

                {/* Action Footer */}
                <footer className="p-10 flex items-center gap-4 bg-[#0b0b0b]/40 backdrop-blur-md border-t border-white/5">
                    <button
                        onClick={handleSave}
                        className="flex items-center gap-2 px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-blue-500/20 active:scale-95"
                    >
                        <Check size={18} /> Apply changes
                    </button>
                    <button
                        onClick={onCancel}
                        className="flex items-center gap-2 px-6 py-2.5 bg-white/5 hover:bg-white/10 text-zinc-300 text-sm font-semibold rounded-xl transition-all active:scale-95"
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
