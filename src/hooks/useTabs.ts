import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Tab, SortConfig, FileEntry, SortColumn, QuickAccessConfig } from '../types';

const normalizePath = (p: string) => {
    if (!p) return '';
    return p.toLowerCase().replace(/[\\/]+$/, '').replace(/\\/g, '/');
};

const createTab = (path: string = '', defaultSort?: SortConfig): Tab => ({
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
    generationId: 0,
});

export const useTabs = (initialSortConfig: SortConfig, showHiddenFiles: boolean, quickAccessConfig: QuickAccessConfig) => {
    const [tabs, setTabs] = useState<Tab[]>(() => {
        const saved = localStorage.getItem('speedexplorer-tabs');
        try {
            if (saved) {
                return JSON.parse(saved).map((t: any) => ({
                    ...t,
                    sortConfig: t.sortConfig || initialSortConfig,
                    generationId: t.generationId || 0
                }));
            }
        } catch (e) { }
        return [createTab('', initialSortConfig)];
    });

    const [activeTabId, setActiveTabId] = useState<string>(() => {
        return localStorage.getItem('speedexplorer-active-tab') || tabs[0]?.id || '';
    });

    const lastNavigationTimeRef = useRef(0);
    const tabsRef = useRef(tabs);
    const activeTabIdRef = useRef(activeTabId);

    // Keep refs in sync with state for event listeners / async callbacks
    useEffect(() => {
        tabsRef.current = tabs;
    }, [tabs]);

    useEffect(() => {
        activeTabIdRef.current = activeTabId;
    }, [activeTabId]);

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

    const loadFilesForTab = useCallback(async (tabId: string, path: string, showHidden?: boolean, pathsToSelect?: string[], expectedGenerationId?: number) => {
        // If expectedGenerationId is provided, we only want to proceed if it matches the current tab's ID.
        // However, we can't easily check the *current* state inside this callback before the async call without refs or functional updates.
        // But the robust check MUST happen AFTER the async call.
        // What we CAN do is pass the ID we expect to be valid when the result returns.

        // If no Expected ID is valid, we assume we are just loading for the current state (e.g. initial load)
        // But for navigations, we MUST pass the new ID.

        const targetTab = tabsRef.current.find(t => t.id === tabId);
        const currentGenId = expectedGenerationId !== undefined ? expectedGenerationId : (targetTab?.generationId ?? 0);

        updateTab(tabId, { loading: true, error: null });

        try {
            const result = await invoke<FileEntry[]>('list_files', { path, showHidden: showHidden ?? showHiddenFiles });

            // ROBUSTNESS CHECK: Capture the LATEST version of the tab to check generationId
            setTabs(prev => {
                const currentTabState = prev.find(t => t.id === tabId);
                // If tab is gone, or generationId has changed (user navigated again), DISCARD result.
                if (!currentTabState || currentTabState.generationId !== currentGenId) {
                    console.log(`[Navigation] Discarding stale response for ${path} (Gen: ${currentGenId} vs Current: ${currentTabState?.generationId})`);
                    return prev;
                }

                // If we are here, the result is valid for the current UI state.
                let selectedFiles: FileEntry[] = [];
                let lastSelectedFile: FileEntry | null = null;

                if (pathsToSelect && pathsToSelect.length > 0) {
                    const normalizedToSelect = pathsToSelect.map(normalizePath);
                    selectedFiles = result.filter(f => normalizedToSelect.includes(normalizePath(f.path)));
                    if (selectedFiles.length > 0) {
                        lastSelectedFile = selectedFiles[selectedFiles.length - 1];
                    }
                } else {
                    if (currentTabState.selectedFiles.length > 0) {
                        const currentSelectedPaths = currentTabState.selectedFiles.map(f => normalizePath(f.path));
                        selectedFiles = result.filter(f => currentSelectedPaths.includes(normalizePath(f.path)));
                        if (selectedFiles.length > 0) {
                            const lastPath = currentTabState.lastSelectedFile ? normalizePath(currentTabState.lastSelectedFile.path) : null;
                            lastSelectedFile = selectedFiles.find(f => normalizePath(f.path) === lastPath) || selectedFiles[0];
                        }
                    }
                }

                return prev.map(t => t.id === tabId ? {
                    ...t,
                    files: result,
                    path, // Enforce path sync with data
                    selectedFiles,
                    lastSelectedFile,
                    loading: false
                } : t);
            });

        } catch (err) {
            setTabs(prev => {
                const currentTabState = prev.find(t => t.id === tabId);
                if (!currentTabState || currentTabState.generationId !== currentGenId) {
                    return prev;
                }
                return prev.map(t => t.id === tabId ? { ...t, error: String(err), loading: false } : t);
            });
        }
    }, [updateTab, showHiddenFiles]);

    const refreshTabsViewing = useCallback((paths: string | string[]) => {
        const pathList = (Array.isArray(paths) ? paths : [paths]).map(normalizePath);
        tabsRef.current.forEach(tab => {
            if (pathList.includes(normalizePath(tab.path))) {
                loadFilesForTab(tab.id, tab.path);
            }
        });
    }, [loadFilesForTab]);

    const navigateTo = useCallback((path: string) => {
        if (!currentTab) return;

        // OPTIMISTIC UPDATE: Update UI path and history immediately.
        // INCREMENT GENERATION: Invalidate any pending old requests.
        const nextGenId = currentTab.generationId + 1;
        lastNavigationTimeRef.current = Date.now();

        const newHistory = currentTab.history.slice(0, currentTab.historyIndex + 1);
        newHistory.push(path);

        updateTab(currentTab.id, {
            history: newHistory,
            historyIndex: newHistory.length - 1,
            searchQuery: '',
            renamingPath: null,
            path: path, // Optimistic update
            generationId: nextGenId,
            selectedFiles: [], // Clear selection immediately on nav
            lastSelectedFile: null
        });

        loadFilesForTab(currentTab.id, path, undefined, undefined, nextGenId);
    }, [currentTab, updateTab, loadFilesForTab]);

    const goBack = useCallback(() => {
        if (!currentTab || currentTab.historyIndex <= 0) return;

        const newIndex = currentTab.historyIndex - 1;
        const newPath = currentTab.history[newIndex];
        const nextGenId = currentTab.generationId + 1;
        lastNavigationTimeRef.current = Date.now();

        updateTab(currentTab.id, {
            historyIndex: newIndex,
            searchQuery: '',
            path: newPath, // Optimistic
            generationId: nextGenId,
            selectedFiles: [],
            lastSelectedFile: null
        });

        loadFilesForTab(currentTab.id, newPath, undefined, undefined, nextGenId);
    }, [currentTab, updateTab, loadFilesForTab]);

    const goForward = useCallback(() => {
        if (!currentTab || currentTab.historyIndex >= currentTab.history.length - 1) return;

        const newIndex = currentTab.historyIndex + 1;
        const newPath = currentTab.history[newIndex];
        const nextGenId = currentTab.generationId + 1;
        lastNavigationTimeRef.current = Date.now();

        updateTab(currentTab.id, {
            historyIndex: newIndex,
            searchQuery: '',
            path: newPath,
            generationId: nextGenId,
            selectedFiles: [],
            lastSelectedFile: null
        });
        loadFilesForTab(currentTab.id, newPath, undefined, undefined, nextGenId);
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

    const refreshCurrentTab = useCallback((isAutoRefresh: boolean = false) => {
        // Use refs to get the ABSOLUTE LATEST state, bypassing any stale closures
        const currentTabs = tabsRef.current;
        const currentActiveId = activeTabIdRef.current;
        const targetTab = currentTabs.find(t => t.id === currentActiveId);

        if (targetTab) {
            // FILTER: If this is an auto-refresh (focus/resize) AND we navigated very recently,
            // ignore it to prevent race conditions or "stickiness" to old states.
            if (isAutoRefresh) {
                const timeSinceNav = Date.now() - lastNavigationTimeRef.current;
                if (timeSinceNav < 2000) {
                    console.log(`[Refresh] Auto-refresh ignored (Cooldown active: ${timeSinceNav}ms < 2000ms)`);
                    return;
                }
            }

            // Even for refresh, we bump the generation ID to "cancel" any previous pending loads
            // and ensure this refresh is the authoritative source of truth.
            const nextGenId = targetTab.generationId + 1;
            updateTab(targetTab.id, { generationId: nextGenId });
            loadFilesForTab(targetTab.id, targetTab.path, undefined, undefined, nextGenId);
        }
    }, [loadFilesForTab, updateTab]);

    const addTab = useCallback((path: string = '', shouldFocus: boolean = true) => {
        const newTab = createTab(path, initialSortConfig);
        setTabs(prev => [...prev, newTab]);
        if (shouldFocus) {
            setActiveTabId(newTab.id);
        }
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

    const reorderTabs = useCallback((newTabs: Tab[]) => {
        setTabs(newTabs);
    }, []);

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
            lastSelectedFile: null,
            renamingPath: null
        });
    }, [currentTab, updateTab]);

    // Restore content for all opened tabs on startup
    useEffect(() => {
        tabs.forEach(tab => {
            loadFilesForTab(tab.id, tab.path);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
        handleClearSelection,
        reorderTabs
    };
};
