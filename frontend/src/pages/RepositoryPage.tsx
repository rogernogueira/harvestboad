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
import { StatCard } from '@/components/StatCard'
import { repositoryHarvestsQuery, repositoryQuery } from '@/lib/queries'

/** Visão geral do repositório e histórico de coletas. */
export function RepositoryPage() {
  const { t, i18n } = useTranslation()
  const { repositoryId = '' } = useParams()

  const repositorio = useQuery(repositoryQuery(repositoryId))
  const coletas = useQuery(repositoryHarvestsQuery(repositoryId))

  const dataFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'short', timeStyle: 'short' }),
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

  if (repositorio.isPending) return <Loading />
  if (repositorio.isError)
    return <ErrorState error={repositorio.error} onRetry={() => void repositorio.refetch()} />

  const repo = repositorio.data

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Breadcrumb
          items={[
            { label: t('repositories.title'), to: '/' },
            { label: repo.acronym ?? repositoryId },
          ]}
        />
        <h1 className="text-xl font-semibold">{repo.name ?? t('repositories.unnamed')}</h1>
        <p className="text-sm text-content-muted">{repo.institutionName}</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('repository.acronym')} value={repo.acronym ?? '—'} />
        <StatCard label={t('repository.metadataPrefix')} value={repo.metadataPrefix ?? '—'} />
        <StatCard label={t('repository.storeSchema')} value={repo.metadataStoreSchema ?? '—'} />
        <StatCard
          label={t('repository.published')}
          value={repo.published ? t('common.yes') : t('common.no')}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">{t('harvests.title')}</h2>

        {coletas.isPending ? <Loading /> : null}
        {coletas.isError ? (
          <ErrorState error={coletas.error} onRetry={() => void coletas.refetch()} />
        ) : null}

        {coletas.data ? (
          coletas.data.count === 0 ? (
            <Empty label={t('harvests.none')} />
          ) : (
            <>
              {serie.length > 1 ? (
                <div className="h-56 w-full rounded-xl border border-border-subtle bg-surface-raised p-4">
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

              <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-raised">
                <table className="w-full min-w-2xl border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-left">
                      <th className="px-4 py-3 font-medium">{t('harvests.columns.snapshot')}</th>
                      <th className="px-4 py-3 font-medium">{t('harvests.columns.status')}</th>
                      <th className="px-4 py-3 font-medium">{t('harvests.columns.end')}</th>
                      <th className="px-4 py-3 font-medium">{t('harvests.columns.size')}</th>
                      <th className="px-4 py-3 font-medium">{t('harvests.columns.valid')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coletas.data.results.map((coleta) => (
                      <tr key={coleta.snapshotId} className="border-b border-border-subtle last:border-0">
                        <td className="px-4 py-3">
                          <Link
                            to={`/coletas/${coleta.snapshotId}`}
                            className="font-mono text-brand-strong hover:underline"
                          >
                            {coleta.snapshotId}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <HarvestStatusBadge status={coleta.status} />
                        </td>
                        <td className="px-4 py-3 text-content-muted">
                          {coleta.endTime ? dataFormat.format(new Date(coleta.endTime)) : '—'}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{numero.format(coleta.size ?? 0)}</td>
                        <td className="px-4 py-3 tabular-nums">
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
