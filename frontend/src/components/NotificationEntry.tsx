import { BrButton } from '@govbr-ds/react-components'
import { useTranslation } from 'react-i18next'

import { nomeDaCategoria } from '@/lib/categorias'
import type { NotificationItem } from '@/lib/types'

/**
 * Uma notificação da caixa de entrada, em três formas.
 *
 * **Exige visto**: o corpo não é clicável e há um botão nomeado, "Dar visto".
 * São os avisos que não podem sair da tela de passagem — um clique distraído no
 * corpo apagaria, para os três gestores do repositório de uma vez, algo que
 * pedia confirmação. É a mesma lógica da modal de opção por seleção do Padrão
 * Digital: a ação só vale depois de confirmada.
 *
 * **Comum e não lida**: o item inteiro é o alvo. Continua exigindo clique —
 * abrir a lista não marca nada —, mas sem a cerimônia do botão.
 *
 * **Lida**: texto simples, sem alvo. Não há como desfazer, e um botão que não
 * faz nada é pior que nenhum.
 *
 * O estado não depende de cor em nenhuma delas: o que distingue é o peso do
 * título, o selo e o rótulo acessível.
 *
 * Mora aqui, e não dentro do `NotificationsPanel`, porque a mesma notificação
 * aparece em dois recipientes — a modal do sino e a aba "Caixa de entrada" da
 * seção de notificações. Duplicar o item faria as três formas divergirem
 * justamente no que distingue "lida" de "exige visto".
 *
 * Com `onDispensar`, ganha o botão de tirar da caixa **ao lado** do conteúdo, e
 * não dentro dele: na forma comum e não lida o item inteiro já é um `<button>`,
 * e um botão dentro de outro é HTML inválido — o navegador desfaz o aninhamento
 * e o clique passa a cair no alvo errado.
 */
export function NotificationEntry({
  id,
  item,
  quando,
  ocupado,
  onMarcar,
  onDispensar,
}: {
  id: string
  item: NotificationItem
  quando: Intl.DateTimeFormat
  ocupado: boolean
  onMarcar: () => void
  /** Ausente, o item não oferece o botão — é o caso da modal do sino. */
  onDispensar?: () => void
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

  const formaDoItem = () => {
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

  if (!onDispensar) return formaDoItem()

  return (
    <div id={`${id}-row`} className="d-flex align-items-start gap-1">
      <div id={`${id}-content`} className="flex-grow-1" style={{ minWidth: 0 }}>
        {formaDoItem()}
      </div>
      {/*
        Um X, e não uma lixeira: a notificação não é apagada — ela continua
        inteira para os outros gestores do repositório e na lista de quem a
        enviou. A lixeira prometeria uma destruição que não acontece.
      */}
      <button
        id={`${id}-dismiss`}
        type="button"
        onClick={onDispensar}
        disabled={ocupado}
        title={t('notifications.dismiss.action')}
        aria-label={t('notifications.dismiss.one', { title: item.title })}
        className="br-button circle small flex-shrink-0"
      >
        <i className="fas fa-times" aria-hidden="true" />
      </button>
    </div>
  )
}
