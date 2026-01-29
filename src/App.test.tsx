import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import SplashScreen from './components/SplashScreen';

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(async (cmd) => {
        if (cmd === 'get_system_default_paths') return {};
        if (cmd === 'get_recycle_bin_status') return { is_empty: true, item_count: 0, total_size: 0 };
        return [];
    }),
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

// Mock ResizeObserver
globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
    Rocket: () => <div data-testid="rocket-icon" />,
    Trash: () => <div data-testid="trash-icon" />,
    Trash2: () => <div data-testid="trash2-icon" />,
    Download: () => <div data-testid="download-icon" />,
    FileText: () => <div data-testid="filetext-icon" />,
    Image: () => <div data-testid="image-icon" />,
    HardDrive: () => <div data-testid="harddrive-icon" />,
    ChevronRight: () => <div data-testid="chevronright-icon" />,
    Monitor: () => <div data-testid="monitor-icon" />,
    ChevronUp: () => <div data-testid="chevronup-icon" />,
    ChevronDown: () => <div data-testid="chevrondown-icon" />,
    Home: () => <div data-testid="home-icon" />,
    Info: () => <div data-testid="info-icon" />,
    Eye: () => <div data-testid="eye-icon" />,
    PlayCircle: () => <div data-testid="playcircle-icon" />,
    Loader2: () => <div data-testid="loader2-icon" />,
    Folder: () => <div data-testid="folder-icon" />,
    File: () => <div data-testid="file-icon" />,
    Search: () => <div data-testid="search-icon" />,
    Settings: () => <div data-testid="settings-icon" />,
    Plus: () => <div data-testid="plus-icon" />,
    X: () => <div data-testid="x-icon" />,
    PanelLeft: () => <div data-testid="panelleft-icon" />,
    PanelRight: () => <div data-testid="panelright-icon" />,
    LayoutGrid: () => <div data-testid="layoutgrid-icon" />,
    List: () => <div data-testid="list-icon" />,
    MoreVertical: () => <div data-testid="morevertical-icon" />,
    ArrowLeft: () => <div data-testid="arrowleft-icon" />,
    ArrowRight: () => <div data-testid="arrowright-icon" />,
    ArrowUp: () => <div data-testid="arrowup-icon" />,
    RotateCw: () => <div data-testid="rotatecw-icon" />,
    Terminal: () => <div data-testid="terminal-icon" />,
    Copy: () => <div data-testid="copy-icon" />,
    Scissors: () => <div data-testid="scissors-icon" />,
    Clipboard: () => <div data-testid="clipboard-icon" />,
    Edit: () => <div data-testid="edit-icon" />,
    Move: () => <div data-testid="move-icon" />,
    Share: () => <div data-testid="share-icon" />,
    ExternalLink: () => <div data-testid="externallink-icon" />,
}));

describe('SplashScreen Component', () => {
    it('renders correctly', () => {
        render(<SplashScreen finishLoading={() => { }} />);
        expect(screen.getByText('Quick Explorer')).toBeDefined();
    });

    it('calls finishLoading after timeout', () => {
        vi.useFakeTimers();
        const finishLoading = vi.fn();
        render(<SplashScreen finishLoading={finishLoading} />);

        // Fast-forward time (1.5s display + 0.5s fade)
        act(() => {
            vi.advanceTimersByTime(2100);
        });

        expect(finishLoading).toHaveBeenCalled();
        vi.useRealTimers();
    });
});

describe('Utility Logic', () => {
    it('sanity check', () => {
        expect(true).toBe(true);
    });
});
