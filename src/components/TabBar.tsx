import { useRef, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import WindowControls from './WindowControls';
import { Reorder, motion } from 'framer-motion';
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
            className="relative h-10 bg-[var(--bg-deep)] border-b border-white/10 backdrop-blur-3xl shadow-xl z-20"
            style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto auto auto',
                gap: '4px',
                paddingLeft: '8px',
                paddingRight: '8px',
            }}
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
            {/* 1. Tabs Area - scroll container */}
            <div
                ref={scrollContainerRef}
                className="flex items-stretch no-scrollbar"
                style={{
                    overflow: 'hidden',
                    overflowX: 'auto',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    minWidth: 0,
                }}
            >
                <div
                    className="flex items-stretch"
                    style={{ display: 'flex', flexWrap: 'nowrap', gap: '4px' }}
                >
                    {tabs.map((tab) => (
                        <div
                            key={tab.id}
                            data-tab-id={tab.id}
                            onClick={() => onTabClick(tab.id)}
                            onMouseDown={(e) => {
                                if (e.button === 1) {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    onTabClose(tab.id);
                                }
                            }}
                            style={{
                                width: '130px',
                                flexShrink: 0,
                                flexGrow: 0,
                                boxSizing: 'border-box',
                                position: 'relative'
                            }}
                            className={`group flex items-center gap-1 h-full px-2 rounded-t-xl cursor-pointer transition-colors no-drag select-none
                                ${tab.id === activeTabId
                                    ? 'bg-[var(--bg-surface)] text-white shadow-[0_-4px_20px_rgba(0,0,0,0.4)]'
                                    : 'bg-black/20 text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-300'}`}
                        >
                            {tab.id === activeTabId && (
                                <div
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        right: 0,
                                        height: '2px',
                                        backgroundColor: 'var(--accent-primary)',
                                        boxShadow: '0 0 10px var(--accent-primary)',
                                    }}
                                />
                            )}
                            <span
                                className={`text-[11px] uppercase tracking-wider ${tab.id === activeTabId ? 'font-black' : 'font-bold'}`}
                                style={{
                                    flex: '1 1 0%',
                                    minWidth: 0,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                }}
                            >
                                {getTabName(tab.path)}
                            </span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onTabClose(tab.id);
                                }}
                                className={`p-0.5 rounded hover:bg-white/10 transition-opacity flex-shrink-0
                                    ${tab.id === activeTabId ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'}`}
                            >
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* 2. New Tab Button - own reserved space */}
            <div className="flex items-center">
                <button
                    onClick={onNewTab}
                    className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-500 hover:text-zinc-300 transition-colors no-drag"
                    title="New Tab (Ctrl+T)"
                >
                    <Plus size={16} />
                </button>
            </div>

            {/* 3. Drag spacer - expands to fill remaining space */}
            <div className="min-w-[20px]" style={{ flex: '1 1 auto' }} />

            {/* 4. Window Controls - fixed size */}
            <div className="flex items-center">
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
