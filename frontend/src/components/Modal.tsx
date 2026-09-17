import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Diálogo modal sobre o `<dialog>` nativo, vestido com as classes do design
 * system.
 *
 * Continua sendo o elemento nativo, e não o `BrModal`, por acessibilidade. O
 * `<dialog>` entrega de graça o que uma implementação manual teria de refazer:
 * captura de foco, fechamento por Esc e camada superior sem disputa de
 * z-index. O bundle do `BrModal` não traz `inert` nem utilitário de captura de
 * foco, então trocar um pelo outro perderia a captura — e o `BrModal` também
 * não aceita `id`, que aqui batiza o título.
 *
 * O `id` também batiza o título: como a tela de repositórios monta um modal por
 * linha, um `id` fixo no `<h2>` deixaria o `aria-labelledby` de todos apontando
 * para o mesmo elemento.
 */
export function Modal({
  id = 'modal',
  aberto,
  onFechar,
  titulo,
  descricao,
  children,
}: {
  id?: string
  aberto: boolean
  onFechar: () => void
  titulo: string
  descricao?: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialogo = ref.current
    if (!dialogo) return
    if (aberto && !dialogo.open) dialogo.showModal()
    if (!aberto && dialogo.open) dialogo.close()
  }, [aberto])

  return (
    <dialog
      id={id}
      ref={ref}
      // `close` cobre o Esc, que fecha o diálogo sem passar pelo botão.
      onClose={onFechar}
      // Clique no backdrop: o alvo é o próprio dialog, não o conteúdo.
      onClick={(event) => {
        if (event.target === ref.current) onFechar()
      }}
      aria-labelledby={`${id}-titulo`}
      className="br-card p-0"
      style={{
        width: 'min(32rem, calc(100vw - 2rem))',
        border: '1px solid var(--border-color)',
        color: 'var(--color)',
      }}
    >
      <div
        id={`${id}-header`}
        className="card-header d-flex align-items-start justify-content-between p-3"
        style={{ gap: 'var(--spacing-scale-2x)' }}
      >
        <div id={`${id}-header-text`} style={{ minWidth: 0 }}>
          <h2 id={`${id}-titulo`} className="text-up-01 text-bold mt-0 mb-0">
            {titulo}
          </h2>
          {descricao ? (
            <p id={`${id}-descricao`} className="text-down-01 mt-1 mb-0">
              {descricao}
            </p>
          ) : null}
        </div>
        <button
          id={`${id}-close`}
          type="button"
          onClick={onFechar}
          aria-label={t('common.close')}
          className="br-button circle small"
        >
          <i className="fas fa-times" aria-hidden="true" />
        </button>
      </div>

      <div
        id={`${id}-body`}
        className="card-content p-3"
        style={{ maxHeight: '60vh', overflowY: 'auto' }}
      >
        {children}
      </div>
    </dialog>
  )
}
