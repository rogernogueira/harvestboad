import { BrButton } from '@govbr-ds/react-components'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Modal } from '@/components/Modal'

/**
 * Confirmação de uma ação que não se desfaz.
 *
 * Substitui o `window.confirm`, que resolvia o problema e criava outros três: o
 * diálogo é do navegador, então não passa por `t()` nos botões — "OK" e
 * "Cancelar" saem no idioma do sistema, não no da interface —, não aceita o
 * `id` que a convenção do projeto pede, e trava a thread até alguém responder.
 *
 * O recipiente é o `Modal` do projeto, e **não** `obrigatorio`: aqui Esc e
 * clique fora têm significado claro e seguro — desistir. É o contrário do aviso
 * que exige visto, onde as duas saídas registram escolhas diferentes e nenhuma
 * pode ser o padrão.
 *
 * O primeiro foco do `<dialog>` é o **botão de fechar do cabeçalho**, que o
 * `Modal` renderiza antes do corpo e do rodapé — medido no DOM, não deduzido da
 * ordem das `acoes`. Serve ao mesmo fim: quem aperta Enter sem ler desiste, em
 * vez de apagar. "Cancelar" ainda vem antes de "Excluir" no rodapé, para que a
 * tabulação chegue à ação destrutiva por último.
 *
 * Com `destrutivo`, o botão de confirmação leva `primary` **e** `danger`: as
 * duas são classes simples sobre `.br-button`, e no `core-lite.min.css` a
 * `danger` vem depois (197.633 contra 197.344), então é ela que pinta o fundo.
 * O `primary` fica pelo resto — é ele que dá o peso de ação principal.
 *
 * Branco sobre `--danger` (#e52207) mede **4,60**. Passa nos 4,5 que o texto do
 * botão exige, já que 16,8px no peso 600 não conta como texto grande — mas no
 * limite, não com folga: ao trocar essa cor, remeça.
 */
export function ConfirmModal({
  id = 'confirm-modal',
  aberto,
  titulo,
  rotuloConfirmar,
  onConfirmar,
  onCancelar,
  ocupado = false,
  destrutivo = false,
  children,
}: {
  id?: string
  aberto: boolean
  titulo: string
  /** Rótulo do botão que age. Diz o que vai acontecer, não "OK". */
  rotuloConfirmar: string
  onConfirmar: () => void
  onCancelar: () => void
  ocupado?: boolean
  destrutivo?: boolean
  /** O que se perde ao confirmar, em uma frase. */
  children: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <Modal
      id={id}
      aberto={aberto}
      onFechar={onCancelar}
      titulo={titulo}
      acoes={
        <>
          <BrButton id={`${id}-cancel`} type="button" secondary onClick={onCancelar}>
            {t('common.cancel')}
          </BrButton>
          <BrButton
            id={`${id}-confirm`}
            type="button"
            primary
            className={destrutivo ? 'danger' : undefined}
            disabled={ocupado}
            onClick={onConfirmar}
          >
            {rotuloConfirmar}
          </BrButton>
        </>
      }
    >
      <p id={`${id}-message`} className="text-base mb-0">
        {children}
      </p>
    </Modal>
  )
}
