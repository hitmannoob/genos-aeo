'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// Tracks single-query runs that are in flight on the client. Lives at the
// root provider tree so the state survives navigation away from /dashboard
// and back. Bulk runs already get this for free via the React Query job
// cache; single-query runs aren't a server-side job, so we track them here.

interface PendingSingleQueriesContextValue {
  getPending: (brandId: string | undefined) => ReadonlySet<string>;
  addPending: (brandId: string, queryId: string) => void;
  removePending: (brandId: string, queryId: string) => void;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

const PendingSingleQueriesContext = createContext<PendingSingleQueriesContextValue | null>(null);

export function PendingSingleQueriesProvider({ children }: { children: ReactNode }) {
  const [pendingByBrand, setPendingByBrand] = useState<Map<string, Set<string>>>(new Map());

  const addPending = useCallback((brandId: string, queryId: string) => {
    setPendingByBrand((prev) => {
      const next = new Map(prev);
      const ids = new Set(next.get(brandId) ?? []);
      ids.add(queryId);
      next.set(brandId, ids);
      return next;
    });
  }, []);

  const removePending = useCallback((brandId: string, queryId: string) => {
    setPendingByBrand((prev) => {
      const next = new Map(prev);
      const ids = new Set(next.get(brandId) ?? []);
      ids.delete(queryId);
      next.set(brandId, ids);
      return next;
    });
  }, []);

  const getPending = useCallback(
    (brandId: string | undefined): ReadonlySet<string> => {
      if (!brandId) return EMPTY_SET;
      return pendingByBrand.get(brandId) ?? EMPTY_SET;
    },
    [pendingByBrand],
  );

  const value = useMemo<PendingSingleQueriesContextValue>(
    () => ({ getPending, addPending, removePending }),
    [getPending, addPending, removePending],
  );

  return (
    <PendingSingleQueriesContext.Provider value={value}>
      {children}
    </PendingSingleQueriesContext.Provider>
  );
}

export function usePendingSingleQueries(): PendingSingleQueriesContextValue {
  const ctx = useContext(PendingSingleQueriesContext);
  if (!ctx) {
    throw new Error(
      'usePendingSingleQueries must be used within a PendingSingleQueriesProvider',
    );
  }
  return ctx;
}
