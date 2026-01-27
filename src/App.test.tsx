import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import SplashScreen from './components/SplashScreen';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
    Rocket: () => <div data-testid="rocket-icon" />,
    Trash: () => <div data-testid="trash-icon" />,
    Trash2: () => <div data-testid="trash2-icon" />,
    // Add other icons as needed
}));

describe('SplashScreen Component', () => {
    it('renders correctly', () => {
        render(<SplashScreen finishLoading={() => { }} />);
        expect(screen.getByText('SpeedExplorer')).toBeDefined();
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
