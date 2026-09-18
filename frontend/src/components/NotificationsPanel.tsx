import { BrButton } from '@govbr-ds/react-components'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/context'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { Modal } from '@/components/Modal'
import { NewNotificationModal } from '@/components/NewNotificationModal'
import { ApiError, apiPost } from '@/lib/api'
import { notificationsQuery } from '@/lib/queries'
import type { NotificationItem } from '@/lib/types'

/**
 * Painel de notificações.
 *
 * **Não é o `br-notification` do Padrão Digital**, e o motivo é o mesmo já
 * registrado para `BrTab`, `BrModal` e companhia. Três impedimentos somados:
 * o componente do DS depende do `br-tab`, que não emite `role="tablist"` nem
 * navegação por seta; o comportamento vem de `new core.BRNotification(...)`,
 * que varre o `document` no import e não alcança marcação do React; e, no
 * `core-lite.min.css`, a classe nasce com `display:none`, largura `50vw`/`100vw`
 * e `--notification-height: calc(100vh - 86px)` — os 86px são a altura do
 * cabeçalho do gov.br, que este projeto não usa.
 *
 * Aqui o recipiente é o `Modal` próprio (o `<dialog>` nativo, que entrega
 * captura de foco e Esc), e a lista usa `.br-list`/`.br-item`, que são só
 * estilo e vêm no core-lite.
 *
 * Só consulta quando aberto: são N repositórios por tela, e a lista não
 * interessa a quem não abriu.
 */
export function NotificationsPanel({
  id = 'notifications-panel',
  aberto,
  onFechar,
  repositoryId,
  titulo,
  descricao,
  acronym,
}: {
  id?: string
  aberto: boolean
  onFechar: () => void
  /** Ausente, o painel mostra a caixa de entrada de quem está vendo. */
  repositoryId?: string
  titulo: string
  descricao?: string
  /** Sigla do repositório, para pré-selecionar o destino ao criar. */
  acronym?: string
}) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [criando, setCriando] = useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    ...notificationsQuery(repositoryId ? { repository: repositoryId } : {}),
    enabled: aberto,
  })

  const quandoFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'short',
    timeStyle: 'short',
  })

  const marcar = useMutation({
    mutationFn: (notificacaoId: number) =>
      apiPost<NotificationItem>(`/notifications/${notificacaoId}/read/`, {}),
    onSuccess: async () => {
      /*
        Invalida as notificações e as duas listas de repositório, que carregam
        a contagem do indicador.

        `['repositories']` inteiro seria caro demais: derrubaria também o
        `index` (~960 KB) e o `summary`, que recompõe o painel do gestor contra
        o Harvester, repositório por repositório. Só as chaves que de fato
        mostram o número.
      */
      await queryClient.invalidateQueries({ queryKey: ['notifications'] })
      await queryClient.invalidateQueries({ queryKey: ['repositories', 'summary'] })
      await queryClient.invalidateQueries({ queryKey: ['repositories', 'index'] })
    },
  })

  return (
    <Modal id={id} aberto={aberto} onFechar={onFechar} titulo={titulo} descricao={descricao}>
      {isPending ? <Loading id={`${id}-loading`} /> : null}
      {isError ? (
        <ErrorState id={`${id}-error`} error={error} onRetry={() => void refetch()} />
      ) : null}

      {/*
        A criação mora aqui, e não na linha da tabela: a coluna de gestores tem
        13% da largura e um terceiro botão a quebrava em três linhas. O guarda é
        conveniência — quem recusa de fato é o backend, com 403.
      */}
      {user?.profile === 'ADMIN' ? (
        <div id={`${id}-actions`} className="d-flex justify-content-end mb-2">
          <BrButton id={`${id}-new`} type="button" secondary onClick={() => setCriando(true)}>
            {t('notifications.new.open')}
          </BrButton>
        </div>
      ) : null}

      {criando ? (
        <NewNotificationModal
          id={`${id}-new-modal`}
          aberto
          onFechar={() => setCriando(false)}
          repositorioFixo={
            repositoryId ? { id: repositoryId, acronym: acronym ?? repositoryId } : undefined
          }
        />
      ) : null}

      {marcar.isError ? (
        <p id={`${id}-warning`} role="alert" className="text-base text-red-vivid-50 mb-2">
          {marcar.error instanceof ApiError ? marcar.error.detail : t('common.error')}
        </p>
      ) : null}

      {data ? (
        data.results.length === 0 ? (
          <Empty id={`${id}-empty`} label={t('notifications.none')} />
        ) : (
          <ul id={`${id}-list`} className="plain-list d-flex flex-column gap-2">
            {data.results.map((item) => (
              <li id={`${id}-item-${item.id}`} key={item.id}>
                <ItemDaNotificacao
                  id={`${id}-item-${item.id}`}
                  item={item}
                  quando={quandoFormat}
                  ocupado={marcar.isPending}
                  onMarcar={() => marcar.mutate(item.id)}
                />
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Modal>
  )
}

/**
 * Uma notificação da lista.
 *
 * Não lida é um `<button>`: clicar nela é a única forma de marcar como lida, e
 * o requisito é justamente esse — abrir o painel não pode apagar o aviso da
 * equipe inteira, porque a leitura vale para todos os gestores do repositório.
 *
 * Lida vira texto simples, sem alvo de clique: não há como desfazer, e um botão
 * que não faz nada é pior que nenhum.
 *
 * O estado não depende de cor: o não lido tem o sino, o título em peso maior e
 * a palavra "não lida" no rótulo acessível.
 */
function ItemDaNotificacao({
  id,
  item,
  quando,
  ocupado,
  onMarcar,
}: {
  id: string
  item: NotificationItem
  quando: Intl.DateTimeFormat
  ocupado: boolean
  onMarcar: () => void
}) {
  const { t } = useTranslation()
  const criada = new Date(item.createdAt)

  const corpo = (
    <>
      <span id={`${id}-head`} className="d-flex flex-wrap align-items-center gap-half">
        <span id={`${id}-category`} className="br-tag text small">
          {t(`notifications.categories.${item.category}`)}
        </span>
        {item.acronym ? (
          <span id={`${id}-acronym`} className="text-down-01 text-gray-70">
            {item.acronym}
          </span>
        ) : (
          <span id={`${id}-direct`} className="text-down-01 text-gray-70">
            {t('notifications.direct')}
          </span>
        )}
        <span id={`${id}-when`} className="text-down-01 text-gray-70">
          {quando.format(criada)}
        </span>
      </span>
      <span id={`${id}-title`} className={`d-block ${item.read ? '' : 'text-semi-bold'}`}>
        {item.title}
      </span>
      <span
        id={`${id}-message`}
        className="d-block text-down-01"
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {item.message}
      </span>
    </>
  )

  if (item.read) {
    return (
      <div id={`${id}-read`} className="br-item p-2">
        {corpo}
        <span id={`${id}-read-by`} className="d-block text-down-01 text-gray-70">
          {item.readByUsername
            ? t('notifications.readBy', { username: item.readByUsername })
            : t('notifications.alreadyRead')}
        </span>
      </div>
    )
  }

  return (
    <button
      id={`${id}-mark`}
      type="button"
      onClick={onMarcar}
      disabled={ocupado}
      aria-label={t('notifications.markRead', { title: item.title })}
      className="br-item p-2 text-left w-100"
    >
      {corpo}
      <span id={`${id}-hint`} className="d-block text-down-01 text-gray-70">
        {t('notifications.markReadHint')}
      </span>
    </button>
  )
}
