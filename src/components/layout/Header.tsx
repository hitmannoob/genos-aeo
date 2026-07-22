'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import ThemeToggle from '@/components/shared/ThemeToggle';
import WebLogo from '@/components/shared/WebLogo';
import { useBrandContext } from '@/context/BrandContext';

export default function Header({ title }: { title?: string }): React.ReactElement {
  const [isBrandDropdownOpen, setIsBrandDropdownOpen] = useState(false);
  const { selectedBrand, brands, setSelectedBrandId } = useBrandContext();
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsBrandDropdownOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsBrandDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <header className="border-b border-border bg-background px-4 py-4 pl-16 shadow-sm sm:px-6 sm:pl-6">
      <div className="flex items-center justify-between gap-4">
        {title ? <h1 className="text-2xl font-bold text-foreground">{title}</h1> : <div />}

        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsBrandDropdownOpen((open) => !open)}
              aria-expanded={isBrandDropdownOpen}
              aria-haspopup="listbox"
              className="flex w-[min(14rem,52vw)] min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 transition-colors hover:bg-accent sm:w-auto sm:min-w-[200px] sm:px-4"
            >
              {selectedBrand ? (
                <>
                  <WebLogo domain={selectedBrand.domain} size={20} />
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-medium text-foreground">{selectedBrand.companyName}</p>
                    <p className="truncate text-xs text-muted-foreground">{selectedBrand.domain}</p>
                  </div>
                </>
              ) : (
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-sm font-medium text-muted-foreground">Select a brand</p>
                </div>
              )}
              {isBrandDropdownOpen
                ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </button>

            {isBrandDropdownOpen && (
              <div role="listbox" className="absolute right-0 top-full z-50 mt-1 max-h-64 w-64 overflow-y-auto rounded-xl border border-border bg-background shadow-lg">
                {brands.length === 0 ? (
                  <p className="p-3 text-center text-sm text-muted-foreground">No brands available</p>
                ) : brands.map((brand) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedBrand?.id === brand.id}
                    key={brand.id}
                    onClick={() => {
                      setSelectedBrandId(brand.id);
                      setIsBrandDropdownOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-accent ${selectedBrand?.id === brand.id ? 'bg-accent' : ''}`}
                  >
                    <WebLogo domain={brand.domain} size={20} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{brand.companyName}</p>
                      <p className="truncate text-xs text-muted-foreground">{brand.domain}</p>
                    </div>
                  </button>
                ))}
                <div className="border-t border-border" />
                <Link
                  href="/dashboard/add-brand/step-1"
                  onClick={() => setIsBrandDropdownOpen(false)}
                  className="flex items-center gap-3 p-3 text-left transition-colors hover:bg-accent"
                >
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                    <Plus className="h-3 w-3 text-primary-foreground" />
                  </div>
                  <span className="text-sm font-medium text-primary">Add brand</span>
                </Link>
              </div>
            )}
          </div>

          <Link
            href="/dashboard/add-brand/step-1"
            className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-primary transition-colors hover:bg-primary/20"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden text-sm sm:inline">Add brand</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
