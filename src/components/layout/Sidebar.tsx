'use client'
import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { 
  BarChart3, 
  CreditCard, 
  Search, 
  Users, 
  Quote, 
  Plus,
  Menu,
  KeyRound,
  User,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useBrandContext } from '@/context/BrandContext';
import { useAuthContext } from '@/context/AuthContext';
import WebLogo from '@/components/shared/WebLogo';
import OpenRouterKeyDialog from '@/components/settings/OpenRouterKeyDialog';

const navigationItems = [
  { name: 'Overview', href: '/dashboard', icon: BarChart3 },
  { name: 'Competitors', href: '/dashboard/competitors', icon: Users },
  { name: 'Queries', href: '/dashboard/queries', icon: Search },
  { name: 'Citations', href: '/dashboard/citations', icon: Quote },
  { name: 'Add Brand', href: '/dashboard/add-brand/step-1', icon: Plus },
];

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export default function Sidebar({ isOpen, onToggle }: SidebarProps): React.ReactElement {
  const pathname = usePathname();
  const { user, userProfile } = useAuthContext();
  const { 
    brands, 
    loading: brandsLoading, 
    error: brandsError, 
    selectedBrandId, 
    setSelectedBrandId 
  } = useBrandContext();
  const [isBrandsDropdownOpen, setIsBrandsDropdownOpen] = React.useState(false);
  const [isKeyDialogOpen, setIsKeyDialogOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Ensure single brand is selected when only one brand exists
  React.useEffect(() => {
    if (brands.length === 1 && !selectedBrandId) {
      setSelectedBrandId(brands[0].id);
    }
  }, [brands, selectedBrandId, setSelectedBrandId]);

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsBrandsDropdownOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsBrandsDropdownOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  // Note: We intentionally don't add periodic refresh here as it can interfere with query processing
  // Credits are updated manually after API calls in ProcessQueriesButton

  return (
    <>
      <OpenRouterKeyDialog
        open={isKeyDialogOpen}
        onClose={() => setIsKeyDialogOpen(false)}
      />
      {/* Mobile menu button */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={isOpen}
        className="lg:hidden fixed top-6 left-6 z-50 p-2 rounded-lg bg-card border border-border text-foreground hover:bg-accent transition-colors"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          role="presentation"
          className="lg:hidden fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed lg:static inset-y-0 left-0 z-50 w-72 bg-muted/40 border-r border-border transform ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 transition-transform duration-300 ease-in-out`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center px-6 pt-4 pb-0">
            <div className="flex items-center justify-center w-full">
              <Image
                src="/genos-wordmark.png"
                alt="Genos Logo"
                width={512}
                height={141}
                className="h-auto w-40"
                priority
              />
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-6 pt-2 pb-6 space-y-1 overflow-y-auto">
            {/* User Brands - Always show, handle loading and empty states */}
            {!brandsLoading && (
              <>
                <div className="w-full mb-6">
                  <h3 className="text-sm font-medium text-foreground mb-3">Your Brands</h3>

                  {/* Always show dropdown - regardless of brand count */}
                  <div className="relative" ref={dropdownRef}>
                    {/* Dropdown Button */}
                    <button
                      type="button"
                      onClick={() => setIsBrandsDropdownOpen(!isBrandsDropdownOpen)}
                      aria-expanded={isBrandsDropdownOpen}
                      aria-haspopup="listbox"
                      className="w-full flex items-center space-x-3 p-2 bg-card rounded-xl border border-border hover:bg-muted transition-colors"
                    >
                      {selectedBrandId && brands.length > 0 && (() => {
                        const selected = brands.find(b => b.id === selectedBrandId);
                        return selected ? (
                          <>
                            <WebLogo domain={selected.domain} size={20} />
                            <div className="flex-1 min-w-0 text-left">
                              <p className="text-xs font-medium text-foreground truncate">{selected.companyName}</p>
                              {selected.domain && (
                                <p className="text-xs text-muted-foreground truncate">{selected.domain}</p>
                              )}
                            </div>
                          </>
                        ) : null;
                      })()}
                      {(!selectedBrandId || brands.length === 0) && (
                        <div className="flex-1 text-left">
                          <p className="text-xs font-medium text-muted-foreground">
                            {brands.length === 0 ? 'No brands available' : 'Select a brand'}
                          </p>
                        </div>
                      )}
                      <div className="flex-shrink-0">
                        {isBrandsDropdownOpen ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </button>

                    {/* Dropdown Menu */}
                    {isBrandsDropdownOpen && (
                      <div role="listbox" className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto">
                        {/* Show brands if available */}
                        {brands.length > 0 ? (
                          <>
                            {/* All Brands */}
                            {brands.map((brand) => (
                              <button
                                type="button"
                                role="option"
                                aria-selected={selectedBrandId === brand.id}
                                key={brand.id}
                                onClick={() => {
                                  setSelectedBrandId(brand.id);
                                  setIsBrandsDropdownOpen(false);
                                }}
                                className={`w-full flex items-center space-x-3 p-2 hover:bg-muted transition-colors text-left ${
                                  selectedBrandId === brand.id ? 'bg-muted' : ''
                                }`}
                              >
                                <WebLogo domain={brand.domain} size={20} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-foreground truncate">{brand.companyName}</p>
                                  {brand.domain && (
                                    <p className="text-xs text-muted-foreground truncate">{brand.domain}</p>
                                  )}
                                </div>
                              </button>
                            ))}
                            
                            {/* Separator */}
                            <div className="border-t border-border my-1"></div>
                          </>
                        ) : (
                          <>
                            {/* No brands message */}
                            <div className="p-3 text-center">
                              <p className="text-xs text-muted-foreground">No brands available</p>
                              <p className="text-xs text-muted-foreground mt-1">Create your first brand below</p>
                            </div>

                            {/* Separator */}
                            <div className="border-t border-border my-1"></div>
                          </>
                        )}
                        
                        {/* Add Brand Option - Always show */}
                        <Link
                          href="/dashboard/add-brand/step-1"
                          onClick={() => setIsBrandsDropdownOpen(false)}
                          className="w-full flex items-center space-x-3 p-2 hover:bg-muted transition-colors text-left rounded-b-xl"
                        >
                          <div className="w-5 h-5 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                            <Plus className="h-3 w-3 text-primary-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground">Add Brand</p>
                            <p className="text-xs text-muted-foreground">Create a new brand</p>
                          </div>
                        </Link>
                      </div>
                    )}
                  </div>
                </div>

                {/* Horizontal line - Always show */}
                <div className="border-t border-border mb-8"></div>
              </>
            )}

            {/* Loading state */}
            {brandsLoading && (
              <>
                <div className="w-full mb-6">
                  <h3 className="text-sm font-medium text-foreground mb-3">Your Brands</h3>
                  <div className="flex items-center space-x-3 p-2 bg-card rounded-lg border border-border">
                    <div className="w-5 h-5 bg-muted rounded-full animate-pulse"></div>
                    <div className="flex-1 min-w-0">
                      <div className="h-3 bg-muted rounded w-24 mb-1 animate-pulse"></div>
                      <div className="h-2 bg-muted rounded w-16 animate-pulse"></div>
                    </div>
                  </div>
                </div>

                {/* Horizontal line */}
                <div className="border-t border-border mb-8"></div>
              </>
            )}

            {brandsError && (
              <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                Could not load brands: {brandsError}
              </p>
            )}
            
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.name === 'Add Brand' 
                ? pathname.startsWith('/dashboard/add-brand')
                : pathname === item.href;
              
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`group flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Icon className={`h-5 w-5 ${isActive ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground'} transition-colors`} />
                  <span className="font-medium">{item.name}</span>
                  {isActive && (
                    <div className="ml-auto w-2 h-2 bg-primary-foreground rounded-full"></div>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* User section */}
          <div className="p-4 border-t border-border">
            {/* Credits Display */}
            {userProfile && typeof userProfile.credits === 'number' && (
              <div className={`mb-3 px-4 py-2 rounded-xl border ${
                userProfile.credits < 50 
                  ? 'bg-destructive/10 border-destructive/30'
                  : userProfile.credits < 100
                  ? 'bg-warning/10 border-warning/30'
                  : 'bg-primary/10 border-primary/20'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <CreditCard className={`h-3 w-3 ${
                      userProfile.credits < 50 
                        ? 'text-destructive'
                        : userProfile.credits < 100
                        ? 'text-warning'
                        : 'text-primary'
                    }`} />
                    <span className={`text-xs font-medium ${
                      userProfile.credits < 50 
                        ? 'text-destructive'
                        : userProfile.credits < 100
                        ? 'text-warning'
                        : 'text-primary'
                    }`}>Available Credits</span>
                  </div>
                  <span className={`text-sm font-bold ${
                    userProfile.credits < 50 
                      ? 'text-destructive'
                      : userProfile.credits < 100
                      ? 'text-warning'
                      : 'text-primary'
                  }`}>{userProfile.credits.toLocaleString()}</span>
                </div>
                {userProfile.credits < 50 && (
                  <div className="mt-1 text-xs text-destructive">
                    ⚠️ Low credits! Consider purchasing more.
                  </div>
                )}
              </div>
            )}
            
            <button
              type="button"
              onClick={() => setIsKeyDialogOpen(true)}
              className="flex w-full items-center space-x-3 rounded-xl border border-border bg-muted px-4 py-3 text-left transition-colors hover:bg-accent"
              title="Edit OpenRouter API key"
            >
              {userProfile?.photoURL ? (
                <img
                  src={userProfile.photoURL}
                  alt="Profile"
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary rounded-full flex items-center justify-center">
                  <User className="h-5 w-5 text-primary-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-foreground text-sm font-medium truncate">
                  {userProfile?.displayName || user?.displayName || 'Local user'}
                </p>
                <p className="text-muted-foreground text-xs truncate">
                  OpenRouter configured
                </p>
              </div>
              <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
