/**
 * Dica de cabeçalho de coluna.
 *
 * As quatro tabelas do sistema têm rótulos curtos — "Sigla", "Violam",
 * "Prefixo", "Transformado" — que só são óbvios para quem já conhece o
 * vocabulário do Harvester. A dica diz do que se trata a coluna sem gastar
 * linha na tela.
 *
 * É o `title` nativo, e não o `BrTooltip` do design system, por três motivos
 * lidos no componente (`dist/components/BrTooltip`): ele não aceita `id` nem
 * `className`, como o `BrBreadcrumbs`; ele não liga o gatilho ao texto com
 * `aria-describedby` — o `role="tooltip"` fica solto e o leitor de tela não
 * anuncia nada, que é a mesma falha do `BrTab`; e monta um popper por elemento
 * dentro de um `useEffect`, o que em 26 cabeçalhos custa mais do que a
 * informação vale.
 *
 * Com o `title` no `<th>`, o rótulo continua sendo o **nome** acessível da
 * coluna e a dica vira a **descrição** acessível — exatamente a distinção que
 * se quer, e sem repetir a explicação a cada célula, como aconteceria com um
 * `.sr-only` dentro do cabeçalho.
 *
 * `cursor: help` é a única pista visual, de propósito: um ícone em cada
 * cabeçalho empurraria a largura das colunas da tela de administração, que já
 * estão calibradas no limite para não trazer de volta a barra de rolagem
 * horizontal.
 */
export function dicaDeColuna(texto: string) {
  return { title: texto, style: { cursor: 'help' as const } }
}
