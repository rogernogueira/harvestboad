import type { ReactNode } from 'react'

/*
 * Cor da faixa e do número, por tom.
 *
 * São os passos que o Padrão Digital de Governo atribui à função Feedback:
 * Sucesso `--green-cool-vivid-50` e Erro `--red-vivid-50`.
 *
 * O número é 24px em negrito, o que o padrão classifica como texto grande —
 * limite de 3:1. Sobre branco, os dois dão 4,59 e 4,60.
 */
const FAIXAS = {
  brand: 'bg-blue-warm-vivid-70',
  ok: 'bg-green-cool-vivid-50',
  down: 'bg-red-vivid-50',
  gold: 'bg-yellow-vivid-20',
} as const

const CORES_DO_VALOR = {
  brand: undefined,
  ok: 'text-green-cool-vivid-50',
  down: 'text-red-vivid-50',
  gold: undefined,
} as const

/**
 * Cartão de indicador do painel.
 *
 * A faixa colorida no topo é o recurso da identidade para diferenciar blocos
 * sem recorrer a fundos coloridos, que prejudicariam o contraste do número.
 * Ela é o motivo de o cartão não ser um `BrCard`: aquele não tem faixa, e
 * também não aceita `id` — que aqui é obrigatório, já que os cartões sempre
 * vêm em série. As classes são as do design system, então o visual é o do
 * padrão.
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
  tone?: keyof typeof FAIXAS
}) {
  const tomAtual = tone ?? 'brand'

  return (
    <div id={id} className="br-card">
      <div
        id={`${id}-stripe`}
        className={FAIXAS[tomAtual]}
        style={{ height: 'var(--surface-width-lg)' }}
        aria-hidden="true"
      />
      <div id={`${id}-body`} className="card-content p-3">
        <p id={`${id}-label`} className="eyebrow mb-1">
          {label}
        </p>
        <p
          id={`${id}-value`}
          className={`text-up-03 text-bold mb-0 ${CORES_DO_VALOR[tomAtual] ?? ''}`}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
        </p>
        {hint ? (
          <p id={`${id}-hint`} className="text-down-01 mt-1 mb-0">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  )
}
