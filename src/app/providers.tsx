import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from './theme';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Card and deck data changes only when this user changes it, so refetching
        // on every window focus is wasted traffic. Practice queues are invalidated
        // explicitly after each review instead.
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        retry: 1,
      },
      mutations: { retry: 0 },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  // useState so the client survives Fast Refresh but is never shared across
  // renders of different trees (matters once tests mount this).
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          {children}
          <Toaster position="top-center" richColors />
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
