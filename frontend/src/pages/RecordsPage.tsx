import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'

import { ValidityBadge } from '@/components/Badges'
import { ExportButton } from '@/components/ExportButton'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { FilterBar } from '@/components/FilterBar'
import { Pagination } from '@/components/Pagination'
import { filtersFromSearch, filtersToParams, type RecordFilters } from '@/lib/filters'
import { recordsQuery } from '@/lib/queries'

const PAGE_SIZE = 20

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

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    ...recordsQuery(snapshotId, page, PAGE_SIZE, filtros),
    // Mantém a página anterior visível enquanto a próxima carrega: o Harvester
    // é lento e piscar a tabela a cada passo é pior que um leve atraso.
    placeholderData: keepPreviousData,
  })

  /** Mudar filtro volta para a primeira página — a antiga pode não existir mais. */
  const aplicarFiltros = useCallback(
    (novos: RecordFilters) => {
      const params = filtersToParams(novos)
      setSearchParams(params, { replace: false })
    },
    [setSearchParams],
  )

  const irParaPagina = useCallback(
    (destino: number) => {
      const params = filtersToParams(filtros)
      if (destino > 1) params.set('page', String(destino))
      setSearchParams(params)
    },
    [filtros, setSearchParams],
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
                  <th id="records-page-column-set" scope="col">
                    {t('records.columns.set')}
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
                    <td id={`records-page-row-${registro.id}-set`} className="text-gray-70">
                      {registro.setSpec ?? '—'}
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
          />
        </>
      )}
    </div>
  )
}
