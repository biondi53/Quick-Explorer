export interface CacheEntry {
    size: number;
    formatted_size: string;
    timestamp: number;
}

type CacheStore = Record<string, CacheEntry>;

const CACHE_KEY = 'speedexplorer-folder-sizes';
const TTL = 2 * 60 * 60 * 1000; // 2 hours in ms

export const getCachedSize = (path: string): CacheEntry | null => {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;

        const store: CacheStore = JSON.parse(raw);
        const entry = store[path];

        if (!entry) return null;

        // Check expiration
        if (Date.now() - entry.timestamp > TTL) {
            return null;
        }

        return entry;
    } catch (e) {
        console.error('[Cache] Error reading from localStorage', e);
        return null;
    }
};

export const setCachedSize = (path: string, size: number, formatted_size: string): void => {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        let store: CacheStore = {};

        if (raw) {
            store = JSON.parse(raw);
        }

        store[path] = {
            size,
            formatted_size,
            timestamp: Date.now()
        };

        localStorage.setItem(CACHE_KEY, JSON.stringify(store));
    } catch (e) {
        console.error('[Cache] Error writing to localStorage', e);
    }
};

export const invalidateCachedSize = (path: string): void => {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return;

        const store: CacheStore = JSON.parse(raw);
        if (store[path]) {
            delete store[path];
            localStorage.setItem(CACHE_KEY, JSON.stringify(store));
        }
    } catch (e) {
        console.error('[Cache] Error invalidating path', e);
    }
};

export const clearExpiredEntries = (): void => {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return;

        const store: CacheStore = JSON.parse(raw);
        const now = Date.now();
        const nextStore: CacheStore = {};
        let changed = false;

        for (const [path, entry] of Object.entries(store)) {
            if (now - entry.timestamp <= TTL) {
                nextStore[path] = entry;
            } else {
                changed = true;
            }
        }

        if (changed) {
            localStorage.setItem(CACHE_KEY, JSON.stringify(nextStore));
        }
    } catch (e) {
        console.error('[Cache] Error clearing expired entries', e);
    }
};
