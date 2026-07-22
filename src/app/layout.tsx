import React from 'react';
import { AuthContextProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { BrandContextProvider } from '@/context/BrandContext';
import { ToastProvider } from '@/context/ToastContext';
import { PendingSingleQueriesProvider } from '@/context/PendingSingleQueriesContext';
import { QueryProvider } from '@/providers/QueryProvider';
import { JobSideEffectsObserver } from '@/components/JobSideEffectsObserver';
import './globals.css';
import type { Metadata } from 'next';

// Metadata for the application
export const metadata: Metadata = {
  title: {
    default: 'Genos',
    template: '%s | Genos',
  },
  description: 'Track brand visibility and citations across AI answer engines.',
  manifest: '/site.webmanifest',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
};

// Root layout component for the application
export default function RootLayout( { children }: { children: React.ReactNode } ): React.ReactElement {
  return (
    <html lang="en" suppressHydrationWarning>
      {/*
        The <head /> component will contain the components returned by the nearest parent
        head.js. It can be used to define the document head for SEO, metadata, and other purposes.
        Learn more at https://beta.nextjs.org/docs/api-reference/file-conventions/head
      */}
      <head />
      <body className="antialiased" suppressHydrationWarning>
        <QueryProvider>
          <ThemeProvider>
            <AuthContextProvider>
              <BrandContextProvider>
                <ToastProvider>
                  <PendingSingleQueriesProvider>
                    <JobSideEffectsObserver />
                    {children}
                  </PendingSingleQueriesProvider>
                </ToastProvider>
              </BrandContextProvider>
            </AuthContextProvider>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
