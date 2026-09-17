import type { ReactNode } from 'react'

/**
 * Cabeçalho padrão das telas do painel.
 *
 * O rótulo em mono caixa-alta acima do título é a assinatura tipográfica da
 * identidade; mantê-lo em um componente garante o mesmo tratamento em todas
 * as páginas.
 *
 * O tamanho do título vem da escala tipográfica do design system
 * (`text-up-03`, 24,19px) em vez de um valor próprio.
 */
export function PageHeader({
  id = 'page-header',
  eyebrow,
  title,
  description,
  actions,
}: {
  id?: string
  eyebrow?: string
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header
      id={id}
      className="d-flex flex-wrap align-items-end justify-content-between pb-3 mb-3"
      style={{
        gap: 'var(--spacing-scale-2x)',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      <div id={`${id}-text`} style={{ minWidth: 0 }}>
        {eyebrow ? (
          <p id={`${id}-eyebrow`} className="eyebrow mb-1">
            {eyebrow}
          </p>
        ) : null}
        <h1 id={`${id}-title`} className="mt-0 mb-0">
          {title}
        </h1>
        {description ? (
          <p id={`${id}-description`} className="text-base mt-1 mb-0">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          id={`${id}-actions`}
          className="d-flex flex-shrink-0"
          style={{ gap: 'var(--spacing-scale-base)' }}
        >
          {actions}
        </div>
      ) : null}
    </header>
  )
}
