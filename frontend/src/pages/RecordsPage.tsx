import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'

import { ValidityBadge } from '@/components/Badges'
import { ExportButton } from '@/components/ExportButton'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { FilterBar } from '@/components/FilterBar'
import { Pagination } from '@/components/Pagination'
import { RecordDiagnosisModal } from '@/components/RecordDiagnosisModal'
import { filtersFromSearch, filtersToParams, type RecordFilters } from '@/lib/filters'
import { tamanhoDaUrl, tamanhoParaUrl } from '@/lib/pagination'
import { recordsQuery } from '@/lib/queries'
import type { RecordItem } from '@/lib/types'

/**
 * Registros por página, e o conjunto oferecido no seletor.
 *
 * O teto é 200 porque é o que `parse_pagination` aceita em `count`
 * (`apps/harvests/views.py`). Não é um número tímido: 200 registros já são
 * ~108 KB de resposta, e a origem derruba cerca de metade das conexões — uma
 * página maior passa mais tempo exposta a essa falha, e a repetição só cobre
 * falha de transporte.
 */
const PAGE_SIZE = 25
const TAMANHOS = [25, 50, 100, 200] as const

/**
 * Registros da coleta.
 *
 * Paginação e filtros são resolvidos no servidor: a coleta tem dezenas de
 * milhares de registros e trazer tudo para o navegador não é opção. A tabela
 * apenas apresenta a página corrente — daí ser HTML puro sobre as classes
 * `br-table`, e não uma tabela com estado. Ordenar só os 20 visíveis daria a
 * ilusão de ordenar o conjunto.
 */
export function RecordsPage() {
  const { t } = useTranslation()
  const { snapshotId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()

  const filtros = filtersFromSearch(searchParams)
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const porPagina = tamanhoDaUrl(searchParams.get('por'), TAMANHOS, PAGE_SIZE)

  /*
   * Um modal por vez, montado só quando há registro escolhido — o mesmo arranjo
   * do diagnóstico. Guardar a linha inteira, e não só o identificador, é o que
   * dispensa uma segunda consulta: o detalhe da validação já vem nela.
   */
  const [registroAberto, setRegistroAberto] = useState<RecordItem | null>(null)

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    ...recordsQuery(snapshotId, page, porPagina, filtros),
    // Mantém a página anterior visível enquanto a próxima carrega: o Harvester
    // é lento e piscar a tabela a cada passo é pior que um leve atraso.
    placeholderData: keepPreviousData,
  })

  /*
   * Monta a URL da listagem a partir das três coisas que a definem. O tamanho
   * de página entra aqui porque é preferência de exibição, não filtro: quem
   * escolheu ver 200 por vez continua vendo 200 depois de mexer no recorte.
   */
  const urlDaListagem = useCallback((recorte: RecordFilters, destino: number, tamanho: number) => {
    const params = filtersToParams(recorte)
    if (destino > 1) params.set('page', String(destino))
    const por = tamanhoParaUrl(tamanho, PAGE_SIZE)
    if (por) params.set('por', por)
    return params
  }, [])

  /** Mudar filtro volta para a primeira página — a antiga pode não existir mais. */
  const aplicarFiltros = useCallback(
    (novos: RecordFilters) => {
      setSearchParams(urlDaListagem(novos, 1, porPagina), { replace: false })
    },
    [porPagina, setSearchParams, urlDaListagem],
  )

  const irParaPagina = useCallback(
    (destino: number) => {
      setSearchParams(urlDaListagem(filtros, destino, porPagina))
    },
    [filtros, porPagina, setSearchParams, urlDaListagem],
  )

  /** Trocar o tamanho reinicia a paginação: a página 7 de 25 não existe com 200. */
  const mudarTamanho = useCallback(
    (novo: number) => {
      setSearchParams(urlDaListagem(filtros, 1, novo))
    },
    [filtros, setSearchParams, urlDaListagem],
  )

  // Os filtros seguem no link do registro para que voltar preserve o recorte.
  const sufixoFiltros = useMemo(() => {
    const query = filtersToParams(filtros).toString()
    return query ? `?${query}` : ''
  }, [filtros])

  const registros = data?.results ?? []

  if (isPending) return <Loading id="records-page-loading" />
  if (isError)
    return <ErrorState id="records-page-error" error={error} onRetry={() => void refetch()} />

  return (
    <div id="records-page">
      <div
        id="records-page-toolbar"
        className="d-flex flex-wrap align-items-start justify-content-between mb-3"
        style={{ gap: 'var(--spacing-scale-2x)' }}
      >
        <FilterBar id="records-page-filters" filters={filtros} onChange={aplicarFiltros} />
        <ExportButton id="records-page-export" snapshotId={snapshotId} filters={filtros} />
      </div>

      <p id="records-page-total" className="text-gray-70 mb-2">
        {t('records.total', { count: data.totalElements ?? 0 })}
        {isFetching ? ` · ${t('common.loading')}` : ''}
      </p>

      {registros.length === 0 ? (
        <Empty id="records-page-empty" label={t('records.none')} />
      ) : (
        <>
          <div
            id="records-page-table-wrapper"
            className="br-table mb-3"
            style={{ overflowX: 'auto' }}
          >
            <table id="records-page-table">
              <thead id="records-page-table-head">
                <tr id="records-page-table-head-row">
                  <th id="records-page-column-identifier" scope="col">
                    {t('records.columns.identifier')}
                  </th>
                  <th id="records-page-column-valid" scope="col">
                    {t('records.columns.valid')}
                  </th>
                  <th id="records-page-column-transformed" scope="col">
                    {t('records.columns.transformed')}
                  </th>
                  <th id="records-page-column-origin" scope="col">
                    {t('records.columns.origin')}
                  </th>
                  <th id="records-page-column-prefix" scope="col">
                    {t('records.columns.prefix')}
                  </th>
                  <th id="records-page-column-set" scope="col">
                    {t('records.columns.set')}
                  </th>
                  <th id="records-page-column-details" scope="col">
                    {t('records.columns.details')}
                  </th>
                </tr>
              </thead>
              <tbody id="records-page-table-body">
                {registros.map((registro) => (
                  <tr id={`records-page-row-${registro.id}`} key={registro.id}>
                    <td id={`records-page-row-${registro.id}-identifier`}>
                      <Link
                        id={`records-page-row-${registro.id}-link`}
                        to={`/coletas/${snapshotId}/registros/${registro.identifier}${sufixoFiltros}`}
                        className="text-down-01"
                        style={{ wordBreak: 'break-all' }}
                      >
                        {registro.identifier}
                      </Link>
                    </td>
                    <td id={`records-page-row-${registro.id}-valid`}>
                      <ValidityBadge
                        id={`records-page-row-${registro.id}-validity`}
                        valid={registro.isValid}
                      />
                    </td>
                    <td id={`records-page-row-${registro.id}-transformed`}>
                      {registro.isTransformed === null || registro.isTransformed === undefined
                        ? '—'
                        : registro.isTransformed
                          ? t('common.yes')
                          : t('common.no')}
                    </td>
                    {/*
                      A origem é o baseURL OAI de onde o registro veio, e não o
                      cadastro atual do repositório: numa coleta a origem pode
                      diferir de linha para linha (repositório migrado de
                      endereço), e é ela que explica de onde saiu aquele
                      metadado. Vai em fonte menor e com quebra porque é uma URL
                      longa ao lado de colunas curtas.
                    */}
                    <td
                      id={`records-page-row-${registro.id}-origin`}
                      className="text-down-01 text-gray-70"
                      style={{ wordBreak: 'break-all' }}
                    >
                      {registro.origin ?? '—'}
                    </td>
                    <td
                      id={`records-page-row-${registro.id}-prefix`}
                      className="text-down-01 text-gray-70"
                    >
                      {registro.metadataPrefix ?? '—'}
                    </td>
                    <td id={`records-page-row-${registro.id}-set`} className="text-gray-70">
                      {registro.setSpec ?? '—'}
                    </td>
                    <td id={`records-page-row-${registro.id}-details`}>
                      <button
                        id={`records-page-row-${registro.id}-details-button`}
                        type="button"
                        onClick={() => setRegistroAberto(registro)}
                        aria-label={t('recordDiagnosis.open', { record: registro.identifier })}
                        title={t('recordDiagnosis.openShort')}
                        className="br-button circle small"
                      >
                        <i className="fas fa-clipboard-check" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            id="records-page-pagination"
            page={data.page}
            totalPages={data.totalPages ?? 1}
            onChange={irParaPagina}
            tamanho={porPagina}
            tamanhos={TAMANHOS}
            onTamanho={mudarTamanho}
          />
        </>
      )}

      {registroAberto ? (
        <RecordDiagnosisModal
          id={`records-page-row-${registroAberto.id}-details-modal`}
          aberto
          onFechar={() => setRegistroAberto(null)}
          snapshotId={snapshotId}
          registro={registroAberto}
        />
      ) : null}
    </div>
  )
}
