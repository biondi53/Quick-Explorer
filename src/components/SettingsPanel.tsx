import { useState } from 'react';
import { Settings, Folder, Check, X, ChevronRight, SlidersHorizontal, Monitor, Download, FileText, Image, Trash2, Languages } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from '../i18n/useTranslation';
import { Language } from '../i18n/types';

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
    onSave: (newConfig: QuickAccessConfig, newSortConfig?: SortConfig, showHiddenFiles?: boolean, autoSearchOnKey?: boolean, focusNewTabOnMiddleClick?: boolean, closePanel?: boolean) => void;
    onReset: () => void;
    onCancel: () => void;
}

const SYSTEM_FOLDER_IDS = ['desktop', 'downloads', 'documents', 'pictures', 'recycle-bin', 'home'];

export default function SettingsPanel({ config, sortConfig, showHiddenFiles, autoSearchOnKey, focusNewTabOnMiddleClick, onSave, onReset, onCancel }: SettingsPanelProps) {
    const { t, language, setLanguage } = useTranslation();
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
    const [localLanguage, setLocalLanguage] = useState<Language>(language);

    const handleSave = (closePanel = true) => {
        setLanguage(localLanguage);
        onSave(localConfig, localSortConfig, localShowHidden, localAutoSearch, localFocusNewTab, closePanel);
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

    const getSystemLabel = (id: string, fallback: string) => {
        const key = id === 'recycle-bin' ? 'recycle_bin' : id === 'home' ? 'this_pc' : id;
        const translated = t(`sidebar.${key}`);
        return translated === `sidebar.${key}` ? fallback : translated;
    };

    const getIcon = (id: string) => {
        switch (id) {
            case 'desktop': return <Monitor size={16} />;
            case 'home': return <Monitor size={16} />;
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
                    <h2 className="text-lg font-bold text-white tracking-tight">{t('settings.title')}</h2>
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
                            {t('settings.general')}
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
                            {t('sidebar.pinned')}
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
                                <h1 className="text-3xl font-bold text-white mb-2">{t('settings.general')}</h1>
                                <p className="text-sm text-[var(--text-muted)]">{t('settings.general_desc')}</p>
                            </header>

                            <div className="px-10 space-y-8 max-w-2xl pb-10">
                                <div className="space-y-6">
                                    <div className="grid gap-2">
                                        <label className="text-xs font-bold text-[var(--text-dim)] uppercase tracking-widest pl-1">{t('settings.language')}</label>
                                        <div className="flex items-center gap-3">
                                            <Languages size={18} className="text-[var(--text-dim)]" />
                                            <select
                                                value={localLanguage}
                                                onChange={(e) => setLocalLanguage(e.target.value as Language)}
                                                className="flex-1 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30 transition-all cursor-pointer"
                                            >
                                                <option value="auto" className="bg-zinc-900">{t('settings.auto')}</option>
                                                <option value="es" className="bg-zinc-900">{t('settings.spanish')}</option>
                                                <option value="en" className="bg-zinc-900">{t('settings.english')}</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="grid gap-2">
                                        <label className="text-xs font-bold text-[var(--text-dim)] uppercase tracking-widest pl-1">{t('context_menu.sort_by')}</label>
                                        <select
                                            value={localSortConfig.column}
                                            onChange={(e) => setLocalSortConfig({ ...localSortConfig, column: e.target.value as SortColumn })}
                                            className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30 transition-all cursor-pointer"
                                        >
                                            <option value="name" className="bg-zinc-900">{t('files.name')}</option>
                                            <option value="modified_at" className="bg-zinc-900">{t('files.date_modified')}</option>
                                            <option value="created_at" className="bg-zinc-900">{t('files.date_created')}</option>
                                            <option value="file_type" className="bg-zinc-900">{t('files.type')}</option>
                                            <option value="size" className="bg-zinc-900">{t('files.size')}</option>
                                        </select>
                                    </div>

                                    <div className="grid gap-2">
                                        <select
                                            value={localSortConfig.direction}
                                            onChange={(e) => setLocalSortConfig({ ...localSortConfig, direction: e.target.value as SortDirection })}
                                            className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30 transition-all cursor-pointer"
                                        >
                                            <option value="asc" className="bg-zinc-900">{t('settings.ascending')}</option>
                                            <option value="desc" className="bg-zinc-900">{t('settings.descending')}</option>
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
                                            {t('settings.show_hidden')}
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
                                            {t('settings.auto_search')}
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
                                            {t('settings.focus_new_tab')}
                                        </label>
                                    </div>

                                    <div className="pt-8 border-t border-white/5 space-y-4">
                                        <div className="space-y-1">
                                            <h3 className="text-sm font-bold text-white">{t('settings.maintenance')}</h3>
                                            <p className="text-xs text-[var(--text-muted)]">{t('settings.maintenance_desc')}</p>
                                        </div>
                                        <button
                                            onClick={onReset}
                                            className="px-4 py-2 bg-zinc-900 border border-white/10 hover:border-red-500/50 hover:bg-red-500/10 text-[var(--text-dim)] hover:text-red-400 text-xs font-bold rounded-lg transition-all active:scale-95"
                                        >
                                            {t('settings.reset_to_default')}
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
                                <h1 className="text-3xl font-bold text-white mb-2">{t('sidebar.pinned')}</h1>
                                <p className="text-sm text-[var(--text-muted)]">{t('settings.pinned_desc')}</p>
                            </header>

                            <div className="px-10 space-y-10 max-w-3xl pb-10">
                                {/* System Folders Section */}
                                <section className="space-y-4">
                                    <div className="space-y-1">
                                        <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest pl-1">{t('settings.fixed_items')}</h3>
                                        <p className="text-xs text-[var(--text-muted)] pl-1 border-l-2 border-[var(--accent-primary)]/30">{t('settings.fixed_items_desc')}</p>
                                    </div>
                                    <div className="grid gap-3 bg-white/[0.02] border border-white/5 rounded-2xl p-4 shadow-inner">
                                        {systemFolders.map((folder) => (
                                            <div key={folder.id} className="group flex items-center gap-4 bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all rounded-xl p-3">
                                                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/5 text-[var(--text-dim)] group-hover:text-[var(--accent-primary)] group-hover:bg-[var(--accent-primary)]/10 transition-colors">
                                                    {getIcon(folder.id)}
                                                </div>
                                                <div className="flex-1 space-y-1.5">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex-1 min-w-0">
                                                            <h4 className="text-sm font-semibold text-white mb-0.5 truncate">
                                                                {getSystemLabel(folder.id, folder.name)}
                                                            </h4>
                                                        </div>
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
                                                        disabled={folder.id === 'recycle-bin' || folder.id === 'home'}
                                                        title={folder.id === 'recycle-bin' || folder.id === 'home' ? "This path is managed by the system" : ""}
                                                        className={`w-full bg-black/20 border border-white/5 rounded-lg px-3 py-1.5 text-xs transition-all font-mono
                                                            ${(folder.id === 'recycle-bin' || folder.id === 'home') ? 'text-zinc-600 cursor-not-allowed opacity-50' : 'text-zinc-400 focus:outline-none focus:border-[var(--accent-primary)]/50'}`}
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
                                        <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest pl-1">{t('settings.custom_folders')}</h3>
                                        <p className="text-xs text-[var(--text-muted)] pl-1 border-l-2 border-[var(--accent-primary)]/30">{t('settings.custom_folders_desc')}</p>
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
                                                <p className="text-xs text-zinc-600 font-medium">{t('settings.no_custom_folders')}</p>
                                            </div>
                                        )}
                                    </div>
                                </section>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Action Footer */}
                <footer className="p-10 flex items-center justify-start gap-3 bg-[#0b0b0b]/40 backdrop-blur-md border-t border-white/5 mt-auto z-20">
                    <button
                        onClick={() => handleSave(true)}
                        className="flex items-center justify-center gap-2 px-6 py-2.5 bg-[var(--accent-primary)] hover:opacity-90 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-[rgba(var(--accent-rgb),0.2)] active:scale-95"
                    >
                        <Check size={18} /> {t('common.confirm')}
                    </button>
                    <button
                        onClick={() => handleSave(false)}
                        className="flex items-center justify-center gap-2 px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white text-sm font-bold rounded-xl transition-all border border-white/5 active:scale-95"
                    >
                        <Check size={18} /> {t('common.apply')}
                    </button>
                    <button
                        onClick={onCancel}
                        className="flex items-center justify-center gap-2 px-6 py-2.5 bg-white/5 hover:bg-white/10 text-zinc-300 text-sm font-semibold rounded-xl transition-all active:scale-95 border border-transparent"
                    >
                        <X size={18} /> {t('common.cancel')}
                    </button>
                </footer>
            </main>

            <style>{`
                .ease-spring { transition-timing-function: cubic-bezier(0.175, 0.885, 0.32, 1.275); }
            `}</style>
        </div>
    );
}
