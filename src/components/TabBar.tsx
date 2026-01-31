import { useRef, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import WindowControls from './WindowControls';
import { Reorder } from 'framer-motion';
import { Tab } from '../types';



interface TabBarProps {
    tabs: Tab[];
    activeTabId: string;
    onTabClick: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onNewTab: () => void;
    onReorder: (newTabs: Tab[]) => void;
}

export default function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onNewTab, onReorder }: TabBarProps) {
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll active tab into view
    useEffect(() => {
        if (!activeTabId || !scrollContainerRef.current) return;

        // Small delay to ensure the DOM has updated (especially for new tabs)
        const timeoutId = setTimeout(() => {
            const activeElement = scrollContainerRef.current?.querySelector(`[data-tab-id="${activeTabId}"]`);
            if (activeElement) {
                activeElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'nearest'
                });
            }
        }, 50);

        return () => clearTimeout(timeoutId);
    }, [activeTabId]);
    const getTabName = (path: string) => {
        if (!path) return 'This PC';
        if (path === 'shell:RecycleBin') return 'Recycle Bin';
        const parts = path.split('\\').filter(Boolean);
        return parts[parts.length - 1] || path;
    };

    return (
        <div
            className="relative h-10 bg-[var(--bg-deep)] border-b border-white/10 flex items-stretch px-2 gap-1 backdrop-blur-3xl shadow-xl z-20"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            onMouseDown={(e) => {
                if (e.defaultPrevented) return;

                const target = e.target as HTMLElement;
                if (target.closest('.no-drag, button')) return;

                if (e.detail === 2 && e.button === 0) {
                    getCurrentWindow().toggleMaximize();
                } else if (e.button === 0) {
                    getCurrentWindow().startDragging();
                }
            }}
            onContextMenu={(e) => e.preventDefault()}
        >
            {/* Main Tabs Area - Shared scroll container */}
            <div
                ref={scrollContainerRef}
                className="flex-1 flex items-stretch overflow-x-auto overflow-y-hidden no-scrollbar min-w-0"
                style={{
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    WebkitOverflowScrolling: 'touch'
                }}
            >
                <Reorder.Group
                    axis="x"
                    values={tabs}
                    onReorder={onReorder}
                    className="flex items-stretch gap-1"
                >
                    {tabs.map((tab) => (
                        <Reorder.Item
                            key={tab.id}
                            value={tab}
                            data-tab-id={tab.id}
                            drag={tabs.length > 1 ? "x" : false}
                            dragConstraints={scrollContainerRef}
                            dragElastic={0}
                            onPointerDown={(e) => {
                                if (e.button === 1) {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    onTabClose(tab.id);
                                }
                            }}
                            onClick={() => onTabClick(tab.id)}
                            initial={false}
                            whileDrag={{
                                zIndex: 50,
                                y: 0,
                                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4)",
                            }}
                            className={`group relative flex items-center gap-2 h-full px-4 rounded-t-xl cursor-pointer transition-colors max-w-[200px] min-w-[120px] no-drag select-none overflow-hidden
                                ${tab.id === activeTabId
                                    ? 'bg-[var(--bg-surface)] text-white shadow-[0_-4px_20px_rgba(0,0,0,0.4)]'
                                    : 'bg-black/20 text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-300'}`}
                        >
                            {tab.id === activeTabId && (
                                <div className="absolute top-0 left-0 right-0 h-0.5 bg-[var(--accent-primary)] shadow-[0_0_10px_var(--accent-primary)] z-10" />
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
                        </Reorder.Item>
                    ))}
                </Reorder.Group>

                {/* New Tab Button - Immediately follows the tabs */}
                <div className="relative z-10 flex items-center px-1">
                    <button
                        onClick={onNewTab}
                        className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-500 hover:text-zinc-300 transition-colors no-drag"
                        title="New Tab (Ctrl+T)"
                    >
                        <Plus size={16} />
                    </button>
                </div>

                {/* Flexible spacer inside scroll container to catch window-dragging clicks */}
                <div className="flex-1 min-w-[20px]" />
            </div>

            {/* Window Controls - Fixed at the right */}
            <div className="relative z-10 flex items-center h-full pl-2">
                <WindowControls />
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                .no-scrollbar::-webkit-scrollbar {
                    display: none;
                }
            `}} />
        </div>
    );
}
