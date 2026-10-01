import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, screen } from '@testing-library/react';
import App from './App';
import { LanguageProvider } from './i18n/LanguageProvider';

const renderApp = () => render(<LanguageProvider><App /></LanguageProvider>);

// Mock Tauri APIs (mirror of Layout.test.tsx + list_files / get_clipboard_info)
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'get_system_default_paths') return {};
        if (cmd === 'get_recycle_bin_status') return { is_empty: true, item_count: 0, total_size: 0 };
        if (cmd === 'list_files') {
            return {
                entries: [
                    { name: 'real.txt', path: 'C:\\test\\real.txt', is_dir: false, size: 10, formatted_size: '10 B', file_type: 'File', created_at: '', modified_at: '', is_shortcut: false, disk_info: null },
                    { name: 'docs', path: 'C:\\test\\docs', is_dir: true, size: 0, formatted_size: '', file_type: 'Folder', created_at: '', modified_at: '', is_shortcut: false, disk_info: null },
                ],
                expanded_path: 'C:\\test',
            };
        }
        if (cmd === 'get_clipboard_info') return { has_files: false, has_image: false, paths: [] };
        return [];
    }),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(() => Promise.resolve(() => { })),
    emit: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        maximize: vi.fn(),
        show: vi.fn(),
        setFocus: vi.fn(),
        isMaximized: vi.fn(() => Promise.resolve(false)),
        onMoved: vi.fn(() => Promise.resolve(() => { })),
        onResized: vi.fn(() => Promise.resolve(() => { })),
        onCloseRequested: vi.fn(() => Promise.resolve(() => { })),
        unlisten: vi.fn(),
    }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    ask: vi.fn(),
}));

// Mock ResizeObserver / IntersectionObserver (real classes: @tanstack/react-virtual does `new ResizeObserver`)
class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver = MockResizeObserver;

class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

// jsdom lacks scrollIntoView (used by TabBar on a timeout)
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});

// jsdom reports 0 layout sizes; @tanstack/react-virtual reads offsetHeight of the
// scroll container, so give elements a non-zero size to let rows render.
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    get() { return 650; }, configurable: true,
});
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    get() { return 900; }, configurable: true,
});

async function openFileMenu() {
    await screen.findAllByText('real.txt');
    const rows = Array.from(document.querySelectorAll('.file-row'));
    const row = rows.find(r => r.textContent?.includes('real.txt')) ?? rows[0];
    if (!row) throw new Error('no .file-row rendered');
    await act(async () => { fireEvent.contextMenu(row, { clientX: 100, clientY: 100, button: 2 }); });
}

describe('ContextMenu regression', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        // Seed a real directory tab so the App renders FileGrid/FileTable (not ThisPCView)
        localStorage.setItem('speedexplorer-tabs', JSON.stringify([{
            id: 'tab-test', path: 'C:\\test', files: [], selectedFiles: [], lastSelectedFile: null,
            sortConfig: { column: 'name', direction: 'asc' }, history: ['C:\\test'], historyIndex: 0,
            loading: false, error: null, isDeepSearching: false, deepSearchStatus: '', searchQuery: '',
            renamingPath: null, generationId: 1, scrollIndex: 0, isDeepSearchResultsActive: false, visibleIndices: [],
        }]));
        localStorage.setItem('speedexplorer-active-tab', 'tab-test');
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1000 });
        Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 800 });
    });

    it('closes the file context menu on outside mousedown', async () => {
        await act(async () => { renderApp(); });
        await openFileMenu();

        expect(screen.getByText('Move to')).toBeTruthy();

        await act(async () => { fireEvent.mouseDown(document.body); });

        expect(screen.queryByText('Move to')).toBeNull();
    });

    it('closes the file context menu on Escape without leaving the empty-state menu', async () => {
        await act(async () => { renderApp(); });
        await openFileMenu();

        expect(screen.getByText('Move to')).toBeTruthy();

        await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });

        expect(screen.queryByText('Move to')).toBeNull();
        expect(screen.queryByText('Properties')).toBeNull();
    });
});
