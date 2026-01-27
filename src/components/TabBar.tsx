import { X, Plus } from 'lucide-react';
import WindowControls from './WindowControls';

interface Tab {
    id: string;
    path: string;
}

interface TabBarProps {
    tabs: Tab[];
    activeTabId: string;
    onTabClick: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onNewTab: () => void;
}

export default function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onNewTab }: TabBarProps) {
    const getTabName = (path: string) => {
        if (!path) return 'This PC';
        if (path === 'shell:RecycleBin') return 'Recycle Bin';
        const parts = path.split('\\').filter(Boolean);
        return parts[parts.length - 1] || path;
    };

    return (
        <div
            className="h-10 bg-[var(--bg-deep)] border-b border-white/10 flex items-center px-2 gap-1 backdrop-blur-3xl shadow-xl z-20"
            data-tauri-drag-region
        >
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                {tabs.map((tab) => (
                    <div
                        key={tab.id}
                        onClick={() => onTabClick(tab.id)}
                        onMouseDown={(e) => {
                            // Middle click to close
                            if (e.button === 1) {
                                e.preventDefault();
                                onTabClose(tab.id);
                            }
                        }}
                        className={`group relative flex items-center gap-2 h-8 px-4 rounded-t-xl cursor-pointer transition-all max-w-[200px] min-w-[120px] no-drag
                            ${tab.id === activeTabId
                                ? 'bg-[var(--bg-surface)] text-white shadow-[0_-4px_20px_rgba(0,0,0,0.4)]'
                                : 'bg-black/20 text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-300'}`}
                    >
                        {tab.id === activeTabId && (
                            <div className="absolute top-0 left-2 right-2 h-0.5 bg-[var(--accent-primary)] rounded-full shadow-[0_0_10px_var(--accent-primary)]" />
                        )}
                        <span className={`text-[11px] uppercase tracking-wider truncate flex-1 ${tab.id === activeTabId ? 'font-black' : 'font-bold'}`}>
                            {getTabName(tab.path)}
                        </span>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onTabClose(tab.id);
                            }}
                            className={`p-0.5 rounded hover:bg-white/10 transition-opacity
                                ${tab.id === activeTabId ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'}`}
                        >
                            <X size={12} />
                        </button>
                    </div>
                ))}
            </div>

            <button
                onClick={onNewTab}
                className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-500 hover:text-zinc-300 transition-colors ml-1 no-drag"
                title="New Tab (Ctrl+T)"
            >
                <Plus size={16} />
            </button>

            <div className="flex-1 h-full" data-tauri-drag-region />

            <WindowControls />
        </div>
    );
}
