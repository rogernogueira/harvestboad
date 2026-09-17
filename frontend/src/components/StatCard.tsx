import type { ReactNode } from 'react'

/**
 * Cartão de indicador do painel.
 *
 * A faixa colorida no topo é o recurso da identidade para diferenciar blocos
 * sem recorrer a fundos coloridos, que prejudicariam o contraste do número.
 *
 * Os cartões sempre vêm em série, então o `id` é do chamador; o padrão só cobre
 * um uso isolado.
 */
export function StatCard({
  id = 'stat-card',
  label,
  value,
  hint,
  tone,
}: {
  id?: string
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
    <div id={id} className="panel overflow-hidden">
      <div id={`${id}-stripe`} className={`h-1 ${faixa}`} aria-hidden="true" />
      <div id={`${id}-body`} className="p-4">
        <p id={`${id}-label`} className="eyebrow">
          {label}
        </p>
        <p
          id={`${id}-value`}
          className={`mt-2 font-heading text-2xl font-extrabold tabular-nums ${corValor}`}
        >
          {value}
        </p>
        {hint ? (
          <p id={`${id}-hint`} className="mt-1 text-xs text-content-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  )
}
