import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { apiGet, apiPost, SESSION_EXPIRED } from '@/lib/api'
import type { TokenPair, User } from '@/lib/types'

import { AuthContext, type AuthValue } from './context'
import { tokens } from './tokens'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  // Sem token guardado não há o que validar: começa anônimo em vez de passar
  // por um "carregando" que o efeito encerraria de imediato.
  const [status, setStatus] = useState<AuthValue['status']>(() =>
    tokens.access ? 'carregando' : 'anonimo',
  )
  const queryClient = useQueryClient()

  const logout = useCallback(() => {
    tokens.clear()
    setUser(null)
    setStatus('anonimo')
    queryClient.clear()
  }, [queryClient])

  const refreshUser = useCallback(async () => {
    const data = await apiGet<User>('/auth/me/')
    setUser(data)
  }, [])

  // Sessão existente: valida o token guardado antes de liberar a aplicação.
  useEffect(() => {
    let cancelado = false
    if (!tokens.access) return

    apiGet<User>('/auth/me/')
      .then((data) => {
        if (cancelado) return
        setUser(data)
        setStatus('autenticado')
      })
      .catch(() => {
        if (cancelado) return
        tokens.clear()
        setStatus('anonimo')
      })
    return () => {
      cancelado = true
    }
  }, [])

  // O cliente HTTP avisa quando a renovação falhou de vez.
  useEffect(() => {
    const encerrar = () => logout()
    window.addEventListener(SESSION_EXPIRED, encerrar)
    return () => window.removeEventListener(SESSION_EXPIRED, encerrar)
  }, [logout])

  const login = useCallback(
    async (username: string, password: string) => {
      const data = await apiPost<TokenPair>(
        '/auth/token/',
        { username, password },
        { skipAuth: true },
      )
      tokens.set(data.access, data.refresh)
      setUser(data.user)
      setStatus('autenticado')
      return data.user
    },
    [],
  )

  const value = useMemo<AuthValue>(
    () => ({ user, status, login, logout, refreshUser }),
    [user, status, login, logout, refreshUser],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
