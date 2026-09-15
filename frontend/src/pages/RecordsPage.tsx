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
 * apenas apresenta a página corrente — daí ser HTML puro, como as demais do
 * projeto. Ordenar só os 20 visíveis daria a ilusão de ordenar o conjunto.
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

  if (isPending) return <Loading />
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <FilterBar filters={filtros} onChange={aplicarFiltros} />
        <ExportButton snapshotId={snapshotId} filters={filtros} />
      </div>

      <p className="text-sm text-content-muted">
        {t('records.total', { count: data.totalElements ?? 0 })}
        {isFetching ? ` · ${t('common.loading')}` : ''}
      </p>

      {registros.length === 0 ? (
        <Empty label={t('records.none')} />
      ) : (
        <>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-3xl border-collapse text-sm">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-muted text-left">
                  <th className="px-4 py-3 font-heading text-xs font-bold">
                    {t('records.columns.identifier')}
                  </th>
                  <th className="px-4 py-3 font-heading text-xs font-bold">
                    {t('records.columns.valid')}
                  </th>
                  <th className="px-4 py-3 font-heading text-xs font-bold">
                    {t('records.columns.transformed')}
                  </th>
                  <th className="px-4 py-3 font-heading text-xs font-bold">
                    {t('records.columns.set')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {registros.map((registro) => (
                  <tr key={registro.id} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-3 align-top">
                      <Link
                        to={`/coletas/${snapshotId}/registros/${registro.identifier}${sufixoFiltros}`}
                        className="font-mono text-xs break-all text-brand-strong hover:underline"
                      >
                        {registro.identifier}
                      </Link>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <ValidityBadge valid={registro.isValid} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      {registro.isTransformed === null || registro.isTransformed === undefined
                        ? '—'
                        : registro.isTransformed
                          ? t('common.yes')
                          : t('common.no')}
                    </td>
                    <td className="px-4 py-3 align-top text-content-muted">
                      {registro.setSpec ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={data.page} totalPages={data.totalPages ?? 1} onChange={irParaPagina} />
        </>
      )}
    </div>
  )
}
