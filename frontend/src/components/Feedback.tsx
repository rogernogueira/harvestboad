import { useTranslation } from 'react-i18next'

import { ApiError } from '@/lib/api'

export function Loading({ id = 'loading', label }: { id?: string; label?: string }) {
  const { t } = useTranslation()
  return (
    <p id={id} className="flex items-center gap-2 py-8 text-sm text-content-muted" role="status">
      <span
        id={`${id}-spinner`}
        aria-hidden="true"
        className="inline-block size-3 animate-spin border-2 border-border-strong border-t-brand"
      />
      {label ?? t('common.loading')}
    </p>
  )
}

export function Empty({ id = 'empty', label }: { id?: string; label?: string }) {
  const { t } = useTranslation()
  return (
    <p id={id} className="panel px-4 py-8 text-center text-sm text-content-muted">
      {label ?? t('common.noResults')}
    </p>
  )
}

/**
 * Erro de carregamento.
 *
 * O backend distingue indisponibilidade temporária do Harvester (503) de erro
 * definitivo, e a mensagem muda junto: só faz sentido oferecer "tentar de novo"
 * no primeiro caso.
 */
export function ErrorState({
  id = 'error-state',
  error,
  onRetry,
}: {
  id?: string
  error: unknown
  onRetry?: () => void
}) {
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
    <div id={id} className="border-l-2 border-down bg-down-soft px-4 py-4">
      <p id={`${id}-message`} className="text-sm text-down">
        {mensagem}
      </p>
      {onRetry && transitorio ? (
        <button
          id={`${id}-retry`}
          type="button"
          onClick={onRetry}
          className="mt-3 bg-brand px-3 py-1.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-strong"
        >
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  )
}
