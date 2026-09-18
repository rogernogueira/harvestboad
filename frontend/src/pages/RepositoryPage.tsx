import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Breadcrumb } from '@/components/Breadcrumb'
import { HarvestStatusBadge } from '@/components/Badges'
import { CsvDownloadButton } from '@/components/CsvDownloadButton'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { dicaDeColuna } from '@/lib/columnHints'
import { repositoryHarvestsQuery, repositoryQuery } from '@/lib/queries'

/** Visão geral do repositório e histórico de coletas. */
/**
 * Inválidos de uma coleta: o número que a origem não manda.
 *
 * `null` quando falta o total ou os válidos — a subtração aí seria invenção, e
 * zero leria como "nenhum inválido", que é outra afirmação.
 */
function invalidos(coleta: { size: number | null; validSize: number | null }): number | null {
  if (typeof coleta.size !== 'number' || typeof coleta.validSize !== 'number') return null
  return Math.max(0, coleta.size - coleta.validSize)
}

export function RepositoryPage() {
  const { t, i18n } = useTranslation()
  const { repositoryId = '' } = useParams()

  const repositorio = useQuery(repositoryQuery(repositoryId))
  const coletas = useQuery(repositoryHarvestsQuery(repositoryId))

  const dataFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'short', timeStyle: 'short' }),
    [i18n.resolvedLanguage],
  )
  const numero = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage),
    [i18n.resolvedLanguage],
  )

  // A série vai da coleta mais antiga para a mais recente, ao contrário da lista.
  const serie = useMemo(() => {
    const itens = coletas.data?.results ?? []
    return [...itens]
      .filter((coleta) => coleta.endTime)
      .reverse()
      .map((coleta) => ({
        data: (coleta.endTime ?? '').slice(0, 10),
        registros: coleta.size ?? 0,
        validos: coleta.validSize ?? 0,
        // A origem não manda inválidos: é a diferença, a mesma conta do painel.
        invalidos: invalidos(coleta) ?? 0,
      }))
  }, [coletas.data])

  if (repositorio.isPending) return <Loading id="repository-page-loading" />
  if (repositorio.isError)
    return (
      <ErrorState
        id="repository-page-error"
        error={repositorio.error}
        onRetry={() => void repositorio.refetch()}
      />
    )

  const repo = repositorio.data

  return (
    <div id="repository-page" className="d-flex flex-column gap-5">
      <div id="repository-page-heading">
        <Breadcrumb
          id="repository-page-breadcrumb"
          items={[
            { label: t('repositories.title'), to: '/' },
            { label: repo.acronym ?? repositoryId },
          ]}
        />
        <PageHeader
          id="repository-page-header"
          eyebrow={repo.acronym ?? repositoryId}
          title={repo.name ?? t('repositories.unnamed')}
          description={repo.institutionName}
        />
      </div>

      <section id="repository-page-stats" className="row mb-4">
        <div id="repository-page-stat-acronym-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="repository-page-stat-acronym"
            label={t('repository.acronym')}
            value={repo.acronym ?? '—'}
          />
        </div>
        <div id="repository-page-stat-metadata-prefix-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="repository-page-stat-metadata-prefix"
            label={t('repository.metadataPrefix')}
            value={repo.metadataPrefix ?? '—'}
          />
        </div>
        <div id="repository-page-stat-store-schema-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="repository-page-stat-store-schema"
            label={t('repository.storeSchema')}
            value={repo.metadataStoreSchema ?? '—'}
          />
        </div>
        <div id="repository-page-stat-published-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="repository-page-stat-published"
            label={t('repository.published')}
            value={repo.published ? t('common.yes') : t('common.no')}
          />
        </div>
      </section>

      <section id="repository-page-harvests" className="d-flex flex-column gap-4">
        <div
          id="repository-page-harvests-toolbar"
          className="d-flex flex-wrap align-items-center justify-content-between"
          style={{ gap: 'var(--spacing-scale-2x)' }}
        >
          <h2 id="repository-page-harvests-title" className="text-base text-bold mb-0">
            {t('harvests.title')}
          </h2>
          {coletas.data && coletas.data.count > 0 ? (
            <CsvDownloadButton
              id="repository-page-harvests-export"
              path={`/reports/repositories/${repositoryId}/harvests.csv`}
              filename={`repositorio-${repositoryId}-coletas.csv`}
              label={t('harvests.exportHistory')}
            />
          ) : null}
        </div>

        {coletas.isPending ? <Loading id="repository-page-harvests-loading" /> : null}
        {coletas.isError ? (
          <ErrorState
            id="repository-page-harvests-error"
            error={coletas.error}
            onRetry={() => void coletas.refetch()}
          />
        ) : null}

        {coletas.data ? (
          coletas.data.count === 0 ? (
            <Empty id="repository-page-harvests-empty" label={t('harvests.none')} />
          ) : (
            <>
              {serie.length > 1 ? (
                <div
                  id="repository-page-harvests-chart"
                  className="br-card p-3 mb-3"
                  style={{ height: '14rem' }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={serie} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                      <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
                      <XAxis
                        dataKey="data"
                        stroke="var(--color-content-muted)"
                        tickLine={false}
                        fontSize={11}
                      />
                      <YAxis
                        stroke="var(--color-content-muted)"
                        tickLine={false}
                        fontSize={11}
                        width={56}
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: '0.5rem',
                          border: '1px solid var(--color-border-subtle)',
                          fontSize: '0.8rem',
                        }}
                        formatter={(value) => numero.format(Number(value))}
                      />
                      <Line
                        type="monotone"
                        dataKey="registros"
                        name={t('harvests.records')}
                        stroke="var(--color-brand)"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="validos"
                        name={t('harvests.valid')}
                        stroke="var(--color-ok)"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="invalidos"
                        name={t('harvests.chartInvalid')}
                        stroke="var(--color-down)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : null}

              <div
                id="repository-page-harvests-table-wrapper"
                className="br-table"
                style={{ overflowX: 'auto' }}
              >
                <table id="repository-page-harvests-table">
                  <thead id="repository-page-harvests-table-head">
                    <tr
                      id="repository-page-harvests-table-head-row"
                      className="bg-gray-2 text-left"
                    >
                      <th
                        id="repository-page-column-snapshot"
                        className="px-3 py-2 text-down-01 text-bold"
                        {...dicaDeColuna(t('harvests.columnHints.snapshot'))}
                      >
                        {t('harvests.columns.snapshot')}
                      </th>
                      <th
                        id="repository-page-column-status"
                        className="px-3 py-2 text-down-01 text-bold"
                        {...dicaDeColuna(t('harvests.columnHints.status'))}
                      >
                        {t('harvests.columns.status')}
                      </th>
                      <th
                        id="repository-page-column-start"
                        className="px-3 py-2 text-down-01 text-bold"
                        {...dicaDeColuna(t('harvests.columnHints.start'))}
                      >
                        {t('harvests.columns.start')}
                      </th>
                      <th
                        id="repository-page-column-end"
                        className="px-3 py-2 text-down-01 text-bold"
                        {...dicaDeColuna(t('harvests.columnHints.end'))}
                      >
                        {t('harvests.columns.end')}
                      </th>
                      <th
                        id="repository-page-column-size"
                        className="px-3 py-2 text-down-01 text-bold"
                        {...dicaDeColuna(t('harvests.columnHints.size'))}
                      >
                        {t('harvests.columns.size')}
                      </th>
                      <th
                        id="repository-page-column-valid"
                        className="px-3 py-2 text-down-01 text-bold"
                        {...dicaDeColuna(t('harvests.columnHints.valid'))}
                      >
                        {t('harvests.columns.valid')}
                      </th>
                      <th
                        id="repository-page-column-invalid"
                        className="px-3 py-2 text-down-01 text-bold"
                        {...dicaDeColuna(t('harvests.columnHints.invalid'))}
                      >
                        {t('harvests.columns.invalid')}
                      </th>
                    </tr>
                  </thead>
                  <tbody id="repository-page-harvests-table-body">
                    {coletas.data.results.map((coleta) => (
                      <tr
                        id={`repository-page-harvest-${coleta.snapshotId}`}
                        key={coleta.snapshotId}
                      >
                        <td
                          id={`repository-page-harvest-${coleta.snapshotId}-snapshot`}
                          className="px-3 py-2"
                        >
                          <Link
                            id={`repository-page-harvest-${coleta.snapshotId}-link`}
                            to={`/coletas/${coleta.snapshotId}`}
                            className="text-blue-warm-vivid-80"
                          >
                            {coleta.snapshotId}
                          </Link>
                        </td>
                        <td
                          id={`repository-page-harvest-${coleta.snapshotId}-status`}
                          className="px-3 py-2"
                        >
                          <HarvestStatusBadge
                            id={`repository-page-harvest-${coleta.snapshotId}-status-badge`}
                            status={coleta.status}
                          />
                        </td>
                        <td
                          id={`repository-page-harvest-${coleta.snapshotId}-start`}
                          className="px-3 py-2 text-gray-70"
                        >
                          {coleta.startTime
                            ? dataFormat.format(new Date(coleta.startTime.replace(' ', 'T')))
                            : '—'}
                        </td>
                        <td
                          id={`repository-page-harvest-${coleta.snapshotId}-end`}
                          className="px-3 py-2 text-gray-70"
                        >
                          {coleta.endTime
                            ? dataFormat.format(new Date(coleta.endTime.replace(' ', 'T')))
                            : '—'}
                        </td>
                        <td
                          id={`repository-page-harvest-${coleta.snapshotId}-size`}
                          className="px-3 py-2"
                        >
                          {numero.format(coleta.size ?? 0)}
                        </td>
                        <td
                          id={`repository-page-harvest-${coleta.snapshotId}-valid`}
                          className="px-3 py-2"
                        >
                          {numero.format(coleta.validSize ?? 0)}
                        </td>
                        <td
                          id={`repository-page-harvest-${coleta.snapshotId}-invalid`}
                          className="px-3 py-2"
                        >
                          {invalidos(coleta) === null ? '—' : numero.format(invalidos(coleta) ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        ) : null}
      </section>
    </div>
  )
}
