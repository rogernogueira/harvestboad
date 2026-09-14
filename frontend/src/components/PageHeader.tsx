import type { ReactNode } from 'react'

/**
 * Cabeçalho padrão das telas do painel.
 *
 * O rótulo em mono caixa-alta acima do título é a assinatura tipográfica da
 * identidade; mantê-lo em um componente garante o mesmo tratamento em todas
 * as páginas.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border-subtle pb-4">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h1 className="font-heading text-2xl font-extrabold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-content-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </header>
  )
}
