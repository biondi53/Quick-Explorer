import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTabs } from './useTabs';
import { SortConfig, QuickAccessConfig } from '../types';

// Mock Tauri APIs
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: any[]) => mockInvoke(...args),
}));

describe('useTabs Hook - Navigation Logic', () => {
    const initialSort: SortConfig = { column: 'name', direction: 'asc' };
    const quickAccess: QuickAccessConfig = { pinnedFolders: [] };

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockInvoke.mockReset();
    });

    it('should initialize with Home tab', () => {
        const { result } = renderHook(() => useTabs(initialSort, false, quickAccess));
        expect(result.current.tabs).toHaveLength(1);
        expect(result.current.tabs[0].path).toBe('');
    });

    it('should navigate to a new path and update history', async () => {
        mockInvoke.mockResolvedValue([]);
        const { result } = renderHook(() => useTabs(initialSort, false, quickAccess));

        await act(async () => {
            result.current.navigateTo('C:\\Test');
        });

        expect(result.current.currentTab.path).toBe('C:\\Test');
        expect(result.current.currentTab.history).toContain('C:\\Test');
        expect(result.current.currentTab.loading).toBe(false);
    });

    it('should handle "Smart History Jump" when path fails', async () => {
        // Setup: Home -> Valid -> Invalid -> Valid
        mockInvoke
            .mockResolvedValueOnce([]) // Initial (Home)
            .mockResolvedValueOnce([]) // Nav to Valid1
            .mockRejectedValueOnce(new Error('Path not found')) // Nav to Invalid
            .mockResolvedValueOnce([]); // Nav to Valid2

        const { result } = renderHook(() => useTabs(initialSort, false, quickAccess));

        // 1. Nav to Valid1
        await act(async () => {
            result.current.navigateTo('C:\\Valid1');
        });

        // 2. Nav to Invalid
        await act(async () => {
            result.current.navigateTo('C:\\Invalid');
        });

        // 3. Nav to Valid2
        await act(async () => {
            result.current.navigateTo('C:\\Valid2');
        });

        expect(result.current.currentTab.history).toHaveLength(4); // Home, Valid1, Invalid, Valid2
        expect(result.current.currentTab.historyIndex).toBe(3);

        // 4. Go Back (should hit Invalid, fail, and jump to Valid1)
        mockInvoke.mockImplementation(async (_cmd, args) => {
            if (args.path === 'C:\\Invalid') throw new Error('Fail');
            return [];
        });

        await act(async () => {
            result.current.goBack();
        });

        // Wait for potential setTimeouts
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
        });

        expect(result.current.currentTab.path).toBe('C:\\Valid1');
        expect(result.current.currentTab.loading).toBe(false);
    });

    it('should handle overlapping navigation calls without hanging', async () => {
        // Setup: slow invoke
        let resolve1: any;
        let resolve2: any;
        const promise1 = new Promise(r => resolve1 = r);
        const promise2 = new Promise(r => resolve2 = r);

        mockInvoke
            .mockReturnValueOnce(Promise.resolve([])) // Initial load
            .mockReturnValueOnce(promise1) // First call to C:\A
            .mockReturnValueOnce(promise2); // Second call to C:\B

        const { result } = renderHook(() => useTabs(initialSort, false, quickAccess));

        // Start first navigation (Gen 1)
        await act(async () => {
            result.current.navigateTo('C:\\A');
        });
        expect(result.current.currentTab.loading).toBe(true);
        expect(result.current.currentTab.generationId).toBe(1);

        // Start second navigation immediately (Gen 2)
        await act(async () => {
            result.current.navigateTo('C:\\B');
        });
        expect(result.current.currentTab.loading).toBe(true);
        expect(result.current.currentTab.generationId).toBe(2);

        // Resolve first navigation (should be discarded)
        await act(async () => {
            resolve1([]);
            await promise1;
        });
        // Important: after discard, loading MUST still be true because Gen 2 is pending
        expect(result.current.currentTab.loading).toBe(true);

        // Resolve second navigation
        await act(async () => {
            resolve2([]);
            await promise2;
        });
        // Now loading MUST be false
        expect(result.current.currentTab.loading).toBe(false);
        expect(result.current.currentTab.path).toBe('C:\\B');
    });

    it('should clear loading even if navigation fails and is discarded', async () => {
        // Setup: slow invoke that fails
        let reject1: any;
        let resolve2: any;
        const promise1 = new Promise((_, r) => reject1 = r);
        const promise2 = new Promise(r => resolve2 = r);

        mockInvoke
            .mockReturnValueOnce(Promise.resolve([])) // Initial load
            .mockReturnValueOnce(promise1) // First call (will fail)
            .mockReturnValueOnce(promise2); // Second call (succeeds)

        const { result } = renderHook(() => useTabs(initialSort, false, quickAccess));

        await act(async () => {
            result.current.navigateTo('C:\\Fail');
        });
        await act(async () => {
            result.current.navigateTo('C:\\Success');
        });

        // Fail the first one
        await act(async () => {
            reject1(new Error('Network error'));
            try { await promise1; } catch { }
        });
        expect(result.current.currentTab.loading).toBe(true); // Still waiting for second

        // Succeed the second one
        await act(async () => {
            resolve2([]);
            await promise2;
        });
        expect(result.current.currentTab.loading).toBe(false);
    });

    it('should NOT get stuck if refreshCurrentTab is called during navigation', async () => {
        let resolveNav: any;
        let resolveRef: any;
        const pNav = new Promise(r => resolveNav = r);
        const pRef = new Promise(r => resolveRef = r);

        mockInvoke
            .mockReturnValueOnce(Promise.resolve([])) // Initial
            .mockReturnValueOnce(pNav) // Navigation
            .mockReturnValueOnce(pRef); // Refresh

        const { result } = renderHook(() => useTabs(initialSort, false, quickAccess));

        // Start Nav (Gen 1)
        await act(async () => {
            result.current.navigateTo('C:\\Target');
        });

        // Trigger Refresh (Gen 2)
        await act(async () => {
            result.current.refreshCurrentTab();
        });

        expect(result.current.currentTab.generationId).toBe(2);

        // Resolve Nav (Gen 1) -> Discarded
        await act(async () => {
            resolveNav([]);
            await pNav;
        });
        expect(result.current.currentTab.loading).toBe(true);

        // Resolve Refresh (Gen 2) -> Success
        await act(async () => {
            resolveRef([]);
            await pRef;
        });
        expect(result.current.currentTab.loading).toBe(false);
    });
});
