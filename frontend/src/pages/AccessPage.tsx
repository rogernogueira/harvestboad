import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { PageHeader } from '@/components/PageHeader'
import { ApiError, apiDelete, apiPost } from '@/lib/api'
import { allAccessesQuery, availableRepositoriesQuery, gestoresQuery } from '@/lib/queries'
import type { RepositoryAccess } from '@/lib/types'

const REPOS_POR_PAGINA = 50

/**
 * Associação de gestores a repositórios.
 *
 * Duas decisões moldam a tela:
 *
 * 1. O repositório é escolhido de uma lista vinda do Harvester, não digitado.
 *    Um identificador digitado errado só apareceria como acesso faltando.
 * 2. A lista de repositórios pode não carregar (a origem cai com frequência).
 *    Nesse caso o campo vira entrada manual com sigla obrigatória, que é o que
 *    o backend aceita quando não consegue confirmar na origem.
 */
export function AccessPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [buscaGestor, setBuscaGestor] = useState('')
  const [buscaRepo, setBuscaRepo] = useState('')
  const [gestorId, setGestorId] = useState('')
  const [repoId, setRepoId] = useState('')
  const [siglaManual, setSiglaManual] = useState('')
  const [paginaRepos, setPaginaRepos] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)

  const gestores = useQuery(gestoresQuery(buscaGestor))
  const disponiveis = useQuery(availableRepositoriesQuery(paginaRepos, REPOS_POR_PAGINA))
  const vinculos = useQuery(allAccessesQuery)

  const origemIndisponivel = disponiveis.isError

  const reposFiltrados = useMemo(() => {
    const itens = disponiveis.data?.results ?? []
    const termo = buscaRepo.trim().toLowerCase()
    if (!termo) return itens
    return itens.filter((repo) =>
      [repo.acronym, repo.name, repo.institutionName, repo.harvesterRepositoryId]
        .filter(Boolean)
        .some((campo) => String(campo).toLowerCase().includes(termo)),
    )
  }, [disponiveis.data, buscaRepo])

  const limparFormulario = () => {
    setGestorId('')
    setRepoId('')
    setSiglaManual('')
    setBuscaRepo('')
  }

  const criar = useMutation({
    mutationFn: async () => {
      const corpo: Record<string, unknown> = {
        user: Number(gestorId),
        harvesterRepositoryId: repoId.trim(),
      }
      // A sigla só viaja quando digitada: com a origem no ar, o backend a
      // resolve sozinho e o valor autoritativo é o dele.
      if (siglaManual.trim()) corpo.acronym = siglaManual.trim()
      return apiPost<RepositoryAccess>('/repositories/accesses/', corpo)
    },
    onSuccess: async () => {
      setAviso(null)
      limparFormulario()
      await queryClient.invalidateQueries({ queryKey: ['accesses'] })
      await queryClient.invalidateQueries({ queryKey: ['repositories', 'mine'] })
    },
    onError: (error) => {
      setAviso(error instanceof ApiError ? error.detail : t('common.error'))
    },
  })

  const removerVinculo = useMutation({
    mutationFn: (id: number) => apiDelete(`/repositories/accesses/${id}/`),
    onSuccess: async () => {
      setAviso(null)
      await queryClient.invalidateQueries({ queryKey: ['accesses'] })
      await queryClient.invalidateQueries({ queryKey: ['repositories', 'mine'] })
    },
    onError: (error) => {
      setAviso(error instanceof ApiError ? error.detail : t('common.error'))
    },
  })

  const podeCriar =
    gestorId !== '' && repoId.trim() !== '' && (!origemIndisponivel || siglaManual.trim() !== '')

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t('access.eyebrow')}
        title={t('access.title')}
        description={t('access.subtitle')}
      />

      {/* Formulário de associação */}
      <section className="panel p-6">
        <h2 className="font-heading text-sm font-bold">{t('access.newLink')}</h2>

        <form
          className="mt-4 grid gap-4 lg:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            criar.mutate()
          }}
        >
          {/* Gestor */}
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">{t('access.manager')}</span>
              <input
                type="search"
                value={buscaGestor}
                onChange={(event) => setBuscaGestor(event.target.value)}
                placeholder={t('access.searchManager')}
                className="border border-border-subtle bg-surface px-3 py-2 text-sm"
              />
            </label>

            {gestores.isPending ? <Loading /> : null}
            {gestores.isError ? (
              <ErrorState error={gestores.error} onRetry={() => void gestores.refetch()} />
            ) : null}
            {gestores.data ? (
              <select
                value={gestorId}
                onChange={(event) => setGestorId(event.target.value)}
                size={6}
                aria-label={t('access.manager')}
                className="border border-border-subtle bg-surface px-1 py-1 text-sm"
              >
                <option value="">{t('access.chooseManager')}</option>
                {gestores.data.results.map((gestor) => (
                  <option key={gestor.id} value={gestor.id}>
                    {gestor.username}
                    {gestor.first_name || gestor.last_name
                      ? ` — ${gestor.first_name} ${gestor.last_name}`.trimEnd()
                      : ''}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {/* Repositório */}
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">{t('access.repository')}</span>
              <input
                type="search"
                value={buscaRepo}
                onChange={(event) => setBuscaRepo(event.target.value)}
                placeholder={t('access.searchRepository')}
                disabled={origemIndisponivel}
                className="border border-border-subtle bg-surface px-3 py-2 text-sm disabled:opacity-50"
              />
            </label>

            {disponiveis.isPending ? <Loading /> : null}

            {origemIndisponivel ? (
              <div className="flex flex-col gap-2">
                <p className="border-l-2 border-warn bg-warn-soft px-3 py-2 text-xs text-warn">
                  {t('access.sourceDownFallback')}
                </p>
                <input
                  type="text"
                  value={repoId}
                  onChange={(event) => setRepoId(event.target.value)}
                  placeholder={t('access.repositoryIdPlaceholder')}
                  aria-label={t('access.repositoryId')}
                  className="border border-border-subtle bg-surface px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  value={siglaManual}
                  onChange={(event) => setSiglaManual(event.target.value)}
                  placeholder={t('access.acronymPlaceholder')}
                  aria-label={t('access.acronym')}
                  className="border border-border-subtle bg-surface px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void disponiveis.refetch()}
                  className="self-start text-xs text-brand-strong underline"
                >
                  {t('common.retry')}
                </button>
              </div>
            ) : disponiveis.data ? (
              <>
                <select
                  value={repoId}
                  onChange={(event) => setRepoId(event.target.value)}
                  size={6}
                  aria-label={t('access.repository')}
                  className="border border-border-subtle bg-surface px-1 py-1 text-sm"
                >
                  <option value="">{t('access.chooseRepository')}</option>
                  {reposFiltrados.map((repo) => (
                    <option key={repo.harvesterRepositoryId} value={repo.harvesterRepositoryId}>
                      {repo.acronym} — {repo.name}
                    </option>
                  ))}
                </select>
                <div className="flex items-center justify-between text-xs text-content-muted">
                  <span>
                    {t('access.showing', {
                      shown: reposFiltrados.length,
                      total: disponiveis.data.page.totalElements ?? 0,
                    })}
                  </span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPaginaRepos((p) => Math.max(0, p - 1))}
                      disabled={paginaRepos === 0}
                      className="border border-border-subtle px-2 py-1 disabled:opacity-40"
                    >
                      {t('pagination.previous')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaginaRepos((p) => p + 1)}
                      disabled={paginaRepos + 1 >= (disponiveis.data.page.totalPages ?? 1)}
                      className="border border-border-subtle px-2 py-1 disabled:opacity-40"
                    >
                      {t('pagination.next')}
                    </button>
                  </span>
                </div>
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
            <button
              type="submit"
              disabled={!podeCriar || criar.isPending}
              className="bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-strong disabled:opacity-50"
            >
              {criar.isPending ? t('access.linking') : t('access.link')}
            </button>
            {aviso ? (
              <p role="alert" className="text-sm text-down">
                {aviso}
              </p>
            ) : null}
            {criar.isSuccess && !aviso ? (
              <p className="text-sm text-ok">{t('access.linked')}</p>
            ) : null}
          </div>
        </form>
      </section>

      {/* Vínculos existentes */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-sm font-bold">{t('access.existing')}</h2>

        {vinculos.isPending ? <Loading /> : null}
        {vinculos.isError ? (
          <ErrorState error={vinculos.error} onRetry={() => void vinculos.refetch()} />
        ) : null}

        {vinculos.data ? (
          vinculos.data.count === 0 ? (
            <Empty label={t('access.noLinks')} />
          ) : (
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-3xl border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border-subtle bg-surface-muted text-left">
                    <th className="px-4 py-3 font-heading text-xs font-bold">
                      {t('access.columns.manager')}
                    </th>
                    <th className="px-4 py-3 font-heading text-xs font-bold">
                      {t('access.columns.repository')}
                    </th>
                    <th className="px-4 py-3 font-heading text-xs font-bold">
                      {t('access.columns.grantedAt')}
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {vinculos.data.results.map((vinculo) => (
                    <tr key={vinculo.id} className="border-b border-border-subtle last:border-0">
                      <td className="px-4 py-3 font-semibold">{vinculo.username}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-brand-strong">
                          {vinculo.acronym}
                        </span>
                        {vinculo.acronymIsStale ? (
                          <span className="ml-2 bg-warn-soft px-1.5 py-0.5 text-[0.65rem] text-warn">
                            {t('access.staleAcronym')}
                          </span>
                        ) : null}
                        <span className="block text-content-muted">
                          {vinculo.name ?? t('repositories.unnamed')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-content-muted">
                        {new Date(vinculo.grantedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              window.confirm(t('access.confirmRemove', { user: vinculo.username }))
                            )
                              removerVinculo.mutate(vinculo.id)
                          }}
                          disabled={removerVinculo.isPending}
                          className="border border-border-subtle px-2.5 py-1 text-xs text-down transition-colors duration-150 hover:border-down disabled:opacity-50"
                        >
                          {t('access.remove')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </section>
    </div>
  )
}
