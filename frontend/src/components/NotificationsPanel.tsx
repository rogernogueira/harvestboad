import { BrButton } from '@govbr-ds/react-components'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/context'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { Modal } from '@/components/Modal'
import { NotificationEntry } from '@/components/NotificationEntry'
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
                <NotificationEntry
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
