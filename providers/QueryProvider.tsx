import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes
        retry: (failureCount, error: any) => {
          // Don't retry on 4xx errors (except 401 which Supabase handles via token refresh)
          const status = error?.status ?? error?.response?.status;
          if (status >= 400 && status < 500 && status !== 401) return false;
          return failureCount < 3;
        },
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      },
      mutations: {
        retry: (failureCount, error: any) => {
          const status = error?.status ?? error?.response?.status;
          if (status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });

// Module-level singleton for non-React contexts (e.g. prefetchChatRooms called outside a component).
let browserQueryClient: QueryClient | undefined;

export const getQueryClient = () => {
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
};

export const QueryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // useState ensures a new client per component tree (correct for SSR / test isolation).
  const [queryClient] = useState(() => makeQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

// Keep named export for any existing imports of `queryClient`
export { getQueryClient as queryClient };
