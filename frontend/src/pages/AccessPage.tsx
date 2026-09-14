import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'

import { HarvestStatusBadge } from '@/components/Badges'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { NewUserModal } from '@/components/NewUserModal'
import { PageHeader } from '@/components/PageHeader'
import { Pagination } from '@/components/Pagination'
import { useDebounced } from '@/hooks/useDebounced'
import { ApiError, apiDelete, apiPost } from '@/lib/api'
import { accessesByRepositoryQuery, gestoresQuery, repositorySearchQuery } from '@/lib/queries'
import type { RepositoryHit } from '@/lib/types'

const POR_PAGINA = 10

/**
 * Acessos a repositórios, na ordem em que o trabalho acontece: primeiro se
 * encontra o repositório, depois se cadastram os gestores dentro dele.
 *
 * O repositório selecionado e a busca vivem na URL — a tela fica compartilhável
 * e o botão voltar funciona.
 */
export function AccessPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  const termoUrl = searchParams.get('busca') ?? ''
  const pagina = Math.max(1, Number(searchParams.get('pagina') ?? 1))
  const selecionado = searchParams.get('repositorio') ?? ''

  const [termo, setTermo] = useState(termoUrl)
  const termoAtrasado = useDebounced(termo)

  const busca = useQuery(repositorySearchQuery(termoAtrasado, pagina, POR_PAGINA))

  const atualizarUrl = (mudancas: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams)
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null || valor === '') params.delete(chave)
      else params.set(chave, valor)
    }
    setSearchParams(params)
  }

  // Trocar a busca reinicia a paginação: a página antiga pode não existir.
  const aoBuscar = (valor: string) => {
    setTermo(valor)
    atualizarUrl({ busca: valor, pagina: null })
  }

  const repositorioSelecionado =
    busca.data?.results.find((r) => r.harvesterRepositoryId === selecionado) ?? null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('access.eyebrow')}
        title={t('access.title')}
        description={t('access.subtitle')}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        {/* Busca de repositórios */}
        <section className="panel flex flex-col gap-3 p-5">
          <h2 className="font-heading text-sm font-bold">{t('access.findRepository')}</h2>

          <label className="flex flex-col gap-1.5">
            <span className="sr-only">{t('access.searchRepository')}</span>
            <input
              type="search"
              value={termo}
              onChange={(event) => aoBuscar(event.target.value)}
              placeholder={t('access.searchRepository')}
              className="border border-border-subtle bg-surface px-3 py-2 text-sm"
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
                <p className="text-xs text-content-muted">
                  {t('access.foundBy', {
                    total: busca.data.totalElements,
                    field: busca.data.field
                      ? t(`access.fields.${busca.data.field}`)
                      : t('access.fields.all'),
                  })}
                </p>

                <ul className="flex flex-col">
                  {busca.data.results.map((repo) => (
                    <li key={repo.harvesterRepositoryId}>
                      <RepositoryOption
                        repo={repo}
                        ativo={repo.harvesterRepositoryId === selecionado}
                        onSelect={() => atualizarUrl({ repositorio: repo.harvesterRepositoryId })}
                      />
                    </li>
                  ))}
                </ul>

                <Pagination
                  page={busca.data.page}
                  totalPages={busca.data.totalPages}
                  onChange={(destino) => atualizarUrl({ pagina: String(destino) })}
                />
              </>
            )
          ) : null}
        </section>

        {/* Gestores do repositório selecionado */}
        <section className="lg:sticky lg:top-24">
          {selecionado ? (
            <ManagersPanel repositoryId={selecionado} repo={repositorioSelecionado} />
          ) : (
            <div className="panel p-5">
              <p className="eyebrow mb-1">{t('access.noSelection')}</p>
              <p className="text-sm text-content-muted">{t('access.selectHint')}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function RepositoryOption({
  repo,
  ativo,
  onSelect,
}: {
  repo: RepositoryHit
  ativo: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={ativo}
      className={`flex w-full flex-col gap-0.5 border-l-2 px-3 py-2.5 text-left transition-colors duration-150 ${
        ativo
          ? 'border-brand bg-brand-soft'
          : 'border-transparent hover:border-border-strong hover:bg-surface-muted'
      }`}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-brand-strong">{repo.acronym}</span>
        {repo.lastSnapshotStatus ? <HarvestStatusBadge status={repo.lastSnapshotStatus} /> : null}
      </span>
      <span className="text-sm font-semibold">{repo.name}</span>
      {repo.institutionName ? (
        <span className="text-xs text-content-muted">{repo.institutionName}</span>
      ) : null}
    </button>
  )
}

/** Gestores cadastrados no repositório, com adição e remoção. */
function ManagersPanel({
  repositoryId,
  repo,
}: {
  repositoryId: string
  repo: RepositoryHit | null
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [buscaGestor, setBuscaGestor] = useState('')
  const [gestorId, setGestorId] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [novoUsuario, setNovoUsuario] = useState(false)

  const buscaAtrasada = useDebounced(buscaGestor)
  const gestores = useQuery(gestoresQuery(buscaAtrasada))
  const vinculos = useQuery(accessesByRepositoryQuery(repositoryId))

  const invalidar = async () => {
    await queryClient.invalidateQueries({ queryKey: ['accesses'] })
    await queryClient.invalidateQueries({ queryKey: ['repositories'] })
  }

  const adicionar = useMutation({
    mutationFn: () =>
      apiPost('/repositories/accesses/', {
        user: Number(gestorId),
        harvesterRepositoryId: repositoryId,
        // A sigla vem da própria busca, então o vínculo nasce correto mesmo se
        // a origem cair entre a busca e o cadastro.
        ...(repo?.acronym ? { acronym: repo.acronym } : {}),
      }),
    onSuccess: async () => {
      setAviso(null)
      setGestorId('')
      await invalidar()
    },
    onError: (error) => setAviso(error instanceof ApiError ? error.detail : t('common.error')),
  })

  const remover = useMutation({
    mutationFn: (id: number) => apiDelete(`/repositories/accesses/${id}/`),
    onSuccess: async () => {
      setAviso(null)
      await invalidar()
    },
    onError: (error) => setAviso(error instanceof ApiError ? error.detail : t('common.error')),
  })

  // Quem já tem acesso não deve aparecer na lista de adicionar.
  const jaVinculados = new Set(vinculos.data?.results.map((v) => v.user) ?? [])
  const disponiveis = (gestores.data?.results ?? []).filter((g) => !jaVinculados.has(g.id))

  return (
    <div className="panel flex flex-col gap-4 p-5">
      <div>
        <p className="eyebrow !text-brand-strong">{repo?.acronym ?? repositoryId}</p>
        <h2 className="font-heading text-lg font-bold tracking-tight">
          {repo?.name ?? t('access.selectedRepository')}
        </h2>
        {repo?.institutionName ? (
          <p className="text-sm text-content-muted">{repo.institutionName}</p>
        ) : null}
      </div>

      {/* Gestores já cadastrados */}
      <div>
        <p className="eyebrow mb-2">
          {t('access.managersWithAccess', { count: vinculos.data?.count ?? 0 })}
        </p>

        {vinculos.isPending ? <Loading /> : null}
        {vinculos.isError ? (
          <ErrorState error={vinculos.error} onRetry={() => void vinculos.refetch()} />
        ) : null}

        {vinculos.data ? (
          vinculos.data.count === 0 ? (
            <p className="text-sm text-content-muted">{t('access.noManagers')}</p>
          ) : (
            <ul className="divide-y divide-border-subtle border-y border-border-subtle">
              {vinculos.data.results.map((vinculo) => (
                <li
                  key={vinculo.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span>
                    <span className="text-sm font-semibold">{vinculo.username}</span>
                    <span className="block text-xs text-content-muted">
                      {t('access.since', {
                        date: new Date(vinculo.grantedAt).toLocaleDateString(),
                      })}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(t('access.confirmRemove', { user: vinculo.username })))
                        remover.mutate(vinculo.id)
                    }}
                    disabled={remover.isPending}
                    className="border border-border-subtle px-2.5 py-1 text-xs text-down transition-colors duration-150 hover:border-down disabled:opacity-50"
                  >
                    {t('access.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      {/* Cadastrar gestor */}
      <form
        className="flex flex-col gap-2 border-t border-border-subtle pt-4"
        onSubmit={(event) => {
          event.preventDefault()
          adicionar.mutate()
        }}
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="eyebrow">{t('access.addManager')}</span>
          <button
            type="button"
            onClick={() => setNovoUsuario(true)}
            className="text-xs text-brand-strong underline transition-colors duration-150 hover:text-brand"
          >
            {t('newUser.open')}
          </button>
        </span>

        <input
          type="search"
          value={buscaGestor}
          onChange={(event) => setBuscaGestor(event.target.value)}
          placeholder={t('access.searchManager')}
          className="border border-border-subtle bg-surface px-3 py-2 text-sm"
        />

        {gestores.isPending ? <Loading /> : null}
        {gestores.isError ? (
          <ErrorState error={gestores.error} onRetry={() => void gestores.refetch()} />
        ) : null}

        {gestores.data ? (
          disponiveis.length === 0 ? (
            <p className="text-sm text-content-muted">{t('access.allManagersLinked')}</p>
          ) : (
            <select
              value={gestorId}
              onChange={(event) => setGestorId(event.target.value)}
              size={5}
              aria-label={t('access.manager')}
              className="border border-border-subtle bg-surface px-1 py-1 text-sm"
            >
              <option value="">{t('access.chooseManager')}</option>
              {disponiveis.map((gestor) => (
                <option key={gestor.id} value={gestor.id}>
                  {gestor.username}
                  {gestor.first_name || gestor.last_name
                    ? ` — ${gestor.first_name} ${gestor.last_name}`.trimEnd()
                    : ''}
                </option>
              ))}
            </select>
          )
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!gestorId || adicionar.isPending}
            className="bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-strong disabled:opacity-50"
          >
            {adicionar.isPending ? t('access.linking') : t('access.addManager')}
          </button>
          {aviso ? (
            <p role="alert" className="text-sm text-down">
              {aviso}
            </p>
          ) : null}
        </div>
      </form>

      <NewUserModal
        aberto={novoUsuario}
        onFechar={() => setNovoUsuario(false)}
        onCriado={async (user) => {
          // Já deixa a conta nova selecionada: quem cadastrou veio para vinculá-la.
          setBuscaGestor(user.username)
          setGestorId(String(user.id))
          await queryClient.invalidateQueries({ queryKey: ['users'] })
        }}
      />
    </div>
  )
}
