'use client';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

interface InfoTooltipProps {
  children: ReactNode;
  // Pixels from the icon to where the tooltip should anchor. Useful when a
  // parent has `overflow: hidden` and the default `top-full mt-2` placement
  // would get clipped.
  side?: 'top' | 'bottom';
  className?: string;
}

export default function InfoTooltip({
  children,
  side = 'bottom',
  className = '',
}: InfoTooltipProps) {
  const placement =
    side === 'top'
      ? 'bottom-full mb-2'
      : 'top-full mt-2';

  return (
    <span className={`relative inline-flex items-center align-middle ml-1 group ${className}`}>
      <Info
        tabIndex={0}
        className="h-3.5 w-3.5 text-muted-foreground/70 hover:text-muted-foreground focus:outline-none focus-visible:text-muted-foreground cursor-help"
        aria-label="Definition"
      />
      <span
        role="tooltip"
        className={`invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity duration-150 absolute left-1/2 -translate-x-1/2 ${placement} w-64 z-30 bg-foreground text-background normal-case text-xs leading-relaxed font-normal rounded-md px-3 py-2 shadow-lg pointer-events-none whitespace-normal text-left`}
      >
        {children}
      </span>
    </span>
  );
}
