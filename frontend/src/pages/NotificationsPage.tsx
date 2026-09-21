import { BrButton } from '@govbr-ds/react-components'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'

import { useAuth } from '@/auth/context'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { CategoryCatalog } from '@/components/CategoryCatalog'
import { NewNotificationModal } from '@/components/NewNotificationModal'
import { NotificationEntry } from '@/components/NotificationEntry'
import { PageHeader } from '@/components/PageHeader'
import { Pagination } from '@/components/Pagination'
import { Tabs } from '@/components/Tabs'
import type { Aba } from '@/components/Tabs'
import { nomeDaCategoria } from '@/lib/categorias'
import { ApiError, apiDelete, apiPost } from '@/lib/api'
import { dicaDeColuna } from '@/lib/columnHints'
import { tamanhoDaUrl, tamanhoParaUrl } from '@/lib/pagination'
import { inboxNotificationsQuery, sentNotificationsQuery } from '@/lib/queries'
import type { NotificationItem } from '@/lib/types'

/**
 * Itens por página desta tela.
 *
 * Sem "tudo": a lista pagina no servidor, e ali o infinito não tem como ser
 * pedido — o teto de 200 é o mesmo que `config/pagination.py` impõe. O padrão
 * é 25 para casar com o da tabela de registros.
 */
const POR_PAGINA = 25
const TAMANHOS = [10, 25, 50, 100] as const

/**
 * Seção de notificações.
 *
 * Tem dois públicos na mesma rota, e o que muda entre eles é quantas abas
 * existem — não qual tela se abre. Todo mundo tem caixa de entrada, inclusive o
 * administrador, que também gerencia repositórios e recebe recado direto; só o
 * administrador tem o que enviou e o catálogo, porque criar, excluir e manter
 * categorias é `IsAdminProfile` no backend.
 *
 * O guarda de perfil aqui é conveniência de navegação: o gestor que digitasse a
 * rota das outras abas esbarraria no 403, que é quem recusa de fato.
 *
 * A aba do administrador abre em "Enviadas", que era a tela inteira antes da
 * caixa de entrada existir — quem já usava a seção continua caindo onde caía.
 */
export function NotificationsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const admin = user?.profile === 'ADMIN'
  const [aba, setAba] = useState(admin ? 'enviadas' : 'caixa')

  const abas: Aba[] = [
    {
      chave: 'caixa',
      rotulo: t('notifications.inbox.tab'),
      conteudo: <CaixaDeEntrada />,
    },
  ]
  if (admin)
    abas.push(
      { chave: 'enviadas', rotulo: t('notifications.manage.tabSent'), conteudo: <Enviadas /> },
      {
        chave: 'catalogo',
        rotulo: t('notifications.catalog.tab'),
        conteudo: <CategoryCatalog id="notifications-page-catalog" />,
      },
    )

  /*
   * Trocar de aba zera a paginação da URL.
   *
   * As duas listas paginam no servidor e dividem `page`/`por` — só a aba ativa
   * é montada, então nunca disputam os parâmetros ao mesmo tempo. Sem este
   * zeramento, porém, quem estivesse na página 6 das enviadas caía na página 6
   * da caixa de entrada, que é um trecho arbitrário de outra lista — ou uma
   * página vazia, quando a caixa é menor.
   */
  const trocarAba = (chave: string) => {
    setAba(chave)
    const params = new URLSearchParams(searchParams)
    params.delete('page')
    params.delete('por')
    setSearchParams(params, { replace: true })
  }

  return (
    <div id="notifications-page" className="d-flex flex-column gap-4">
      <PageHeader
        id="notifications-page-header"
        eyebrow={admin ? t('nav.admin') : undefined}
        title={t('notifications.title')}
        description={t(admin ? 'notifications.page.adminSubtitle' : 'notifications.inboxSubtitle')}
      />

      {/*
        Abas no `Tabs` próprio do projeto, que emite `role="tablist"` e
        navegação por seta — o `BrTab` do pacote React não emite nenhum dos
        dois, e o `tab.js` do core varre o `document` no import.

        Com uma aba só, a barra continua: ela nomeia o que está na tela e
        mantém o mesmo desenho para os dois perfis.
      */}
      <Tabs id="notifications-page-tabs" ativa={aba} onTrocar={trocarAba} abas={abas} />
    </div>
  )
}

/**
 * Aba da caixa de entrada: o que chegou para quem está vendo.
 *
 * Mesma lista do sino do cabeçalho — recados diretos mais os avisos dos
 * repositórios que a pessoa gerencia —, com duas diferenças que justificam a
 * tela existir além da modal: pagina, e por isso alcança o que já foi lido; e
 * cabe na página inteira, onde a mensagem de várias linhas não disputa altura
 * com o resto do conteúdo.
 *
 * O item é o `NotificationEntry` compartilhado com o painel, para que "lida",
 * "exige visto" e "comum" não divirjam entre os dois lugares.
 */
function CaixaDeEntrada() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const pagina = Math.max(1, Number(searchParams.get('page') ?? 1))
  const porPagina = tamanhoDaUrl(searchParams.get('por'), TAMANHOS, POR_PAGINA)

  const { data, isPending, isError, error, refetch } = useQuery({
    ...inboxNotificationsQuery(pagina, porPagina),
    placeholderData: keepPreviousData,
  })

  const quando = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'short',
    timeStyle: 'short',
  })

  const marcar = useMutation({
    mutationFn: (notificacaoId: number) =>
      apiPost<NotificationItem>(`/notifications/${notificacaoId}/read/`, {}),
    onSuccess: () => {
      /*
        Mesmas invalidações do painel: as notificações e as duas listas de
        repositório, que carregam a contagem do sino de cada linha.
        `['repositories']` inteiro derrubaria também o índice, de ~960 KB.

        Sem `await`: o `summary` recompõe o painel do gestor contra o
        Harvester, e aguardá-lo manteria os botões desabilitados muito depois
        de a leitura já ter sido registrada.
      */
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      void queryClient.invalidateQueries({ queryKey: ['repositories', 'summary'] })
      void queryClient.invalidateQueries({ queryKey: ['repositories', 'index'] })
    },
  })

  const irParaPagina = (destino: number) => {
    const params = new URLSearchParams(searchParams)
    if (destino <= 1) params.delete('page')
    else params.set('page', String(destino))
    setSearchParams(params, { replace: true })
  }

  /* Trocar o tamanho volta para a primeira página, pelo mesmo motivo das
     enviadas: a página 6 de 10 itens não é a página 6 de 50. */
  const mudarTamanho = (tamanho: number) => {
    const params = new URLSearchParams(searchParams)
    const valor = tamanhoParaUrl(tamanho, POR_PAGINA)
    if (valor) params.set('por', valor)
    else params.delete('por')
    params.delete('page')
    setSearchParams(params, { replace: true })
  }

  if (isPending) return <Loading id="notifications-page-inbox-loading" />
  if (isError)
    return (
      <ErrorState
        id="notifications-page-inbox-error"
        error={error}
        onRetry={() => void refetch()}
      />
    )

  return (
    <div id="notifications-page-inbox" className="d-flex flex-column gap-3">
      <p id="notifications-page-inbox-count" className="text-gray-70 mb-0">
        {t('notifications.inbox.subtitle', { count: data.count })}
      </p>

      {marcar.isError ? (
        <p
          id="notifications-page-inbox-warning"
          role="alert"
          className="text-base text-red-vivid-50 mb-0"
        >
          {marcar.error instanceof ApiError ? marcar.error.detail : t('common.error')}
        </p>
      ) : null}

      {data.results.length === 0 ? (
        <Empty id="notifications-page-inbox-empty" label={t('notifications.none')} />
      ) : (
        <>
          <ul id="notifications-page-inbox-list" className="plain-list d-flex flex-column gap-2">
            {data.results.map((item) => (
              <li id={`notifications-page-inbox-item-${item.id}`} key={item.id}>
                <NotificationEntry
                  id={`notifications-page-inbox-item-${item.id}`}
                  item={item}
                  quando={quando}
                  ocupado={marcar.isPending}
                  onMarcar={() => marcar.mutate(item.id)}
                />
              </li>
            ))}
          </ul>

          <Pagination
            id="notifications-page-inbox-pagination"
            page={pagina}
            totalPages={Math.max(1, Math.ceil(data.count / porPagina))}
            onChange={irParaPagina}
            tamanho={porPagina}
            tamanhos={TAMANHOS}
            onTamanho={mudarTamanho}
          />
        </>
      )}
    </div>
  )
}

/** Aba do que foi enviado: a lista, a criação e a exclusão. */
function Enviadas() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [criando, setCriando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const pagina = Math.max(1, Number(searchParams.get('page') ?? 1))
  const porPagina = tamanhoDaUrl(searchParams.get('por'), TAMANHOS, POR_PAGINA)

  const { data, isPending, isError, error, refetch } = useQuery({
    ...sentNotificationsQuery(pagina, porPagina),
    // Mantém a página visível enquanto a próxima carrega, como nos registros.
    placeholderData: keepPreviousData,
  })

  const alterarParams = (mudanca: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams)
    mudanca(params)
    setSearchParams(params, { replace: true })
  }

  const irParaPagina = (destino: number) =>
    alterarParams((params) =>
      destino <= 1 ? params.delete('page') : params.set('page', String(destino)),
    )

  /*
   * Trocar o tamanho volta para a primeira página.
   *
   * A página 6 de 10 itens não é a página 6 de 50: manter o número levaria a um
   * trecho arbitrário da lista, ou a uma página vazia quando o total encolhe.
   */
  const mudarTamanho = (tamanho: number) =>
    alterarParams((params) => {
      const valor = tamanhoParaUrl(tamanho, POR_PAGINA)
      if (valor) params.set('por', valor)
      else params.delete('por')
      params.delete('page')
    })

  const quando = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'short',
    timeStyle: 'short',
  })

  const excluir = useMutation({
    mutationFn: (id: number) => apiDelete(`/notifications/${id}/`),
    onSuccess: () => {
      setAviso(null)
      // Sem `await`: o resumo do gestor é lento (recompõe contra o Harvester) e
      // aguardá-lo travaria o botão de excluir depois de a linha já ter saído.
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      void queryClient.invalidateQueries({ queryKey: ['repositories', 'summary'] })
      void queryClient.invalidateQueries({ queryKey: ['repositories', 'index'] })
    },
    onError: (erro) => setAviso(erro instanceof ApiError ? erro.detail : t('common.error')),
  })

  if (isPending) return <Loading id="notifications-page-loading" />
  if (isError)
    return <ErrorState id="notifications-page-error" error={error} onRetry={() => void refetch()} />

  return (
    <div id="notifications-page-sent" className="d-flex flex-column gap-3">
      <div
        id="notifications-page-toolbar"
        className="d-flex flex-wrap align-items-center justify-content-between gap-2"
      >
        <p id="notifications-page-count" className="text-gray-70 mb-0">
          {t('notifications.manage.subtitle', { count: data.count })}
        </p>
        <BrButton
          id="notifications-page-new"
          type="button"
          primary
          onClick={() => setCriando(true)}
        >
          {t('notifications.new.open')}
        </BrButton>
      </div>

      {aviso ? (
        <p id="notifications-page-warning" role="alert" className="text-base text-red-vivid-50">
          {aviso}
        </p>
      ) : null}

      {data.results.length === 0 ? (
        <Empty id="notifications-page-empty" label={t('notifications.manage.none')} />
      ) : (
        <>
          <div
            id="notifications-page-table-wrapper"
            className="br-table"
            style={{ overflowX: 'auto' }}
          >
            <table id="notifications-page-table">
              <thead id="notifications-page-table-head">
                <tr id="notifications-page-table-head-row" className="bg-gray-2 text-left">
                  {(['destination', 'notification', 'sentAt', 'status', 'actions'] as const).map(
                    (coluna) => (
                      <th
                        id={`notifications-page-column-${coluna}`}
                        key={coluna}
                        className="px-3 py-2 text-down-01 text-bold"
                        {...dicaDeColuna(t(`notifications.manage.columnHints.${coluna}`))}
                      >
                        {t(`notifications.manage.columns.${coluna}`)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody id="notifications-page-table-body">
                {data.results.map((item) => (
                  <Linha
                    key={item.id}
                    item={item}
                    quando={quando}
                    ocupado={excluir.isPending}
                    onExcluir={() => {
                      if (
                        window.confirm(
                          t('notifications.manage.confirmDelete', { title: item.title }),
                        )
                      )
                        excluir.mutate(item.id)
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            id="notifications-page-pagination"
            page={pagina}
            totalPages={Math.max(1, Math.ceil(data.count / porPagina))}
            onChange={irParaPagina}
            tamanho={porPagina}
            tamanhos={TAMANHOS}
            onTamanho={mudarTamanho}
          />
        </>
      )}

      <NewNotificationModal
        id="notifications-page-new-modal"
        aberto={criando}
        onFechar={() => setCriando(false)}
      />
    </div>
  )
}

function Linha({
  item,
  quando,
  ocupado,
  onExcluir,
}: {
  item: NotificationItem
  quando: Intl.DateTimeFormat
  ocupado: boolean
  onExcluir: () => void
}) {
  const { t, i18n } = useTranslation()
  const id = `notifications-page-row-${item.id}`
  const pendentes = item.pendingManagers ?? []

  return (
    <tr id={id}>
      <td id={`${id}-destination`} className="px-3 py-2">
        {item.harvesterRepositoryId ? (
          <span id={`${id}-destination-repo`}>{item.acronym || item.harvesterRepositoryId}</span>
        ) : (
          <span id={`${id}-destination-user`} className="text-gray-70">
            {t('notifications.manage.toManager', { username: item.recipientUsername ?? '—' })}
          </span>
        )}
      </td>

      <td id={`${id}-notification`} className="px-3 py-2">
        <span id={`${id}-category`} className="br-tag text small mr-1">
          {nomeDaCategoria(item.category, i18n.resolvedLanguage)}
        </span>
        <span id={`${id}-title`} className="text-semi-bold">
          {item.title}
        </span>
        {item.requiresAcknowledgement ? (
          <span id={`${id}-requires`} className="d-block text-down-01 text-gray-70">
            {t('notifications.requiresTag')}
          </span>
        ) : null}
      </td>

      <td id={`${id}-sent-at`} className="px-3 py-2 text-down-01 text-gray-70">
        {quando.format(new Date(item.createdAt))}
      </td>

      <td id={`${id}-status`} className="px-3 py-2 text-down-01">
        {item.read ? (
          <span id={`${id}-status-read`}>
            {item.readByUsername
              ? t(item.requiresAcknowledgement ? 'notifications.seenBy' : 'notifications.readBy', {
                  username: item.readByUsername,
                })
              : t('notifications.alreadyRead')}
          </span>
        ) : (
          <span id={`${id}-status-pending`} className="d-flex flex-column">
            <span id={`${id}-status-pending-label`} className="text-semi-bold">
              {t('notifications.manage.pending')}
            </span>
            {/*
              Recado direto não tem lista de gestores; repositório sem nenhum
              vinculado também não — e aí o aviso fica sem quem o leia, que é
              em si a informação útil.
            */}
            <span id={`${id}-status-pending-who`} className="text-gray-70">
              {item.harvesterRepositoryId
                ? pendentes.length > 0
                  ? pendentes.join(', ')
                  : t('notifications.manage.noManagers')
                : (item.recipientUsername ?? '—')}
            </span>
          </span>
        )}
      </td>

      <td id={`${id}-actions`} className="px-3 py-2">
        <button
          id={`${id}-delete`}
          type="button"
          onClick={onExcluir}
          disabled={ocupado}
          title={t('notifications.manage.delete')}
          aria-label={t('notifications.manage.deleteOne', { title: item.title })}
          className="br-button circle small"
        >
          <i className="fas fa-trash-alt" aria-hidden="true" />
        </button>
      </td>
    </tr>
  )
}
