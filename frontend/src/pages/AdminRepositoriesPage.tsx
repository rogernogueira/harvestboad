import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'

import { HarvestStatusBadge } from '@/components/Badges'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { PageHeader } from '@/components/PageHeader'
import { Pagination } from '@/components/Pagination'
import { RepositoryManagersModal } from '@/components/RepositoryManagersModal'
import { UserPlusIcon } from '@/components/UserPlusIcon'
import { UsersIcon } from '@/components/UsersIcon'
import { useDebounced } from '@/hooks/useDebounced'
import { repositorySearchQuery } from '@/lib/queries'
import type { RepositoryHit } from '@/lib/types'

const POR_PAGINA = 25

/**
 * Painel de administração: todos os repositórios do Harvester.
 *
 * É o que o ADMIN vê ao entrar, no lugar de "meus repositórios" — a listagem
 * espelha a da interface do Harvester (sigla, repositório, instituição, coleta) e
 * acrescenta a coluna que só existe aqui: quem cuida de cada um.
 */
export function AdminRepositoriesPage() {
  const { t, i18n } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  const termoUrl = searchParams.get('busca') ?? ''
  const pagina = Math.max(1, Number(searchParams.get('pagina') ?? 1))

  const [termo, setTermo] = useState(termoUrl)
  const termoAtrasado = useDebounced(termo)
  const [gestoresDe, setGestoresDe] = useState<RepositoryHit | null>(null)

  const busca = useQuery(repositorySearchQuery(termoAtrasado, pagina, POR_PAGINA))

  const numero = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage),
    [i18n.resolvedLanguage],
  )

  const atualizarUrl = (mudancas: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams)
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null || valor === '') params.delete(chave)
      else params.set(chave, valor)
    }
    setSearchParams(params)
  }

  const aoBuscar = (valor: string) => {
    setTermo(valor)
    atualizarUrl({ busca: valor, pagina: null })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('adminRepositories.eyebrow')}
        title={t('adminRepositories.title')}
        description={
          busca.data
            ? t('adminRepositories.subtitle', {
                total: numero.format(busca.data.totalElements),
              })
            : t('adminRepositories.subtitleLoading')
        }
      />

      <label className="block max-w-md">
        <span className="sr-only">{t('access.searchRepository')}</span>
        <input
          type="search"
          value={termo}
          onChange={(event) => aoBuscar(event.target.value)}
          placeholder={t('access.searchRepository')}
          className="w-full border border-border-subtle bg-surface px-3 py-2 text-sm"
        />
      </label>

      {busca.isPending ? <Loading /> : null}
      {busca.isError ? (
        <ErrorState error={busca.error} onRetry={() => void busca.refetch()} />
      ) : null}

      {busca.data ? (
        busca.data.totalElements === 0 ? (
          <Empty label={t('access.noRepositories')} />
        ) : (
          <>
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-4xl border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border-subtle bg-surface-muted text-left">
                    <th className="px-4 py-3 font-heading text-xs font-bold">
                      {t('adminRepositories.columns.acronym')}
                    </th>
                    <th className="px-4 py-3 font-heading text-xs font-bold">
                      {t('adminRepositories.columns.repository')}
                    </th>
                    <th className="px-4 py-3 font-heading text-xs font-bold">
                      {t('adminRepositories.columns.institution')}
                    </th>
                    <th className="px-4 py-3 font-heading text-xs font-bold">
                      {t('adminRepositories.columns.harvest')}
                    </th>
                    <th className="px-4 py-3 text-center font-heading text-xs font-bold">
                      {t('adminRepositories.columns.managers')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {busca.data.results.map((repo) => (
                    <tr
                      key={repo.harvesterRepositoryId}
                      className="border-b border-border-subtle last:border-0"
                    >
                      <td className="px-4 py-3 align-top">
                        <span className="font-mono text-xs text-brand-strong">{repo.acronym}</span>
                      </td>
                      <td className="px-4 py-3 align-top font-semibold">{repo.name}</td>
                      <td className="px-4 py-3 align-top text-content-muted">
                        {repo.institutionName ?? '—'}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <HarvestCell repo={repo} numero={numero} />
                      </td>
                      <td className="px-4 py-3 text-center align-top">
                        <ManagersCell repo={repo} onVer={() => setGestoresDe(repo)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={busca.data.page}
              totalPages={busca.data.totalPages}
              onChange={(destino) => atualizarUrl({ pagina: String(destino) })}
            />
          </>
        )
      ) : null}

      {gestoresDe ? (
        <RepositoryManagersModal
          aberto
          onFechar={() => setGestoresDe(null)}
          repositoryId={gestoresDe.harvesterRepositoryId}
          repositorio={`${gestoresDe.acronym} · ${gestoresDe.name ?? ''}`}
        />
      ) : null}
    </div>
  )
}

/** Dados da última coleta: situação, data e totais. */
function HarvestCell({ repo, numero }: { repo: RepositoryHit; numero: Intl.NumberFormat }) {
  const { t } = useTranslation()

  if (!repo.lastSnapshotId) {
    return <span className="text-content-muted">{t('harvests.none')}</span>
  }

  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        {repo.lastSnapshotStatus ? <HarvestStatusBadge status={repo.lastSnapshotStatus} /> : null}
        <Link
          to={`/coletas/${repo.lastSnapshotId}`}
          className="font-mono text-xs text-brand-strong hover:underline"
        >
          #{repo.lastSnapshotId}
        </Link>
      </span>
      <span className="text-xs text-content-muted">
        {/* A origem manda "2024-06-25 12:10:33"; só a data basta na tabela. */}
        {repo.lastSnapshotDate?.slice(0, 10) ?? '—'}
        {repo.lastSize !== null ? (
          <>
            {' · '}
            {t('adminRepositories.records', { count: numero.format(repo.lastSize) })}
            {repo.lastValidSize !== null
              ? ` · ${numero.format(repo.lastValidSize)} ${t('harvests.valid').toLowerCase()}`
              : ''}
          </>
        ) : null}
      </span>
    </span>
  )
}

/**
 * Coluna de gestores.
 *
 * Com gestores, abre o modal. Sem nenhum, o ícone muda e leva à tela de acessos
 * com o repositório já selecionado — que é a ação que falta fazer ali.
 */
function ManagersCell({ repo, onVer }: { repo: RepositoryHit; onVer: () => void }) {
  const { t } = useTranslation()

  if (repo.managerCount > 0) {
    return (
      <button
        type="button"
        onClick={onVer}
        title={t('adminRepositories.seeManagers', { count: repo.managerCount })}
        aria-label={t('adminRepositories.seeManagers', { count: repo.managerCount })}
        className="inline-flex items-center gap-1.5 px-2 py-1 text-content-muted transition-colors duration-150 hover:text-brand-strong"
      >
        <UsersIcon />
        <span className="text-xs tabular-nums">{repo.managerCount}</span>
      </button>
    )
  }

  return (
    <Link
      to={`/acessos?busca=${encodeURIComponent(repo.acronym ?? '')}&selecionar=${repo.harvesterRepositoryId}`}
      title={t('adminRepositories.assignManager')}
      aria-label={t('adminRepositories.assignManager')}
      className="inline-flex items-center gap-1.5 px-2 py-1 text-warn transition-colors duration-150 hover:text-brand-strong"
    >
      <UserPlusIcon />
      <span className="text-xs">{t('adminRepositories.none')}</span>
    </Link>
  )
}
