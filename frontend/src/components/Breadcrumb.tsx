import { Fragment } from 'react'
import { Link } from 'react-router'

export interface Crumb {
  label: string
  to?: string
}

/** Trilha de navegação: o fluxo tem quatro níveis e é fácil se perder. */
export function Breadcrumb({ id = 'breadcrumb', items }: { id?: string; items: Crumb[] }) {
  return (
    <nav id={id} aria-label="breadcrumb" className="mb-4 text-sm text-content-muted">
      {items.map((item, index) => (
        <Fragment key={`${item.label}-${index}`}>
          {index > 0 ? (
            <span id={`${id}-separator-${index}`} className="mx-1.5 opacity-50">
              /
            </span>
          ) : null}
          {item.to ? (
            <Link
              id={`${id}-item-${index}`}
              to={item.to}
              className="hover:text-brand-strong hover:underline"
            >
              {item.label}
            </Link>
          ) : (
            <span id={`${id}-item-${index}`} className="text-content">
              {item.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
