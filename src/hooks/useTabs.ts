import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Tab, SortConfig, FileEntry, SortColumn, QuickAccessConfig } from '../types';

const normalizePath = (p: string) => {
    if (!p) return '';
    return p.toLowerCase().replace(/[\\/]+$/, '').replace(/\\/g, '/');
};

const createTab = (path: string = 'C:\\', defaultSort?: SortConfig): Tab => ({
    id: crypto.randomUUID(),
    path,
    history: [path],
    historyIndex: 0,
    files: [],
    selectedFiles: [],
    lastSelectedFile: null,
    searchQuery: '',
    loading: false,
    error: null,
    viewMode: 'list',
    sortConfig: defaultSort || { column: 'name', direction: 'asc' },
    renamingPath: null,
});

export const useTabs = (initialSortConfig: SortConfig, showHiddenFiles: boolean, quickAccessConfig: QuickAccessConfig) => {
    const [tabs, setTabs] = useState<Tab[]>(() => {
        const saved = localStorage.getItem('speedexplorer-tabs');
        try {
            if (saved) {
                return JSON.parse(saved).map((t: any) => ({
                    ...t,
                    sortConfig: t.sortConfig || initialSortConfig
                }));
            }
        } catch (e) { }
        return [createTab('C:\\', initialSortConfig)];
    });

    const [activeTabId, setActiveTabId] = useState<string>(() => {
        return localStorage.getItem('speedexplorer-active-tab') || tabs[0]?.id || '';
    });

    // Persistence
    useEffect(() => {
        localStorage.setItem('speedexplorer-tabs', JSON.stringify(tabs.map(t => ({
            ...t,
            files: [], // Don't persist large file lists
            selectedFiles: [],
            lastSelectedFile: null,
            loading: false,
            error: null
        }))));
    }, [tabs]);

    useEffect(() => {
        localStorage.setItem('speedexplorer-active-tab', activeTabId);
    }, [activeTabId]);

    const currentTab = tabs.find(t => t.id === activeTabId) || tabs[0];

    const updateTab = useCallback((tabId: string, updates: Partial<Tab>) => {
        setTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...updates } : t));
    }, []);

    const loadFilesForTab = useCallback(async (tabId: string, path: string, showHidden?: boolean) => {
        updateTab(tabId, { loading: true, error: null });
        try {
            const result = await invoke<FileEntry[]>('list_files', { path, showHidden: showHidden ?? showHiddenFiles });
            updateTab(tabId, { files: result, path, selectedFiles: [], lastSelectedFile: null, loading: false });
        } catch (err) {
            updateTab(tabId, { error: String(err), loading: false });
        }
    }, [updateTab, showHiddenFiles]);

    const refreshTabsViewing = useCallback((paths: string | string[]) => {
        const pathList = (Array.isArray(paths) ? paths : [paths]).map(normalizePath);
        tabs.forEach(tab => {
            if (pathList.includes(normalizePath(tab.path))) {
                loadFilesForTab(tab.id, tab.path);
            }
        });
    }, [tabs, loadFilesForTab]);

    const navigateTo = useCallback((path: string) => {
        if (!currentTab) return;
        const newHistory = currentTab.history.slice(0, currentTab.historyIndex + 1);
        newHistory.push(path);
        updateTab(currentTab.id, {
            history: newHistory,
            historyIndex: newHistory.length - 1,
            searchQuery: '',
        });
        loadFilesForTab(currentTab.id, path);
    }, [currentTab, updateTab, loadFilesForTab]);

    const goBack = useCallback(() => {
        if (!currentTab || currentTab.historyIndex <= 0) return;
        const newIndex = currentTab.historyIndex - 1;
        updateTab(currentTab.id, { historyIndex: newIndex, searchQuery: '' });
        loadFilesForTab(currentTab.id, currentTab.history[newIndex]);
    }, [currentTab, updateTab, loadFilesForTab]);

    const goForward = useCallback(() => {
        if (!currentTab || currentTab.historyIndex >= currentTab.history.length - 1) return;
        const newIndex = currentTab.historyIndex + 1;
        updateTab(currentTab.id, { historyIndex: newIndex, searchQuery: '' });
        loadFilesForTab(currentTab.id, currentTab.history[newIndex]);
    }, [currentTab, updateTab, loadFilesForTab]);

    const goUp = useCallback(() => {
        if (!currentTab) return;
        const parts = currentTab.path.split('\\').filter(Boolean);
        if (parts.length > 0) {
            parts.pop();
            const parent = parts.join('\\');
            if (parent === '') {
                if (currentTab.path.length <= 3) {
                    navigateTo('');
                } else {
                    navigateTo('');
                }
            } else {
                const pathWithSlash = parent.endsWith(':') ? (parent + '\\') : parent;
                navigateTo(pathWithSlash);
            }
        } else if (currentTab.path === '') {
            const desktopPath = quickAccessConfig.pinnedFolders.find((f: any) => f.id === 'desktop')?.path;
            if (desktopPath) navigateTo(desktopPath);
        }
    }, [currentTab, navigateTo, quickAccessConfig]);

    const refreshCurrentTab = useCallback(() => {
        if (currentTab) loadFilesForTab(currentTab.id, currentTab.path);
    }, [currentTab, loadFilesForTab]);

    const addTab = useCallback((path: string = 'C:\\') => {
        const newTab = createTab(path, initialSortConfig);
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(newTab.id);
        loadFilesForTab(newTab.id, path);
    }, [loadFilesForTab, initialSortConfig]);

    const closeTab = useCallback(async (tabId: string) => {
        if (tabs.length <= 1) {
            try {
                const { exit } = await import('@tauri-apps/plugin-process');
                await exit(0);
            } catch (err) {
                console.error('Failed to exit app:', err);
            }
            return;
        }
        setTabs(prev => {
            const newTabs = prev.filter(t => t.id !== tabId);
            if (activeTabId === tabId) {
                const closedIndex = prev.findIndex(t => t.id === tabId);
                const newActiveIndex = Math.max(0, Math.min(closedIndex, newTabs.length - 1));
                setActiveTabId(newTabs[newActiveIndex].id);
            }
            return newTabs;
        });
    }, [activeTabId, tabs.length]);

    const switchTab = useCallback((tabId: string) => {
        setActiveTabId(tabId);
    }, []);

    const handleSort = useCallback((column: SortColumn) => {
        if (!currentTab) return;
        const newDirection = (currentTab.sortConfig.column === column && currentTab.sortConfig.direction === 'asc') ? 'desc' : 'asc';
        const newSortConfig: SortConfig = { column, direction: newDirection };
        updateTab(currentTab.id, { sortConfig: newSortConfig });
        return newSortConfig;
    }, [currentTab, updateTab]);

    const handleSelectAll = useCallback((sortedFiles: FileEntry[]) => {
        if (!currentTab || sortedFiles.length === 0) return;
        updateTab(currentTab.id, {
            selectedFiles: sortedFiles,
            lastSelectedFile: sortedFiles[0]
        });
    }, [currentTab, updateTab]);

    const handleClearSelection = useCallback(() => {
        if (!currentTab) return;
        updateTab(currentTab.id, {
            selectedFiles: [],
            lastSelectedFile: null
        });
    }, [currentTab, updateTab]);

    return {
        tabs,
        activeTabId,
        currentTab,
        addTab,
        closeTab,
        switchTab,
        updateTab,
        loadFilesForTab,
        navigateTo,
        goBack,
        goForward,
        goUp,
        refreshCurrentTab,
        refreshTabsViewing,
        handleSort,
        handleSelectAll,
        handleClearSelection
    };
};
