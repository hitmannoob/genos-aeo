'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useUserBrands } from '@/hooks/useUserBrands';
import type { UserBrand } from '@/types/userBrand';

interface BrandContextType {
  selectedBrand: UserBrand | null;
  selectedBrandId: string | null;
  brands: UserBrand[];
  setSelectedBrandId: (brandId: string) => void;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  refetchBrands: () => Promise<void>;
}

const BrandContext = createContext<BrandContextType | undefined>(undefined);

export function useBrandContext(): BrandContextType {
  const context = useContext(BrandContext);
  if (!context) throw new Error('useBrandContext must be used within a BrandContextProvider');
  return context;
}

export function BrandContextProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { brands, loading, error, refetch } = useUserBrands();
  const [selectedBrandId, setSelectedBrandIdState] = useState<string | null>(null);
  const [selectionLoaded, setSelectionLoaded] = useState(false);

  useEffect(() => {
    setSelectedBrandIdState(window.localStorage.getItem('selectedBrandId'));
    setSelectionLoaded(true);
  }, []);

  useEffect(() => {
    if (!selectionLoaded || loading) return;

    if (brands.length === 0) {
      setSelectedBrandIdState(null);
      window.localStorage.removeItem('selectedBrandId');
      return;
    }

    if (!selectedBrandId || !brands.some((brand) => brand.id === selectedBrandId)) {
      const firstBrandId = brands[0].id;
      setSelectedBrandIdState(firstBrandId);
      window.localStorage.setItem('selectedBrandId', firstBrandId);
    }
  }, [brands, loading, selectedBrandId, selectionLoaded]);

  const setSelectedBrandId = useCallback((brandId: string) => {
    const normalized = brandId.trim();
    if (!normalized || normalized.length > 200) return;
    setSelectedBrandIdState(normalized);
    window.localStorage.setItem('selectedBrandId', normalized);
  }, []);

  const selectedBrand = useMemo(
    () => selectedBrandId
      ? brands.find((brand) => brand.id === selectedBrandId) ?? null
      : null,
    [brands, selectedBrandId]
  );

  const value = useMemo<BrandContextType>(() => ({
    selectedBrand,
    selectedBrandId,
    brands,
    setSelectedBrandId,
    loading: loading || !selectionLoaded,
    error,
    refetch,
    refetchBrands: refetch,
  }), [
    selectedBrand,
    selectedBrandId,
    brands,
    setSelectedBrandId,
    loading,
    selectionLoaded,
    error,
    refetch,
  ]);

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}
