import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useLocation } from 'react-router'

import { useAuth } from '@/auth/context'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

interface NavItem {
  to: string
  label: string
  end: boolean
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'nav.repositories', end: true },
  { to: '/acessos', label: 'nav.access', end: false, adminOnly: true },
]

/** Identificador de navegação a partir da rota, para o id sair legível. */
const navId = (to: string) => (to === '/' ? 'home' : to.replace(/^\//, '').replace(/\//g, '-'))

/**
 * Moldura do painel.
 *
 * Segue a especificação de design: faixa institucional no topo, marca,
 * navegação com underline animado e blocos angulares. A estrutura é de
 * dashboard — navegação lateral persistente em telas grandes e conteúdo à
 * direita —, não de landing page.
 */
export function AppShell() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const location = useLocation()
  const [menuAberto, setMenuAberto] = useState(false)

  const itens = NAV_ITEMS.filter((item) => !item.adminOnly || user?.profile === 'ADMIN')

  const linkClasses = ({ isActive }: { isActive: boolean }) =>
    `block border-l-2 px-4 py-2.5 text-sm transition-colors duration-150 ${
      isActive
        ? 'border-brand bg-brand-soft font-semibold text-brand-strong'
        : 'border-transparent text-content-muted hover:border-border-strong hover:text-content'
    }`

  return (
    <div id="app-shell" className="min-h-dvh bg-surface-muted">
      {/* Faixa institucional */}
      <div id="app-shell-institution-bar" className="bg-brand-strong text-white">
        <div
          id="app-shell-institution-bar-inner"
          className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-1.5"
        >
          <p id="app-shell-institution-name" className="eyebrow !text-white/85">
            {t('app.institution')}
          </p>
          <LanguageSwitcher id="app-shell-language-switcher" />
        </div>
      </div>

      {/* Barra principal */}
      <header
        id="app-shell-header"
        className="sticky top-0 z-20 border-b border-border-subtle bg-surface"
      >
        <div
          id="app-shell-header-inner"
          className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3"
        >
          <button
            id="app-shell-menu-toggle"
            type="button"
            onClick={() => setMenuAberto((aberto) => !aberto)}
            aria-expanded={menuAberto}
            aria-label={t('nav.toggleMenu')}
            className="-ml-1 rounded-card p-2 text-content-muted hover:bg-surface-muted lg:hidden"
          >
            <span
              id="app-shell-menu-toggle-icon"
              aria-hidden="true"
              className="block text-lg leading-none"
            >
              {menuAberto ? '×' : '≡'}
            </span>
          </button>

          {/*
            Lockup horizontal, 44px — a mesma altura que o par nome + eyebrow
            ocupava, então o cabeçalho não muda de tamanho.

            O eyebrow sai porque o nome já vem desenhado na logo: o símbolo ocupa
            68% da altura da arte e o wordmark só 24%, então a 44px o nome tem
            10,5px de caixa alta. Com "Repositórios e coletas" embaixo, a tagline
            ficaria maior que a marca que ela qualifica.

            O alt carrega o nome acessível do link, que antes vinha do texto.
          */}
          <Link id="app-shell-logo-link" to="/" className="mr-auto">
            <img
              id="app-shell-logo"
              src="/logoHB-horizontal.svg"
              alt={t('app.name')}
              className="h-11 w-auto"
            />
          </Link>

          {user ? (
            <div id="app-shell-user" className="flex items-center gap-3">
              <div id="app-shell-user-identity" className="hidden text-right sm:block">
                <p id="app-shell-user-username" className="text-sm font-semibold">
                  {user.username}
                </p>
                <p id="app-shell-user-profile" className="eyebrow !text-brand-strong">
                  {user.profileDisplay}
                </p>
              </div>
              <Link
                id="app-shell-change-password"
                to="/trocar-senha"
                className="hidden border border-border-subtle px-3 py-1.5 text-sm text-content-muted transition-colors duration-150 hover:border-brand hover:text-brand-strong sm:block"
              >
                {t('auth.changePassword')}
              </Link>
              <button
                id="app-shell-logout"
                type="button"
                onClick={logout}
                className="border border-border-subtle px-3 py-1.5 text-sm transition-colors duration-150 hover:border-brand hover:text-brand-strong"
              >
                {t('auth.logout')}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div id="app-shell-body" className="mx-auto flex max-w-7xl gap-8 px-4 py-6">
        {/* Navegação lateral */}
        <nav
          id="app-shell-nav"
          aria-label={t('nav.main')}
          className={`${menuAberto ? 'block' : 'hidden'} w-full shrink-0 lg:block lg:w-56`}
        >
          <p id="app-shell-nav-label" className="eyebrow mb-2 px-4">
            {t('nav.sections')}
          </p>
          <ul id="app-shell-nav-list" className="border-l border-border-subtle">
            {itens.map((item) => (
              <li id={`app-shell-nav-item-${navId(item.to)}`} key={item.to}>
                <NavLink
                  id={`app-shell-nav-link-${navId(item.to)}`}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMenuAberto(false)}
                  className={linkClasses}
                >
                  {t(item.label)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main
          id="app-shell-main"
          className={`${menuAberto ? 'hidden' : 'block'} min-w-0 flex-1 lg:block`}
          key={location.pathname}
        >
          <Outlet />
        </main>
      </div>

      <footer id="app-shell-footer" className="mt-8 border-t border-border-subtle bg-surface">
        <div
          id="app-shell-footer-inner"
          className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-6"
        >
          <p id="app-shell-footer-text" className="text-sm text-content-muted">
            {t('app.footer')}
          </p>
          <p id="app-shell-footer-institution" className="eyebrow">
            {t('app.institution')}
          </p>
        </div>
      </footer>
    </div>
  )
}
