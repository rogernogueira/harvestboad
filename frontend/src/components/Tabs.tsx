import type { KeyboardEvent, ReactNode } from 'react'

export type Aba = {
  chave: string
  rotulo: string
  conteudo: ReactNode
}

/**
 * Abas com as classes `br-tab` do design system e o padrão ARIA de tablist.
 *
 * O `BrTab` do pacote React foi testado e descartado: ele monta `<nav>`, `<ul>`
 * e `<button>` com as classes certas, mas sem nenhum papel de acessibilidade —
 * sem `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls` nem
 * `role="tabpanel"` —, e sem navegação por seta. O comportamento que o core traz
 * para esses papéis é o `tab.js`, que varre `window.document` no momento do
 * import e nunca alcança marcação renderizada pelo React. Some a isso a falta de
 * `id` e `className` na raiz, o mesmo motivo que descartou o `BrBreadcrumbs`.
 *
 * O painel fica **fora** de `.tab-content`, que o core fixa em
 * `height: calc(100vh - 86px)` — dentro de um modal isso rende um painel mais
 * alto que a tela. Aqui a altura é a do conteúdo, e quem limita é o corpo do
 * modal.
 *
 * Só a aba ativa é montada: é o que deixa a consulta de cada painel preguiçosa
 * (o XML do registro é uma ida ao Harvester que só quem abre a aba paga).
 */
export function Tabs({
  id = 'tabs',
  abas,
  ativa,
  onTrocar,
}: {
  id?: string
  abas: Aba[]
  ativa: string
  onTrocar: (chave: string) => void
}) {
  const indiceAtivo = Math.max(
    0,
    abas.findIndex((aba) => aba.chave === ativa),
  )
  const abaAtiva = abas[indiceAtivo]

  /**
   * Setas, Home e End percorrem as abas, como manda o padrão de tablist.
   *
   * A ativação acompanha o foco (`aria-activedescendant` não entra aqui): com
   * duas abas de conteúdo já carregado, exigir Enter depois da seta só
   * acrescentaria uma tecla.
   */
  const aoTeclar = (evento: KeyboardEvent<HTMLUListElement>) => {
    const destino = {
      ArrowRight: indiceAtivo + 1,
      ArrowLeft: indiceAtivo - 1,
      Home: 0,
      End: abas.length - 1,
    }[evento.key]
    if (destino === undefined) return

    evento.preventDefault()
    const alvo = abas[(destino + abas.length) % abas.length]
    onTrocar(alvo.chave)
    document.getElementById(`${id}-tab-${alvo.chave}`)?.focus()
  }

  return (
    <div id={id} className="br-tab">
      <nav id={`${id}-nav`} className="tab-nav">
        <ul id={`${id}-list`} role="tablist" className="plain-list" onKeyDown={aoTeclar}>
          {abas.map((aba) => (
            <li
              id={`${id}-item-${aba.chave}`}
              key={aba.chave}
              className={`tab-item${aba.chave === ativa ? ' is-active' : ''}`}
            >
              {/*
                Tabindex rotativo: só a aba ativa entra na ordem de tabulação, e
                as outras são alcançadas pelas setas. Sem isso, um Tab por aba
                atrasa quem só quer chegar ao conteúdo.
              */}
              <button
                id={`${id}-tab-${aba.chave}`}
                type="button"
                role="tab"
                aria-selected={aba.chave === ativa}
                aria-controls={`${id}-panel-${aba.chave}`}
                tabIndex={aba.chave === ativa ? 0 : -1}
                onClick={() => onTrocar(aba.chave)}
              >
                <span className="name">{aba.rotulo}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/*
        `tabIndex={0}` no painel: o conteúdo rola (XML longo, lista de regras) e
        sem foco possível o teclado não consegue rolá-lo.
      */}
      <div
        id={`${id}-panel-${abaAtiva.chave}`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${abaAtiva.chave}`}
        tabIndex={0}
        className="pt-3"
      >
        {abaAtiva.conteudo}
      </div>
    </div>
  )
}
