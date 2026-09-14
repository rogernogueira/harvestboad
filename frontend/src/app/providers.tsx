import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import type { ReactNode } from 'react'

import { AuthProvider } from '@/auth/AuthContext'
import { ApiError } from '@/lib/api'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Erros definitivos não se resolvem repetindo; indisponibilidade do
        // Harvester (503), sim — a rede até ele é instável.
        if (error instanceof ApiError) {
          if (error.status === 503) return failureCount < 3
          return false
        }
        return failureCount < 2
      },
    },
  },
})

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
      {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  )
}
