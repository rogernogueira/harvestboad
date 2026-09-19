import { BrButton } from '@govbr-ds/react-components'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { CategoryCatalog } from '@/components/CategoryCatalog'
import { NewNotificationModal } from '@/components/NewNotificationModal'
import { PageHeader } from '@/components/PageHeader'
import { Tabs } from '@/components/Tabs'
import { nomeDaCategoria } from '@/lib/categorias'
import { ApiError, apiDelete } from '@/lib/api'
import { sentNotificationsQuery } from '@/lib/queries'
import type { NotificationItem } from '@/lib/types'

/**
 * Gestão das notificações enviadas pelo administrador.
 *
 * A listagem vem de `?sent=true`, que recorta por autoria e **não** pela caixa
 * de entrada: quem envia não é destinatário do próprio aviso, e filtrar pela
 * caixa devolvia lista vazia justamente para quem quer acompanhar o que mandou.
 *
 * A coluna de pendentes diz o que o modelo permite dizer. Como o visto é
 * compartilhado — o primeiro gestor que confirmar vale pelos demais —, não há
 * pendência por pessoa: ou ninguém viu, e aí todos os gestores do repositório
 * constam, ou alguém viu e não sobra pendência para ninguém.
 */
export function NotificationsPage() {
  const { t } = useTranslation()
  const [aba, setAba] = useState('enviadas')

  return (
    <div id="notifications-page" className="d-flex flex-column gap-4">
      <PageHeader
        id="notifications-page-header"
        eyebrow={t('nav.admin')}
        title={t('notifications.manage.title')}
        description={t('notifications.manage.headerSubtitle')}
      />

      {/*
        Duas abas no `Tabs` próprio do projeto, que emite `role="tablist"` e
        navegação por seta — o `BrTab` do pacote React não emite nenhum dos
        dois, e o `tab.js` do core varre o `document` no import.
      */}
      <Tabs
        id="notifications-page-tabs"
        ativa={aba}
        onTrocar={setAba}
        abas={[
          { chave: 'enviadas', rotulo: t('notifications.manage.tabSent'), conteudo: <Enviadas /> },
          {
            chave: 'catalogo',
            rotulo: t('notifications.catalog.tab'),
            conteudo: <CategoryCatalog id="notifications-page-catalog" />,
          },
        ]}
      />
    </div>
  )
}

/** Aba do que foi enviado: a lista, a criação e a exclusão. */
function Enviadas() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [criando, setCriando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery(sentNotificationsQuery)

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
                      window.confirm(t('notifications.manage.confirmDelete', { title: item.title }))
                    )
                      excluir.mutate(item.id)
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
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
