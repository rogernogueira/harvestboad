import { useTranslation } from 'react-i18next'

import { ApiError } from '@/lib/api'

export function Loading({ label }: { label?: string }) {
  const { t } = useTranslation()
  return (
    <p className="py-8 text-sm text-content-muted" role="status">
      {label ?? t('common.loading')}
    </p>
  )
}

export function Empty({ label }: { label?: string }) {
  const { t } = useTranslation()
  return <p className="py-8 text-sm text-content-muted">{label ?? t('common.noResults')}</p>
}

/**
 * Erro de carregamento.
 *
 * O backend distingue indisponibilidade temporária do Harvester (503) de erro
 * definitivo, e a mensagem muda junto: só faz sentido oferecer "tentar de novo"
 * no primeiro caso.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation()
  const status = error instanceof ApiError ? error.status : undefined
  const transitorio = status === 503 || status === 502 || status === undefined

  let mensagem = t('common.error')
  if (status === 503) mensagem = t('common.harvesterDown')
  else if (status === 502) mensagem = t('common.harvesterBad')
  else if (status === 403) mensagem = t('common.forbidden')
  else if (status === 404) mensagem = t('common.notFound')
  else if (error instanceof ApiError) mensagem = error.detail

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-raised p-6">
      <p className="text-sm text-down">{mensagem}</p>
      {onRetry && transitorio ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong"
        >
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  )
}
