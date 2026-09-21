import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation } from 'react-router'

import { useAuth } from './context'

export function ProtectedRoute() {
  const { user, status } = useAuth()
  const location = useLocation()
  const { t } = useTranslation()

  if (status === 'carregando') {
    return (
      <p id="protected-route-loading" className="text-gray-70 p-4">
        {t('common.loading')}
      </p>
    )
  }

  if (status === 'anonimo') {
    return <Navigate to="/entrar" replace state={{ from: location }} />
  }

  // Troca obrigatória de senha bloqueia o resto da aplicação. O destino é o
  // perfil, que abriga o formulário de senha — a outra metade da tela, o
  // cadastro, fica visível junto e não atrapalha: só a troca levanta o bloqueio.
  if (user?.mustChangePassword && location.pathname !== '/perfil') {
    return <Navigate to="/perfil" replace />
  }

  return <Outlet />
}
