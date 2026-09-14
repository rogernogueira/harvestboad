import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation } from 'react-router'

import { useAuth } from './context'

export function ProtectedRoute() {
  const { user, status } = useAuth()
  const location = useLocation()
  const { t } = useTranslation()

  if (status === 'carregando') {
    return <p className="p-8 text-content-muted">{t('common.loading')}</p>
  }

  if (status === 'anonimo') {
    return <Navigate to="/entrar" replace state={{ from: location }} />
  }

  // Troca obrigatória de senha bloqueia o resto da aplicação.
  if (user?.mustChangePassword && location.pathname !== '/trocar-senha') {
    return <Navigate to="/trocar-senha" replace />
  }

  return <Outlet />
}
