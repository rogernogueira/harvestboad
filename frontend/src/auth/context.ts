import { createContext, use } from 'react'

import type { User } from '@/lib/types'

export interface AuthValue {
  user: User | null
  status: 'carregando' | 'autenticado' | 'anonimo'
  login: (username: string, password: string) => Promise<User>
  logout: () => void
  refreshUser: () => Promise<void>
}

/**
 * Separado do provider para que o arquivo do componente exporte apenas
 * componentes — requisito do fast refresh.
 */
export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const value = use(AuthContext)
  if (!value) throw new Error('useAuth precisa estar dentro de AuthProvider')
  return value
}
