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
    scrollIndex: 0,
    lastLoadTime: 0,
});

export const useTabs = (initialSortConfig: SortConfig, showHiddenFiles: boolean, quickAccessConfig: QuickAccessConfig) => {
    const [tabs, setTabsState] = useState<Tab[]>(() => {
        const saved = localStorage.getItem('speedexplorer-tabs');
        try {
            if (saved) {
                return JSON.parse(saved).map((t: any) => ({
                    ...t,
                    sortConfig: t.sortConfig || initialSortConfig,
                    generationId: t.generationId || 0,
                    scrollIndex: t.scrollIndex || 0
                }));
            }
        } catch (e) { }
        return [createTab('', initialSortConfig)];
    });

    const [activeTabId, setActiveTabIdState] = useState<string>(() => {
        return localStorage.getItem('speedexplorer-active-tab') || tabs[0]?.id || '';
    });

    const tabsRef = useRef<Tab[]>(tabs);
    const activeTabIdRef = useRef<string>(activeTabId);
    const lastNavigationTimeRef = useRef(0);

    const setTabs = useCallback((update: Tab[] | ((prev: Tab[]) => Tab[])) => {
        setTabsState(prev => {
            const next = typeof update === 'function' ? update(prev) : update;
            tabsRef.current = next;
            return next;
        });
    }, []);

    const setActiveTabId = useCallback((update: string | ((prev: string) => string)) => {
        setActiveTabIdState(prev => {
            const next = typeof update === 'function' ? update(prev) : update;
            activeTabIdRef.current = next;
            return next;
        });
    }, []);

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

    const loadFilesForTab = useCallback(async (tabId: string, path: string, showHidden?: boolean, pathsToSelect?: string[], expectedGenerationId?: number, revertState?: Partial<Tab>, retryDirection?: 'back' | 'forward' | null, jumpOriginPath?: string) => {
        // If expectedGenerationId is provided, we only want to proceed if it matches the current tab's ID.
        // However, we can't easily check the *current* state inside this callback before the async call without refs or functional updates.
        // But the robust check MUST happen AFTER the async call.
        // What we CAN do is pass the ID we expect to be valid when the result returns.

        // If no Expected ID is valid, we assume we are just loading for the current state (e.g. initial load)
        // But for navigations, we MUST pass the new ID.

        const targetTab = tabsRef.current.find(t => t.id === tabId);
        const currentGenId = expectedGenerationId !== undefined ? expectedGenerationId : (targetTab?.generationId ?? 0);

        updateTab(tabId, { loading: true, error: null, lastLoadTime: Date.now() });

        // Safety Timeout: If loading takes more than 15 seconds, force clear it.
        const safetyTimeout = setTimeout(() => {
            setTabs(prev => prev.map(t => {
                if (t.id === tabId && t.loading && t.generationId === currentGenId) {
                    console.warn(`[Navigation] Safety timeout reached for ${path}. Forcing loading to false.`);
                    return { ...t, loading: false };
                }
                return t;
            }));
        }, 15000);

        try {
            const result = await invoke<FileEntry[]>('list_files', { path, showHidden: showHidden ?? showHiddenFiles });
            clearTimeout(safetyTimeout);

            setTabs(prev => {
                const currentTabState = prev.find(t => t.id === tabId);
                if (!currentTabState) return prev;

                // ROBUSTNESS CHECK: If a NEWER request is already active, discard this response.
                if (currentTabState.generationId > currentGenId) {
                    console.log(`[Navigation] Discarding stale success for ${path} (Pending: ${currentTabState.generationId} vs Completed: ${currentGenId})`);
                    return prev;
                }

                // If we are here, we are the current (or most recent) request.
                let selectedFiles: FileEntry[] = [];
                let lastSelectedFile: FileEntry | null = null;

                if (pathsToSelect && pathsToSelect.length > 0) {
                    const normalizedToSelect = pathsToSelect.map(normalizePath);
                    selectedFiles = result.filter(f => normalizedToSelect.includes(normalizePath(f.path)));
                    if (selectedFiles.length > 0) {
                        lastSelectedFile = selectedFiles[selectedFiles.length - 1];
                    }
                } else if (currentTabState.selectedFiles.length > 0) {
                    const currentSelectedPaths = currentTabState.selectedFiles.map(f => normalizePath(f.path));
                    selectedFiles = result.filter(f => currentSelectedPaths.includes(normalizePath(f.path)));
                    if (selectedFiles.length > 0) {
                        const lastPath = currentTabState.lastSelectedFile ? normalizePath(currentTabState.lastSelectedFile.path) : null;
                        lastSelectedFile = selectedFiles.find(f => normalizePath(f.path) === lastPath) || selectedFiles[0];
                    }
                }

                return prev.map(t => t.id === tabId ? {
                    ...t,
                    files: result,
                    path,
                    selectedFiles,
                    lastSelectedFile,
                    loading: false
                } : t);
            });
        } catch (err) {
            clearTimeout(safetyTimeout);
            setTabs(prev => {
                const currentTabState = prev.find(t => t.id === tabId);
                if (!currentTabState || currentTabState.generationId > currentGenId) {
                    return prev;
                }

                if (!retryDirection && revertState) {
                    return prev.map(t => t.id === tabId ? { ...t, ...revertState, error: null, loading: false } : t);
                }

                const direction = retryDirection;

                if (direction === 'back') {
                    let nextIndex = currentTabState.historyIndex - 1;

                    // Skip not only the failed path but also any path identical to where we started.
                    // This handles the [A, B, C, D, C] case where going Back from C over deleted D lands on C again.
                    while (nextIndex >= 0 && normalizePath(currentTabState.history[nextIndex]) === normalizePath(jumpOriginPath || '')) {
                        console.log(`[Nav] Skipping redundant path in history jump: ${currentTabState.history[nextIndex]} at index ${nextIndex}`);
                        nextIndex--;
                    }

                    if (nextIndex >= 0) {
                        const nextPath = currentTabState.history[nextIndex];
                        const nextGenId = currentTabState.generationId + 1;
                        console.log(`[Nav] Jump Back: "${path}" (idx ${currentTabState.historyIndex}) failed → trying "${nextPath}" (idx ${nextIndex})`);
                        setTimeout(() => loadFilesForTab(tabId, nextPath, undefined, undefined, nextGenId, undefined, 'back', jumpOriginPath), 0);
                        return prev.map(t => t.id === tabId ? { ...t, historyIndex: nextIndex, path: nextPath, generationId: nextGenId, error: null } : t);
                    } else {
                        const nextGenId = currentTabState.generationId + 1;
                        setTimeout(() => loadFilesForTab(tabId, '', undefined, undefined, nextGenId, undefined, null), 0);
                        return prev.map(t => t.id === tabId ? { ...t, path: '', generationId: nextGenId, error: null } : t);
                    }
                } else if (direction === 'forward') {
                    let nextIndex = currentTabState.historyIndex + 1;

                    while (nextIndex < currentTabState.history.length && normalizePath(currentTabState.history[nextIndex]) === normalizePath(jumpOriginPath || '')) {
                        console.log(`[Nav] Skipping redundant path in history jump: ${currentTabState.history[nextIndex]} at index ${nextIndex}`);
                        nextIndex++;
                    }

                    if (nextIndex < currentTabState.history.length) {
                        const nextPath = currentTabState.history[nextIndex];
                        const nextGenId = currentTabState.generationId + 1;
                        console.log(`[Nav] Jump Forward: "${path}" (idx ${currentTabState.historyIndex}) failed → trying "${nextPath}" (idx ${nextIndex})`);
                        setTimeout(() => loadFilesForTab(tabId, nextPath, undefined, undefined, nextGenId, undefined, 'forward', jumpOriginPath), 0);
                        return prev.map(t => t.id === tabId ? { ...t, historyIndex: nextIndex, path: nextPath, generationId: nextGenId, error: null } : t);
                    } else {
                        return prev.map(t => t.id === tabId ? { ...t, loading: false, error: null } : t);
                    }
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

    const navigateTo = useCallback((path: string, isManual: boolean = false) => {
        if (!currentTab) return;

        const isSamePath = normalizePath(path) === normalizePath(currentTab.path);
        const nextGenId = currentTab.generationId + 1;
        lastNavigationTimeRef.current = Date.now();

        // If duplicate path, we allow the load (for retry/refresh) but skip history entry
        const updates: Partial<Tab> = {
            searchQuery: '',
            renamingPath: null,
            path: path,
            generationId: nextGenId,
            selectedFiles: [],
            lastSelectedFile: null,
            scrollIndex: 0,
            error: null
        };

        if (!isSamePath) {
            const newHistory = currentTab.history.slice(0, currentTab.historyIndex + 1);
            newHistory.push(path);
            updates.history = newHistory;
            updates.historyIndex = newHistory.length - 1;
        }

        const revertState = isManual ? {
            path: currentTab.path,
            history: currentTab.history,
            historyIndex: currentTab.historyIndex,
            generationId: nextGenId
        } : undefined;

        updateTab(currentTab.id, updates);
        loadFilesForTab(currentTab.id, path, undefined, undefined, nextGenId, revertState);
    }, [currentTab, updateTab, loadFilesForTab]);

    const goBack = useCallback((isRetry: any = false) => {
        const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current);
        if (!tab) return;

        if (tab.historyIndex <= 0) {
            if (isRetry === true) updateTab(tab.id, { loading: false });
            return;
        }

        const newIndex = tab.historyIndex - 1;
        const newPath = tab.history[newIndex];
        const nextGenId = tab.generationId + 1;
        lastNavigationTimeRef.current = Date.now();

        updateTab(tab.id, {
            historyIndex: newIndex,
            searchQuery: '',
            generationId: nextGenId,
            selectedFiles: [],
            lastSelectedFile: null,
            scrollIndex: 0
        });

        loadFilesForTab(tab.id, newPath, undefined, undefined, nextGenId, undefined, 'back', tab.path);
    }, [updateTab, loadFilesForTab]);

    const goForward = useCallback((isRetry: any = false) => {
        const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current);
        if (!tab) return;

        if (tab.historyIndex >= tab.history.length - 1) {
            if (isRetry === true) updateTab(tab.id, { loading: false });
            return;
        }

        const newIndex = tab.historyIndex + 1;
        const newPath = tab.history[newIndex];
        const nextGenId = tab.generationId + 1;
        lastNavigationTimeRef.current = Date.now();

        updateTab(tab.id, {
            historyIndex: newIndex,
            searchQuery: '',
            generationId: nextGenId,
            selectedFiles: [],
            lastSelectedFile: null,
            scrollIndex: 0
        });
        loadFilesForTab(tab.id, newPath, undefined, undefined, nextGenId, undefined, 'forward', tab.path);
    }, [updateTab, loadFilesForTab]);

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
