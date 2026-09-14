import type { ReactNode } from 'react'

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'ok' | 'down'
}) {
  const valueTone = tone === 'ok' ? 'text-ok' : tone === 'down' ? 'text-down' : ''
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-raised p-4">
      <p className="text-xs font-medium tracking-wide text-content-muted uppercase">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${valueTone}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-content-muted">{hint}</p> : null}
    </div>
  )
}
