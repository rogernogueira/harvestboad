import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Modal sobre `<dialog>` nativo: `inert` no fundo, captura de foco e Esc de
 * graça, que é o motivo de o Perfil já ser feito assim.
 *
 * O conteúdo é de quem chama e deve continuar montado enquanto a janela fecha
 * — quem chama guarda o último item exibido em vez de zerá-lo junto com
 * `aberta`, ou o diálogo pisca vazio antes de sumir.
 */
export function Janela({
  aberta,
  aoFechar,
  titulo,
  largura = 640,
  children,
}: {
  aberta: boolean
  aoFechar: () => void
  /** id do elemento que dá nome ao diálogo, para leitor de tela. */
  titulo: string
  largura?: number
  children: ReactNode
}) {
  const caixa = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = caixa.current
    if (!d) return
    if (aberta && !d.open) d.showModal()
    if (!aberta && d.open) d.close()
  }, [aberta])

  return (
    <dialog
      ref={caixa}
      onClose={aoFechar}
      onClick={(e) => e.target === caixa.current && aoFechar()}
      aria-labelledby={titulo}
      style={{ maxWidth: largura }}
      className="m-auto w-[calc(100vw-32px)] rounded border border-borda-forte bg-superficie p-0 text-conteudo backdrop:bg-black/55"
    >
      <div className="p-5">
        {children}
        <button
          type="button"
          onClick={aoFechar}
          className="mt-5 w-full cursor-pointer rounded-sm border border-borda-forte bg-superficie-alt py-2 text-base hover:border-marca hover:text-marca"
        >
          fechar
        </button>
      </div>
    </dialog>
  )
}

/**
 * O item exibido numa Janela e se ela está aberta, separados: fechar mantém o
 * último item, para o conteúdo não sumir antes do diálogo.
 */
export function useJanela<T>() {
  const [item, setItem] = useState<T | null>(null)
  const [aberta, setAberta] = useState(false)
  const abrir = useCallback((v: T) => {
    setItem(v)
    setAberta(true)
  }, [])
  const fechar = useCallback(() => setAberta(false), [])
  return { item, aberta, abrir, fechar }
}
