import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Diálogo modal sobre o `<dialog>` nativo.
 *
 * O elemento nativo já entrega o que uma implementação manual teria de refazer:
 * captura de foco, fechamento por Esc e camada superior sem disputa de z-index.
 */
export function Modal({
  aberto,
  onFechar,
  titulo,
  descricao,
  children,
}: {
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
      ref={ref}
      // `close` cobre o Esc, que fecha o diálogo sem passar pelo botão.
      onClose={onFechar}
      // Clique no backdrop: o alvo é o próprio dialog, não o conteúdo.
      onClick={(event) => {
        if (event.target === ref.current) onFechar()
      }}
      aria-labelledby="modal-titulo"
      className="w-[min(32rem,calc(100vw-2rem))] border border-border-subtle bg-surface p-0 text-content backdrop:bg-black/40"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
        <div className="min-w-0">
          <h2 id="modal-titulo" className="font-heading text-base font-bold tracking-tight">
            {titulo}
          </h2>
          {descricao ? <p className="mt-0.5 text-sm text-content-muted">{descricao}</p> : null}
        </div>
        <button
          type="button"
          onClick={onFechar}
          aria-label={t('common.close')}
          className="-mt-1 -mr-1 px-2 py-1 text-lg leading-none text-content-muted transition-colors duration-150 hover:text-content"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="max-h-[60vh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  )
}
