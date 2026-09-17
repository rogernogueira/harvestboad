import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

export interface Crumb {
  label: string
  to?: string
}

/**
 * Trilha de navegação: o fluxo tem quatro níveis e é fácil se perder.
 *
 * Markup próprio sobre as classes `br-breadcrumb` do core, e não o
 * `BrBreadcrumbs`: aquele aceita só a prop `crumbs` — sem `id`, sem
 * `className` — e embute `aria-label="Abrir menu Breadcrumb"` em português,
 * que vazaria nas versões em espanhol e inglês.
 *
 * O `aria-label` da trilha, que antes era a palavra "breadcrumb" fixa em
 * inglês, agora também passa por `t()`.
 */
export function Breadcrumb({ id = 'breadcrumb', items }: { id?: string; items: Crumb[] }) {
  const { t } = useTranslation()

  return (
    <nav id={id} aria-label={t('nav.breadcrumb')} className="br-breadcrumb mb-3">
      <ol id={`${id}-list`} className="crumb-list" role="list">
        {items.map((item, index) => (
          <Fragment key={`${item.label}-${index}`}>
            <li
              id={`${id}-item-${index}`}
              className="crumb"
              data-active={item.to ? undefined : 'active'}
            >
              {index > 0 ? <i className="icon fas fa-chevron-right" aria-hidden="true" /> : null}
              {item.to ? (
                <Link id={`${id}-link-${index}`} to={item.to}>
                  {item.label}
                </Link>
              ) : (
                <span id={`${id}-current-${index}`} aria-current="page">
                  {item.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  )
}
