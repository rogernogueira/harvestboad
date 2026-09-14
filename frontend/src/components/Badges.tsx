import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** Classifica o status de coleta do Harvester em três níveis visuais. */
function harvestTone(status: string): 'ok' | 'warn' | 'down' {
  const value = status.toUpperCase()
  if (value.includes('ERROR')) return 'down'
  if (value.includes('VALID')) return 'ok'
  return 'warn'
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
export function Tag({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center border-l-2 px-2 py-0.5 font-mono text-[0.6875rem] tracking-wide uppercase ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}

export function HarvestStatusBadge({ status }: { status: string }) {
  return <Tag tone={harvestTone(status)}>{status}</Tag>
}

export function ValidityBadge({ valid }: { valid: boolean | null | undefined }) {
  const { t } = useTranslation()
  if (valid === null || valid === undefined) return <span className="text-content-muted">—</span>
  return <Tag tone={valid ? 'ok' : 'down'}>{valid ? t('records.valid') : t('records.invalid')}</Tag>
}
