import { useState, useEffect, useCallback, useMemo, Fragment, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { motion, AnimatePresence } from 'framer-motion';
import ThisPCView from './components/ThisPCView';

// Global singleton for extreme frontend performance
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
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
  Terminal,
  ChevronRight,
  PanelRight,
  RotateCcw,
  Scale,
  Eraser
} from 'lucide-react';
import { isPreviewable } from './utils/previewUtils';

const DEFAULT_COLUMNS: SortColumn[] = ['name', 'modified_at', 'created_at', 'file_type', 'size'];



import Sidebar from './components/Sidebar';
import FileTable from './components/FileTable';
import FileGrid from './components/FileGrid';
import InfoPanel from './components/InfoPanel';
import ContextMenu from './components/ContextMenu';
import SettingsPanel from './components/SettingsPanel';
import { invalidateCachedSize } from './utils/folderSizeCache';
import TabBar from './components/TabBar';
import QuickPreview from './components/QuickPreview';
import InputContextMenu from './components/InputContextMenu';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import './App.css';

import { useTabs } from './hooks/useTabs';
import { /* Tab, */ SortConfig, SortColumn, FileEntry, QuickAccessConfig, ClipboardInfo, RecycleBinStatus, ToolbarMode } from './types';
import SplashScreen from './components/SplashScreen';
import { useTranslation } from './i18n/useTranslation';
import { DeepSearchButton } from './components/DeepSearchButton';
import { cn } from './lib/utils';
import { SearchStatusIndicator } from './components/SearchStatusIndicator';

export default function App() {
  const { t } = useTranslation();
  const [isLoadingApp, setIsLoadingApp] = useState(true);
  const [deepSearchDetailStatus, setDeepSearchDetailStatus] = useState<string>("");
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
        { id: 'home', name: 'This PC', path: '', enabled: true },
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
            // Migration: Rename 'Home' to 'This PC' for existing users
            if (f.id === 'home' && f.name === 'Home') return { ...f, name: 'This PC' };
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
        { id: 'home', name: 'This PC', path: '', enabled: true },
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

  const [toolbarMode, setToolbarMode] = useState<ToolbarMode>(() => {
    return (localStorage.getItem('speedexplorer-toolbar-mode') as ToolbarMode) || 'dynamic';
  });

  const [isToolbarCompact, setIsToolbarCompact] = useState(false);


  const searchInputRef = useRef<HTMLInputElement>(null);
  const centralPanelRef = useRef<HTMLDivElement>(null);


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
    updateVisibleIndices,
    triggerSizeCalculation,
    clearSizeCache,
    triggerDeepSearch,
    removeItemsFromTabs,
    // reorderTabs
  } = useTabs(defaultSortConfig, showHiddenFiles, quickAccessConfig);

  // === Stable callbacks to prevent infinite render loops ===
  const handleVisibleFilesChange = useCallback((indices: number[]) => {
    if (currentTab) {
      updateVisibleIndices(currentTab.id, indices);
    }
  }, [currentTab?.id, updateVisibleIndices]);

  const handleScrollChange = useCallback((index: number) => {
    if (currentTab) {
      updateTab(currentTab.id, { scrollIndex: index });
    }
  }, [currentTab?.id, updateTab]);

  // === Drag & Drop Refs (to decouple from React re-renders) ===
  const currentTabRef = useRef(currentTab);
  const currentPathRef = useRef(currentTab?.path);
  const refreshCurrentTabRef = useRef(refreshCurrentTab);
  const dragCounterRef = useRef(0);
  const lastProcessedDropRef = useRef(0);
  const lastShowOverlayRef = useRef(0);
  const isInternalDraggingRef = useRef(false);
  const internalDragStartTimeRef = useRef(0);
  const internalDraggedPathsRef = useRef<string[]>([]);
  const internalDragTimeoutRef = useRef<any>(null);
  const lastInternalDropTimeRef = useRef(0);
  const lastInternalLockReleaseTimeRef = useRef(0);

  // === Animation State ===
  const [direction, setDirection] = useState(0);
  const lastTabIdRef = useRef(activeTabId);

  useEffect(() => {
    if (activeTabId !== lastTabIdRef.current) {
      const prevIndex = tabs.findIndex(t => t.id === lastTabIdRef.current);
      const currIndex = tabs.findIndex(t => t.id === activeTabId);

      if (prevIndex !== -1 && currIndex !== -1) {
        setDirection(currIndex > prevIndex ? 1 : -1);
      } else {
        setDirection(0);
      }
      lastTabIdRef.current = activeTabId;
    }
  }, [activeTabId, tabs]);

  useEffect(() => {
    if (isLoadingApp || !centralPanelRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        // We consider compact if width is below 1050px
        const width = entry.contentRect.width;
        if (width > 0) {
          const isCompact = toolbarMode === 'compact' || (toolbarMode === 'dynamic' && width < 1050);
          setIsToolbarCompact(isCompact);
        }
      }
    });

    observer.observe(centralPanelRef.current);

    // Initial check
    const initialWidth = centralPanelRef.current.offsetWidth;
    if (initialWidth > 0) {
      const isCompact = toolbarMode === 'compact' || (toolbarMode === 'dynamic' && initialWidth < 1050);
      setIsToolbarCompact(isCompact);
    }

    return () => observer.disconnect();
  }, [isLoadingApp, t, showSettings, toolbarMode]);

  // Sync refs on every render (cheap operation, no side effects)
  useEffect(() => {
    currentTabRef.current = currentTab;
    currentPathRef.current = currentTab?.path;
  }, [currentTab, currentTab?.path]);

  useEffect(() => {
    refreshCurrentTabRef.current = refreshCurrentTab;
  }, [refreshCurrentTab]);

  // === Async Notification Listener (v12.0) ===
  useEffect(() => {
    const unlisten = listen('refresh-tab', () => {
      console.log("[v12.0] Received 'refresh-tab' event. Refreshing...");
      if (refreshCurrentTabRef.current) {
        refreshCurrentTabRef.current();
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  useEffect(() => {
    const unlistenStatus = listen<string>('deep-search-detail-status', (event) => {
      setDeepSearchDetailStatus(event.payload);
    });

    const unlistenReplace = listen<FileEntry[]>('deep-search-replace', (event) => {
      // NOTE: Backend ensures nav_id matches before emitting this
      if (currentTabRef.current) {
        updateTab(currentTabRef.current.id, { files: event.payload });
      }
    });

    return () => {
      unlistenStatus.then(f => f());
      unlistenReplace.then(f => f());
    };
  }, [updateTab]);

  // RESET SEARCH STATUS ON NAVIGATION (v30.0)
  // v32.0 (Breadcrumb Edge Case): generationId ensures it triggers even on "reload current path" clicks
  useEffect(() => {
    setDeepSearchDetailStatus("");
  }, [currentTab?.id, currentTab?.path, currentTab?.generationId]);

  const onInternalDragEnd = useCallback((caller: string = 'unknown') => {
    // Plan v7.3: Protected Sticky Sessions.
    // Decouple the UI Lock (clears now) from Data State (clears on drop/next drag).
    const now = Date.now();
    const duration = internalDragStartTimeRef.current ? now - internalDragStartTimeRef.current : 0;

    console.log(`[DND-LOG] [${now}] Global UI Lock RELEASED (via ${caller}). Current dragging state persists. Duration: ${duration}ms`);

    if (internalDragTimeoutRef.current) {
      clearTimeout(internalDragTimeoutRef.current);
      internalDragTimeoutRef.current = null;
    }

    // Set drop cooldown to filter out OS "ecos" (Post-Drop Spikes)
    lastInternalDropTimeRef.current = now;
    lastInternalLockReleaseTimeRef.current = now;

    // Clear Global Handshake Lock
    // @ts-ignore
    window.__SPEED_EXPLORER_DND_LOCK = false;
    dragCounterRef.current = 0;
  }, []);

  // === Main Drag & Drop Listener (runs ONCE on mount) ===
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let isMounted = true;

    // 1. HTML5 handlers to unblock the cursor
    const getCentralPanelRect = () => {
      if (!centralPanelRef.current) return null;
      const rect = centralPanelRef.current.getBoundingClientRect();
      return {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current++;
      const now = Date.now();

      // GHOST FILTER (v7.2): If buttons === 0, it's an OS-generated echo event from a previous drop.
      if (e.buttons === 0) {
        return;
      }

      // HANDSHAKE LOCK (v5.0): Synchronous check to avoid React state latency
      // @ts-ignore
      const isInternalLock = window.__SPEED_EXPLORER_DND_LOCK === true;

      // ORPHAN RECOVERY (v7.3): If state is active but lock is off, check if we are in the Sticky phase.
      if (!isInternalLock && isInternalDraggingRef.current) {
        const timeSinceLockRelease = now - lastInternalLockReleaseTimeRef.current;
        if (timeSinceLockRelease > 500) {
          // console.log(`[DND-LOG] [${now}] Recovering from orphan internal state (Stale: ${timeSinceLockRelease}ms).`);
          isInternalDraggingRef.current = false;
          internalDraggedPathsRef.current = [];
        } else {
          // PROTECTED STICKY WINDOW: Don't clean up yet, we are likely moving towards a drop.
          // console.log(`[DND-LOG] [${now}] Maintaining sticky state (Fresh: ${timeSinceLockRelease}ms).`);
        }
      }

      const isCooldownActive = now - lastInternalDropTimeRef.current < 2500;
      const hasFiles = Array.from(e.dataTransfer?.types || []).includes('Files');

      // console.log(`[DND-LOG] [${now}] dragenter | Internal: ${isInternalDraggingRef.current} | Lock: ${isInternalLock} | Cooldown: ${isCooldownActive} (Last drop: ${now - lastInternalDropTimeRef.current}ms ago)`);

      // STRICT GUARD (v7.2):
      if (isInternalLock || isInternalDraggingRef.current || isCooldownActive || !hasFiles) {
        return;
      }

      // Only show overlay on the FIRST dragenter (0 -> 1)
      if (dragCounterRef.current === 1) {
        // console.log(`[DND-LOG] [${now}] SHOW OVERLAY TRIGGERED`);
        invoke('show_overlay', { rect: getCentralPanelRect() }).catch(() => { });
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.buttons === 0) return; // Ghost event

      // @ts-ignore
      const isInternalLock = window.__SPEED_EXPLORER_DND_LOCK === true;

      if (e.dataTransfer) {
        if (isInternalLock || isInternalDraggingRef.current) {
          e.dataTransfer.dropEffect = 'copy';
        } else {
          e.dataTransfer.dropEffect = 'none';
        }
      }

      const now = Date.now();
      const isCooldownActive = now - lastInternalDropTimeRef.current < 2500;

      // MOVEMENT PULSE (v6.0): Keep state alive while moving
      if (isInternalLock || isInternalDraggingRef.current) {
        if (internalDragTimeoutRef.current) {
          clearTimeout(internalDragTimeoutRef.current);
        }

        internalDragTimeoutRef.current = setTimeout(() => {
          if (isInternalDraggingRef.current) {
            // console.warn(`[DND-LOG] [${Date.now()}] Internal drag movement timeout (5s pulse) reached.`);
            // Explicitly clear everything on timeout
            isInternalDraggingRef.current = false;
            internalDraggedPathsRef.current = [];
            // @ts-ignore
            window.__SPEED_EXPLORER_DND_LOCK = false;
          }
        }, 5000); // 5s pulse (Plan v6.0)
        return;
      }

      if (isCooldownActive) return;

      const hasFiles = Array.from(e.dataTransfer?.types || []).includes('Files');
      if (!hasFiles) return;

      // Heartbeat: Keep app+overlay at front together (unified unit)
      if (now - lastShowOverlayRef.current > 150) {
        // Heartbeat log removed for performance
        lastShowOverlayRef.current = now;
        invoke('show_overlay', { rect: getCentralPanelRect() }).catch(() => { });
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      const now = Date.now();

      if (isInternalDraggingRef.current) {
        const paths = internalDraggedPathsRef.current;
        const targetPath = currentPathRef.current;
        // console.log(`[DND-LOG] [${now}] Internal drop detected. Paths:`, paths, 'to target:', targetPath);

        // DATA CLEANUP (v7.2): Clear internal state now that we've captured the paths for the drop.
        isInternalDraggingRef.current = false;
        internalDraggedPathsRef.current = [];
        internalDragStartTimeRef.current = 0;
        lastInternalDropTimeRef.current = now;

        if (paths.length > 0 && targetPath && targetPath !== '' && targetPath !== 'shell:RecycleBin') {
          // BATCH-RELEASE SYNC (v8.0): Wait 50ms to let the OS finish processing the mouse-up/drop
          // before we hit the backend which will disable the window for modality.
          setTimeout(async () => {
            try {
              await invoke('drop_items', {
                files: paths,
                targetPath: targetPath
              });
              // Invalidate cache for destination
              invalidateCachedSize(targetPath);
              // Invalidate cache for sources (if they were folders or files whose parents change)
              paths.forEach(p => {
                const parent = p.substring(0, p.lastIndexOf('\\'));
                if (parent) invalidateCachedSize(parent.endsWith(':') ? parent + '\\' : parent);
              });
              refreshCurrentTabRef.current();
            } catch (error) {
              console.error('[App] Failed to drop items command (internal):', error);
            }
          }, 50);
        }
      }
    };

    const handleDragLeave = (_e: DragEvent) => {
      if (dragCounterRef.current > 0) {
        dragCounterRef.current--;
      }
      // DragLeave log removed for brevity
    };

    const handleDragEnd = () => {
      // NOTE: In v4.0, we ignore dragend for internal state to avoid premature resets.
      // The 5s timeout or a Drop event are the only ways out.
    };


    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragend', handleDragEnd);

    // 2. Tauri event listener (registered ONCE)
    import('@tauri-apps/api/event').then(({ listen }) => {
      if (!isMounted) return;

      listen<string[]>('app:file-drop', async (event) => {
        const now = Date.now();
        const paths = event.payload;
        console.log('[APP] app:file-drop RECEIVED. Paths:', paths, 'Time since last:', now - lastProcessedDropRef.current);

        // Temporal Deduplication (Ignore repeat events within 500ms)
        if (now - lastProcessedDropRef.current < 500) {
          console.warn('[APP] Ignoring duplicate/bouncing drop event (within 500ms)');
          return;
        }
        lastProcessedDropRef.current = now;

        const targetPath = currentPathRef.current; // Read from ref, not closure
        console.log('[APP] Processing drop to targetPath:', targetPath);

        if (paths.length > 0 && targetPath && targetPath !== '' && targetPath !== 'shell:RecycleBin') {
          try {
            console.log(`[APP] [${now}] Invoking drop_items for ${paths.length} files to: ${targetPath}`);
            const result = await invoke('drop_items', {
              files: paths,
              targetPath: targetPath
            });
            // Invalidate cache for destination
            invalidateCachedSize(targetPath);
            // Invalidate cache for sources
            paths.forEach(p => {
              const parent = p.substring(0, p.lastIndexOf('\\'));
              if (parent) invalidateCachedSize(parent.endsWith(':') ? parent + '\\' : parent);
            });
            console.log(`[APP] [${now}] drop_items success result:`, result);
            refreshCurrentTabRef.current(); // Call current ref value
          } catch (error) {
            console.error(`[APP] [${now}] Failed to drop items command:`, error);
          }
        } else {
          console.warn(`[APP] [${now}] Drop rejected: Invalid targetPath or empty paths. Target: "${targetPath}", Paths count: ${paths.length}`);
        }
      }).then(fn => {
        if (!isMounted) {
          fn();
          return;
        }
        unlistenFn = fn;
      });
    });

    return () => {
      isMounted = false;
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragend', handleDragEnd);
      if (unlistenFn) unlistenFn();
    };
  }, []); // Empty deps = runs ONCE on mount, never re-registers


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
    const themes = ['neon', 'emerald', 'sunset', 'cyber', 'monochrome'];
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
        refreshCurrentTab(true); // Auto-refresh (subject to cooldown)
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
    let unMoved: () => void;
    let unResized: () => void;
    win.onMoved(() => triggerRefresh()).then(fn => { unMoved = fn; });
    win.onResized(() => triggerRefresh()).then(fn => { unResized = fn; });

    return () => {
      window.removeEventListener('focus', handleFocus);
      if (focusTimeout) window.clearTimeout(focusTimeout);
      if (unMoved) unMoved();
      if (unResized) unResized();
    };
  }, [fetchRecycleBinStatus, refreshCurrentTab]);

  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, file: FileEntry | null, fromSidebar?: boolean } | null>(null);
  const [inputContextMenu, setInputContextMenu] = useState<{ x: number, y: number, target: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [canPaste, setCanPaste] = useState(false);
  const [clipboardInfo, setClipboardInfo] = useState<ClipboardInfo | null>(null);
  const [clipboardPopup, setClipboardPopup] = useState<{ x: number, y: number } | null>(null);
  const [lastCutPaths, setLastCutPaths] = useState<string[]>([]);
  const [showQuickPreview, setShowQuickPreview] = useState(false);
  const [forceScrollToSelected, setForceScrollToSelected] = useState(0);

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

  // Info Panel visibility toggle (persisted)
  const [infoPanelVisible, setInfoPanelVisible] = useState(() => {
    const saved = localStorage.getItem('speedexplorer-info-panel-visible');
    return saved !== null ? saved === 'true' : true;
  });

  const toggleInfoPanel = useCallback(() => {
    setInfoPanelVisible(prev => {
      const next = !prev;
      localStorage.setItem('speedexplorer-info-panel-visible', String(next));
      return next;
    });
  }, []);

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

  const handleRestore = async (paths: string[]) => {
    try {
      await invoke('restore_items', { paths });
      if (currentTab) {
        await loadFilesForTab(currentTab.id, currentTab.path);
      }
    } catch (err: any) {
      if (currentTab) {
        updateTab(currentTab.id, { error: String(err) });
      }
    }
  };

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

  const pasteTitle = useMemo(() => {
    const base = t('toolbar.paste');
    if (!canPaste || !clipboardInfo) return base;
    if (clipboardInfo.has_image) return `${base}\n${t('toolbar.paste_image')}`;
    if (!clipboardInfo.has_files || !clipboardInfo.paths.length) return base;

    const counts: Record<string, number> = {};
    for (const p of clipboardInfo.paths) {
      const name = p.split('\\').pop() ?? '';
      const dotIdx = name.lastIndexOf('.');
      const key = dotIdx > 0 ? name.slice(dotIdx + 1).toUpperCase() : t('files.folder');
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const groups = Object.entries(counts);
    if (groups.length > 4) {
      return `${base}\n${clipboardInfo.file_count} ${t('files.items')}`;
    }
    return `${base}\n${groups.map(([ext, n]) => `${n} ${ext}`).join('\n')}`;
  }, [canPaste, clipboardInfo, t]);

  // Load initial files - delegated to hook (init in hook state or effect if needed, but here we can just ensure at least one load)
  useEffect(() => {
    if (tabs.length > 0 && tabs[0].files.length === 0) {
      loadFilesForTab(tabs[0].id, tabs[0].path);
    }
  }, []);

  // Memoize filtered and sorted files
  const sortedFiles = useMemo(() => {
    if (!currentTab) return [];

    const filtered = currentTab.files.filter(f =>
      f.name.toLowerCase().includes((currentTab.searchQuery || '').toLowerCase())
    );

    return [...filtered].sort((a, b) => {
      // Folders always first
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;

      // SPECIFIC DRIVE SORTING (v12.5): Ensure ThisPC matches Sidebar (C: first, then D, E...)
      // Drives are uniquely identified by file_type === 'Drive'
      const isADrive = a.file_type === 'Drive';
      const isBDrive = b.file_type === 'Drive';
      
      if (isADrive && isBDrive) {
        // 1. System Drive always first
        if (a.disk_info?.is_system && !b.disk_info?.is_system) return -1;
        if (!a.disk_info?.is_system && b.disk_info?.is_system) return 1;
        
        // 2. Alphabetical by path (C:\, D:\, etc.) to ignore labels/nicknames
        return collator.compare(a.path, b.path);
      }

      const { column, direction } = currentTab.sortConfig || defaultSortConfig;
      let comparison = 0;

      if (column === 'size') {
        comparison = a.size - b.size;
      } else if (column === 'modified_at') {
        comparison = (a.modified_timestamp || 0) - (b.modified_timestamp || 0);
      } else if (column === 'created_at') {
        // @ts-ignore - Field was added to backend and TS bindings
        comparison = (a.created_timestamp || 0) - (b.created_timestamp || 0);
      } else {
        // O(1) instant locale comparison via Intl singleton
        comparison = collator.compare(String(a[column] || ''), String(b[column] || ''));
      }

      // STABILITY FALLBACK: If values are equal, sort by name
      if (comparison === 0 && column !== 'name') {
        comparison = collator.compare(a.name, b.name);
      }

      return direction === 'asc' ? comparison : -comparison;
    });
  }, [currentTab?.files, currentTab?.searchQuery, currentTab?.sortConfig, defaultSortConfig]);
  
  // Auto-scroll to selection effect
  useEffect(() => {
    if (currentTab && !currentTab.loading && currentTab.shouldScrollToSelection && currentTab.selectedFiles.length > 0) {
      const targetPath = currentTab.selectedFiles[0].path;
      const index = sortedFiles.findIndex(f => f.path === targetPath);
      
      if (index !== -1) {
        updateTab(currentTab.id, { 
          scrollIndex: index,
          shouldScrollToSelection: false 
        });
      } else {
        updateTab(currentTab.id, { shouldScrollToSelection: false });
      }
    } else if (currentTab && !currentTab.loading && currentTab.shouldScrollToSelection) {
      // If no selection but flag is set, reset it
      updateTab(currentTab.id, { shouldScrollToSelection: false });
    }
  }, [currentTab?.loading, currentTab?.shouldScrollToSelection, currentTab?.selectedFiles, currentTab?.id, sortedFiles, updateTab]);

  /* Wrapper for Sort to also update global default locally */
  const handleSort = useCallback((column: SortColumn) => {
    const newSortConfig = hookHandleSort(column);
    if (newSortConfig) {
      setDefaultSortConfig(newSortConfig);
      localStorage.setItem('speedexplorer-sort', JSON.stringify(newSortConfig));
    }
  }, [hookHandleSort]);

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
    }
    setIsEditingPath(false);
  };

  const handleContextMenu = (e: React.MouseEvent, file: FileEntry | null) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, file, fromSidebar: false });

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
    const isDrive = file.file_type === 'Drive' || (file.path.length <= 3 && file.path.endsWith(':\\'));
    if (isDrive) return; // Disallow drive rename

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
      const isDrive = file.file_type === 'Drive' || (file.path.length <= 3 && file.path.endsWith(':\\'));

      await invoke('rename_item', { oldPath: file.path, newName });

      // Invalidate old path to avoid stale cache entries (only relevant if it was a folder)
      invalidateCachedSize(file.path);

      updateTab(currentTab.id, { renamingPath: null });

      if (isDrive) {
        refreshCurrentTab();
      } else {
        const lastSlash = file.path.lastIndexOf('\\');
        let parent = "";
        if (lastSlash === -1) {
          parent = file.path;
        } else {
          parent = file.path.substring(0, lastSlash);
          if (parent.endsWith(':')) parent += '\\';
        }

        const newPath = parent.endsWith('\\') ? parent + newName : parent + '\\' + newName;

        const oldPathLower = file.path.toLowerCase();
        const oldPrefix = oldPathLower + '\\';

        setQuickAccessConfig(prev => {
          let updated = false;
          const newPinned = prev.pinnedFolders.map(folder => {
            const folderPathLower = folder.path.toLowerCase();
            if (folderPathLower === oldPathLower) {
              updated = true;
              return { ...folder, path: newPath, name: folder.id.startsWith('custom-') ? newName : folder.name };
            }
            if (folderPathLower.startsWith(oldPrefix)) {
              updated = true;
              const relative = folder.path.substring(file.path.length);
              return { ...folder, path: newPath + relative };
            }
            return folder;
          });

          if (updated) {
            const newConfig = { pinnedFolders: newPinned };
            localStorage.setItem('speedexplorer-config', JSON.stringify(newConfig));
            return newConfig;
          }
          return prev;
        });

        await loadFilesForTab(currentTab.id, parent, undefined, [newPath]);
        refreshTabsViewing(parent);
      }
    } catch (err: any) {
      updateTab(currentTab.id, { error: String(err), renamingPath: null });
    }
  }, [currentTab, updateTab, handleRenameCancel, refreshTabsViewing, loadFilesForTab, refreshCurrentTab]);

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

  const handlePaste = useCallback(async (customTargetPath?: string) => {
    if (!currentTab) return;
    const targetPath = customTargetPath || currentTab.path;

    if (clipboardInfo && !clipboardInfo.has_files && clipboardInfo.has_image) {
      try {
        const newFile = await invoke<FileEntry>('save_clipboard_image', { targetPath });
        if (targetPath === currentTab.path) {
          updateTab(currentTab.id, {
            files: [...currentTab.files, newFile],
            selectedFiles: [newFile],
            lastSelectedFile: newFile
          });
        }
      } catch (err: any) {
        updateTab(currentTab.id, { error: String(err) });
      }
      return;
    }

    try {
      await invoke('paste_items', { targetPath });

      // Invalidate destination and sources
      invalidateCachedSize(targetPath);
      lastCutPaths.forEach(p => invalidateCachedSize(p));

      // Single unified refresh: cover the destination path plus any cut source paths.
      // Previously, separate calls to refreshCurrentTab() + refreshTabsViewing(targetPath)
      // would fire two concurrent list_files calls for the same tab, with the second
      // cancelling the first via the generationId mechanism, resulting in an empty file list.
      const pathsToRefresh = Array.from(new Set([targetPath, ...lastCutPaths]));
      refreshTabsViewing(pathsToRefresh);
      if (lastCutPaths.length > 0) {
        removeItemsFromTabs(lastCutPaths);
        setLastCutPaths([]);
      }
      checkClipboard();
    } catch (err: any) {
      updateTab(currentTab.id, { error: String(err) });
    }
  }, [currentTab, updateTab, refreshTabsViewing, lastCutPaths, clipboardInfo, checkClipboard]);

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
        ? (prev.length > 1 ? prev.filter(c => c !== column) : prev)
        : [...prev, column].sort((a, b) => DEFAULT_COLUMNS.indexOf(a) - DEFAULT_COLUMNS.indexOf(b));

      localStorage.setItem('speedexplorer-columns', JSON.stringify(newColumns));
      return newColumns;
    });
  }, []);


  const handleDelete = async (files: FileEntry[], silent: boolean = false) => {
    if (files.length === 0) return;

    let confirmed = silent;
    if (!silent) {
      const message = files.length === 1
        ? t('preview.delete_conf_msg').replace('{name}', files[0].name)
        : t('preview.delete_conf_msg').replace('{name}', `${files.length} ${t('files.items')}`);

      confirmed = await ask(message, {
        title: t('preview.delete_conf_title'),
        kind: 'warning',
      });
    }

    if (confirmed && currentTab) {
      try {
        const deletedPaths = files.map(f => f.path);
        await invoke('delete_items', { paths: deletedPaths, silent });

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

        const parents = Array.from(new Set(files.map(f => {
          const lastSlash = f.path.lastIndexOf('\\');
          if (lastSlash === -1) return f.path;
          let parent = f.path.substring(0, lastSlash);
          if (parent.endsWith(':')) parent += '\\';
          return parent;
        })));
        refreshTabsViewing(parents);
        removeItemsFromTabs(deletedPaths);
        parents.forEach(p => invalidateCachedSize(p));
        fetchRecycleBinStatus();
      } catch (err: any) {
        updateTab(currentTab.id, { error: String(err) });
      }
    }
  };

  const handleEmptyRecycleBin = async () => {
    const confirmed = await ask(t('context_menu.empty_recycle_bin') + '?', {
      title: t('preview.delete_conf_title'),
      kind: 'warning',
    });

    if (confirmed) {
      try {
        await invoke('empty_recycle_bin');
        refreshTabsViewing('shell:RecycleBin');
        invalidateCachedSize('shell:RecycleBin');
        fetchRecycleBinStatus();
      } catch (err: any) {
        if (currentTab) updateTab(currentTab.id, { error: String(err) });
      }
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
        const movedPaths = selectedFiles.map(f => f.path);
        await invoke('move_items', { paths: movedPaths, targetPath });
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
        removeItemsFromTabs(movedPaths);
        loadFilesForTab(tabId, targetPath);
      } catch (err: any) {
        updateTab(currentTab.id, { error: String(err) });
      }
      return;
    }

    if (action === 'delete') {
      handleDelete(selectedFiles, false);
      return;
    } else if (action === 'copy') {
      handleCopy(selectedFiles);
      return;
    } else if (action === 'cut') {
      handleCut(selectedFiles);
      return;
    } else if (action === 'restore') {
      handleRestore(selectedFiles.map(f => f.path));
      return;
    }

    if (!file) {
      if (action === 'paste') {
        handlePaste();
      } else if (action === 'properties') {
        if (currentTab) invoke('show_item_properties', { path: currentTab.path });
      } else if (action === 'open-terminal') {
        invoke('open_terminal', { path: currentTab.path });
      }
      return;
    }

    if (action === 'open') {
      if (file.is_dir) navigateTo(file.path);
      else invoke('open_file', { path: file.path });
    } else if (action === 'open-with' && file) {
      invoke('open_with', { path: file.path });
    } else if (action === 'open-location') {
      if (file.is_shortcut) {
        invoke<string>('resolve_shortcut', { path: file.path }).then(targetPath => {
          const parent = targetPath.substring(0, targetPath.lastIndexOf('\\'));
          if (parent) navigateTo(parent);
        }).catch((err: any) => {
          updateTab(currentTab.id, { error: String(err) });
        });
      } else {
        const parent = file.path.substring(0, file.path.lastIndexOf('\\'));
        if (parent) {
          // Open location in a new tab and select the file
          addTab(parent, true, [file.path]);
        }
      }
    } else if (action === 'copy-path') {
      navigator.clipboard.writeText(file.path);
    } else if (action === 'properties') {
      invoke('show_item_properties', { path: file.path });
    } else if (action === 'paste') {
      if (file.is_dir) handlePaste(file.path);
      else handlePaste();
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
    } else if (action === 'extract-here' && file) {
      try {
        const parentDir = file.path.substring(0, file.path.lastIndexOf('\\'));
        await invoke('extract_archive', { archivePath: file.path, targetDir: parentDir || currentTab.path });
        refreshCurrentTab();
      } catch (err: any) {
        updateTab(currentTab.id, { error: String(err) });
      }
    }
  };


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

        if (showQuickPreview) {
          setShowQuickPreview(false);
          setForceScrollToSelected(p => p + 1);
          handled = true;
        } else if (currentTab?.renamingPath) {
          handleRenameCancel();
          handled = true;
        } else if (currentTab?.isDeepSearching || currentTab?.isDeepSearchResultsActive || (currentTab?.searchQuery && currentTab?.searchQuery.length > 0)) {
          // Rule: If we are searching (deep or local), ESC returns to the current folder view and cancels backend tasks
          setDeepSearchDetailStatus(""); // Ensure status is cleared
          navigateTo(currentTab.path);
          handled = true;
        } else if (deepSearchDetailStatus) {
          // If we are showing a "Finished" status but results are not active anymore (or we are in a normal folder)
          setDeepSearchDetailStatus("");
          handled = true;
        } else {
          if (currentTab?.selectedFiles && currentTab.selectedFiles.length > 0) {
            handleClearSelection();
            handled = true;
          }
        }

        if (handled) {
          e.preventDefault();
        }
        return;
      }

      // Quick Preview on Space
      if (e.key === ' ' && !currentTab?.renamingPath && !isEditingPath && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault(); // Prevent scrolling
        if (showQuickPreview) {
          setShowQuickPreview(false);
          setForceScrollToSelected(p => p + 1);
        } else if (currentTab?.selectedFiles.length === 1 && isPreviewable(currentTab.selectedFiles[0])) {
          setShowQuickPreview(true);
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
      if (autoSearchOnKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && e.key !== ' ' && !currentTab?.renamingPath && !isEditingPath) {
        if (currentTab) {
          searchInputRef.current?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addTab, closeTab, tabs.length, activeTabId, currentTab, refreshCurrentTab, autoSearchOnKey, sortedFiles, navigateTo, showQuickPreview, isEditingPath, handleRenameCancel, handleClearSelection, handleCopy, handleCut, handlePaste, handleSelectAll, handleDelete, handleRename]);

  // Duplicate handlers below removed


  const handleSidebarContextMenu = (e: React.MouseEvent, path: string, name: string) => {
    e.preventDefault();
    const mockFile: FileEntry = {
      name,
      path,
      is_dir: true,
      size: 0,
      formatted_size: '',
      file_type: (path.length <= 3 && path.endsWith(':\\')) ? 'Drive' : 'Folder',
      created_at: '',
      modified_at: '',
      is_shortcut: false,
      disk_info: null,
      modified_timestamp: 0,
      created_timestamp: 0,
      dimensions: null
    };
    setContextMenu({ x: e.clientX, y: e.clientY, file: mockFile, fromSidebar: true });

    if (currentTab) {
      updateTab(currentTab.id, {
        selectedFiles: [mockFile],
        lastSelectedFile: mockFile
      });
    }
  };

  const saveConfig = (newConfig: QuickAccessConfig, newSortConfig?: SortConfig, newShowHidden?: boolean, newAutoSearch?: boolean, newFocusNewTab?: boolean, newToolbarMode?: ToolbarMode, closePanel = true) => {
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
    if (newToolbarMode !== undefined) {
      setToolbarMode(newToolbarMode);
      localStorage.setItem('speedexplorer-toolbar-mode', newToolbarMode);
    }
    if (closePanel) {
      setShowSettings(false);
    }
  };

  const handleResetSettings = async () => {
    const confirmed = await ask('¿Estás seguro de que deseas restaurar todos los ajustes a sus valores por defecto? Esta acción borrará todas tus personalizaciones.', {
      title: 'Quick Explorer',
      kind: 'warning',
    });

    if (confirmed) {
      localStorage.removeItem('speedexplorer-config');
      localStorage.removeItem('speedexplorer-sort');
      localStorage.removeItem('speedexplorer-hidden');
      localStorage.removeItem('speedexplorer-autosearch');
      localStorage.removeItem('speedexplorer-theme');
      localStorage.removeItem('speedexplorer-focus-new-tab');
      localStorage.removeItem('speedexplorer-toolbar-mode');

      setDefaultSortConfig({ column: 'name', direction: 'asc' });
      setShowHiddenFiles(false);
      setAutoSearchOnKey(true);
      setFocusNewTabOnMiddleClick(false);
      setToolbarMode('dynamic');
      setTheme('neon');
      await fetchSystemPaths(true);
      setShowSettings(false);
    }
  };




  const breadcrumbs = useMemo(() => {
    if (!currentTab) return [];
    if (currentTab.path === 'shell:RecycleBin') return [
      { label: t('sidebar.this_pc'), path: '' },
      { label: t('sidebar.recycle_bin'), path: 'shell:RecycleBin' }
    ];

    const parts = currentTab.path.split('\\').filter(Boolean);
    const crumbs = [{ label: t('sidebar.this_pc'), path: '' }];

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
  }, [currentTab, t]);


  // Placeholder for handleContextMenuAction, handleDelete, etc. which are now consolidated above

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

  const handleOpenPreview = useCallback((file: FileEntry) => {
    if (isPreviewable(file)) {
      handleSelectMultiple([file], file);
      setShowQuickPreview(true);
    }
  }, [handleSelectMultiple]);

  const handleQuickPreviewNavigate = useCallback((direction: 'next' | 'prev') => {
    if (!currentTab || currentTab.selectedFiles.length !== 1) return;

    const previewableFiles = sortedFiles.filter(f => isPreviewable(f));
    if (previewableFiles.length === 0) return;

    const currentFile = currentTab.selectedFiles[0];
    const currentIndex = previewableFiles.findIndex(f => f.path === currentFile.path);

    let nextFile;
    if (currentIndex === -1) {
      // If current is somehow not in the previewable list, find the next/prev relative to it in the full list
      const currentIndexInFull = sortedFiles.findIndex(f => f.path === currentFile.path);
      if (direction === 'next') {
        nextFile = sortedFiles.slice(currentIndexInFull + 1).find(f => isPreviewable(f)) || previewableFiles[0];
      } else {
        nextFile = [...sortedFiles.slice(0, currentIndexInFull)].reverse().find(f => isPreviewable(f)) || previewableFiles[previewableFiles.length - 1];
      }
    } else {
      const newIndex = direction === 'next'
        ? (currentIndex + 1) % previewableFiles.length
        : (currentIndex - 1 + previewableFiles.length) % previewableFiles.length;
      nextFile = previewableFiles[newIndex];
    }

    if (nextFile) {
      updateTab(currentTab.id, {
        selectedFiles: [nextFile],
        lastSelectedFile: nextFile
      });
    }
  }, [currentTab, sortedFiles, updateTab]);

  const handleQuickPreviewDelete = async (): Promise<boolean> => {
    if (!currentTab || currentTab.selectedFiles.length !== 1) return false;
    const currentFile = currentTab.selectedFiles[0];

    const confirmed = await ask(t('preview.delete_conf_msg').replace('{name}', currentFile.name), {
      title: t('preview.delete_conf_title'),
      kind: 'warning',
    });

    if (confirmed) {
      try {
        await invoke('delete_items', { paths: [currentFile.path], silent: false });

        const currentIndex = sortedFiles.findIndex(f => f.path === currentFile.path);
        let nextFile = null;
        if (currentIndex !== -1 && sortedFiles.length > 1) {
          nextFile = currentIndex < sortedFiles.length - 1 ? sortedFiles[currentIndex + 1] : sortedFiles[currentIndex - 1];
        }

        const lastSlash = currentFile.path.lastIndexOf('\\');
        let parent = currentFile.path;
        if (lastSlash !== -1) {
          parent = currentFile.path.substring(0, lastSlash);
          if (parent.endsWith(':')) parent += '\\';
        }
        refreshTabsViewing([parent]);
        removeItemsFromTabs([currentFile.path]);
        invalidateCachedSize(parent);
        fetchRecycleBinStatus();

        if (nextFile) {
          updateTab(currentTab.id, {
            selectedFiles: [nextFile],
            lastSelectedFile: nextFile
          });
        } else {
          setShowQuickPreview(false);
        }
        return true;
      } catch (err: any) {
        updateTab(currentTab.id, { error: String(err) });
        return false;
      }
    }
    return false;
  };

  const debouncedSelectedFiles = useDebouncedValue(currentTab?.selectedFiles || [], 100);

  useEffect(() => {
    const handleDefaultContextMenu = (e: MouseEvent) => {
      // If we clicked on an input, show our custom context menu instead of native chromium menu
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        e.preventDefault();
        setInputContextMenu({
          x: e.clientX,
          y: e.clientY,
          target: e.target
        });
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('contextmenu', handleDefaultContextMenu);
    return () => window.removeEventListener('contextmenu', handleDefaultContextMenu);
  }, []);

  const handleInputContextMenuAction = async (action: 'cut' | 'copy' | 'paste' | 'select-all' | 'paste-and-go') => {
    if (!inputContextMenu) return;
    const { target } = inputContextMenu;

    // We must focus the input first so execCommand works on its selection
    target.focus();

    if (action === 'select-all') {
      target.select();
    } else if (action === 'copy') {
      document.execCommand('copy');
    } else if (action === 'cut') {
      document.execCommand('cut');
    } else if (action === 'paste') {
      try {
        const text = await invoke<string>('get_clipboard_text');
        const start = target.selectionStart || 0;
        const end = target.selectionEnd || 0;
        const value = target.value;
        const newValue = value.substring(0, start) + text + value.substring(end);

        // Use native value setter for React onChange to fire
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        nativeInputValueSetter?.call(target, newValue);

        const event = new Event('input', { bubbles: true });
        target.dispatchEvent(event);

        // Restore cursor position
        setTimeout(() => {
          target.setSelectionRange(start + text.length, start + text.length);
        }, 0);
      } catch (err) {
        console.error("Failed to paste from clipboard", err);
      }
    } else if (action === 'paste-and-go') {
      try {
        const text = await invoke<string>('get_clipboard_text');
        navigateTo(text);
        setIsEditingPath(false);
      } catch (err) {
        console.error("Failed to paste and go", err);
      }
    }
  };

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
          toolbarMode={toolbarMode}
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



          <main className="flex-1 flex flex-col min-w-0 bg-[var(--bg-surface)] transition-all duration-300">
            {/* Tab Bar */}
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onTabClick={switchTab}
              onTabClose={closeTab}
              onNewTab={() => addTab()}
            /* onReorder={(reorderedTabs: Tab[]) => {
              reorderTabs(reorderedTabs);
            }} */
            />

            {/* Navigation Bar */}
            <header className="h-14 flex items-center px-4 gap-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSettings(true)}
                  className="p-1 rounded-lg hover:bg-white/10 text-zinc-300 hover:text-white transition-all active:scale-95"
                  title={t('toolbar.settings')}
                >
                  <SettingsIcon size={18} />
                </button>

                <button
                  onClick={cycleTheme}
                  className="p-1 rounded-lg hover:bg-white/10 text-zinc-300 hover:text-white transition-all active:scale-95 group relative"
                  title={t('toolbar.change_theme')}
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
                  title={t('toolbar.up')}
                >
                  <ArrowUp size={18} />
                </button>
                <button
                  onClick={() => {
                    refreshCurrentTab(false);
                  }}
                  disabled={currentTab?.isDeepSearching || currentTab?.isDeepSearchResultsActive}
                  className={cn(
                    "p-2 rounded-lg transition-all",
                    (currentTab?.isDeepSearching || currentTab?.isDeepSearchResultsActive) 
                      ? "text-zinc-500 cursor-not-allowed opacity-50" 
                      : "hover:bg-white/10 text-zinc-300"
                  )}
                  title={(currentTab?.isDeepSearching || currentTab?.isDeepSearchResultsActive) ? t('toolbar.refresh_locked') : t('toolbar.refresh')}
                >
                  <RotateCw size={18} className={(currentTab?.loading && !currentTab?.isDeepSearching) ? 'animate-spin' : ''} />
                </button>
              </div>

              {/* Address Bar */}
              <div className="flex-1 h-9 bg-white/[0.03] rounded-lg flex items-center px-3 relative group focus-within:bg-white/[0.06] transition-all">
                {isEditingPath ? (
                  <form onSubmit={handlePathSubmit} className="flex-1 h-full">
                    <input
                      id="address-bar-input"
                      autoFocus
                      className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-400 outline-none font-mono"
                      value={pathInput}
                      onChange={(e) => setPathInput(e.target.value)}
                      onBlur={() => setIsEditingPath(false)}
                      onFocus={(e) => e.currentTarget.select()}
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
                          {index > 0 && <ChevronRight size={14} className="text-zinc-600 mx-1" />}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigateTo(crumb.path);
                            }}
                            className={`text-sm px-3 py-1 rounded-full transition-all truncate max-w-[150px]
                              ${index === breadcrumbs.length - 1
                                ? 'bg-[var(--accent-primary)]/20 text-white font-medium shadow-[0_0_10px_rgba(var(--accent-rgb),0.2)]'
                                : 'text-zinc-300 hover:bg-white/10 hover:text-white'
                              }
                            `}
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
                className="h-9 bg-white/[0.03] rounded-lg flex items-center px-3 relative transition-all focus-within:bg-white/[0.06]"
                style={{ width: searchBarWidth }}
              >
                <Search size={14} className="text-zinc-400 mr-2 shrink-0" />
                <input
                  ref={searchInputRef}
                  className="bg-transparent text-sm text-white outline-none w-full placeholder:text-zinc-400"
                  placeholder={t('toolbar.search_placeholder', { count: String(currentTab?.files.length || 0) })}
                  value={currentTab?.searchQuery || ''}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    updateTab(currentTab.id, { 
                      searchQuery: newValue,
                      ...(newValue === '' ? { isDeepSearchResultsActive: false } : {})
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && sortedFiles.length === 1) {
                      const file = sortedFiles[0];
                      if (file.is_dir) navigateTo(file.path);
                      else invoke('open_file', { path: file.path });
                    } else if (e.key === 'Escape') {
                      // Let global handler handle it, but we blur to give focus back to the grid
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

              {/* Deep Search Button */}
              {currentTab?.searchQuery && (
                <DeepSearchButton
                  onDeepSearch={triggerDeepSearch}
                  isSearching={currentTab.isDeepSearching || false}
                  disabled={currentTab.loading}
                />
              )}
            </header>

            {/* Toolbar (Placeholder moved below) */}

            {currentTab?.error && (
              <div className="bg-red-500/10 px-4 py-2 text-xs text-red-400 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                {currentTab.error}
              </div>
            )}

            <div className="flex-1 flex min-h-0">
              <div className="flex-1 flex flex-col min-w-0" ref={centralPanelRef}>
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
                    <div className="h-11 flex items-center px-4 justify-between">
                      {(() => {
                        const isRecycleBin = currentTab?.path === 'shell:RecycleBin';
                        const hasSelection = currentTab && currentTab.selectedFiles.length > 0;

                        return (
                          <div className="flex items-center gap-1.5">
                            {isRecycleBin ? (
                              <button
                                onClick={() => currentTab && handleRestore(currentTab.selectedFiles.map(f => f.path))}
                                disabled={!hasSelection}
                                className={`flex items-center text-sm font-bold transition-all duration-300 group px-2 py-1.5 rounded-md toolbar-btn whitespace-nowrap overflow-hidden
                                  ${hasSelection ? 'text-zinc-100 hover:text-white' : 'text-zinc-500 cursor-not-allowed opacity-50'}`}
                                title={t('toolbar.restore')}
                              >
                                <RotateCcw size={18} className={`shrink-0 transition-all ${hasSelection ? "text-[var(--accent-primary)] group-hover:drop-shadow-[0_0_10px_rgba(var(--accent-rgb),0.5)]" : "text-zinc-500"}`} />
                                <AnimatePresence>
                                  {!isToolbarCompact && (
                                    <motion.span
                                      initial={{ opacity: 0, width: 0, marginLeft: 0 }}
                                      animate={{ opacity: 1, width: 'auto', marginLeft: 8 }}
                                      exit={{ opacity: 0, width: 0, marginLeft: 0 }}
                                      className="overflow-hidden"
                                    >
                                      {t('toolbar.restore')}
                                    </motion.span>
                                  )}
                                </AnimatePresence>
                              </button>
                            ) : (
                               currentTab?.isDeepSearching || deepSearchDetailStatus || (currentTab?.searchQuery && currentTab.searchQuery.length > 0) ? (
                                 <SearchStatusIndicator status={deepSearchDetailStatus || (currentTab?.isDeepSearching ? 'Searching...' : 'Search finished')} />
                               ) : (
                                 <button
                                   onClick={async () => {
                                     if (!currentTab || isRecycleBin) return;
                                     try {
                                       const folderName = await invoke<string>('create_folder', { parentPath: currentTab.path });
                                       const newPath = currentTab.path.endsWith('\\') ? currentTab.path + folderName : currentTab.path + '\\' + folderName;
                                       await loadFilesForTab(currentTab.id, currentTab.path, undefined, [newPath]);
                                       updateTab(currentTab.id, { renamingPath: newPath });
                                     } catch (err: any) {
                                       updateTab(currentTab.id, { error: String(err) });
                                     }
                                   }}
                                   disabled={isRecycleBin}
                                   className={`flex items-center text-sm font-bold transition-all duration-300 group px-2 py-1.5 rounded-md toolbar-btn whitespace-nowrap overflow-hidden
                                     ${isRecycleBin ? 'text-zinc-500 cursor-not-allowed opacity-50' : 'text-zinc-100 hover:text-white'}`}
                                   title={t('toolbar.new_folder')}
                                 >
                                   <svg viewBox="0 0 24 24" fill={isRecycleBin ? "none" : "var(--accent-primary-20, rgba(var(--accent-rgb), 0.2))"} stroke={isRecycleBin ? "currentColor" : "var(--accent-primary)"} strokeWidth="2" className={`w-[18px] h-[18px] transition-all shrink-0 ${!isRecycleBin ? 'group-hover:drop-shadow-[0_0_10px_rgba(var(--accent-rgb),0.5)]' : ''}`}>
                                     <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                   </svg>
                                   <AnimatePresence>
                                     {!isToolbarCompact && (
                                       <motion.span
                                         initial={{ opacity: 0, width: 0, marginLeft: 0 }}
                                         animate={{ opacity: 1, width: 'auto', marginLeft: 8 }}
                                         exit={{ opacity: 0, width: 0, marginLeft: 0 }}
                                         className="overflow-hidden"
                                       >
                                         {t('toolbar.new_folder')}
                                       </motion.span>
                                     )}
                                   </AnimatePresence>
                                 </button>
                               )
                             )}
                            <div className="h-3.5 w-px bg-white/5" />
                            <button
                              onClick={handleSelectAll}
                              disabled={!currentTab || sortedFiles.length === 0}
                              className={`flex items-center text-sm transition-all duration-300 px-2 py-1.5 rounded-md toolbar-btn whitespace-nowrap overflow-hidden
                                        ${currentTab && sortedFiles.length > 0
                                  ? 'bg-[var(--accent-primary)]/10 text-white font-bold'
                                  : 'text-[var(--text-muted)] hover:bg-white/[0.05] hover:text-white'
                              }`}
                              title={t('context_menu.select_all')}
                            >
                              <CheckSquare size={18} className={`shrink-0 ${currentTab && sortedFiles.length > 0 ? "text-[var(--accent-primary)]" : "text-zinc-500"}`} />
                              <AnimatePresence>
                                {!isToolbarCompact && (
                                  <motion.span
                                    initial={{ opacity: 0, width: 0, marginLeft: 0 }}
                                    animate={{ opacity: 1, width: 'auto', marginLeft: 8 }}
                                    exit={{ opacity: 0, width: 0, marginLeft: 0 }}
                                    className="grid shrink-0 overflow-hidden"
                                  >
                                    <span className={`col-start-1 row-start-1 ${currentTab && sortedFiles.length > 0 ? 'font-bold' : 'font-medium'}`}>{t('context_menu.select_all')}</span>
                                    <span className="col-start-1 row-start-1 font-bold invisible" aria-hidden="true">{t('context_menu.select_all')}</span>
                                  </motion.span>
                                )}
                              </AnimatePresence>
                            </button>
                            <button
                              onClick={() => currentTab?.selectedFiles.length > 0 && handleCopy(currentTab.selectedFiles)}
                              disabled={!currentTab || currentTab.selectedFiles.length === 0 || isRecycleBin}
                              className={`flex items-center text-sm transition-all duration-300 px-2 py-1.5 rounded-md toolbar-btn whitespace-nowrap overflow-hidden
                                        ${currentTab && currentTab.selectedFiles.length > 0 && !isRecycleBin
                                  ? 'text-zinc-100 hover:text-white'
                                  : 'text-zinc-500 cursor-not-allowed'}`}
                              title={t('toolbar.copy')}
                            >
                              <Copy size={18} className={`shrink-0 ${currentTab && currentTab.selectedFiles.length > 0 && !isRecycleBin ? "text-[var(--accent-primary)]" : "text-zinc-500"}`} />
                              <AnimatePresence>
                                {!isToolbarCompact && (
                                  <motion.span
                                    initial={{ opacity: 0, width: 0, marginLeft: 0 }}
                                    animate={{ opacity: 1, width: 'auto', marginLeft: 8 }}
                                    exit={{ opacity: 0, width: 0, marginLeft: 0 }}
                                    className="grid shrink-0 overflow-hidden"
                                  >
                                    <span className={`col-start-1 row-start-1 ${currentTab && currentTab.selectedFiles.length > 0 && !isRecycleBin ? 'font-bold' : 'font-medium'}`}>{t('toolbar.copy')}</span>
                                    <span className="col-start-1 row-start-1 font-bold invisible" aria-hidden="true">{t('toolbar.copy')}</span>
                                  </motion.span>
                                )}
                              </AnimatePresence>
                            </button>
                            <button
                              onClick={() => currentTab?.selectedFiles.length > 0 && handleCut(currentTab.selectedFiles)}
                              disabled={!currentTab || currentTab.selectedFiles.length === 0 || isRecycleBin}
                              className={`flex items-center text-sm transition-all duration-300 px-2 py-1.5 rounded-md toolbar-btn whitespace-nowrap overflow-hidden
                                        ${currentTab && currentTab.selectedFiles.length > 0 && !isRecycleBin
                                  ? 'text-zinc-300 hover:text-white'
                                  : 'text-zinc-500 cursor-not-allowed'}`}
                              title={t('toolbar.cut')}
                            >
                              <Scissors size={18} className="shrink-0" />
                              <AnimatePresence>
                                {!isToolbarCompact && (
                                  <motion.span
                                    initial={{ opacity: 0, width: 0, marginLeft: 0 }}
                                    animate={{ opacity: 1, width: 'auto', marginLeft: 8 }}
                                    exit={{ opacity: 0, width: 0, marginLeft: 0 }}
                                    className="grid shrink-0 overflow-hidden"
                                  >
                                    <span className={`col-start-1 row-start-1 ${currentTab && currentTab.selectedFiles.length > 0 && !isRecycleBin ? 'font-bold' : 'font-medium'}`}>{t('toolbar.cut')}</span>
                                    <span className="col-start-1 row-start-1 font-bold invisible" aria-hidden="true">{t('toolbar.cut')}</span>
                                  </motion.span>
                                )}
                              </AnimatePresence>
                            </button>
                            <button
                              onClick={() => handlePaste()}
                              onContextMenu={handlePasteContextMenu}
                              disabled={!canPaste || isRecycleBin}
                              className={`flex items-center text-sm pl-3 pr-2 py-1.5 rounded-md transition-all duration-300 group/paste toolbar-btn whitespace-nowrap overflow-hidden
                                        ${canPaste && !isRecycleBin
                                  ? 'text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 hover:shadow-[0_0_15px_rgba(var(--accent-rgb),0.3)]'
                                  : 'text-zinc-500 cursor-not-allowed opacity-50'}`}
                              title={pasteTitle}
                            >
                              <PasteIcon size={18} className="shrink-0" />
                              <AnimatePresence>
                                {!isToolbarCompact && (
                                  <motion.span
                                    initial={{ opacity: 0, width: 0, marginLeft: 0 }}
                                    animate={{ opacity: 1, width: 'auto', marginLeft: 10 }}
                                    exit={{ opacity: 0, width: 0, marginLeft: 0 }}
                                    className="grid shrink-0 text-zinc-100 group-hover/paste:text-[var(--accent-primary)] transition-colors overflow-hidden"
                                  >
                                    <span className={`col-start-1 row-start-1 ${canPaste && !isRecycleBin ? 'font-bold' : 'font-medium'}`}>{t('toolbar.paste')}</span>
                                    <span className="col-start-1 row-start-1 font-bold invisible" aria-hidden="true">{t('toolbar.paste')}</span>
                                  </motion.span>
                                )}
                              </AnimatePresence>

                              {/* Content Indicator Chip */}
                              {canPaste && !isRecycleBin && clipboardInfo && (
                                <div className="flex items-center ml-1 animate-in fade-in slide-in-from-right-2 duration-300">
                                  <div className="w-6 h-6 text-[var(--accent-primary)] flex items-center justify-center">
                                    {clipboardInfo.has_image ? (
                                      <ImageIcon size={20} strokeWidth={2.5} />
                                    ) : clipboardInfo.file_count > 1 ? (
                                      <FilesIcon size={20} strokeWidth={2.5} />
                                    ) : (
                                      <FileIcon size={20} strokeWidth={2.5} />
                                    )}
                                  </div>
                                </div>
                              )}
                            </button>
                            <div className="h-3.5 w-px bg-white/5" />
                            <button
                              onClick={(e) => currentTab && currentTab.selectedFiles.length > 0 && handleDelete(currentTab.selectedFiles, e.shiftKey)}
                              disabled={!currentTab || currentTab.selectedFiles.length === 0}
                              className={`flex items-center text-sm transition-all duration-300 px-2 py-1.5 rounded-md toolbar-btn whitespace-nowrap overflow-hidden
                                        ${currentTab && currentTab.selectedFiles.length > 0
                                  ? 'text-red-400 hover:text-red-300'
                                  : 'text-zinc-500 cursor-not-allowed'}`}
                              title={t('toolbar.delete')}
                            >
                              <Trash size={18} className={`shrink-0 ${currentTab && currentTab.selectedFiles.length > 0 ? "text-red-500" : "text-zinc-500"}`} />
                              <AnimatePresence>
                                {!isToolbarCompact && (
                                  <motion.span
                                    initial={{ opacity: 0, width: 0, marginLeft: 0 }}
                                    animate={{ opacity: 1, width: 'auto', marginLeft: 8 }}
                                    exit={{ opacity: 0, width: 0, marginLeft: 0 }}
                                    className="grid shrink-0 overflow-hidden"
                                  >
                                    <span className={`col-start-1 row-start-1 ${currentTab && currentTab.selectedFiles.length > 0 ? 'font-bold' : 'font-medium'}`}>{t('toolbar.delete')}</span>
                                    <span className="col-start-1 row-start-1 font-bold invisible" aria-hidden="true">{t('toolbar.delete')}</span>
                                  </motion.span>
                                )}
                              </AnimatePresence>
                            </button>
                            <div className="h-3.5 w-px bg-white/5" />
                            <button
                              onClick={async () => {
                                if (currentTab && !isRecycleBin) {
                                  try {
                                    await invoke('open_terminal', { path: currentTab.path });
                                  } catch (err) {
                                    updateTab(currentTab.id, { error: String(err) });
                                  }
                                }
                              }}
                              disabled={isRecycleBin}
                              className={`flex items-center text-sm font-bold transition-all duration-300 group px-2 py-1.5 rounded-md whitespace-nowrap overflow-hidden
                                ${isRecycleBin ? 'text-zinc-500 cursor-not-allowed opacity-50' : 'text-zinc-100 hover:text-white hover:bg-white/5'}`}
                              title={t('toolbar.terminal')}
                            >
                              <Terminal size={18} className={`shrink-0 transition-all ${isRecycleBin ? "text-zinc-500" : "text-[var(--accent-primary)] group-hover:drop-shadow-[0_0_8px_var(--accent-primary)]"}`} />
                              <AnimatePresence>
                                {!isToolbarCompact && (
                                  <motion.span
                                    initial={{ opacity: 0, width: 0, marginLeft: 0 }}
                                    animate={{ opacity: 1, width: 'auto', marginLeft: 8 }}
                                    exit={{ opacity: 0, width: 0, marginLeft: 0 }}
                                    className="overflow-hidden"
                                  >
                                    {t('toolbar.terminal')}
                                  </motion.span>
                                )}
                              </AnimatePresence>
                            </button>
                          </div>
                        );
                      })()}

                      <div className="flex items-center gap-1">
                        <button
                          onClick={triggerSizeCalculation}
                          className="p-1.5 rounded-md transition-all hover:bg-white/5 text-zinc-400 hover:text-[var(--accent-primary)]"
                          title={t('toolbar.calculate_sizes')}
                        >
                          <Scale size={16} />
                        </button>
                        <button
                          onClick={clearSizeCache}
                          className="p-1.5 rounded-md transition-all hover:bg-white/5 text-zinc-400 hover:text-red-400"
                          title={t('toolbar.clear_cache')}
                        >
                          <Eraser size={16} />
                        </button>
                        <div className="h-3.5 w-px bg-white/5 mx-1" />
                        <button
                          onClick={() => currentTab && updateTab(currentTab.id, { viewMode: 'list' })}
                          className={`p-1.5 rounded-md transition-all ${currentTab?.viewMode === 'list' ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]' : 'hover:bg-white/5 text-zinc-400'}`}
                          title={t('toolbar.list_view')}
                        >
                          <List size={16} />
                        </button>
                        <button
                          onClick={() => currentTab && updateTab(currentTab.id, { viewMode: 'grid' })}
                          className={`p-1.5 rounded-md transition-all ${currentTab?.viewMode === 'grid' ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]' : 'hover:bg-white/5 text-zinc-400'}`}
                          title={t('toolbar.grid_view')}
                        >
                          <Grid size={16} />
                        </button>
                        <div className="h-3.5 w-px bg-white/5" />
                        <button
                          onClick={toggleInfoPanel}
                          className={`p-1.5 rounded-md transition-all ${infoPanelVisible ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]' : 'hover:bg-white/5 text-zinc-400'}`}
                          title={infoPanelVisible ? t('toolbar.hide_details') : t('toolbar.show_details')}
                        >
                          <PanelRight size={16} />
                        </button>
                      </div>
                    </div>
                    <AnimatePresence mode="popLayout" custom={direction} initial={false}>
                      <motion.div
                        key={activeTabId}
                        custom={direction}
                        variants={{
                          enter: {
                            opacity: 0,
                            scale: 0.98
                          },
                          center: {
                            zIndex: 1,
                            opacity: 1,
                            scale: 1
                          },
                          exit: {
                            zIndex: 0,
                            opacity: 0,
                            scale: 0.98
                          }
                        }}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        transition={{
                          opacity: { duration: 0.25 },
                          scale: { duration: 0.3 }
                        }}
                        style={{ willChange: "transform, opacity" }}
                        className="flex-1 flex flex-col min-h-0 min-w-0"
                      >
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
                            onInternalDragStart={(paths: string[]) => {
                              const now = Date.now();
                              // console.log(`[DND-LOG] [${now}] Internal drag state -> TRUE (FileGrid)`);

                              if (internalDragTimeoutRef.current) {
                                clearTimeout(internalDragTimeoutRef.current);
                              }

                              isInternalDraggingRef.current = true;
                              internalDragStartTimeRef.current = now;
                              internalDraggedPathsRef.current = paths;

                              // Safety Timeout (v6.0): Movement Pulse will keep this alive, 
                              // Initial fail-safe at 30s as per Plan v6.0.
                              internalDragTimeoutRef.current = setTimeout(() => {
                                if (isInternalDraggingRef.current) {
                                  // console.warn(`[DND-LOG] [${Date.now()}] Internal drag safety timeout (30s) reached.`);
                                  onInternalDragEnd('timeout-grid');
                                }
                              }, 30000);
                            }}
                            onInternalDragEnd={onInternalDragEnd}
                            forceScrollToSelected={forceScrollToSelected}
                            initialScrollIndex={currentTab?.scrollIndex || 0}
                            onScrollChange={handleScrollChange}
                            activeTabId={activeTabId}
                            onOpenPreview={handleOpenPreview}
                            onVisibleFilesChange={handleVisibleFilesChange}
                            isDeepSearch={currentTab?.isDeepSearchResultsActive}
                            isSearchActive={!!currentTab?.isDeepSearchResultsActive || (currentTab?.searchQuery !== '')}
                            isDeepSearching={currentTab?.isDeepSearching}
                            deepSearchStatus={currentTab?.deepSearchStatus}
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
                            onInternalDragStart={(paths: string[]) => {
                              const now = Date.now();
                              // console.log(`[DND-LOG] [${now}] Internal drag state -> TRUE (FileTable)`);

                              if (internalDragTimeoutRef.current) {
                                clearTimeout(internalDragTimeoutRef.current);
                              }

                              isInternalDraggingRef.current = true;
                              internalDragStartTimeRef.current = now;
                              internalDraggedPathsRef.current = paths;

                              internalDragTimeoutRef.current = setTimeout(() => {
                                if (isInternalDraggingRef.current) {
                                  // console.warn(`[DND-LOG] [${Date.now()}] Internal drag safety timeout (30s) reached.`);
                                  onInternalDragEnd('timeout-table');
                                }
                              }, 30000);
                            }}
                            onInternalDragEnd={onInternalDragEnd}
                            forceScrollToSelected={forceScrollToSelected}
                            initialScrollIndex={currentTab?.scrollIndex || 0}
                            onScrollChange={handleScrollChange}
                            activeTabId={activeTabId}
                            onOpenPreview={handleOpenPreview}
                            onVisibleFilesChange={handleVisibleFilesChange}
                            isDeepSearch={currentTab?.isDeepSearchResultsActive}
                            isSearchActive={!!currentTab?.isDeepSearchResultsActive || (currentTab?.searchQuery !== '')}
                            isDeepSearching={currentTab?.isDeepSearching}
                            deepSearchStatus={currentTab?.deepSearchStatus}
                          />
                        )}
                      </motion.div>
                    </AnimatePresence>

                    {/* Status Bar */}
                    <footer className="h-7 border-t border-white/5 bg-white/[0.01] flex items-center px-4 shrink-0 select-none">
                      <span className="text-[11px] text-zinc-500 font-medium">
                        {currentTab && currentTab.selectedFiles.length > 0
                          ? `${currentTab.selectedFiles.length} ${t('footer.selected')}`
                          : `${sortedFiles.length} ${sortedFiles.length === 1 ? t('footer.item') : t('footer.items')}`
                        }
                      </span>
                    </footer>
                  </>
                )}
              </div>

              {/* Info Panel Resizer + Panel */}
              {infoPanelVisible && currentTab?.path !== '' && (
                <>
                  <div
                    className={`w-1 cursor-col-resize hover:bg-[var(--accent-primary)]/30 transition-colors z-50 flex-shrink-0 ${isResizing === 'info' ? 'bg-[var(--accent-primary)]/50' : 'bg-white/5'}`}
                    onMouseDown={() => setIsResizing('info')}
                  />
                  <InfoPanel selectedFiles={debouncedSelectedFiles} width={infoPanelWidth} />
                </>
              )}
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
              allowRename={true}

              fromSidebar={contextMenu.fromSidebar}
              recycleBinStatus={recycleBinStatus}
              tabs={tabs}
              activeTabId={activeTabId}
              isDeepSearch={currentTab?.isDeepSearchResultsActive}
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
                  <PasteIcon size={10} /> {t('toolbar.paste')}
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

      {showQuickPreview && currentTab?.selectedFiles.length === 1 && (
        <QuickPreview
          file={currentTab.selectedFiles[0]}
          onClose={() => setShowQuickPreview(false)}
          onNavigate={handleQuickPreviewNavigate}
          onDelete={handleQuickPreviewDelete}
        />
      )}

      {/* Custom Input Context Menu */}
      {inputContextMenu && (
        <InputContextMenu
          x={inputContextMenu.x}
          y={inputContextMenu.y}
          onClose={() => setInputContextMenu(null)}
          onAction={handleInputContextMenuAction}
          showPasteAndGo={inputContextMenu.target.id === 'address-bar-input'}
        />
      )}
    </div>
  );
}


