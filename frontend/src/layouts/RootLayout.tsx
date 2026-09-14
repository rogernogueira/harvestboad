import { useTranslation } from 'react-i18next'
import { Link, Outlet } from 'react-router'

import { useAuth } from '@/auth/context'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

export function RootLayout() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-surface-raised/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <Link to="/" className="mr-auto">
            <p className="text-sm font-semibold">{t('app.name')}</p>
            <p className="text-xs text-content-muted">{t('app.tagline')}</p>
          </Link>

          <LanguageSwitcher />

          {user ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-content-muted">
                {user.username}
                <span className="ml-1.5 rounded bg-brand/10 px-1.5 py-0.5 text-xs text-brand-strong">
                  {user.profileDisplay}
                </span>
              </span>
              <button
                type="button"
                onClick={logout}
                className="rounded-md border border-border-subtle px-3 py-1.5 hover:bg-border-subtle"
              >
                {t('auth.logout')}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
