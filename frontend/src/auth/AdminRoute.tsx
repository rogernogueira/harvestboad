import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router'

import { useAuth } from './context'

/**
 * Restringe uma rota ao perfil ADMIN.
 *
 * É conveniência de navegação, não segurança: o backend recusa as mesmas
 * operações com 403 independentemente do que o cliente permita.
 */
export function AdminRoute() {
  const { user } = useAuth()
  const { t } = useTranslation()

  if (user?.profile !== 'ADMIN') {
    return (
      <div className="panel p-6">
        <p className="eyebrow mb-1">{t('common.forbiddenLabel')}</p>
        <p className="text-sm text-content-muted">{t('common.adminOnly')}</p>
      </div>
    )
  }

  return <Outlet />
}
