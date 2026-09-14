import { useTranslation } from 'react-i18next'

/** Classifica o status de coleta do Harvester em três níveis visuais. */
function harvestTone(status: string): 'ok' | 'warn' | 'down' {
  const value = status.toUpperCase()
  if (value.includes('ERROR')) return 'down'
  if (value.includes('VALID')) return 'ok'
  return 'warn'
}

const TONES = {
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/20 text-warn',
  down: 'bg-down/15 text-down',
} as const

export function Tag({
  tone,
  children,
}: {
  tone: keyof typeof TONES
  children: React.ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONES[tone]}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
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
  return (
    <Tag tone={valid ? 'ok' : 'down'}>{valid ? t('records.valid') : t('records.invalid')}</Tag>
  )
}
