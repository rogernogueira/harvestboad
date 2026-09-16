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
import type { BulkLinkResult, RepositoryHit } from '@/lib/types'

const POR_PAGINA = 10

/** Repositório escolhido, guardado com sigla e nome para exibir e gravar. */
interface Selecionado {
  id: string
  acronym: string
  name: string
}

/**
 * Acessos a repositórios.
 *
 * Busca-se o repositório, marcam-se quantos forem necessários e associa-se o
 * conjunto a um gestor de uma vez. A seleção sobrevive à troca de busca e de
 * página: é comum juntar repositórios que não aparecem no mesmo resultado.
 */
export function AccessPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const termoUrl = searchParams.get('busca') ?? ''
  const pagina = Math.max(1, Number(searchParams.get('pagina') ?? 1))

  const [termo, setTermo] = useState(termoUrl)
  const termoAtrasado = useDebounced(termo)
  const [selecionados, setSelecionados] = useState<Selecionado[]>([])
  const [detalhado, setDetalhado] = useState<Selecionado | null>(null)

  const temTermo = termoAtrasado.trim().length > 0
  // Aqui o objetivo é achar um repositório específico: sem termo não há o que
  // buscar, e o acervo inteiro só atrapalharia.
  const busca = useQuery({
    ...repositorySearchQuery(termoAtrasado, pagina, POR_PAGINA),
    enabled: temTermo,
  })

  // Chegada com repositório indicado na URL, vinda do painel de administração:
  // assim que ele aparecer no resultado da busca, entra na seleção uma vez só.
  //
  // Ajuste durante a renderização em vez de efeito — é o padrão que o React
  // recomenda para estado que acompanha um valor derivado: ele re-renderiza
  // antes de pintar, sem o ciclo extra que um efeito provocaria.
  const aSelecionar = searchParams.get('selecionar')
  const [jaTratado, setJaTratado] = useState<string | null>(null)

  if (aSelecionar && aSelecionar !== jaTratado) {
    const achado = busca.data?.results.find((r) => r.harvesterRepositoryId === aSelecionar)
    if (achado) {
      setJaTratado(aSelecionar)
      if (!selecionados.some((item) => item.id === aSelecionar)) {
        setSelecionados([
          ...selecionados,
          {
            id: aSelecionar,
            acronym: achado.acronym ?? aSelecionar,
            name: achado.name ?? '',
          },
        ])
      }
    }
  }

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

  const alternar = (repo: RepositoryHit) => {
    const id = repo.harvesterRepositoryId
    setSelecionados((atual) =>
      atual.some((item) => item.id === id)
        ? atual.filter((item) => item.id !== id)
        : [...atual, { id, acronym: repo.acronym ?? id, name: repo.name ?? '' }],
    )
  }

  const marcados = new Set(selecionados.map((item) => item.id))
  const resultados = busca.data?.results ?? []
  const todosMarcados =
    resultados.length > 0 && resultados.every((r) => marcados.has(r.harvesterRepositoryId))

  const alternarTodos = () => {
    if (todosMarcados) {
      const daPagina = new Set(resultados.map((r) => r.harvesterRepositoryId))
      setSelecionados((atual) => atual.filter((item) => !daPagina.has(item.id)))
    } else {
      setSelecionados((atual) => {
        const existentes = new Set(atual.map((item) => item.id))
        const novos = resultados
          .filter((r) => !existentes.has(r.harvesterRepositoryId))
          .map((r) => ({
            id: r.harvesterRepositoryId,
            acronym: r.acronym ?? r.harvesterRepositoryId,
            name: r.name ?? '',
          }))
        return [...atual, ...novos]
      })
    }
  }

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
              autoFocus
              className="border border-border-subtle bg-surface px-3 py-2 text-sm"
            />
          </label>

          {!temTermo ? (
            <p className="py-6 text-center text-sm text-content-muted">
              {t('access.typeToSearch')}
            </p>
          ) : busca.isPending ? (
            <Loading />
          ) : busca.isError ? (
            <ErrorState error={busca.error} onRetry={() => void busca.refetch()} />
          ) : busca.data && busca.data.totalElements === 0 ? (
            <Empty label={t('access.noRepositories')} />
          ) : busca.data ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-content-muted">
                  {t('access.foundBy', {
                    count: busca.data.totalElements,
                    field: busca.data.field
                      ? t(`access.fields.${busca.data.field}`)
                      : t('access.fields.all'),
                  })}
                </p>
                <button
                  type="button"
                  onClick={alternarTodos}
                  className="text-xs text-brand-strong underline hover:text-brand"
                >
                  {todosMarcados ? t('access.unselectPage') : t('access.selectPage')}
                </button>
              </div>

              <ul className="flex flex-col">
                {busca.data.results.map((repo) => (
                  <li key={repo.harvesterRepositoryId}>
                    <RepositoryOption
                      repo={repo}
                      marcado={marcados.has(repo.harvesterRepositoryId)}
                      onAlternar={() => alternar(repo)}
                      onDetalhar={() =>
                        setDetalhado({
                          id: repo.harvesterRepositoryId,
                          acronym: repo.acronym ?? repo.harvesterRepositoryId,
                          name: repo.name ?? '',
                        })
                      }
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
          ) : null}
        </section>

        {/* Associação em lote ou detalhe de um repositório */}
        <section className="flex flex-col gap-4 lg:sticky lg:top-24">
          {selecionados.length > 0 ? (
            <BulkLinkPanel
              selecionados={selecionados}
              onRemover={(id) => setSelecionados((atual) => atual.filter((item) => item.id !== id))}
              onLimpar={() => setSelecionados([])}
              onConcluido={async () => {
                setSelecionados([])
                await queryClient.invalidateQueries({ queryKey: ['accesses'] })
                await queryClient.invalidateQueries({ queryKey: ['repositories'] })
              }}
            />
          ) : detalhado ? (
            <ManagersPanel repositorio={detalhado} onFechar={() => setDetalhado(null)} />
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
  marcado,
  onAlternar,
  onDetalhar,
}: {
  repo: RepositoryHit
  marcado: boolean
  onAlternar: () => void
  onDetalhar: () => void
}) {
  const { t } = useTranslation()

  return (
    <div
      className={`flex items-start gap-3 border-l-2 px-3 py-2.5 transition-colors duration-150 ${
        marcado ? 'border-brand bg-brand-soft' : 'border-transparent hover:bg-surface-muted'
      }`}
    >
      <input
        type="checkbox"
        checked={marcado}
        onChange={onAlternar}
        aria-label={t('access.selectRepository', { repo: repo.acronym })}
        className="mt-1 size-4 shrink-0 accent-[var(--color-brand)]"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-brand-strong">{repo.acronym}</span>
          {repo.lastSnapshotStatus ? <HarvestStatusBadge status={repo.lastSnapshotStatus} /> : null}
        </span>
        <span className="block text-sm font-semibold">{repo.name}</span>
        {repo.institutionName ? (
          <span className="block text-xs text-content-muted">{repo.institutionName}</span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={onDetalhar}
        className="shrink-0 text-xs text-brand-strong underline hover:text-brand"
      >
        {t('access.seeManagers')}
      </button>
    </div>
  )
}

/** Associa o conjunto selecionado a um gestor. */
function BulkLinkPanel({
  selecionados,
  onRemover,
  onLimpar,
  onConcluido,
}: {
  selecionados: Selecionado[]
  onRemover: (id: string) => void
  onLimpar: () => void
  onConcluido: () => Promise<void>
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [buscaGestor, setBuscaGestor] = useState('')
  const [gestorId, setGestorId] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [resultado, setResultado] = useState<BulkLinkResult | null>(null)
  const [novoUsuario, setNovoUsuario] = useState(false)

  const buscaAtrasada = useDebounced(buscaGestor)
  const gestores = useQuery(gestoresQuery(buscaAtrasada))

  const associar = useMutation({
    mutationFn: () =>
      apiPost<BulkLinkResult>('/repositories/accesses/bulk/', {
        user: Number(gestorId),
        repositories: selecionados.map((item) => ({
          harvesterRepositoryId: item.id,
          acronym: item.acronym,
        })),
      }),
    onSuccess: async (data) => {
      setAviso(null)
      setResultado(data)
      setGestorId('')
      await onConcluido()
    },
    onError: (error) => setAviso(error instanceof ApiError ? error.detail : t('common.error')),
  })

  return (
    <div className="panel flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-sm font-bold">
          {t('access.selectedCount', { count: selecionados.length })}
        </h2>
        <button
          type="button"
          onClick={onLimpar}
          className="text-xs text-content-muted underline hover:text-content"
        >
          {t('access.clearSelection')}
        </button>
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {selecionados.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onRemover(item.id)}
              title={item.name}
              className="inline-flex items-center gap-1.5 bg-brand-soft px-2 py-1 font-mono text-xs text-brand-strong hover:bg-brand/20"
            >
              {item.acronym}
              <span aria-hidden="true">×</span>
              <span className="sr-only">{t('access.removeFromSelection')}</span>
            </button>
          </li>
        ))}
      </ul>

      <form
        className="flex flex-col gap-2 border-t border-border-subtle pt-4"
        onSubmit={(event) => {
          event.preventDefault()
          associar.mutate()
        }}
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="eyebrow">{t('access.linkToManager')}</span>
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
          gestores.data.count === 0 ? (
            <p className="text-sm text-content-muted">{t('access.noManagersFound')}</p>
          ) : (
            <select
              value={gestorId}
              onChange={(event) => setGestorId(event.target.value)}
              size={5}
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
          )
        ) : null}

        <button
          type="submit"
          disabled={!gestorId || associar.isPending}
          className="bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-strong disabled:opacity-50"
        >
          {associar.isPending
            ? t('access.linking')
            : t('access.linkCount', { count: selecionados.length })}
        </button>

        {aviso ? (
          <p role="alert" className="text-sm text-down">
            {aviso}
          </p>
        ) : null}

        {/* O lote relata por repositório: o que já existia não é erro. */}
        {resultado ? (
          <p className="border-l-2 border-ok bg-ok-soft px-3 py-2 text-sm text-ok">
            {t('access.bulkResult', {
              count: resultado.createdCount,
              user: resultado.username,
            })}
            {resultado.skippedCount > 0
              ? ` ${t('access.bulkSkipped', { count: resultado.skippedCount })}`
              : ''}
          </p>
        ) : null}
      </form>

      <NewUserModal
        aberto={novoUsuario}
        onFechar={() => setNovoUsuario(false)}
        onCriado={async (user) => {
          setBuscaGestor(user.username)
          setGestorId(String(user.id))
          await queryClient.invalidateQueries({ queryKey: ['users'] })
        }}
      />
    </div>
  )
}

/** Gestores já vinculados a um repositório, com remoção. */
function ManagersPanel({
  repositorio,
  onFechar,
}: {
  repositorio: Selecionado
  onFechar: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [aviso, setAviso] = useState<string | null>(null)

  const vinculos = useQuery(accessesByRepositoryQuery(repositorio.id))

  const remover = useMutation({
    mutationFn: (id: number) => apiDelete(`/repositories/accesses/${id}/`),
    onSuccess: async () => {
      setAviso(null)
      await queryClient.invalidateQueries({ queryKey: ['accesses'] })
      await queryClient.invalidateQueries({ queryKey: ['repositories'] })
    },
    onError: (error) => setAviso(error instanceof ApiError ? error.detail : t('common.error')),
  })

  return (
    <div className="panel flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow !text-brand-strong">{repositorio.acronym}</p>
          <h2 className="font-heading text-lg font-bold tracking-tight">
            {repositorio.name || t('access.selectedRepository')}
          </h2>
        </div>
        <button
          type="button"
          onClick={onFechar}
          aria-label={t('common.close')}
          className="-mt-1 -mr-1 px-2 py-1 text-lg leading-none text-content-muted hover:text-content"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

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

        {aviso ? (
          <p role="alert" className="mt-2 text-sm text-down">
            {aviso}
          </p>
        ) : null}
      </div>
    </div>
  )
}
