import { BrButton, BrInput, BrSelectStandard } from '@govbr-ds/react-components'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'

import { useAuth } from '@/auth/context'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { Modal } from '@/components/Modal'
import { PageHeader } from '@/components/PageHeader'
import { Pagination } from '@/components/Pagination'
import { ApiError, apiPost } from '@/lib/api'
import { dicaDeColuna } from '@/lib/columnHints'
import { tamanhoDaUrl, tamanhoParaUrl } from '@/lib/pagination'
import { harvestRequestsQuery } from '@/lib/queries'
import type { HarvestRequestItem } from '@/lib/types'

const SITUACOES = ['PENDENTE', 'ATENDIDA', 'RECUSADA'] as const

/** Pagina no servidor, como as notificações: sem "tudo", teto de 200. */
const POR_PAGINA = 25
const TAMANHOS = [10, 25, 50, 100] as const

/**
 * Fila de demandas de nova coleta.
 *
 * A mesma tela serve aos dois perfis, com recorte feito no backend: o ADMIN vê
 * todas — a demanda é única e compartilhada entre eles — e o gestor vê as dos
 * repositórios que gerencia, inclusive as abertas por colegas. Só o ADMIN
 * enxerga os botões de resolver; quem barra de fato é o backend, com 403.
 *
 * Abre filtrada por pendentes, que é o trabalho a fazer.
 */
export function DemandsPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [situacao, setSituacao] = useState<string>('PENDENTE')
  const [resolvendo, setResolvendo] = useState<{
    demanda: HarvestRequestItem
    acao: 'attend' | 'refuse'
  } | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const pagina = Math.max(1, Number(searchParams.get('page') ?? 1))
  const porPagina = tamanhoDaUrl(searchParams.get('por'), TAMANHOS, POR_PAGINA)

  const { data, isPending, isError, error, refetch } = useQuery({
    ...harvestRequestsQuery({ status: situacao, page: pagina, count: porPagina }),
    placeholderData: keepPreviousData,
  })

  const alterarParams = (mudanca: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams)
    mudanca(params)
    setSearchParams(params, { replace: true })
  }

  const irParaPagina = (destino: number) =>
    alterarParams((params) =>
      destino <= 1 ? params.delete('page') : params.set('page', String(destino)),
    )

  /** Trocar o tamanho volta ao início: a página N de 10 não é a página N de 50. */
  const mudarTamanho = (tamanho: number) =>
    alterarParams((params) => {
      const valor = tamanhoParaUrl(tamanho, POR_PAGINA)
      if (valor) params.set('por', valor)
      else params.delete('por')
      params.delete('page')
    })

  /* Trocar a situação também: a fila filtrada é outra, e mais curta. */
  const filtrarPor = (valor: string) => {
    setSituacao(valor)
    alterarParams((params) => params.delete('page'))
  }

  const quando = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
  const ehAdmin = user?.profile === 'ADMIN'

  return (
    <div id="demands-page" className="d-flex flex-column gap-4">
      <PageHeader
        id="demands-page-header"
        eyebrow={ehAdmin ? t('nav.admin') : undefined}
        title={t('demands.title')}
        description={t(ehAdmin ? 'demands.subtitleAdmin' : 'demands.subtitleManager')}
      />

      <div id="demands-page-filters" style={{ maxWidth: '18rem' }}>
        <BrSelectStandard
          id="demands-page-status"
          label={t('demands.columns.status')}
          value={situacao}
          onChange={(evento) => filtrarPor(evento.target.value)}
          options={[
            { label: t('demands.all'), value: '' },
            ...SITUACOES.map((valor) => ({ label: t(`demands.status.${valor}`), value: valor })),
          ]}
        />
      </div>

      {isPending ? <Loading id="demands-page-loading" /> : null}
      {isError ? (
        <ErrorState id="demands-page-error" error={error} onRetry={() => void refetch()} />
      ) : null}

      {data ? (
        data.results.length === 0 ? (
          <Empty id="demands-page-empty" label={t('demands.none')} />
        ) : (
          <>
            <div id="demands-page-table-wrapper" className="br-table" style={{ overflowX: 'auto' }}>
              <table id="demands-page-table">
                <thead id="demands-page-table-head">
                  <tr id="demands-page-table-head-row" className="bg-gray-2 text-left">
                    {(['repository', 'requester', 'openedAt', 'status', 'actions'] as const).map(
                      (coluna) => (
                        <th
                          id={`demands-page-column-${coluna}`}
                          key={coluna}
                          className="px-3 py-2 text-down-01 text-bold"
                          {...dicaDeColuna(t(`demands.columnHints.${coluna}`))}
                        >
                          {t(`demands.columns.${coluna}`)}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody id="demands-page-table-body">
                  {data.results.map((demanda) => (
                    <Linha
                      key={demanda.id}
                      demanda={demanda}
                      quando={quando}
                      ehAdmin={ehAdmin}
                      onResolver={(acao) => setResolvendo({ demanda, acao })}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              id="demands-page-pagination"
              page={pagina}
              totalPages={Math.max(1, Math.ceil(data.count / porPagina))}
              onChange={irParaPagina}
              tamanho={porPagina}
              tamanhos={TAMANHOS}
              onTamanho={mudarTamanho}
            />
          </>
        )
      ) : null}

      {resolvendo ? (
        <ResolverModal
          demanda={resolvendo.demanda}
          acao={resolvendo.acao}
          onFechar={() => setResolvendo(null)}
        />
      ) : null}
    </div>
  )
}

function Linha({
  demanda,
  quando,
  ehAdmin,
  onResolver,
}: {
  demanda: HarvestRequestItem
  quando: Intl.DateTimeFormat
  ehAdmin: boolean
  onResolver: (acao: 'attend' | 'refuse') => void
}) {
  const { t } = useTranslation()
  const id = `demands-page-row-${demanda.id}`
  const pendente = demanda.status === 'PENDENTE'

  return (
    <tr id={id}>
      <td id={`${id}-repository`} className="px-3 py-2">
        <span id={`${id}-acronym`} className="text-semi-bold">
          {demanda.acronym || demanda.harvesterRepositoryId}
        </span>
        {demanda.note ? (
          <span id={`${id}-note`} className="d-block text-down-01 text-gray-70">
            {demanda.note}
          </span>
        ) : null}
      </td>

      <td id={`${id}-requester`} className="px-3 py-2 text-down-01">
        {demanda.requesterUsername}
      </td>

      <td id={`${id}-opened-at`} className="px-3 py-2 text-down-01 text-gray-70">
        {quando.format(new Date(demanda.createdAt))}
      </td>

      <td id={`${id}-status`} className="px-3 py-2 text-down-01">
        <span id={`${id}-status-label`} className="text-semi-bold">
          {t(`demands.status.${demanda.status}`)}
        </span>
        {/* O desfecho junto da situação: é o que o gestor veio ver. */}
        {demanda.status === 'ATENDIDA' ? (
          <span id={`${id}-snapshot`} className="d-block text-gray-70">
            {t('demands.attendedWith', { snapshot: demanda.snapshotId })}
          </span>
        ) : null}
        {demanda.status === 'RECUSADA' ? (
          <span id={`${id}-reason`} className="d-block text-gray-70">
            {demanda.reason}
          </span>
        ) : null}
      </td>

      <td id={`${id}-actions`} className="px-3 py-2">
        {ehAdmin && pendente ? (
          <span id={`${id}-buttons`} className="d-flex flex-wrap gap-2">
            <BrButton
              id={`${id}-attend`}
              type="button"
              primary
              size="small"
              onClick={() => onResolver('attend')}
            >
              {t('demands.attend')}
            </BrButton>
            <BrButton
              id={`${id}-refuse`}
              type="button"
              secondary
              size="small"
              onClick={() => onResolver('refuse')}
            >
              {t('demands.refuse')}
            </BrButton>
          </span>
        ) : (
          <span id={`${id}-resolved-by`} className="text-down-01 text-gray-70">
            {demanda.resolvedByUsername ?? '—'}
          </span>
        )}
      </td>
    </tr>
  )
}

/**
 * Atender ou recusar.
 *
 * Um modal para as duas ações porque a forma é a mesma — um campo obrigatório e
 * a confirmação —, e o que muda é o rótulo e para onde o valor vai. A
 * confirmação nasce desativada até o campo estar preenchido, como a diretriz de
 * Modal recomenda.
 */
function ResolverModal({
  demanda,
  acao,
  onFechar,
}: {
  demanda: HarvestRequestItem
  acao: 'attend' | 'refuse'
  onFechar: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [valor, setValor] = useState('')
  const atender = acao === 'attend'
  const id = `demands-page-resolve-${demanda.id}`

  const resolver = useMutation({
    mutationFn: () =>
      apiPost(
        `/demands/${demanda.id}/${atender ? 'attend' : 'refuse'}/`,
        atender ? { snapshotId: valor.trim() } : { reason: valor.trim() },
      ),
    onSuccess: () => {
      onFechar()
      // A resolução gera um recado ao solicitante, então o sino dele muda.
      void queryClient.invalidateQueries({ queryKey: ['demands'] })
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  return (
    <Modal
      id={id}
      aberto
      onFechar={onFechar}
      titulo={t(atender ? 'demands.attendTitle' : 'demands.refuseTitle')}
      descricao={demanda.acronym || demanda.harvesterRepositoryId}
      acoes={
        <>
          <BrButton id={`${id}-cancel`} type="button" secondary onClick={onFechar}>
            {t('common.cancel')}
          </BrButton>
          <BrButton
            id={`${id}-submit`}
            type="button"
            primary
            loading={resolver.isPending}
            disabled={resolver.isPending || valor.trim() === ''}
            onClick={() => resolver.mutate()}
          >
            {t(atender ? 'demands.attend' : 'demands.refuse')}
          </BrButton>
        </>
      }
    >
      {resolver.isError ? (
        <p id={`${id}-error`} role="alert" className="text-base text-red-vivid-50">
          {resolver.error instanceof ApiError ? resolver.error.detail : t('common.error')}
        </p>
      ) : null}

      {atender ? (
        <BrInput
          id={`${id}-snapshot`}
          label={t('demands.snapshotField')}
          value={valor}
          onChange={(evento) => setValor(evento.target.value)}
        />
      ) : (
        <div id={`${id}-reason`} className="br-textarea">
          <label id={`${id}-reason-label`} htmlFor={`${id}-reason-input`}>
            {t('demands.reasonField')}
          </label>
          <textarea
            id={`${id}-reason-input`}
            rows={4}
            maxLength={1000}
            value={valor}
            onChange={(evento) => setValor(evento.target.value)}
          />
        </div>
      )}
    </Modal>
  )
}
