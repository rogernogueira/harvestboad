import { useTranslation } from 'react-i18next'

import { BellIcon } from '@/components/BellIcon'

/**
 * Sino com a contagem de notificações sem leitura.
 *
 * Mesma anatomia do bloco de gestores — ícone seguido do número — para que as
 * duas informações da linha se leiam como um par, e não como controles de
 * origens diferentes.
 *
 * **Some quando não há nada sem ler.** Nas linhas de repositório o sino é um
 * sinal, não um controle permanente: aceso o tempo todo com "0", ele viraria
 * ruído em 2.181 linhas e deixaria de chamar atenção justamente onde importa.
 * No cabeçalho é o contrário — ali `sempreVisivel` mantém a porta de entrada
 * das notificações, que precisa existir mesmo com a caixa vazia.
 *
 * O número não é a única pista: o `title` e o `aria-label` dizem quantas são,
 * por extenso, e a cor não carrega significado sozinha.
 */
export function NotificationsButton({
  id = 'notifications-button',
  count,
  onAbrir,
  sempreVisivel = false,
  className,
}: {
  id?: string
  count: number
  onAbrir: () => void
  sempreVisivel?: boolean
  className?: string
}) {
  const { t } = useTranslation()

  if (count === 0 && !sempreVisivel) return null

  const rotulo = count > 0 ? t('notifications.unread', { count }) : t('notifications.open')

  return (
    <button
      id={id}
      type="button"
      onClick={onAbrir}
      title={rotulo}
      aria-label={rotulo}
      className={
        className ??
        'd-inline-flex align-items-center justify-content-center gap-half px-1 py-1 text-gray-70'
      }
    >
      <BellIcon id={`${id}-icon`} />
      {count > 0 ? (
        <span id={`${id}-count`} className="text-down-01 text-semi-bold">
          {count}
        </span>
      ) : null}
    </button>
  )
}
