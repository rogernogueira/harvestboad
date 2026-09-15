import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** Classifica o status de coleta do Harvester em três níveis visuais. */
function harvestTone(status: string): 'ok' | 'warn' | 'down' {
  const value = status.toUpperCase()
  if (value.includes('ERROR')) return 'down'
  if (value.includes('VALID')) return 'ok'
  return 'warn'
}

/**
 * Rótulos curtos para os estados de coleta.
 *
 * A origem devolve valores como `HARVESTING_FINISHED_ERROR` — 25 caracteres sem
 * espaço, que numa coluna estreita não quebram e transbordam a célula, gerando
 * barra de rolagem na tabela inteira. A interface do próprio Harvester faz a
 * mesma redução (o filtro `ShortenStatus` dela).
 *
 * O valor bruto continua acessível no `title`.
 */
const ROTULOS: Record<string, string> = {
  VALID: 'harvestStatus.valid',
  HARVESTING: 'harvestStatus.running',
  HARVESTING_FINISHED_VALID: 'harvestStatus.finishedValid',
  HARVESTING_FINISHED_ERROR: 'harvestStatus.finishedError',
  HARVESTING_STOPPED: 'harvestStatus.stopped',
  HARVESTING_ERROR: 'harvestStatus.error',
  INDEXED: 'harvestStatus.indexed',
}

const TONES = {
  ok: 'border-ok bg-ok-soft text-ok',
  warn: 'border-warn bg-warn-soft text-warn',
  down: 'border-down bg-down-soft text-down',
} as const

/**
 * Marcador de estado.
 *
 * Retangular com barra lateral, seguindo a linguagem angular do design — e a
 * cor nunca é o único sinal: o texto sempre nomeia o estado.
 */
export function Tag({
  tone,
  title,
  children,
}: {
  tone: keyof typeof TONES
  title?: string
  children: ReactNode
}) {
  return (
    <span
      title={title}
      // `break-words` é rede de proteção: um estado novo da origem, sem rótulo
      // curto, quebra em vez de empurrar a tabela.
      className={`inline-flex items-center border-l-2 px-2 py-0.5 font-mono text-[0.6875rem] tracking-wide break-words uppercase ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}

export function HarvestStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  const chave = ROTULOS[status.toUpperCase()]

  return (
    <Tag tone={harvestTone(status)} title={status}>
      {chave ? t(chave) : status}
    </Tag>
  )
}

export function ValidityBadge({ valid }: { valid: boolean | null | undefined }) {
  const { t } = useTranslation()
  if (valid === null || valid === undefined) return <span className="text-content-muted">—</span>
  return <Tag tone={valid ? 'ok' : 'down'}>{valid ? t('records.valid') : t('records.invalid')}</Tag>
}
