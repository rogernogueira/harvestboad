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
      <div id="admin-route-forbidden" className="br-card">
        <div id="admin-route-forbidden-body" className="card-content">
          <p id="admin-route-forbidden-label" className="eyebrow mb-1">
            {t('common.forbiddenLabel')}
          </p>
          <p id="admin-route-forbidden-message" className="text-gray-70 mb-0">
            {t('common.adminOnly')}
          </p>
        </div>
      </div>
    )
  }

  return <Outlet />
}
