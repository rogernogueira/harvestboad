import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useParams, useSearchParams } from 'react-router'

import { HarvestStatusBadge } from '@/components/Badges'
import { Breadcrumb } from '@/components/Breadcrumb'
import { ErrorState, Loading } from '@/components/Feedback'
import { filtersFromSearch, filtersToParams } from '@/lib/filters'
import { harvestQuery } from '@/lib/queries'

/**
 * Moldura das telas de coleta.
 *
 * As abas carregam a query string dos filtros adiante: é isso que faz o recorte
 * escolhido no diagnóstico continuar valendo ao abrir os registros, e vice-versa.
 */
export function HarvestLayout() {
  const { t, i18n } = useTranslation()
  const { snapshotId = '' } = useParams()
  const [searchParams] = useSearchParams()

  const { data, isPending, isError, error, refetch } = useQuery(harvestQuery(snapshotId))

  // Só os filtros viajam entre as abas; paginação é específica de cada tela.
  const filtros = filtersToParams(filtersFromSearch(searchParams)).toString()
  const sufixo = filtros ? `?${filtros}` : ''

  if (isPending) return <Loading />
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />

  const abas = [
    { to: `/coletas/${snapshotId}${sufixo}`, label: t('harvest.tabs.diagnosis'), end: true },
    {
      to: `/coletas/${snapshotId}/registros${sufixo}`,
      label: t('harvest.tabs.records'),
      end: false,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb
          items={[
            { label: t('repositories.title'), to: '/' },
            {
              label: data.repository.acronym ?? data.repository.harvesterRepositoryId,
              to: `/repositorios/${data.repository.harvesterRepositoryId}`,
            },
            { label: t('harvest.breadcrumb', { id: snapshotId }) },
          ]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">
            {t('harvest.title', { id: snapshotId })}
          </h1>
          <HarvestStatusBadge status={data.status} />
        </div>
        <p className="text-sm text-content-muted">
          {data.repository.name} · {t('harvest.endedAt')}{' '}
          {data.endTime ? new Date(data.endTime).toLocaleString(i18n.resolvedLanguage) : '—'}
        </p>
      </div>

      <nav className="flex gap-1 border-b border-border-subtle">
        {abas.map((aba) => (
          <NavLink
            key={aba.label}
            to={aba.to}
            end={aba.end}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
                isActive
                  ? 'border-brand font-medium text-brand-strong'
                  : 'border-transparent text-content-muted hover:text-content'
              }`
            }
          >
            {aba.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  )
}
