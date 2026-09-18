import { BrSkipLink } from '@govbr-ds/react-components'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useLocation } from 'react-router'

import { useQuery } from '@tanstack/react-query'

import { useAuth } from '@/auth/context'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { NotificationsButton } from '@/components/NotificationsButton'
import { NotificationsPanel } from '@/components/NotificationsPanel'
import { unreadNotificationsQuery } from '@/lib/queries'

interface NavItem {
  to: string
  label: string
  icon: string
  end: boolean
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'nav.repositories', icon: 'fas fa-database', end: true },
  { to: '/acessos', label: 'nav.access', icon: 'fas fa-users', end: false, adminOnly: true },
]

/** Identificador de navegação a partir da rota, para o id sair legível. */
const navId = (to: string) => (to === '/' ? 'home' : to.replace(/^\//, '').replace(/\//g, '-'))

/**
 * Moldura do painel, no Padrão Digital de Governo.
 *
 * O cabeçalho e a navegação são markup próprio sobre as classes `br-header` e
 * `br-list` do core, e não os componentes `BrHeader`/`BrMenu`. Dois motivos
 * medidos, não de gosto:
 *
 * 1. O `BrHeader` embute `aria-label` em português no código — "Abrir Acesso
 *    Rápido", "Menu" — sem prop que os sobrescreva. Confirmado renderizando a
 *    página com `lang="en"`: os rótulos saem em português. O projeto exige que
 *    todo texto visível passe por `t()` nos três idiomas, e rótulo de leitor de
 *    tela é texto visível para quem depende dele.
 * 2. O `BrMenu` é gaveta, não barra lateral: com `type="push"` ele renderiza
 *    com altura 0 até ser acionado. A navegação daqui é persistente em telas
 *    largas, e trocá-la por gaveta seria mudança de uso, não de visual.
 *
 * O `BrSkipLink` continua sendo o componente do design system — ele não tem
 * rótulo embutido, recebe o texto por prop.
 *
 * A marca gráfica do gov.br não é usada: o `header-logo` recebe o lockup do
 * HarvestBoard e o `header-sign` a assinatura do IBICT.
 */
export function AppShell() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const location = useLocation()
  const [menuAberto, setMenuAberto] = useState(false)
  const [notificacoesAbertas, setNotificacoesAbertas] = useState(false)

  // Só o número; a lista fica para quando o painel abrir.
  const naoLidas = useQuery({ ...unreadNotificationsQuery, enabled: Boolean(user) })

  const itens = NAV_ITEMS.filter((item) => !item.adminOnly || user?.profile === 'ADMIN')

  const itemClasses = ({ isActive }: { isActive: boolean }) => `br-item ${isActive ? 'active' : ''}`

  return (
    <div id="app-shell" className="d-flex flex-column" style={{ minHeight: '100dvh' }}>
      {/*
        Salto para o conteúdo: ganho novo da migração. Antes, quem navegava por
        teclado percorria o cabeçalho e a navegação inteiros, a cada troca de
        página, antes de chegar ao conteúdo.
      */}
      <BrSkipLink data={[{ link: '#app-shell-main', label: t('nav.skipToContent') }]} />

      <header id="app-shell-header" className="br-header" data-sticky="data-sticky">
        <div id="app-shell-header-inner" className="container-lg">
          <div id="app-shell-header-top" className="header-top">
            {/*
              O `header-logo` ficou só com a assinatura do IBICT: a marca do
              HarvestBoard desceu para o `header-info`. O invólucro continua
              porque é ele que dá `flex: 1` ao bloco — o que empurra o
              `header-actions` para a direita — e porque o core só aplica cor e
              peso ao `.header-sign` dentro dele.

              O `br-divider` saiu junto com a marca: ele separava as duas, e
              sozinho sobraria um traço vertical abrindo a linha.
            */}
            <div id="app-shell-header-logo" className="header-logo">
              <div id="app-shell-institution-name" className="header-sign">
                {t('app.institution')}
              </div>
            </div>

            <div id="app-shell-header-actions" className="header-actions">
              <LanguageSwitcher id="app-shell-language-switcher" />

              {user ? (
                <>
                  {/*
                    O sino fica antes do divisor, junto dos controles de sessão:
                    é o único lugar onde o recado direto a um gestor — que não
                    tem repositório — tem onde acender. As notificações de
                    repositório aparecem aqui também, e na linha do próprio
                    repositório.

                    `sempreVisivel` porque no cabeçalho ele é porta de entrada,
                    não sinal: some com a caixa vazia, e quem procurasse as
                    notificações lidas não teria por onde.
                  */}
                  <NotificationsButton
                    id="app-shell-notifications"
                    count={naoLidas.data?.unread ?? 0}
                    onAbrir={() => setNotificacoesAbertas(true)}
                    sempreVisivel
                    className="br-button circle small mr-1"
                  />
                  <span className="br-divider vertical mx-1" aria-hidden="true" />
                  <div id="app-shell-user" className="d-flex align-items-center">
                    <div id="app-shell-user-identity" className="d-none d-sm-block text-right mr-2">
                      <p id="app-shell-user-username" className="text-base text-semi-bold mb-0">
                        {user.username}
                      </p>
                      <p id="app-shell-user-profile" className="eyebrow mb-0">
                        {user.profileDisplay}
                      </p>
                    </div>
                    <Link
                      id="app-shell-change-password"
                      to="/trocar-senha"
                      className="br-button secondary small d-none d-sm-inline-flex mr-2"
                    >
                      {t('auth.changePassword')}
                    </Link>
                    <button
                      id="app-shell-logout"
                      type="button"
                      onClick={logout}
                      className="br-button secondary small"
                    >
                      {t('auth.logout')}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div id="app-shell-header-bottom" className="header-bottom">
            <div id="app-shell-header-menu" className="header-menu">
              <div id="app-shell-menu-trigger" className="header-menu-trigger d-lg-none">
                <button
                  id="app-shell-menu-toggle"
                  className="br-button small circle"
                  type="button"
                  onClick={() => setMenuAberto((aberto) => !aberto)}
                  aria-expanded={menuAberto}
                  aria-controls="app-shell-nav"
                  aria-label={t('nav.toggleMenu')}
                >
                  <i className={menuAberto ? 'fas fa-times' : 'fas fa-bars'} aria-hidden="true" />
                </button>
              </div>
              {/*
                Aqui vai só a tagline. O nome do produto já está no lockup do
                logo, e repeti-lo em texto fazia o cabeçalho anunciar
                "HarvestBoard" duas vezes seguidas para quem usa leitor de tela
                — uma vez no `alt` do logo, outra neste bloco.

                Ela fica no `header-title`, e não no `header-subtitle`, porque
                o core esconde o subtítulo abaixo de 576px: `display: none` na
                regra base, com `display: block` só a partir do breakpoint. No
                celular esta linha ficaria com o gatilho do menu e mais nada.

                O `header-info` continua envolvendo um filho só: é ele que
                carrega o afastamento do gatilho
                (`.header-menu-trigger + .header-info`) e o `padding-top` dos
                breakpoints.
              */}
              <div id="app-shell-header-info" className="header-info">
                {/*
                  A marca abre o bloco e leva à home. O `alt` é o nome do
                  produto porque é ele que dá nome acessível ao link — o texto
                  abaixo é a tagline, não o nome.

                  A altura vem de `#app-shell-logo`, em `index.css`, e não
                  daqui. Dois motivos somados: o `Link` cria um item sem
                  largura própria e o SVG colapsa para 0×0 sem altura
                  explícita; e, fora do `.header-logo`, o `max-height` do core
                  não alcança mais a imagem. O token `--header-logo-size`
                  também não resolve solto — o core só o troca para 40px dentro
                  do próprio `.header-logo`, então aqui ele valeria 24px em
                  qualquer largura.
                */}
                <Link id="app-shell-logo-link" to="/" className="d-inline-flex align-items-center">
                  <img id="app-shell-logo" src="/logoHB-horizontal.svg" alt={t('app.name')} />
                </Link>
                <div id="app-shell-header-tagline" className="header-title">
                  {t('app.tagline')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div id="app-shell-body" className="container-lg flex-grow-1">
        <div id="app-shell-body-row" className="row">
          <nav
            id="app-shell-nav"
            aria-label={t('nav.main')}
            className={`col-lg-3 py-4 ${menuAberto ? 'd-block' : 'd-none'} d-lg-block`}
          >
            <p id="app-shell-nav-label" className="eyebrow mb-1">
              {t('nav.sections')}
            </p>
            <div id="app-shell-nav-list" className="br-list">
              {itens.map((item) => (
                <NavLink
                  id={`app-shell-nav-link-${navId(item.to)}`}
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMenuAberto(false)}
                  className={itemClasses}
                >
                  <span className="content">
                    <i className={`${item.icon} mr-2`} aria-hidden="true" />
                    {t(item.label)}
                  </span>
                </NavLink>
              ))}
            </div>
          </nav>

          <main
            id="app-shell-main"
            className={`col-lg-9 py-4 ${menuAberto ? 'd-none' : 'd-block'} d-lg-block`}
            key={location.pathname}
          >
            <Outlet />
          </main>
        </div>
      </div>

      <footer id="app-shell-footer" className="bg-pure-0 mt-4">
        <div
          id="app-shell-footer-inner"
          className="container-lg d-flex flex-wrap align-items-center justify-content-between py-4"
        >
          <p id="app-shell-footer-text" className="text-base mb-0">
            {t('app.footer')}
          </p>
          <p id="app-shell-footer-institution" className="eyebrow mb-0">
            {t('app.institution')}
          </p>
        </div>
      </footer>

      {user ? (
        <NotificationsPanel
          id="app-shell-notifications-panel"
          aberto={notificacoesAbertas}
          onFechar={() => setNotificacoesAbertas(false)}
          titulo={t('notifications.title')}
          descricao={t('notifications.inboxSubtitle')}
        />
      ) : null}
    </div>
  )
}
