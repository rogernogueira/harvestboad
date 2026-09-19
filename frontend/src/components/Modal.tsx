import { useEffect, useRef, useState, type ReactNode } from 'react'
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
 *
 * ## O que vem da diretriz de Modal do Padrão Digital
 *
 * - **Superfície branca (`--pure-0`) e sombra `--surface-shadow-xl`.** O
 *   `.br-card` pinta o fundo de `--background` (#f8f8f8, medido) e traz uma
 *   sombra de 1px — a mesma de um cartão na página. A diretriz pede branco e a
 *   sombra maior justamente porque a modal "mais que qualquer outro elemento,
 *   deve se destacar aos olhos do usuário", e sobre um fundo cinza-claro o
 *   cartão se confundia com a página. (A diretriz escreve `--shadow-xl`; o
 *   token publicado no core-lite chama-se `--surface-shadow-xl`.)
 * - **Título, corpo e ações em três faixas.** Com rolagem, "o título deve ficar
 *   fixo no topo e os botões na parte inferior" — daí as ações virem por prop e
 *   não dentro de `children`: no `children` elas rolavam para fora da vista
 *   junto com o formulário.
 * - **Sombra na divisão quando há conteúdo oculto**, que é como a diretriz
 *   sinaliza que ainda há o que rolar.
 * - **Nunca rolagem horizontal** (`overflow-x: hidden`). O `.card-content` do
 *   core deixa `auto`; a diretriz é categórica, e o conteúdo largo se resolve
 *   quebrando, como já faz o XML do registro.
 * - **Botão terciário de fechar no canto superior direito**, com os
 *   espaçamentos externos da tabela de Escala.
 */
export function Modal({
  id = 'modal',
  aberto,
  onFechar,
  titulo,
  descricao,
  /**
   * `largo` para conteúdo que não é texto corrido: o XML de um registro a 32rem
   * quebra em quase toda linha, e o que se quer ler ali é a indentação.
   */
  tamanho = 'padrao',
  acoes,
  children,
}: {
  id?: string
  aberto: boolean
  onFechar: () => void
  titulo: string
  descricao?: string
  tamanho?: 'padrao' | 'largo'
  /**
   * Botões da modal, numa faixa fixa no rodapé.
   *
   * Omitido nas modais de opção por lista, que a diretriz descreve sem botões:
   * a escolha "entra em vigor imediatamente quando selecionada", e o fecho é o
   * terciário do topo, o clique fora ou o Esc.
   */
  acoes?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)
  const corpo = useRef<HTMLDivElement>(null)
  const [oculto, setOculto] = useState({ acima: false, abaixo: false })

  useEffect(() => {
    const dialogo = ref.current
    if (!dialogo) return
    if (aberto && !dialogo.open) dialogo.showModal()
    if (!aberto && dialogo.open) dialogo.close()
  }, [aberto])

  /*
   * Trava a rolagem do fundo enquanto o diálogo está aberto.
   *
   * O `<dialog>` modal bloqueia o clique no que está atrás, mas não a rolagem:
   * a roda do mouse sobre o scrim rola a página, e no diagnóstico isso faz a
   * tabela de regras correr por baixo do modal que acabou de ser aberto a
   * partir dela. Só a instância aberta mexe no `body` — a tela de repositórios
   * monta um modal por linha, e as fechadas não entram aqui.
   */
  useEffect(() => {
    if (!aberto) return
    const anterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = anterior
    }
  }, [aberto])

  /*
   * Descobre se há conteúdo escondido acima ou abaixo, para as faixas fixas
   * ganharem sombra — é assim que a diretriz sinaliza que ainda há o que rolar.
   *
   * O `ResizeObserver` cobre o conteúdo que chega depois (uma consulta que
   * resolve, uma aba que troca); o listener de rolagem cobre o movimento. Os
   * dois chamam a medição de fora do corpo do efeito, e não durante a
   * renderização.
   */
  useEffect(() => {
    const elemento = corpo.current
    if (!aberto || !elemento) return

    const medir = () => {
      const { scrollTop, scrollHeight, clientHeight } = elemento
      setOculto({
        acima: scrollTop > 1,
        abaixo: scrollTop + clientHeight < scrollHeight - 1,
      })
    }

    const observador = new ResizeObserver(medir)
    observador.observe(elemento)
    for (const filho of elemento.children) observador.observe(filho)
    elemento.addEventListener('scroll', medir, { passive: true })

    return () => {
      observador.disconnect()
      elemento.removeEventListener('scroll', medir)
    }
  }, [aberto, children])

  const sombraFaixa = '0 1px 6px rgba(0, 0, 0, 0.16)'

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
      className="br-card modal-superficie p-0"
      style={{
        width:
          tamanho === 'largo' ? 'min(60rem, calc(100vw - 2rem))' : 'min(32rem, calc(100vw - 2rem))',
        // Branco, e não o `--background` do `.br-card`: a superfície da modal
        // precisa se destacar da página, que é cinza-claro.
        background: 'var(--pure-0)',
        boxShadow: 'var(--surface-shadow-xl)',
        border: '1px solid var(--border-color)',
        color: 'var(--color)',
        // Altura máxima aqui, e não no corpo: é o que deixa as três faixas se
        // arranjarem com o corpo encolhendo, e dá a "área de respiro" entre a
        // modal e a tela que a diretriz pede.
        maxHeight: 'calc(100vh - 4rem)',
        /*
         * A centralização do `<dialog>` é o `margin: auto` do navegador, e ela
         * cai inteira se uma das margens deixar de ser automática: o `.br-card`
         * fixa `margin-bottom: var(--spacing-scale-2x)`, a margem de cima
         * absorve toda a sobra e o diálogo desce até encostar embaixo (medido
         * em produção, viewport 1280×900: topo a 474px, base a 16px). Repor
         * `auto` nos quatro lados devolve o centro.
         */
        margin: 'auto',
      }}
    >
      <div
        id={`${id}-header`}
        className="card-header d-flex align-items-start justify-content-between"
        style={{
          gap: 'var(--spacing-scale-2x)',
          // Escala da diretriz para o título: externo de 8px em cima e embaixo,
          // 16px à esquerda. O terciário de fechar fica com 8px nos seus três.
          padding:
            'var(--spacing-scale-base) var(--spacing-scale-base) var(--spacing-scale-base) var(--spacing-scale-2x)',
          flex: '0 0 auto',
          boxShadow: oculto.acima ? sombraFaixa : undefined,
          zIndex: 1,
        }}
      >
        <div id={`${id}-header-text`} style={{ minWidth: 0 }}>
          {/*
            Duas linhas no máximo. Acima disso a diretriz manda contrair com
            reticências e revelar o texto inteiro ao passar o mouse — daí o
            `title`, que é o mesmo balão nativo já usado no resto do projeto.
          */}
          <h2
            id={`${id}-titulo`}
            title={titulo}
            className="text-up-01 text-bold mt-0 mb-0"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
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
          style={{ flex: '0 0 auto' }}
        >
          <i className="fas fa-times" aria-hidden="true" />
        </button>
      </div>

      <div
        id={`${id}-body`}
        ref={corpo}
        className="card-content p-3"
        // `overflow-x: hidden` porque a diretriz proíbe rolagem horizontal em
        // modal sem exceção; o `.card-content` do core deixaria `auto`.
        style={{ overflowY: 'auto', overflowX: 'hidden', flex: '1 1 auto', minHeight: 0 }}
      >
        {children}
      </div>

      {acoes ? (
        <div
          id={`${id}-footer`}
          className="card-footer d-flex flex-wrap justify-content-end"
          style={{
            gap: 'var(--spacing-scale-base)',
            // Escala da diretriz para os botões: 8px em cima e embaixo, 16px à
            // direita.
            padding:
              'var(--spacing-scale-base) var(--spacing-scale-2x) var(--spacing-scale-base) var(--spacing-scale-2x)',
            flex: '0 0 auto',
            boxShadow: oculto.abaixo ? sombraFaixa : undefined,
            zIndex: 1,
          }}
        >
          {acoes}
        </div>
      ) : null}
    </dialog>
  )
}
