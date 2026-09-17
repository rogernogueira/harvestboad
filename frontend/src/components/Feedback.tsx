import { BrButton, BrLoading, BrMessage } from '@govbr-ds/react-components'
import { useTranslation } from 'react-i18next'

import { ApiError } from '@/lib/api'

/**
 * Estado de carregamento.
 *
 * O `BrLoading` entra dentro de um wrapper com `role="status"` porque ele não
 * tem região viva: o componente renderiza só a roda e o rótulo, sem `role` nem
 * `aria-live`, e sozinho não seria anunciado por leitor de tela. O `role` fica
 * aqui, e não nele, porque ele também não aceita `id` nem `className` — as
 * props são apenas `label` e `large`.
 */
export function Loading({ id = 'loading', label }: { id?: string; label?: string }) {
  const { t } = useTranslation()
  return (
    <div id={id} role="status" className="py-5">
      <BrLoading label={label ?? t('common.loading')} />
    </div>
  )
}

/**
 * Lista vazia.
 *
 * Continua sendo markup próprio: o `BrMessage` com `status="info"` chamaria
 * atenção demais para o que é ausência de resultado, não ocorrência.
 */
export function Empty({ id = 'empty', label }: { id?: string; label?: string }) {
  const { t } = useTranslation()
  return (
    <div id={id} className="br-card">
      <div id={`${id}-body`} className="card-content text-center py-5">
        {label ?? t('common.noResults')}
      </div>
    </div>
  )
}

/**
 * Erro de carregamento.
 *
 * O backend distingue indisponibilidade temporária do Harvester (503) de erro
 * definitivo, e a mensagem muda junto: só faz sentido oferecer "tentar de novo"
 * no primeiro caso.
 *
 * O `BrMessage` já emite `role="alert"` por conta própria, então o aviso é
 * anunciado sem precisarmos declarar o papel.
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
    <div id={id}>
      <BrMessage id={`${id}-message`} status="danger" message={mensagem} />
      {onRetry && transitorio ? (
        <BrButton id={`${id}-retry`} type="button" secondary onClick={onRetry} className="mt-2">
          {t('common.retry')}
        </BrButton>
      ) : null}
    </div>
  )
}
