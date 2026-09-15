import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { useAuth } from '@/auth/context'
import { HarvestStatusBadge } from '@/components/Badges'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { PageHeader } from '@/components/PageHeader'
import { RepositoryManagersModal } from '@/components/RepositoryManagersModal'
import { UsersIcon } from '@/components/UsersIcon'
import { repositoriesSummaryQuery } from '@/lib/queries'
import type { LastHarvestSummary, RepositoryAccessSummary } from '@/lib/types'

// Sob demanda: a tela do administrador carrega a TanStack Table, e o gestor
// nunca a abre — um import estático faria todo gestor baixar a biblioteca à toa.
const AdminRepositoriesPage = lazy(() =>
  import('@/pages/AdminRepositoriesPage').then((m) => ({
    default: m.AdminRepositoriesPage,
  })),
)

/**
 * Painel de repositórios do gestor.
 *
 * Um repositório por linha: à esquerda a identificação, à direita as
 * estatísticas da última coleta. A lista vem já filtrada pelo backend — o
 * endpoint devolve apenas os vínculos do usuário autenticado.
 */
export function RepositoriesPage() {
  const { user } = useAuth()

  // O administrador não tem "meus repositórios": para ele, esta é a tela de
  // gerenciamento de todo o acervo.
  if (user?.profile === 'ADMIN') {
    return (
      <Suspense fallback={<Loading />}>
        <AdminRepositoriesPage />
      </Suspense>
    )
  }

  return <MyRepositoriesPage />
}

/** Painel do gestor: apenas os repositórios vinculados à sua conta. */
function MyRepositoriesPage() {
  const { t } = useTranslation()
  const { data, isPending, isError, error, refetch } = useQuery(repositoriesSummaryQuery)

  if (isPending) return <Loading label={t('repositories.loadingStats')} />
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('nav.repositories')}
        title={t('repositories.title')}
        description={t('repositories.subtitle', { count: data.count })}
      />

      {data.results.length === 0 ? (
        <Empty label={t('repositories.none')} />
      ) : (
        <ul className="flex flex-col gap-4">
          {data.results.map((acesso) => (
            <li key={acesso.id}>
              <RepositoryRow acesso={acesso} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Uma linha do painel: identificação + estatísticas lado a lado. */
function RepositoryRow({ acesso }: { acesso: RepositoryAccessSummary }) {
  const { t } = useTranslation()
  const [gestoresAbertos, setGestoresAbertos] = useState(false)
  const nomeRepositorio = acesso.name ?? acesso.acronym

  return (
    <article className="panel grid gap-px overflow-hidden bg-border-subtle lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      {/* Identificação */}
      <div className="flex flex-col gap-1 bg-surface p-5">
        <span className="flex items-center justify-between gap-2">
          <span className="eyebrow !text-brand-strong">{acesso.acronym}</span>
          <button
            type="button"
            onClick={() => setGestoresAbertos(true)}
            title={t('managers.open')}
            aria-label={t('managers.open')}
            className="-mt-1 -mr-1 p-1.5 text-content-muted transition-colors duration-150 hover:text-brand-strong"
          >
            <UsersIcon />
          </button>
        </span>
        <Link
          to={`/repositorios/${acesso.harvesterRepositoryId}`}
          className="font-heading text-lg font-bold tracking-tight hover:text-brand-strong hover:underline"
        >
          {acesso.name ?? t('repositories.unnamed')}
        </Link>
        {acesso.institutionName ? (
          <span className="text-sm text-content-muted">{acesso.institutionName}</span>
        ) : null}
        <span className="mt-auto pt-3 text-xs text-content-muted">
          {t('repositories.grantedAt', {
            date: new Date(acesso.grantedAt).toLocaleDateString(),
          })}
        </span>

        <RepositoryManagersModal
          aberto={gestoresAbertos}
          onFechar={() => setGestoresAbertos(false)}
          repositoryId={acesso.harvesterRepositoryId}
          repositorio={`${acesso.acronym} · ${nomeRepositorio}`}
        />
      </div>

      {/* Estatísticas da última coleta */}
      <div className="bg-surface p-5">
        {acesso.unavailable ? (
          <p className="border-l-2 border-warn bg-warn-soft px-3 py-2 text-sm text-warn">
            {t('repositories.statsUnavailable')}
          </p>
        ) : acesso.lastHarvest ? (
          <HarvestStats coleta={acesso.lastHarvest} repositoryId={acesso.harvesterRepositoryId} />
        ) : (
          <p className="text-sm text-content-muted">{t('harvests.none')}</p>
        )}
      </div>
    </article>
  )
}

function HarvestStats({
  coleta,
  repositoryId,
}: {
  coleta: LastHarvestSummary
  repositoryId: string
}) {
  const { t, i18n } = useTranslation()

  const numero = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage),
    [i18n.resolvedLanguage],
  )
  const dataHora = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        dateStyle: 'short',
        timeStyle: 'short',
      }),
    [i18n.resolvedLanguage],
  )

  // O Harvester devolve "2024-06-25 12:10:33"; sem o T o Safari não converte.
  const fim = coleta.endTime ? new Date(coleta.endTime.replace(' ', 'T')) : null
  const fimValido = fim && !Number.isNaN(fim.getTime())

  const registros = `/coletas/${coleta.snapshotId}/registros`

  /*
    Cada número leva à lista que ele resume — mas só quando essa lista existe.
    Registros e regras vêm do índice de diagnóstico, que só é escrito quando a
    coleta é indexada: com `UNKNOWN` ou `FAILED` o link abriria uma tela vazia.
    E zero inválidos não tem o que listar.
  */
  const indicadores = [
    {
      rotulo: t('diagnosis.size'),
      valor: coleta.size,
      cor: '',
      para: coleta.evaluated ? registros : null,
      titulo: t('repositories.openRecords'),
    },
    {
      rotulo: t('diagnosis.valid'),
      valor: coleta.validSize,
      cor: 'text-ok',
      para: coleta.validSize ? `${registros}?valid=true` : null,
      titulo: t('repositories.openValidRecords'),
    },
    {
      rotulo: t('diagnosis.invalid'),
      valor: coleta.invalidSize,
      cor: 'text-down',
      para: coleta.invalidSize ? `${registros}?valid=false` : null,
      titulo: t('repositories.openInvalidRecords'),
    },
    {
      rotulo: t('repositories.violatedRules'),
      valor: coleta.violatedRuleCount,
      cor: 'text-warn',
      para: coleta.violatedRuleCount ? `/coletas/${coleta.snapshotId}` : null,
      titulo: t('repositories.openDiagnosis'),
    },
  ]

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="eyebrow">{t('repositories.lastHarvest')}</span>
        <Link
          to={`/coletas/${coleta.snapshotId}`}
          className="font-mono text-xs text-brand-strong hover:underline"
        >
          #{coleta.snapshotId}
        </Link>
        {coleta.status ? <HarvestStatusBadge status={coleta.status} /> : null}
        <span className="text-xs text-content-muted">{fimValido ? dataHora.format(fim) : '—'}</span>
        {/*
          Coleta sem indexação não passou por validação: os campos de válidos,
          inválidos e regras vêm vazios, e o aviso explica o porquê uma vez só,
          em vez de repetir "não avaliado" em cada indicador.
        */}
        {coleta.evaluated ? null : (
          <span className="text-xs text-content-muted italic" title={coleta.indexStatus ?? ''}>
            {t('repositories.notEvaluated')}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {indicadores.map((item) => (
          <div key={item.rotulo}>
            <dt className="eyebrow">{item.rotulo}</dt>
            <dd className={`font-heading text-xl font-extrabold tabular-nums ${item.cor}`}>
              {item.valor === null || item.valor === undefined ? (
                '—'
              ) : item.para ? (
                <Link to={item.para} title={item.titulo} className="hover:underline">
                  {numero.format(item.valor)}
                </Link>
              ) : (
                numero.format(item.valor)
              )}
            </dd>
          </div>
        ))}
      </dl>

      {coleta.topViolations.length > 0 ? (
        <div className="mt-auto">
          <p className="eyebrow mb-1.5">{t('repositories.topViolations')}</p>
          <ul className="flex flex-col gap-1">
            {coleta.topViolations.map((violacao) => (
              <li key={violacao.ruleId} className="flex items-baseline gap-2 text-xs">
                <Link
                  to={`/coletas/${coleta.snapshotId}/registros?invalidRule=${violacao.ruleId}`}
                  className="text-brand-strong hover:underline"
                  title={t('repositories.seeRecords')}
                >
                  {violacao.name}
                </Link>
                <span className="flex-1 border-b border-dotted border-border-strong" />
                <span className="tabular-nums text-content-muted">
                  {numero.format(violacao.invalidCount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-xs text-content-muted">
        <Link to={`/repositorios/${repositoryId}`} className="hover:underline">
          {t('repositories.seeHistory')}
        </Link>
      </p>
    </div>
  )
}
