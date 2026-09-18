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
import { tamanhoDaUrl, tamanhoParaUrl } from '@/lib/pagination'
import { accessesByRepositoryQuery, gestoresQuery, repositorySearchQuery } from '@/lib/queries'
import type { BulkLinkResult, RepositoryHit } from '@/lib/types'

/**
 * Resultados por página, e o conjunto oferecido no seletor.
 *
 * O teto é 100 porque é o que `/repositories/search/` aceita em `count`
 * (`apps/repositories/views.py`): pedir mais devolve 100 de qualquer forma, e
 * o seletor mostraria um número que a tela não cumpre.
 */
const POR_PAGINA = 10
const TAMANHOS = [10, 25, 50, 100] as const

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
  const porPagina = tamanhoDaUrl(searchParams.get('por'), TAMANHOS, POR_PAGINA)

  const [termo, setTermo] = useState(termoUrl)
  const termoAtrasado = useDebounced(termo)
  const [selecionados, setSelecionados] = useState<Selecionado[]>([])
  const [detalhado, setDetalhado] = useState<Selecionado | null>(null)

  const temTermo = termoAtrasado.trim().length > 0
  // Aqui o objetivo é achar um repositório específico: sem termo não há o que
  // buscar, e o acervo inteiro só atrapalharia.
  const busca = useQuery({
    ...repositorySearchQuery(termoAtrasado, pagina, porPagina),
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
    <div id="access-page" className="d-flex flex-column gap-4">
      <PageHeader
        id="access-page-header"
        eyebrow={t('access.eyebrow')}
        title={t('access.title')}
        description={t('access.subtitle')}
      />

      <div id="access-page-columns" className="row">
        {/* Busca de repositórios */}
        <section id="access-page-search" className="col-lg-6 br-card d-flex flex-column gap-3 p-3">
          <h2 id="access-page-search-title" className="text-base text-bold">
            {t('access.findRepository')}
          </h2>

          <label id="access-page-search-field" className="d-flex flex-column gap-half">
            <span id="access-page-search-label" className="sr-only">
              {t('access.searchRepository')}
            </span>
            <input
              id="access-page-search-input"
              type="search"
              value={termo}
              onChange={(event) => aoBuscar(event.target.value)}
              placeholder={t('access.searchRepository')}
              autoFocus
              className="bg-pure-0 px-2 py-2 text-base"
            />
          </label>

          {!temTermo ? (
            <p id="access-page-search-hint" className="py-6 text-center text-base text-gray-70">
              {t('access.typeToSearch')}
            </p>
          ) : busca.isPending ? (
            <Loading id="access-page-search-loading" />
          ) : busca.isError ? (
            <ErrorState
              id="access-page-search-error"
              error={busca.error}
              onRetry={() => void busca.refetch()}
            />
          ) : busca.data && busca.data.totalElements === 0 ? (
            <Empty id="access-page-search-empty" label={t('access.noRepositories')} />
          ) : busca.data ? (
            <>
              <div
                id="access-page-search-summary"
                className="d-flex flex-wrap align-items-center justify-content-between gap-2"
              >
                <p id="access-page-search-count" className="text-down-01 text-gray-70">
                  {t('access.foundBy', {
                    count: busca.data.totalElements,
                    field: busca.data.field
                      ? t(`access.fields.${busca.data.field}`)
                      : t('access.fields.all'),
                  })}
                </p>
                <button
                  id="access-page-toggle-page-selection"
                  type="button"
                  onClick={alternarTodos}
                  className="text-down-01"
                >
                  {todosMarcados ? t('access.unselectPage') : t('access.selectPage')}
                </button>
              </div>

              <ul id="access-page-results" className="plain-list d-flex flex-column">
                {busca.data.results.map((repo) => (
                  <li
                    id={`access-page-result-${repo.harvesterRepositoryId}`}
                    key={repo.harvesterRepositoryId}
                  >
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
                id="access-page-pagination"
                page={busca.data.page}
                totalPages={busca.data.totalPages}
                onChange={(destino) => atualizarUrl({ pagina: String(destino) })}
                tamanho={porPagina}
                tamanhos={TAMANHOS}
                /* Trocar o tamanho volta à primeira página: a de número 7 com
                   10 por página não existe com 100. */
                onTamanho={(novo) =>
                  atualizarUrl({ por: tamanhoParaUrl(novo, POR_PAGINA), pagina: null })
                }
              />
            </>
          ) : null}
        </section>

        {/* Associação em lote ou detalhe de um repositório */}
        <section id="access-page-side" className="col-lg-6 d-flex flex-column gap-4">
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
            <div id="access-page-no-selection" className="br-card p-3">
              <p id="access-page-no-selection-label" className="eyebrow mb-1">
                {t('access.noSelection')}
              </p>
              <p id="access-page-no-selection-hint" className="text-base text-gray-70">
                {t('access.selectHint')}
              </p>
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
  const id = `access-page-option-${repo.harvesterRepositoryId}`

  return (
    <div
      id={id}
      className={`d-flex align-items-start gap-3 px-2 py-2 ${
        marcado ? 'bg-blue-warm-vivid-5' : ''
      }`}
      style={{
        borderLeft: `2px solid ${marcado ? 'var(--blue-warm-vivid-70)' : 'transparent'}`,
      }}
    >
      <input
        id={`${id}-checkbox`}
        type="checkbox"
        checked={marcado}
        onChange={onAlternar}
        aria-label={t('access.selectRepository', { repo: repo.acronym })}
        className="flex-shrink-0 mt-1"
        style={{ accentColor: 'var(--blue-warm-vivid-70)', width: '1rem', height: '1rem' }}
      />
      <span id={`${id}-info`} className="flex-grow-1">
        <span id={`${id}-top`} className="d-flex flex-wrap align-items-center gap-2">
          <span id={`${id}-acronym`} className="text-down-01 text-blue-warm-vivid-80">
            {repo.acronym}
          </span>
          {repo.lastSnapshotStatus ? (
            <HarvestStatusBadge id={`${id}-status`} status={repo.lastSnapshotStatus} />
          ) : null}
        </span>
        <span id={`${id}-name`} className="d-block text-base text-semi-bold">
          {repo.name}
        </span>
        {repo.institutionName ? (
          <span id={`${id}-institution`} className="d-block text-down-01 text-gray-70">
            {repo.institutionName}
          </span>
        ) : null}
      </span>
      <button
        id={`${id}-see-managers`}
        type="button"
        onClick={onDetalhar}
        className="flex-shrink-0 text-down-01"
      >
        {t('access.seeManagers')}
      </button>
    </div>
  )
}

/** Associa o conjunto selecionado a um gestor. */
function BulkLinkPanel({
  id = 'access-page-bulk',
  selecionados,
  onRemover,
  onLimpar,
  onConcluido,
}: {
  id?: string
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
    <div id={id} className="br-card d-flex flex-column gap-4 p-3">
      <div
        id={`${id}-header`}
        className="d-flex flex-wrap align-items-center justify-content-between gap-2"
      >
        <h2 id={`${id}-title`} className="text-base text-bold">
          {t('access.selectedCount', { count: selecionados.length })}
        </h2>
        <button id={`${id}-clear`} type="button" onClick={onLimpar} className="text-down-01">
          {t('access.clearSelection')}
        </button>
      </div>

      <ul id={`${id}-selection`} className="plain-list d-flex flex-wrap gap-2">
        {selecionados.map((item) => (
          <li id={`${id}-selection-${item.id}`} key={item.id}>
            <button
              id={`${id}-selection-${item.id}-remove`}
              type="button"
              onClick={() => onRemover(item.id)}
              title={item.name}
              className="br-tag text-down-01"
            >
              {item.acronym}
              <span id={`${id}-selection-${item.id}-remove-icon`} aria-hidden="true">
                ×
              </span>
              <span id={`${id}-selection-${item.id}-remove-label`} className="sr-only">
                {t('access.removeFromSelection')}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <form
        id={`${id}-form`}
        className="d-flex flex-column gap-2 pt-3"
        style={{ borderTop: '1px solid var(--border-color)' }}
        onSubmit={(event) => {
          event.preventDefault()
          associar.mutate()
        }}
      >
        <span
          id={`${id}-form-header`}
          className="d-flex flex-wrap align-items-center justify-content-between gap-2"
        >
          <span id={`${id}-form-label`} className="eyebrow">
            {t('access.linkToManager')}
          </span>
          <button
            id={`${id}-new-user`}
            type="button"
            onClick={() => setNovoUsuario(true)}
            className="text-down-01"
          >
            {t('newUser.open')}
          </button>
        </span>

        <input
          id={`${id}-manager-search`}
          type="search"
          value={buscaGestor}
          onChange={(event) => setBuscaGestor(event.target.value)}
          placeholder={t('access.searchManager')}
          className="bg-pure-0 px-2 py-2 text-base"
        />

        {gestores.isPending ? <Loading id={`${id}-managers-loading`} /> : null}
        {gestores.isError ? (
          <ErrorState
            id={`${id}-managers-error`}
            error={gestores.error}
            onRetry={() => void gestores.refetch()}
          />
        ) : null}

        {gestores.data ? (
          gestores.data.count === 0 ? (
            <p id={`${id}-managers-empty`} className="text-base text-gray-70">
              {t('access.noManagersFound')}
            </p>
          ) : (
            <select
              id={`${id}-manager-select`}
              value={gestorId}
              onChange={(event) => setGestorId(event.target.value)}
              size={5}
              aria-label={t('access.manager')}
              className="bg-pure-0 px-1 py-1 text-base"
            >
              <option value="">{t('access.chooseManager')}</option>
              {gestores.data.results.map((gestor) => (
                <option id={`${id}-manager-option-${gestor.id}`} key={gestor.id} value={gestor.id}>
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
          id={`${id}-submit`}
          type="submit"
          disabled={!gestorId || associar.isPending}
          className="br-button primary"
        >
          {associar.isPending
            ? t('access.linking')
            : t('access.linkCount', { count: selecionados.length })}
        </button>

        {aviso ? (
          <p id={`${id}-warning`} role="alert" className="text-base text-red-vivid-50">
            {aviso}
          </p>
        ) : null}

        {/* O lote relata por repositório: o que já existia não é erro. */}
        {resultado ? (
          <p
            id={`${id}-result`}
            className="bg-green-cool-vivid-5 px-2 py-2 text-base text-gray-80"
            style={{ borderLeft: '2px solid var(--green-cool-vivid-50)' }}
          >
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
        id={`${id}-new-user-modal`}
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
  id = 'access-page-managers',
  repositorio,
  onFechar,
}: {
  id?: string
  repositorio: Selecionado
  onFechar: () => void
}) {
  const { t, i18n } = useTranslation()
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
    <div id={id} className="br-card d-flex flex-column gap-4 p-3">
      <div id={`${id}-header`} className="d-flex align-items-start justify-content-between gap-3">
        <div id={`${id}-header-text`}>
          <p
            id={`${id}-acronym`}
            className="eyebrow"
            style={{ color: 'var(--blue-warm-vivid-80)' }}
          >
            {repositorio.acronym}
          </p>
          <h2 id={`${id}-title`} className="text-up-01 text-bold mt-0 mb-0">
            {repositorio.name || t('access.selectedRepository')}
          </h2>
        </div>
        <button
          id={`${id}-close`}
          type="button"
          onClick={onFechar}
          aria-label={t('common.close')}
          className="br-button circle small"
        >
          <span id={`${id}-close-icon`} aria-hidden="true">
            ×
          </span>
        </button>
      </div>

      <div id={`${id}-body`}>
        <p id={`${id}-count`} className="eyebrow mb-2">
          {t('access.managersWithAccess', { count: vinculos.data?.count ?? 0 })}
        </p>

        {vinculos.isPending ? <Loading id={`${id}-loading`} /> : null}
        {vinculos.isError ? (
          <ErrorState
            id={`${id}-error`}
            error={vinculos.error}
            onRetry={() => void vinculos.refetch()}
          />
        ) : null}

        {vinculos.data ? (
          vinculos.data.count === 0 ? (
            <p id={`${id}-empty`} className="text-base text-gray-70">
              {t('access.noManagers')}
            </p>
          ) : (
            <ul id={`${id}-list`} className="plain-list">
              {vinculos.data.results.map((vinculo, indice) => (
                <li
                  id={`${id}-item-${vinculo.id}`}
                  key={vinculo.id}
                  className="d-flex flex-wrap align-items-center justify-content-between gap-2 py-2"
                  style={{
                    borderTop: indice > 0 ? '1px solid var(--border-color)' : undefined,
                  }}
                >
                  <span id={`${id}-item-${vinculo.id}-info`}>
                    <span
                      id={`${id}-item-${vinculo.id}-username`}
                      className="text-base text-semi-bold"
                    >
                      {vinculo.username}
                    </span>
                    <span
                      id={`${id}-item-${vinculo.id}-since`}
                      className="d-block text-down-01 text-gray-70"
                    >
                      {t('access.since', {
                        date: new Date(vinculo.grantedAt).toLocaleDateString(i18n.resolvedLanguage),
                      })}
                    </span>
                  </span>
                  <button
                    id={`${id}-item-${vinculo.id}-remove`}
                    type="button"
                    onClick={() => {
                      if (window.confirm(t('access.confirmRemove', { user: vinculo.username })))
                        remover.mutate(vinculo.id)
                    }}
                    disabled={remover.isPending}
                    className="br-button secondary small"
                  >
                    {t('access.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {aviso ? (
          <p id={`${id}-warning`} role="alert" className="mt-2 text-base text-red-vivid-50">
            {aviso}
          </p>
        ) : null}
      </div>
    </div>
  )
}
