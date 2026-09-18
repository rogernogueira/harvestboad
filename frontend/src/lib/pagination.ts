/**
 * Tamanho de página: o vocabulário compartilhado pelas quatro listas.
 *
 * Fica aqui, e não dentro de `components/Pagination.tsx`, porque exportar
 * constante e função ao lado de um componente quebra o Fast Refresh do Vite —
 * o oxlint avisa com `react(only-export-components)`. Também não cabe em
 * `lib/filters.ts`: aquele arquivo é a metade dianteira de um vocabulário que
 * precisa andar casado com `backend/apps/harvests/filters.py`, e o tamanho de
 * página não tem essa contraparte.
 */

/**
 * "Tudo" é um tamanho de página infinito, não um caso especial.
 *
 * Quem pagina no navegador já fatia com `slice((p - 1) * n, p * n)`: com
 * `Infinity` a conta devolve o array inteiro sem um `if` a mais. E
 * `Math.ceil(x / Infinity)` dá 0, que o `Math.max(…, 1)` do total de páginas
 * normaliza para uma página só.
 *
 * Na URL ele vira o texto `tudo`: `String(Infinity)` sai "Infinity" e
 * `Number('Infinity')` até volta, mas é um valor que ninguém reconhece ao ler
 * ou colar o endereço.
 */
export const TUDO = Number.POSITIVE_INFINITY

/**
 * Lê o tamanho de página da URL.
 *
 * Só aceita o que a tela oferece: um `?por=7` digitado à mão cairia numa
 * paginação que o seletor não sabe representar, e o campo apareceria vazio.
 */
export function tamanhoDaUrl(
  valor: string | null,
  opcoes: readonly number[],
  padrao: number,
): number {
  if (valor === 'tudo') return opcoes.includes(TUDO) ? TUDO : padrao
  const numero = Number(valor)
  return opcoes.includes(numero) ? numero : padrao
}

/** Escreve o tamanho na URL — `null` no padrão, para não sujar o endereço. */
export function tamanhoParaUrl(tamanho: number, padrao: number): string | null {
  if (tamanho === padrao) return null
  return Number.isFinite(tamanho) ? String(tamanho) : 'tudo'
}
