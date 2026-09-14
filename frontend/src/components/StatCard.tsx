import type { ReactNode } from 'react'

/**
 * Cartão de indicador do painel.
 *
 * A faixa colorida no topo é o recurso da identidade para diferenciar blocos
 * sem recorrer a fundos coloridos, que prejudicariam o contraste do número.
 */
export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'brand' | 'ok' | 'down' | 'gold'
}) {
  const faixa = {
    brand: 'bg-brand',
    ok: 'bg-ok',
    down: 'bg-down',
    gold: 'bg-gold',
  }[tone ?? 'brand']

  const corValor = tone === 'ok' ? 'text-ok' : tone === 'down' ? 'text-down' : ''

  return (
    <div className="panel overflow-hidden">
      <div className={`h-1 ${faixa}`} aria-hidden="true" />
      <div className="p-4">
        <p className="eyebrow">{label}</p>
        <p className={`mt-2 font-heading text-2xl font-extrabold tabular-nums ${corValor}`}>
          {value}
        </p>
        {hint ? <p className="mt-1 text-xs text-content-muted">{hint}</p> : null}
      </div>
    </div>
  )
}
