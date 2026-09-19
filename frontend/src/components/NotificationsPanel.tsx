import { BrButton } from '@govbr-ds/react-components'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/context'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { Modal } from '@/components/Modal'
import { nomeDaCategoria } from '@/lib/categorias'
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
  onNova,
}: {
  id?: string
  aberto: boolean
  onFechar: () => void
  /** Ausente, o painel mostra a caixa de entrada de quem está vendo. */
  repositoryId?: string
  titulo: string
  descricao?: string
  /**
   * Abre a criação de notificação. Quem monta o modal é a tela, não este
   * painel: a diretriz proíbe empilhar duas modais, então a tela fecha esta
   * antes de abrir aquela.
   */
  onNova?: () => void
}) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()

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
    onSuccess: () => {
      /*
        Invalida as notificações e as duas listas de repositório, que carregam a
        contagem do indicador. `['repositories']` inteiro seria caro demais:
        derrubaria também o índice, de ~960 KB.

        Sem `await`: o `summary` recompõe o painel do gestor contra o Harvester,
        e aguardá-lo manteria `isPending` ligado — com os botões do painel
        desabilitados — muito depois de a leitura já ter sido registrada.
      */
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      void queryClient.invalidateQueries({ queryKey: ['repositories', 'summary'] })
      void queryClient.invalidateQueries({ queryKey: ['repositories', 'index'] })
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
        13% da largura e um terceiro botão a quebrava em três linhas. Aqui o
        botão só avisa a tela: quem monta o modal é ela, porque a diretriz
        proíbe duas modais abertas ao mesmo tempo. O guarda de perfil é
        conveniência — quem recusa de fato é o backend, com 403.
      */}
      {user?.profile === 'ADMIN' && onNova ? (
        <div id={`${id}-actions`} className="d-flex justify-content-end mb-2">
          <BrButton id={`${id}-new`} type="button" secondary onClick={onNova}>
            {t('notifications.new.open')}
          </BrButton>
        </div>
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
 * Uma notificação da lista, em três formas.
 *
 * **Exige visto**: o corpo não é clicável e há um botão nomeado, "Dar visto".
 * São os avisos que não podem sair da tela de passagem — um clique distraído no
 * corpo apagaria, para os três gestores do repositório de uma vez, algo que
 * pedia confirmação. É a mesma lógica da modal de opção por seleção do Padrão
 * Digital: a ação só vale depois de confirmada.
 *
 * **Comum e não lida**: o item inteiro é o alvo. Continua exigindo clique —
 * abrir o painel não marca nada —, mas sem a cerimônia do botão.
 *
 * **Lida**: texto simples, sem alvo. Não há como desfazer, e um botão que não
 * faz nada é pior que nenhum.
 *
 * O estado não depende de cor em nenhuma delas: o que distingue é o peso do
 * título, o selo e o rótulo acessível.
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
  const { t, i18n } = useTranslation()
  const criada = new Date(item.createdAt)

  const corpo = (
    <>
      <span id={`${id}-head`} className="d-flex flex-wrap align-items-center gap-half">
        <span id={`${id}-category`} className="br-tag text small">
          {nomeDaCategoria(item.category, i18n.resolvedLanguage)}
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
        {item.requiresAcknowledgement && !item.read ? (
          <span
            id={`${id}-requires-tag`}
            className="br-tag text small"
            /* Cinza-80 sobre o amarelo: o token de aviso do DS dá 1,50 de
               contraste como texto pequeno, e a medição está em Badges.tsx. */
            style={{ background: 'var(--yellow-vivid-20)', color: 'var(--gray-80)' }}
          >
            {t('notifications.requiresTag')}
          </span>
        ) : null}
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
            ? t(item.requiresAcknowledgement ? 'notifications.seenBy' : 'notifications.readBy', {
                username: item.readByUsername,
              })
            : t('notifications.alreadyRead')}
        </span>
      </div>
    )
  }

  if (item.requiresAcknowledgement) {
    return (
      <div id={`${id}-pending`} className="br-item p-2">
        {corpo}
        <span
          id={`${id}-requires`}
          className="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-2"
        >
          <span id={`${id}-requires-hint`} className="text-down-01 text-gray-70">
            {t('notifications.requiresHint')}
          </span>
          <BrButton
            id={`${id}-acknowledge`}
            type="button"
            primary
            size="small"
            disabled={ocupado}
            onClick={onMarcar}
          >
            {t('notifications.acknowledge')}
          </BrButton>
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
