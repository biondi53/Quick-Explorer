import { useState, useEffect, useRef } from 'react';

export function useDebouncedValue<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);
    const timeoutRef = useRef<number | null>(null);

    useEffect(() => {
        // Clear previous timeout
        if (timeoutRef.current) {
            window.clearTimeout(timeoutRef.current);
        }

        // Set new timeout
        timeoutRef.current = window.setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            if (timeoutRef.current) {
                window.clearTimeout(timeoutRef.current);
            }
        };
    }, [value, delay]);

    return debouncedValue;
}
