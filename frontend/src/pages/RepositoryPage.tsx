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
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { repositoryHarvestsQuery, repositoryQuery } from '@/lib/queries'

/** Visão geral do repositório e histórico de coletas. */
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
    <div id="repository-page" className="flex flex-col gap-8">
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

      <section id="repository-page-stats" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          id="repository-page-stat-acronym"
          label={t('repository.acronym')}
          value={repo.acronym ?? '—'}
        />
        <StatCard
          id="repository-page-stat-metadata-prefix"
          label={t('repository.metadataPrefix')}
          value={repo.metadataPrefix ?? '—'}
        />
        <StatCard
          id="repository-page-stat-store-schema"
          label={t('repository.storeSchema')}
          value={repo.metadataStoreSchema ?? '—'}
        />
        <StatCard
          id="repository-page-stat-published"
          label={t('repository.published')}
          value={repo.published ? t('common.yes') : t('common.no')}
        />
      </section>

      <section id="repository-page-harvests" className="flex flex-col gap-4">
        <h2 id="repository-page-harvests-title" className="font-heading text-sm font-bold">
          {t('harvests.title')}
        </h2>

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
                <div id="repository-page-harvests-chart" className="h-56 w-full panel p-4">
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
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : null}

              <div id="repository-page-harvests-table-wrapper" className="overflow-x-auto panel">
                <table
                  id="repository-page-harvests-table"
                  className="w-full min-w-2xl border-collapse text-sm"
                >
                  <thead id="repository-page-harvests-table-head">
                    <tr
                      id="repository-page-harvests-table-head-row"
                      className="border-b border-border-subtle bg-surface-muted text-left"
                    >
                      <th
                        id="repository-page-column-snapshot"
                        className="px-4 py-3 font-heading text-xs font-bold"
                      >
                        {t('harvests.columns.snapshot')}
                      </th>
                      <th
                        id="repository-page-column-status"
                        className="px-4 py-3 font-heading text-xs font-bold"
                      >
                        {t('harvests.columns.status')}
                      </th>
                      <th
                        id="repository-page-column-end"
                        className="px-4 py-3 font-heading text-xs font-bold"
                      >
                        {t('harvests.columns.end')}
                      </th>
                      <th
                        id="repository-page-column-size"
                        className="px-4 py-3 font-heading text-xs font-bold"
                      >
                        {t('harvests.columns.size')}
                      </th>
                      <th
                        id="repository-page-column-valid"
                        className="px-4 py-3 font-heading text-xs font-bold"
                      >
                        {t('harvests.columns.valid')}
                      </th>
                    </tr>
                  </thead>
                  <tbody id="repository-page-harvests-table-body">
                    {coletas.data.results.map((coleta) => (
                      <tr
                        id={`repository-page-harvest-${coleta.snapshotId}`}
                        key={coleta.snapshotId}
                        className="border-b border-border-subtle last:border-0"
                      >
                        <td
                          id={`repository-page-harvest-${coleta.snapshotId}-snapshot`}
                          className="px-4 py-3"
                        >
                          <Link
                            id={`repository-page-harvest-${coleta.snapshotId}-link`}
                            to={`/coletas/${coleta.snapshotId}`}
                            className="font-mono text-brand-strong hover:underline"
                          >
                            {coleta.snapshotId}
                          </Link>
                        </td>
                        <td
                          id={`repository-page-harvest-${coleta.snapshotId}-status`}
                          className="px-4 py-3"
                        >
                          <HarvestStatusBadge
                            id={`repository-page-harvest-${coleta.snapshotId}-status-badge`}
                            status={coleta.status}
                          />
                        </td>
                        <td
                          id={`repository-page-harvest-${coleta.snapshotId}-end`}
                          className="px-4 py-3 text-content-muted"
                        >
                          {coleta.endTime ? dataFormat.format(new Date(coleta.endTime)) : '—'}
                        </td>
                        <td
                          id={`repository-page-harvest-${coleta.snapshotId}-size`}
                          className="px-4 py-3 tabular-nums"
                        >
                          {numero.format(coleta.size ?? 0)}
                        </td>
                        <td
                          id={`repository-page-harvest-${coleta.snapshotId}-valid`}
                          className="px-4 py-3 tabular-nums"
                        >
                          {numero.format(coleta.validSize ?? 0)}
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
