import { useState, useEffect, useCallback, useMemo, Fragment, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ThisPCView from './components/ThisPCView';
import { ask } from '@tauri-apps/plugin-dialog';
import {
  Search,
  RotateCw,
  ArrowUp,
  ArrowRight,
  ArrowLeft,
  List,
  Grid,
  Copy,
  Settings as SettingsIcon,
  Trash,
  Paintbrush,
  CheckSquare,
  Clipboard as PasteIcon,
  Image as ImageIcon,
  File as FileIcon,
  Files as FilesIcon,
  Scissors,
  Terminal
} from 'lucide-react';

const DEFAULT_COLUMNS: SortColumn[] = ['name', 'modified_at', 'created_at', 'file_type', 'size'];



import Sidebar from './components/Sidebar';
import FileTable from './components/FileTable';
import FileGrid from './components/FileGrid';
import InfoPanel from './components/InfoPanel';
import ContextMenu from './components/ContextMenu';
import SettingsPanel from './components/SettingsPanel';
import TabBar from './components/TabBar';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import './App.css';

import { useTabs } from './hooks/useTabs';
import { Tab, SortConfig, SortColumn, FileEntry, QuickAccessConfig, ClipboardInfo, RecycleBinStatus } from './types';
import SplashScreen from './components/SplashScreen';
import { getCurrentWindow } from '@tauri-apps/api/window';

export default function App() {
  const [isLoadingApp, setIsLoadingApp] = useState(true);
  const finishLoading = useCallback(() => setIsLoadingApp(false), []);

  /* 
     Settings State & Quick Access Config 
     (Managed locally in App because settings affect global behavior beyond tabs)
  */
  const [showSettings, setShowSettings] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<SortColumn[]>(() => {
    const saved = localStorage.getItem('speedexplorer-columns');
    return saved ? JSON.parse(saved) : DEFAULT_COLUMNS;
  });
  const [quickAccessConfig, setQuickAccessConfig] = useState<QuickAccessConfig>(() => {
    try {
      const saved = localStorage.getItem('speedexplorer-config');
      const basePinned = [
        { id: 'desktop', name: 'Desktop', path: '', enabled: true },
        { id: 'home', name: 'Home', path: '', enabled: true },
        { id: 'downloads', name: 'Downloads', path: '', enabled: true },
        { id: 'documents', name: 'Documents', path: '', enabled: true },
        { id: 'pictures', name: 'Pictures', path: '', enabled: true },
        { id: 'recycle-bin', name: 'Recycle Bin', path: 'shell:RecycleBin', enabled: true }
      ];

      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.pinnedFolders)) {
          const existingIds = new Set(parsed.pinnedFolders.map((f: any) => f.id));
          const toAdd = basePinned.filter(b => !existingIds.has(b.id));
          const merged = parsed.pinnedFolders.map((f: any) => {
            const isSystem = basePinned.some(b => b.id === f.id);
            if (isSystem && f.enabled === undefined) return { ...f, enabled: true };
            return f;
          });
          toAdd.forEach(item => merged.push(item));
          return { pinnedFolders: merged };
        }
      }
      return { pinnedFolders: basePinned };
    } catch (e) {
      console.error("Failed to parse quickAccessConfig", e);
    }
    return {
      pinnedFolders: [
        { id: 'desktop', name: 'Desktop', path: '', enabled: true },
        { id: 'home', name: 'Home', path: '', enabled: true },
        { id: 'downloads', name: 'Downloads', path: '', enabled: true },
        { id: 'documents', name: 'Documents', path: '', enabled: true },
        { id: 'pictures', name: 'Pictures', path: '', enabled: true },
        { id: 'recycle-bin', name: 'Recycle Bin', path: 'shell:RecycleBin', enabled: true }
      ]
    };
  });

  const [defaultSortConfig, setDefaultSortConfig] = useState<SortConfig>(() => {
    try {
      const saved = localStorage.getItem('speedexplorer-sort');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && parsed.column && parsed.direction) {
          return parsed;
        }
      }
    } catch (e) { }
    return { column: 'name', direction: 'asc' };
  });

  const [showHiddenFiles, setShowHiddenFiles] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('speedexplorer-hidden');
      if (saved) return JSON.parse(saved);
    } catch (e) { }
    return false;
  });

  const [autoSearchOnKey, setAutoSearchOnKey] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('speedexplorer-autosearch');
      if (saved) return JSON.parse(saved);
    } catch (e) { }
    return true; // Enabled by default as requested/standard
  });

  const [focusNewTabOnMiddleClick, setFocusNewTabOnMiddleClick] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('speedexplorer-focus-new-tab');
      if (saved) return JSON.parse(saved);
    } catch (e) { }
    return false; // Default to opening in background
  });

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Use the new hook
  const {
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
    handleSort: hookHandleSort,
    handleSelectAll: hookHandleSelectAll,
    handleClearSelection: hookHandleClearSelection,
    reorderTabs
  } = useTabs(defaultSortConfig, showHiddenFiles, quickAccessConfig);

  const [columnWidths, setColumnWidths] = useState<Partial<Record<SortColumn, number>>>(() => {
    try {
      const saved = localStorage.getItem('speedexplorer-column-widths');
      if (saved) return JSON.parse(saved);
    } catch (e) { }
    return {};
  });

  const handleColumnsResize = useCallback((updates: Partial<Record<SortColumn, number>>) => {
    setColumnWidths(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem('speedexplorer-column-widths', JSON.stringify(next));
      return next;
    });
  }, []);






  const [theme, setTheme] = useState<string>(() => {
    return localStorage.getItem('speedexplorer-theme') || 'neon';
  });

  const fetchSystemPaths = useCallback(async (isReset = false) => {
    try {
      const paths = await invoke<Record<string, string>>('get_system_default_paths');

      setQuickAccessConfig(prev => {
        const merged = prev.pinnedFolders.map(folder => {
          if (isReset || folder.path === '') {
            const systemPath = paths[folder.id];
            if (systemPath) {
              return { ...folder, path: systemPath };
            }
          }
          return folder;
        });

        const newConfig = { pinnedFolders: merged };
        if (isReset) {
          localStorage.setItem('speedexplorer-config', JSON.stringify(newConfig));
        }
        return newConfig;
      });
    } catch (err) {
      console.error("Failed to fetch system paths:", err);
    }
  }, []);

  useEffect(() => {
    fetchSystemPaths();
    // Show window after a short delay to ensure black background is rendered
    // or just show immediately if we trust the blackout
    // Show window after a short delay to ensure black background is rendered
    // or just show immediately if we trust the blackout
    const showWindow = async () => {
      const win = getCurrentWindow();
      await win.maximize();
      await win.show();
      await win.setFocus();
    };
    showWindow();
  }, [fetchSystemPaths]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('speedexplorer-theme', theme);
  }, [theme]);

  // Global Ctrl+Tab handler - works even when inputs are focused
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const currentIndex = tabs.findIndex(t => t.id === activeTabId);
        if (currentIndex !== -1) {
          const nextIndex = e.shiftKey
            ? (currentIndex - 1 + tabs.length) % tabs.length
            : (currentIndex + 1) % tabs.length;
          switchTab(tabs[nextIndex].id);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [tabs, activeTabId, switchTab]);

  const cycleTheme = () => {
    const themes = ['neon', 'emerald', 'sunset', 'cyber'];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  const [recycleBinStatus, setRecycleBinStatus] = useState<RecycleBinStatus>({
    is_empty: true,
    item_count: 0,
    total_size: 0
  });

  const fetchRecycleBinStatus = useCallback(async () => {
    try {
      const status = await invoke<RecycleBinStatus>('get_recycle_bin_status');
      setRecycleBinStatus(status);
    } catch (err) {
      console.error("Failed to fetch recycle bin status:", err);
    }
  }, []);

  useEffect(() => {
    let focusTimeout: number | undefined;

    const triggerRefresh = () => {
      if (focusTimeout) window.clearTimeout(focusTimeout);
      focusTimeout = window.setTimeout(() => {
        fetchRecycleBinStatus();
        refreshCurrentTab();
      }, 1000);
    };

    const handleFocus = () => {
      // Debounce focus refresh to avoid blocking UI/drag events immediately on click
      triggerRefresh();
    };

    fetchRecycleBinStatus();
    window.addEventListener('focus', handleFocus);

    // Also postpone refresh if the window is currently moving or resizing
    const win = getCurrentWindow();
    const unlistenMoved = win.onMoved(() => triggerRefresh());
    const unlistenResized = win.onResized(() => triggerRefresh());

    return () => {
      window.removeEventListener('focus', handleFocus);
      if (focusTimeout) window.clearTimeout(focusTimeout);
      unlistenMoved.then((fn: () => void) => fn());
      unlistenResized.then((fn: () => void) => fn());
    };
  }, [fetchRecycleBinStatus, refreshCurrentTab]);

  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, file: FileEntry | null, fromSidebar?: boolean } | null>(null);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [canPaste, setCanPaste] = useState(false);
  const [clipboardInfo, setClipboardInfo] = useState<ClipboardInfo | null>(null);
  const [clipboardPopup, setClipboardPopup] = useState<{ x: number, y: number } | null>(null);
  const [lastCutPaths, setLastCutPaths] = useState<string[]>([]);

  // Window Size Tracker for Responsive Panels
  const [windowWidth, setWindowWidth] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1200);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);


  // Panel Resizing State (Ratios)
  const [infoPanelRatio, setInfoPanelRatio] = useState(() => {
    const saved = localStorage.getItem('speedexplorer-info-ratio');
    if (saved) return parseFloat(saved);

    // Migration: if no ratio but pixels exist
    const savedPixels = localStorage.getItem('speedexplorer-info-width');
    if (savedPixels) return parseInt(savedPixels, 10) / (typeof window !== 'undefined' ? window.innerWidth : 1200);

    return 300 / 1200; // Default 25%
  });

  // Sidebar is now fixed at 220px
  const sidebarWidth = 220;
  // Derived Pixel Widths (with strict minimums)
  const infoPanelWidth = Math.max(windowWidth * infoPanelRatio, 350);

  const [searchBarWidth, setSearchBarWidth] = useState(256);
  const [isResizing, setIsResizing] = useState<'info' | 'search' | null>(null);

  // Removed automatic clamping effect to prevent panel size reset on window resize or maximize.

  // Persistence for ratios
  useEffect(() => {
    if (!isResizing) {
      localStorage.setItem('speedexplorer-info-ratio', String(infoPanelRatio));
    }
  }, [isResizing, infoPanelRatio]);

  const checkClipboard = useCallback(async () => {
    try {
      const info = await invoke<ClipboardInfo>('get_clipboard_info');
      setClipboardInfo(info);
      setCanPaste(info.has_files || info.has_image);
    } catch (err) {
      setClipboardInfo(null);
      setCanPaste(false);
    }
  }, []);

  const handlePasteContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canPaste) return;
    setClipboardPopup({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    const handleClickOutside = () => setClipboardPopup(null);
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('contextmenu', handleClickOutside);
    return () => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('contextmenu', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    checkClipboard();
    // Re-check when window regains focus to catch external copies
    window.addEventListener('focus', checkClipboard);

    // Poll every 1s to catch background changes (like screenshots)
    // The backend uses a sequence number cache so this is very cheap
    const interval = setInterval(checkClipboard, 1000);

    return () => {
      window.removeEventListener('focus', checkClipboard);
      clearInterval(interval);
    };
  }, [checkClipboard]);

  // Load initial files - delegated to hook (init in hook state or effect if needed, but here we can just ensure at least one load)
  useEffect(() => {
    if (tabs.length > 0 && tabs[0].files.length === 0) {
      loadFilesForTab(tabs[0].id, tabs[0].path);
    }
  }, []);

  // Memoize filtered and sorted files
  const sortedFiles = useMemo(() => {
    if (!currentTab) return [];

    const parseDate = (dateStr: string): number => {
      if (!dateStr) return 0;
      // Format: "dd/mm/yyyy HH:MM"
      const [datePart, timePart] = dateStr.split(' ');
      const [day, month, year] = datePart.split('/').map(Number);
      const [hours, minutes] = (timePart || '00:00').split(':').map(Number);
      return new Date(year, month - 1, day, hours, minutes).getTime();
    };

    const filtered = currentTab.files.filter(f =>
      f.name.toLowerCase().includes((currentTab.searchQuery || '').toLowerCase())
    );

    return [...filtered].sort((a, b) => {
      // Folders always first
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;

      const { column, direction } = currentTab.sortConfig || defaultSortConfig;
      let comparison = 0;

      if (column === 'size') {
        comparison = a.size - b.size;
      } else if (column === 'created_at' || column === 'modified_at') {
        comparison = parseDate(a[column]) - parseDate(b[column]);
      } else {
        comparison = String(a[column]).localeCompare(String(b[column]));
      }

      return direction === 'asc' ? comparison : -comparison;
    });
  }, [currentTab?.files, currentTab?.searchQuery, currentTab?.sortConfig, defaultSortConfig]);

  /* Wrapper for Sort to also update global default locally */
  const handleSort = useCallback((column: SortColumn) => {
    const newSortConfig = hookHandleSort(column);
    if (newSortConfig) {
      setDefaultSortConfig(newSortConfig);
      localStorage.setItem('speedexplorer-sort', JSON.stringify(newSortConfig));
    }
  }, [hookHandleSort]);

  // Keyboard shortcuts for tabs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputFocused = document.activeElement?.tagName === 'INPUT';

      // ===== GLOBAL SHORTCUTS (work even when input is focused) =====

      // Ctrl+T for new tab
      if (e.ctrlKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        addTab();
        return;
      }

      // Ctrl+W to close tab
      if (e.ctrlKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        closeTab(activeTabId);
        return;
      }

      // F5 for internal refresh
      if (e.key === 'F5') {
        e.preventDefault();
        refreshCurrentTab();
        return;
      }

      // Ctrl + L for address bar
      if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        startEditingPath();
        return;
      }

      // Escape key handling (global)
      if (e.key === 'Escape') {
        let handled = false;
        if (currentTab?.searchQuery) {
          updateTab(currentTab.id, { searchQuery: '' });
          handled = true;
        }
        if (currentTab?.selectedFiles && currentTab.selectedFiles.length > 0) {
          handleClearSelection();
          handled = true;
        }
        if (handled) {
          e.preventDefault();
        }
        return;
      }

      // ===== INPUT-SENSITIVE SHORTCUTS (skip when typing in input) =====
      if (isInputFocused) return;

      // Delete key for selected files
      if (e.key === 'Delete' && currentTab?.selectedFiles.length > 0) {
        handleDelete(currentTab.selectedFiles, e.shiftKey);
      }

      // Clipboard shortcuts
      if (e.ctrlKey && e.key.toLowerCase() === 'c' && currentTab?.selectedFiles.length > 0) {
        e.preventDefault();
        handleCopy(currentTab.selectedFiles);
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'x' && currentTab?.selectedFiles.length > 0) {
        e.preventDefault();
        handleCut(currentTab.selectedFiles);
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePaste();
      }

      // Ctrl+A for Select All
      if (e.ctrlKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleSelectAll();
      }

      // Enter key for selection or single search result
      if (e.key === 'Enter') {
        const singleResult = currentTab?.searchQuery && sortedFiles.length === 1 ? sortedFiles[0] : null;
        const selectedFile = currentTab?.selectedFiles.length === 1 ? currentTab.selectedFiles[0] : null;
        const file = singleResult || selectedFile;

        if (file) {
          e.preventDefault();
          if (e.shiftKey) {
            if (file.is_dir) addTab(file.path);
          } else {
            if (file.is_dir) navigateTo(file.path);
            else invoke('open_file', { path: file.path });
          }
        }
      }

      // F2 for rename
      if (e.key === 'F2' && currentTab?.selectedFiles.length === 1) {
        e.preventDefault();
        handleRename(currentTab.selectedFiles[0]);
      }

      // Auto-search on key
      if (autoSearchOnKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
        if (currentTab) {
          searchInputRef.current?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addTab, closeTab, tabs.length, activeTabId, currentTab, refreshCurrentTab, autoSearchOnKey, sortedFiles, navigateTo]);

  const handleContextMenu = (e: React.MouseEvent, file: FileEntry | null) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, file, fromSidebar: false });

    // If we right-click a file that is NOT already selected, we want to select ONLY it.
    // If it IS already part of multiple selected files, we keep the selection.
    if (file && currentTab) {
      const isAlreadySelected = currentTab.selectedFiles.some(f => f.path === file.path);
      if (!isAlreadySelected) {
        updateTab(currentTab.id, {
          selectedFiles: [file],
          lastSelectedFile: file
        });
      }
    }
  };

  const handleRename = useCallback((file: FileEntry) => {
    if (currentTab) {
      updateTab(currentTab.id, { renamingPath: file.path });
    }
  }, [currentTab, updateTab]);

  const handleRenameCancel = useCallback(() => {
    if (currentTab) {
      updateTab(currentTab.id, { renamingPath: null });
    }
  }, [currentTab, updateTab]);

  const handleRenameSubmit = useCallback(async (file: FileEntry, newName: string) => {
    if (!currentTab || !newName || newName === file.name) {
      handleRenameCancel();
      return;
    }

    try {
      await invoke('rename_item', { oldPath: file.path, newName });
      updateTab(currentTab.id, { renamingPath: null });
      const lastSlash = file.path.lastIndexOf('\\');
      if (lastSlash === -1) {
        refreshTabsViewing(file.path);
      } else {
        let parent = file.path.substring(0, lastSlash);
        if (parent.endsWith(':')) parent += '\\';
        refreshTabsViewing(parent);
      }
    } catch (err) {
      updateTab(currentTab.id, { error: String(err), renamingPath: null });
    }
  }, [currentTab, updateTab, handleRenameCancel, refreshTabsViewing]);

  const handleSidebarContextMenu = (e: React.MouseEvent, path: string, name: string) => {
    e.preventDefault();
    const mockFile: FileEntry = {
      name,
      path,
      is_dir: true,
      size: 0,
      formatted_size: '',
      file_type: 'Folder',
      created_at: '',
      modified_at: '',
      is_shortcut: false,
      disk_info: null,
      modified_timestamp: 0,
      dimensions: undefined
    };
    setContextMenu({ x: e.clientX, y: e.clientY, file: mockFile, fromSidebar: true });

    if (currentTab) {
      updateTab(currentTab.id, {
        selectedFiles: [mockFile],
        lastSelectedFile: mockFile
      });
    }
  };

  const saveConfig = (newConfig: QuickAccessConfig, newSortConfig?: SortConfig, newShowHidden?: boolean, newAutoSearch?: boolean, newFocusNewTab?: boolean) => {
    setQuickAccessConfig(newConfig);
    localStorage.setItem('speedexplorer-config', JSON.stringify(newConfig));
    if (newSortConfig) {
      setDefaultSortConfig(newSortConfig);
      localStorage.setItem('speedexplorer-sort', JSON.stringify(newSortConfig));
    }
    if (newShowHidden !== undefined) {
      setShowHiddenFiles(newShowHidden);
      localStorage.setItem('speedexplorer-hidden', JSON.stringify(newShowHidden));
      // Refresh all tabs with new hidden setting
      tabs.forEach(tab => loadFilesForTab(tab.id, tab.path, newShowHidden));
    }
    if (newAutoSearch !== undefined) {
      setAutoSearchOnKey(newAutoSearch);
      localStorage.setItem('speedexplorer-autosearch', JSON.stringify(newAutoSearch));
    }
    if (newFocusNewTab !== undefined) {
      setFocusNewTabOnMiddleClick(newFocusNewTab);
      localStorage.setItem('speedexplorer-focus-new-tab', JSON.stringify(newFocusNewTab));
    }
    setShowSettings(false);
  };

  const handleResetSettings = async () => {
    const confirmed = await ask('¿Estás seguro de que deseas restaurar todos los ajustes a sus valores por defecto? Esta acción borrará todas tus personalizaciones.', {
      title: 'SpeedExplorer',
      kind: 'warning',
    });

    if (confirmed) {
      localStorage.removeItem('speedexplorer-config');
      localStorage.removeItem('speedexplorer-sort');
      localStorage.removeItem('speedexplorer-hidden');
      localStorage.removeItem('speedexplorer-autosearch');
      localStorage.removeItem('speedexplorer-theme');
      localStorage.removeItem('speedexplorer-focus-new-tab');

      setDefaultSortConfig({ column: 'name', direction: 'asc' });
      setShowHiddenFiles(false);
      setAutoSearchOnKey(true);
      setFocusNewTabOnMiddleClick(false);
      setTheme('neon');
      await fetchSystemPaths(true);
      setShowSettings(false);
    }
  };




  const breadcrumbs = useMemo(() => {
    if (!currentTab) return [];
    if (currentTab.path === 'shell:RecycleBin') return [
      { label: 'This PC', path: '' },
      { label: 'Recycle Bin', path: 'shell:RecycleBin' }
    ];

    const parts = currentTab.path.split('\\').filter(Boolean);
    const crumbs = [{ label: 'This PC', path: '' }];

    let currentBuildPath = '';
    parts.forEach((part, index) => {
      if (index === 0 && part.endsWith(':')) {
        currentBuildPath = part + '\\';
      } else {
        currentBuildPath = currentBuildPath.endsWith('\\') ? currentBuildPath + part : currentBuildPath + '\\' + part;
      }
      crumbs.push({ label: part, path: currentBuildPath });
    });

    return crumbs;
  }, [currentTab?.path]);

  const handleSelectAll = useCallback(() => {
    hookHandleSelectAll(sortedFiles);
  }, [hookHandleSelectAll, sortedFiles]);

  const handleClearSelection = hookHandleClearSelection;

  const startEditingPath = () => {
    if (currentTab) {
      setPathInput(currentTab.path);
      setIsEditingPath(true);
    }
  };

  const handlePathSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (pathInput.trim()) {
      navigateTo(pathInput.trim());
    } else {
      setIsEditingPath(false);
    }
  };

  const handlePinFolder = useCallback((folder: FileEntry) => {
    setQuickAccessConfig(prev => {
      const newConfig = {
        ...prev,
        pinnedFolders: [
          ...prev.pinnedFolders,
          { id: crypto.randomUUID(), name: folder.name, path: folder.path }
        ]
      };
      localStorage.setItem('speedexplorer-config', JSON.stringify(newConfig));
      return newConfig;
    });
  }, []);

  const handleUnpinFolder = useCallback((path: string) => {
    setQuickAccessConfig(prev => {
      // Find the folder. Special case for home which might have empty path
      const folder = prev.pinnedFolders.find(f => f.path === path || (f.id === 'home' && path === ''));
      const isSystemFolder = folder && ['desktop', 'downloads', 'documents', 'pictures', 'recycle-bin', 'home'].includes(folder.id);

      let newPinnedFolders;
      if (isSystemFolder) {
        newPinnedFolders = prev.pinnedFolders.map(f =>
          f.id === folder.id ? { ...f, enabled: false } : f
        );
      } else {
        newPinnedFolders = prev.pinnedFolders.filter(f => f.path !== path);
      }

      const newConfig = {
        ...prev,
        pinnedFolders: newPinnedFolders
      };
      localStorage.setItem('speedexplorer-config', JSON.stringify(newConfig));
      return newConfig;
    });
  }, []);

  const handleToggleColumn = useCallback((column: SortColumn) => {
    setVisibleColumns(prev => {
      const newColumns = prev.includes(column)
        ? (prev.length > 1 ? prev.filter(c => c !== column) : prev) // Prevent hiding all columns
        : [...prev, column].sort((a, b) => DEFAULT_COLUMNS.indexOf(a) - DEFAULT_COLUMNS.indexOf(b));

      localStorage.setItem('speedexplorer-columns', JSON.stringify(newColumns));
      return newColumns;
    });
  }, []);

  const handleCopy = async (files: FileEntry[]) => {
    try {
      await invoke('copy_items', { paths: files.map(f => f.path) });
      setLastCutPaths([]);
      checkClipboard();
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleCut = async (files: FileEntry[]) => {
    try {
      await invoke('cut_items', { paths: files.map(f => f.path) });
      const parents = Array.from(new Set(files.map(f => {
        const lastSlash = f.path.lastIndexOf('\\');
        if (lastSlash === -1) return f.path;
        let parent = f.path.substring(0, lastSlash);
        if (parent.endsWith(':')) parent += '\\';
        return parent;
      })));
      setLastCutPaths(parents);
      checkClipboard();
    } catch (err) {
      console.error('Failed to cut', err);
    }
  };

  const handlePaste = async (customTargetPath?: string) => {
    if (!currentTab) return;
    const targetPath = customTargetPath || currentTab.path;

    // Optimistic Update for Screenshots
    // Note: If pasting into a SUBFOLDER (customTargetPath), we might NOT want to optimistically update the current view
    // unless we are already IN that subfolder (which we are not, usually).
    // So, if customTargetPath is set, we might skip the optimistic update OR we just rely on standard refresh behaviors.
    // For now, let's keep it simple: only optimistic if pasting to CURRENT view.
    const isCurrentView = targetPath === currentTab.path;

    if (clipboardInfo && !clipboardInfo.has_files && clipboardInfo.has_image) {
      try {
        const newFile = await invoke<FileEntry>('save_clipboard_image', { targetPath });

        if (isCurrentView) {
          // Optimistically add to list without reloading
          updateTab(currentTab.id, {
            files: [...currentTab.files, newFile],
            selectedFiles: [newFile],
            lastSelectedFile: newFile
          });
        }

        checkClipboard();
      } catch (err) {
        console.error('Failed to paste image', err);
        updateTab(currentTab.id, { error: String(err) });
      }
      return;
    }

    // Default Paste (Files)
    try {
      const pastedPaths = await invoke<string[]>('paste_items', { targetPath });

      // If pasting into current tab, reload it directly with selection
      if (isCurrentView) {
        await loadFilesForTab(currentTab.id, targetPath, undefined, pastedPaths);
      } else {
        refreshTabsViewing(targetPath);
      }

      // If it was a cut operation, also refresh the source directories
      if (lastCutPaths.length > 0) {
        refreshTabsViewing(lastCutPaths);
        setLastCutPaths([]); // Clear after move
      }

      checkClipboard();
    } catch (err) {
      console.error('Failed to paste', err);
      // Optional: Show error to user
      updateTab(currentTab.id, { error: String(err) });
    }
  };

  const handleContextMenuAction = async (action: string, data?: any) => {
    if (!currentTab) return;
    const selectedFiles = currentTab.selectedFiles;
    const file = selectedFiles.length === 1 ? selectedFiles[0] : null;

    if (action === 'move-to-tab' && data) {
      const { targetPath, tabId } = data;
      if (selectedFiles.length === 0) return;
      try {
        await invoke('move_items', { paths: selectedFiles.map(f => f.path), targetPath });

        // Auto-close tabs looking at moved FOLDERS
        const movedFolders = selectedFiles.filter(f => f.is_dir).map(f => f.path.toLowerCase());
        if (movedFolders.length > 0) {
          tabs.forEach(t => {
            if (t.path && movedFolders.some(folderPath =>
              t.path.toLowerCase() === folderPath || t.path.toLowerCase().startsWith(folderPath + '\\')
            )) {
              closeTab(t.id);
            }
          });
        }

        refreshCurrentTab();
        loadFilesForTab(tabId, targetPath);
      } catch (err) {
        updateTab(currentTab.id, { error: String(err) });
      }
      return;
    }

    if (action === 'delete') {
      handleDelete(selectedFiles, false); // Context menu delete is always non-silent for safety
      return;
    } else if (action === 'copy') {
      handleCopy(selectedFiles);
      return;
    } else if (action === 'cut') {
      handleCut(selectedFiles);
      return;
    }

    if (!file) {
      // Actions for empty space
      if (action === 'paste') {
        handlePaste();
      } else if (action === 'properties') {
        // Show current folder properties
        if (currentTab) invoke('show_item_properties', { path: currentTab.path });
      } else if (action === 'open-terminal') {
        invoke('open_terminal', { path: currentTab.path });
      }
      return;
    }

    if (action === 'open') {
      if (file.is_dir) {
        navigateTo(file.path);
      } else {
        invoke('open_file', { path: file.path });
      }
    } else if (action === 'open-with' && file) {
      invoke('open_with', { path: file.path });
    } else if (action === 'open-location') {
      if (file.is_shortcut) {
        invoke<string>('resolve_shortcut', { path: file.path }).then(targetPath => {
          const parent = targetPath.substring(0, targetPath.lastIndexOf('\\'));
          if (parent) navigateTo(parent);
        }).catch(err => {
          updateTab(currentTab.id, { error: String(err) });
        });
      } else {
        const parent = file.path.substring(0, file.path.lastIndexOf('\\'));
        if (parent) navigateTo(parent);
      }
    } else if (action === 'copy-path') {
      navigator.clipboard.writeText(file.path);
    } else if (action === 'properties') {
      invoke('show_item_properties', { path: file.path });
    } else if (action === 'paste') {
      // Logic: If file is a directory, paste INTO it. Else paste into current dir.
      if (file.is_dir) {
        handlePaste(file.path);
      } else {
        handlePaste();
      }
    } else if (action === 'select-all') {
      handleSelectAll();
    } else if (action === 'open-in-new-tab' && file) {
      if (file.is_dir) addTab(file.path);
    } else if (action === 'pin' && file) {
      handlePinFolder(file);
    } else if (action === 'unpin' && file) {
      handleUnpinFolder(file.path);
    } else if (action === 'rename' && file) {
      handleRename(file);
    } else if (action === 'empty-recycle-bin') {
      handleEmptyRecycleBin();
    }
  };

  const handleDelete = async (files: FileEntry[], silent: boolean = false) => {
    if (files.length === 0) return;

    let confirmed = silent;
    if (!silent) {
      const message = files.length === 1
        ? `Are you sure you want to delete "${files[0].name}"?`
        : `Are you sure you want to delete ${files.length} items?`;

      confirmed = await ask(message, {
        title: 'SpeedExplorer',
        kind: 'warning',
      });
    }

    if (confirmed && currentTab) {
      try {
        const deletedPaths = files.map(f => f.path);
        await invoke('delete_items', { paths: deletedPaths, silent });

        // Auto-close tabs looking at deleted FOLDERS
        const deletedFolders = files.filter(f => f.is_dir).map(f => f.path.toLowerCase());
        if (deletedFolders.length > 0) {
          tabs.forEach(t => {
            if (t.path && deletedFolders.some(folderPath =>
              t.path.toLowerCase() === folderPath || t.path.toLowerCase().startsWith(folderPath + '\\')
            )) {
              closeTab(t.id);
            }
          });
        }

        // Refresh all tabs viewing the parent directories of deleted items
        const parents = Array.from(new Set(files.map(f => {
          const lastSlash = f.path.lastIndexOf('\\');
          if (lastSlash === -1) return f.path;
          let parent = f.path.substring(0, lastSlash);
          if (parent.endsWith(':')) parent += '\\';
          return parent;
        })));
        refreshTabsViewing(parents);
        fetchRecycleBinStatus();
      } catch (err) {
        updateTab(currentTab.id, { error: String(err) });
      }
    }
  };

  const handleEmptyRecycleBin = async () => {
    const confirmed = await ask('Are you sure you want to empty the Recycle Bin?', {
      title: 'SpeedExplorer',
      kind: 'warning',
    });

    if (confirmed) {
      try {
        await invoke('empty_recycle_bin');
        refreshTabsViewing('shell:RecycleBin');
        fetchRecycleBinStatus();
      } catch (err) {
        if (currentTab) updateTab(currentTab.id, { error: String(err) });
      }
    }
  };

  // Mouse Handlers for Resizing
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const MIN_INFO_WIDTH = 350;
    const MAX_INFO_PERCENT = 0.25;
    const MIN_CENTER_PERCENT = 0.50;
    const MIN_CENTER_WIDTH_PX = 800;

    const minCenterWidth = Math.max(windowWidth * MIN_CENTER_PERCENT, MIN_CENTER_WIDTH_PX);

    if (isResizing === 'info') {
      const maxAllowedByCenter = windowWidth - sidebarWidth - minCenterWidth;
      const maxAllowedByPercent = windowWidth * MAX_INFO_PERCENT;
      const maxWidth = Math.min(maxAllowedByPercent, maxAllowedByCenter);

      const newWidth = Math.max(MIN_INFO_WIDTH, Math.min(windowWidth - e.clientX, maxWidth));
      setInfoPanelRatio(newWidth / windowWidth);
    } else if (isResizing === 'search') {
      const newWidth = Math.max(150, Math.min(500, windowWidth - infoPanelWidth - e.clientX - 40));
      setSearchBarWidth(newWidth);
    }
  }, [isResizing, infoPanelWidth, sidebarWidth, windowWidth]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(null);
  }, []);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleSelectMultiple = useCallback((files: FileEntry[], lastOne: FileEntry | null) => {
    updateTab(activeTabId, {
      selectedFiles: files,
      lastSelectedFile: lastOne
    });
  }, [activeTabId, updateTab]);

  const debouncedSelectedFiles = useDebouncedValue(currentTab?.selectedFiles || [], 100);

  useEffect(() => {
    const handleDefaultContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    window.addEventListener('contextmenu', handleDefaultContextMenu);
    return () => window.removeEventListener('contextmenu', handleDefaultContextMenu);
  }, []);

  return (
    <div className="flex h-screen w-screen bg-[var(--bg-deep)] text-[var(--text-main)] overflow-hidden select-none mica-container">
      {isLoadingApp && <SplashScreen finishLoading={finishLoading} />}

      {showSettings ? (
        <SettingsPanel
          config={quickAccessConfig}
          sortConfig={defaultSortConfig}
          showHiddenFiles={showHiddenFiles}
          autoSearchOnKey={autoSearchOnKey}
          focusNewTabOnMiddleClick={focusNewTabOnMiddleClick}
          onSave={saveConfig}
          onReset={handleResetSettings}
          onCancel={() => setShowSettings(false)}
        />
      ) : (
        <>
          <Sidebar
            onNavigate={navigateTo}
            onOpenInNewTab={(path) => addTab(path, focusNewTabOnMiddleClick)}
            onContextMenu={handleSidebarContextMenu}
            currentPath={currentTab?.path || ''}
            quickAccess={quickAccessConfig}
            width={sidebarWidth}
            onClearSelection={handleClearSelection}
            recycleBinStatus={recycleBinStatus}
            onRefreshRecycleBin={fetchRecycleBinStatus}
          />



          <main className="flex-1 flex flex-col min-w-0 bg-[var(--bg-surface)]">
            {/* Tab Bar */}
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onTabClick={switchTab}
              onTabClose={closeTab}
              onNewTab={() => addTab()}
              onReorder={(reorderedTabs: Tab[]) => {
                reorderTabs(reorderedTabs);
              }}
            />

            {/* Navigation Bar */}
            <header className="h-14 border-b border-white/10 flex items-center px-4 gap-4 backdrop-blur-2xl">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSettings(true)}
                  className="p-1 rounded-lg hover:bg-white/10 text-zinc-300 hover:text-white transition-all active:scale-95"
                  title="Settings"
                >
                  <SettingsIcon size={18} />
                </button>

                <button
                  onClick={cycleTheme}
                  className="p-1 rounded-lg hover:bg-white/10 text-zinc-300 hover:text-white transition-all active:scale-95 group relative"
                  title="Change Theme"
                >
                  <Paintbrush size={18} className="group-hover:rotate-12 transition-transform" />
                  <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[var(--accent-primary)] shadow-[0_0_8px_var(--accent-primary)]" />
                </button>
              </div>

              <div className="flex items-center gap-0">
                <button
                  onClick={goBack}
                  disabled={!currentTab || currentTab.historyIndex <= 0}
                  className="p-2 rounded-lg hover:bg-white/10 text-zinc-300 disabled:text-zinc-700 disabled:hover:bg-transparent transition-all"
                >
                  <ArrowLeft size={18} />
                </button>
                <button
                  onClick={goForward}
                  disabled={!currentTab || currentTab.historyIndex >= currentTab.history.length - 1}
                  className="p-2 rounded-lg hover:bg-white/10 text-zinc-300 disabled:text-zinc-700 disabled:hover:bg-transparent transition-all"
                >
                  <ArrowRight size={18} />
                </button>
                <button
                  onClick={goUp}
                  className="p-2 rounded-lg hover:bg-white/10 text-zinc-300 transition-all ml-1"
                  title="Up"
                >
                  <ArrowUp size={18} />
                </button>
                <button
                  onClick={refreshCurrentTab}
                  className="p-2 rounded-lg hover:bg-white/10 text-zinc-300 transition-all"
                  title="Refresh"
                >
                  <RotateCw size={18} className={currentTab?.loading ? 'animate-spin' : ''} />
                </button>
              </div>

              {/* Address Bar */}
              <div className="flex-1 h-9 bg-white/5 border border-white/10 rounded-lg flex items-center px-3 relative group focus-within:border-[var(--accent-primary)] focus-within:ring-1 focus-within:ring-[var(--accent-primary)] transition-all">
                {isEditingPath ? (
                  <form onSubmit={handlePathSubmit} className="flex-1 h-full">
                    <input
                      autoFocus
                      className="w-full h-full bg-transparent text-sm text-white outline-none font-mono"
                      value={pathInput}
                      onChange={(e) => setPathInput(e.target.value)}
                      onBlur={() => setIsEditingPath(false)}
                    />
                  </form>
                ) : (
                  <div className="flex items-center gap-1 flex-1 h-full cursor-text overflow-hidden" onClick={startEditingPath}>
                    <div className="flex items-center gap-0.5 text-zinc-400 select-none mr-2">
                      <div className="w-4 h-4">
                        {currentTab?.path === 'shell:RecycleBin' ? <Trash size={14} /> : <div className="i-lucide-hard-drive size-3.5" />}
                      </div>
                    </div>

                    <div className="flex items-center overflow-hidden">
                      {breadcrumbs.map((crumb, index) => (
                        <Fragment key={crumb.path}>
                          {index > 0 && <span className="text-zinc-600 mx-1">/</span>}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigateTo(crumb.path);
                            }}
                            className="text-sm text-zinc-300 hover:bg-white/10 px-1.5 py-0.5 rounded transition-colors truncate max-w-[150px]"
                          >
                            {crumb.label}
                          </button>
                        </Fragment>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Search Bar */}
              <div
                className="h-9 bg-white/5 border border-white/10 rounded-lg flex items-center px-3 relative transition-all focus-within:border-[var(--accent-primary)]"
                style={{ width: searchBarWidth }}
              >
                <Search size={14} className="text-zinc-500 mr-2 shrink-0" />
                <input
                  ref={searchInputRef}
                  className="bg-transparent text-sm text-white outline-none w-full placeholder:text-zinc-600"
                  placeholder={`Search ${currentTab?.files.length || 0} items...`}
                  value={currentTab?.searchQuery || ''}
                  onChange={(e) => updateTab(currentTab.id, { searchQuery: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && sortedFiles.length === 1) {
                      const file = sortedFiles[0];
                      if (file.is_dir) navigateTo(file.path);
                      else invoke('open_file', { path: file.path });
                    } else if (e.key === 'Escape') {
                      if (currentTab?.searchQuery) {
                        updateTab(currentTab.id, { searchQuery: '' });
                      }
                      e.currentTarget.blur();
                    }
                  }}
                />
                {/* Search Resizer */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent-primary)]/50"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setIsResizing('search');
                  }}
                />
              </div>
            </header>

            {/* Toolbar (Placeholder moved below) */}

            {currentTab?.error && (
              <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-xs text-red-400 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                {currentTab.error}
              </div>
            )}

            <div className="flex-1 flex min-h-0">
              <div className="flex-1 flex flex-col min-w-0">
                {currentTab?.path === '' ? (
                  <ThisPCView
                    files={sortedFiles}
                    onOpen={(file: FileEntry) => {
                      if (file.is_dir) {
                        navigateTo(file.path);
                      } else {
                        invoke('open_file', { path: file.path });
                      }
                    }}
                    onOpenInNewTab={(file: FileEntry) => {
                      if (file.is_dir) {
                        addTab(file.path, focusNewTabOnMiddleClick);
                      }
                    }}
                    onContextMenu={handleContextMenu}
                    selectedFiles={currentTab?.selectedFiles || []}
                    onSelectMultiple={handleSelectMultiple}
                  />
                ) : (
                  <>
                    {/* Toolbar (Moved here) */}
                    <div className="h-11 border-b border-white/10 flex items-center px-4 justify-between bg-white/[0.02]">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={async () => {
                            if (!currentTab) return;
                            try {
                              await invoke('create_folder', { parentPath: currentTab.path });
                              loadFilesForTab(currentTab.id, currentTab.path);
                            } catch (err) {
                              updateTab(currentTab.id, { error: String(err) });
                            }
                          }}
                          className="flex items-center gap-2 text-sm font-bold text-zinc-100 hover:text-white transition-colors group px-2 py-1.5 rounded-md toolbar-btn"
                        >
                          <svg viewBox="0 0 24 24" fill="var(--accent-primary-20, rgba(var(--accent-rgb), 0.2))" stroke="var(--accent-primary)" strokeWidth="2" className="w-[18px] h-[18px] group-hover:drop-shadow-[0_0_10px_rgba(var(--accent-rgb),0.5)] transition-all">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg> New Folder
                        </button>
                        <div className="h-3.5 w-px bg-white/5" />
                        <button
                          onClick={handleSelectAll}
                          disabled={!currentTab || sortedFiles.length === 0}
                          className={`flex items-center gap-2 text-sm transition-colors px-2 py-1.5 rounded-md toolbar-btn 
                                    ${currentTab && sortedFiles.length > 0
                              ? 'text-zinc-100 hover:text-white'
                              : 'text-zinc-500 cursor-not-allowed'}`}
                        >
                          <CheckSquare size={18} className={currentTab && sortedFiles.length > 0 ? "text-[var(--accent-primary)]" : "text-zinc-500"} />
                          <span className="grid shrink-0">
                            <span className={`col-start-1 row-start-1 ${currentTab && sortedFiles.length > 0 ? 'font-bold' : 'font-medium'}`}>Select all</span>
                            <span className="col-start-1 row-start-1 font-bold invisible" aria-hidden="true">Select all</span>
                          </span>
                        </button>
                        <button
                          onClick={() => currentTab?.selectedFiles.length > 0 && handleCopy(currentTab.selectedFiles)}
                          disabled={!currentTab || currentTab.selectedFiles.length === 0}
                          className={`flex items-center gap-2 text-sm transition-colors px-2 py-1.5 rounded-md toolbar-btn 
                                    ${currentTab && currentTab.selectedFiles.length > 0
                              ? 'text-zinc-100 hover:text-white'
                              : 'text-zinc-500 cursor-not-allowed'}`}
                        >
                          <Copy size={18} className={currentTab && currentTab.selectedFiles.length > 0 ? "text-[var(--accent-primary)]" : "text-zinc-500"} />
                          <span className="grid shrink-0">
                            <span className={`col-start-1 row-start-1 ${currentTab && currentTab.selectedFiles.length > 0 ? 'font-bold' : 'font-medium'}`}>Copy</span>
                            <span className="col-start-1 row-start-1 font-bold invisible" aria-hidden="true">Copy</span>
                          </span>
                        </button>
                        <button
                          onClick={() => currentTab?.selectedFiles.length > 0 && handleCut(currentTab.selectedFiles)}
                          disabled={!currentTab || currentTab.selectedFiles.length === 0}
                          className={`flex items-center gap-2 text-sm transition-colors px-2 py-1.5 rounded-md toolbar-btn 
                                    ${currentTab && currentTab.selectedFiles.length > 0
                              ? 'text-zinc-300 hover:text-white'
                              : 'text-zinc-500 cursor-not-allowed'}`}
                        >
                          <Scissors size={18} />
                          <span className="grid shrink-0">
                            <span className={`col-start-1 row-start-1 ${currentTab && currentTab.selectedFiles.length > 0 ? 'font-bold' : 'font-medium'}`}>Cut</span>
                            <span className="col-start-1 row-start-1 font-bold invisible" aria-hidden="true">Cut</span>
                          </span>
                        </button>
                        <button
                          onClick={() => handlePaste()}
                          onContextMenu={handlePasteContextMenu}
                          disabled={!canPaste}
                          className={`flex items-center gap-2.5 text-sm pl-3 pr-2 py-1.5 rounded-md transition-all duration-300 group/paste toolbar-btn
                                    ${canPaste
                              ? 'text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 hover:shadow-[0_0_15px_rgba(var(--accent-rgb),0.3)]'
                              : 'text-zinc-500 cursor-not-allowed opacity-50'}`}
                        >
                          <PasteIcon size={18} className={canPaste ? 'animate-pulse' : ''} />
                          <span className="grid shrink-0 text-zinc-100 group-hover/paste:text-[var(--accent-primary)] transition-colors">
                            <span className={`col-start-1 row-start-1 ${canPaste ? 'font-bold' : 'font-medium'}`}>Paste</span>
                            <span className="col-start-1 row-start-1 font-bold invisible" aria-hidden="true">Paste</span>
                          </span>

                          {/* Content Indicator Chip */}
                          {canPaste && clipboardInfo && (
                            <div className="flex items-center ml-1 animate-in fade-in slide-in-from-right-2 duration-300">
                              <div className="w-6 h-6 bg-[var(--accent-primary)] text-black rounded-md flex items-center justify-center shadow-sm">
                                {clipboardInfo.has_image ? (
                                  <ImageIcon size={14} strokeWidth={3} />
                                ) : clipboardInfo.file_count > 1 ? (
                                  <FilesIcon size={14} strokeWidth={3} />
                                ) : (
                                  <FileIcon size={14} strokeWidth={3} />
                                )}
                              </div>
                            </div>
                          )}
                        </button>
                        <div className="h-3.5 w-px bg-white/5" />
                        <button
                          onClick={() => currentTab && currentTab.selectedFiles.length > 0 && handleDelete(currentTab.selectedFiles, false)}
                          disabled={!currentTab || currentTab.selectedFiles.length === 0}
                          className={`flex items-center gap-2 text-sm transition-colors px-2 py-1.5 rounded-md toolbar-btn 
                                    ${currentTab && currentTab.selectedFiles.length > 0
                              ? 'text-red-400 hover:text-red-300'
                              : 'text-zinc-500 cursor-not-allowed'}`}
                        >
                          <Trash size={18} className={currentTab && currentTab.selectedFiles.length > 0 ? "text-red-500" : "text-zinc-500"} />
                          <span className="grid shrink-0">
                            <span className={`col-start-1 row-start-1 ${currentTab && currentTab.selectedFiles.length > 0 ? 'font-bold' : 'font-medium'}`}>Delete</span>
                            <span className="col-start-1 row-start-1 font-bold invisible" aria-hidden="true">Delete</span>
                          </span>
                        </button>
                        <div className="h-3.5 w-px bg-white/5" />
                        <button
                          onClick={async () => {
                            if (currentTab) {
                              try {
                                await invoke('open_terminal', { path: currentTab.path });
                              } catch (err) {
                                updateTab(currentTab.id, { error: String(err) });
                              }
                            }
                          }}
                          className="flex items-center gap-2 text-sm font-bold text-zinc-100 hover:text-white transition-colors group px-2 py-1.5 rounded-md hover:bg-white/5"
                        >
                          <Terminal size={18} className="text-[var(--accent-primary)] group-hover:drop-shadow-[0_0_8px_var(--accent-primary)] transition-all" />
                          Terminal
                        </button>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => currentTab && updateTab(currentTab.id, { viewMode: 'list' })}
                          className={`p-1.5 rounded-md transition-all ${currentTab?.viewMode === 'list' ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]' : 'hover:bg-white/5 text-zinc-400'}`}
                          title="List View"
                        >
                          <List size={16} />
                        </button>
                        <button
                          onClick={() => currentTab && updateTab(currentTab.id, { viewMode: 'grid' })}
                          className={`p-1.5 rounded-md transition-all ${currentTab?.viewMode === 'grid' ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]' : 'hover:bg-white/5 text-zinc-400'}`}
                          title="Grid View"
                        >
                          <Grid size={16} />
                        </button>
                      </div>
                    </div>
                    {currentTab?.viewMode === 'grid' ? (
                      <FileGrid
                        files={sortedFiles}
                        currentPath={currentTab?.path || ''}
                        selectedFiles={currentTab?.selectedFiles || []}
                        lastSelectedFile={currentTab?.lastSelectedFile || null}
                        onSelectMultiple={handleSelectMultiple}
                        onOpen={(file: FileEntry) => {
                          if (file.is_dir) {
                            navigateTo(file.path);
                          } else {
                            invoke('open_file', { path: file.path });
                          }
                        }}
                        onOpenInNewTab={(file: FileEntry) => {
                          if (file.is_dir) {
                            addTab(file.path, focusNewTabOnMiddleClick);
                          }
                        }}
                        onContextMenu={handleContextMenu}
                        onClearSelection={handleClearSelection}
                        renamingPath={currentTab?.renamingPath || null}
                        onRenameSubmit={handleRenameSubmit}
                        onRenameCancel={handleRenameCancel}
                        clipboardInfo={clipboardInfo}
                      />
                    ) : (
                      <FileTable
                        files={sortedFiles}
                        currentPath={currentTab?.path || ''}
                        selectedFiles={currentTab?.selectedFiles || []}
                        lastSelectedFile={currentTab?.lastSelectedFile || null}
                        sortConfig={currentTab?.sortConfig || defaultSortConfig}
                        onSort={handleSort}
                        onSelectMultiple={handleSelectMultiple}
                        onOpen={(file: FileEntry) => {
                          if (file.is_dir) {
                            navigateTo(file.path);
                          } else {
                            invoke('open_file', { path: file.path });
                          }
                        }}
                        onOpenInNewTab={(file: FileEntry) => {
                          if (file.is_dir) {
                            addTab(file.path, focusNewTabOnMiddleClick);
                          }
                        }}
                        onContextMenu={handleContextMenu}
                        onClearSelection={handleClearSelection}
                        renamingPath={currentTab?.renamingPath || null}
                        onRenameSubmit={handleRenameSubmit}
                        onRenameCancel={handleRenameCancel}
                        visibleColumns={visibleColumns}
                        onToggleColumn={handleToggleColumn}
                        columnWidths={columnWidths}
                        onColumnsResize={handleColumnsResize}
                        clipboardInfo={clipboardInfo}
                      />
                    )}

                    {/* Status Bar */}
                    <footer className="h-7 border-t border-white/5 bg-white/[0.01] flex items-center px-4 shrink-0 select-none">
                      <span className="text-[11px] text-zinc-500 font-medium">
                        {currentTab && currentTab.selectedFiles.length > 0
                          ? `${currentTab.selectedFiles.length} selected`
                          : `${sortedFiles.length} ${sortedFiles.length === 1 ? 'item' : 'items'}`
                        }
                      </span>
                    </footer>
                  </>
                )}
              </div>

              {/* Info Panel Resizer */}
              <div
                className={`w-1 cursor-col-resize hover:bg-[var(--accent-primary)]/30 transition-colors z-50 flex-shrink-0 ${isResizing === 'info' ? 'bg-[var(--accent-primary)]/50' : 'bg-white/5'}`}
                onMouseDown={() => setIsResizing('info')}
              />

              <InfoPanel selectedFiles={debouncedSelectedFiles} width={infoPanelWidth} />
            </div>
          </main>

          {contextMenu && (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onClose={() => setContextMenu(null)}
              onAction={handleContextMenuAction}
              selectedFiles={currentTab?.selectedFiles || []}
              pinnedFolders={quickAccessConfig.pinnedFolders}
              allowRename={!contextMenu.fromSidebar}
              fromSidebar={contextMenu.fromSidebar}
              recycleBinStatus={recycleBinStatus}
              tabs={tabs}
              activeTabId={activeTabId}
            />
          )}

          {clipboardPopup && clipboardInfo && (
            clipboardInfo.has_image ? (
              <>
                {/* Center Modal for Images */}
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[99] animate-in fade-in duration-300" />
                <div
                  className="fixed z-[100] bg-[rgba(20,20,22,0.95)] border border-white/10 rounded-2xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-3xl animate-in fade-in zoom-in-95 duration-300 pointer-events-none"
                  style={{
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 'auto',
                    maxWidth: '70vw',
                    maxHeight: '70vh',
                    minWidth: '300px'
                  }}
                >


                  {clipboardInfo.image_data && (
                    <div className="mb-4 rounded-xl overflow-hidden border border-white/10 bg-black/40 shadow-inner flex justify-center">
                      <img
                        src={clipboardInfo.image_data}
                        alt="Clipboard preview"
                        className="w-auto h-auto object-contain max-h-[70vh] max-w-full block"
                      />
                    </div>
                  )}



                </div>
              </>
            ) : (
              /* Original Small Popup for Files/Text */
              <div
                className="fixed z-[100] bg-[rgba(20,20,22,0.9)] border border-white/10 rounded-xl p-3 shadow-2xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-200 pointer-events-none"
                style={{
                  left: Math.min(clipboardPopup.x, window.innerWidth - 220),
                  top: clipboardPopup.y + 10,
                  width: '210px'
                }}
              >
                <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <PasteIcon size={10} /> Clipboard Content
                </div>

                {clipboardInfo.has_files ? (
                  <ul className="space-y-1">
                    {clipboardInfo.file_summary?.split(', ').map((item, i) => (
                      <li key={i} className="text-xs text-zinc-300 flex items-center gap-2">
                        <div className="w-1 h-1 rounded-full bg-[var(--accent-primary)] shrink-0" />
                        <span className="font-medium tracking-tight">{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-zinc-500 italic">
                    Empty or unsupported format
                  </div>
                )}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
