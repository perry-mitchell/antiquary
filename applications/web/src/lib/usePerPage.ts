import { useCallback, useState } from 'react';

const STORAGE_KEY = 'perPage';

export const PER_PAGE_OPTIONS = [25, 50, 100, 250, 500];
export const DEFAULT_PER_PAGE = 25;

export function usePerPage() {
    const [perPage, setPerPage] = useState(() => {
        const stored = Number(localStorage.getItem(STORAGE_KEY));
        return PER_PAGE_OPTIONS.includes(stored) ? stored : DEFAULT_PER_PAGE;
    });

    const updatePerPage = useCallback((value: number) => {
        setPerPage(value);
        localStorage.setItem(STORAGE_KEY, String(value));
    }, []);

    return [perPage, updatePerPage] as const;
}
