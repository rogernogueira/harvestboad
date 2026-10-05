/**
 * Paleta do gráfico ECharts, resolvida dos tokens do projeto.
 *
 * Fica em `lib`, e não no componente `Grafico`, porque não é componente:
 * exportar função de um módulo de componentes quebra o Fast Refresh do Vite —
 * é o que a regra `react/only-export-components` do oxlint acusa (mesmo motivo
 * de `harvestStatus.ts`).
 *
 * O ECharts desenha em canvas e **não** lê `var()`, então as cores saem de
 * `getComputedStyle` na montagem — e são relidas quando o tema muda, para o
 * gráfico acompanhar claro/escuro.
 */
export type Paleta = {
  conteudo: string
  conteudoFraco: string
  borda: string
  superficie: string
  superficieAlt: string
  marca: string
  ok: string
  warn: string
  down: string
}

export function cores(): Paleta {
  const cs = getComputedStyle(document.documentElement)
  const ler = (nome: string) => cs.getPropertyValue(nome).trim()
  return {
    conteudo: ler('--color-content'),
    conteudoFraco: ler('--color-content-muted'),
    borda: ler('--color-border-subtle'),
    superficie: ler('--color-surface'),
    superficieAlt: ler('--color-surface-muted'),
    marca: ler('--color-brand'),
    ok: ler('--color-ok'),
    warn: ler('--color-warn'),
    down: ler('--color-down'),
  }
}
