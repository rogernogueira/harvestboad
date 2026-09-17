import type { Rule } from './types'

/**
 * Recorte da tabela de regras do diagnóstico.
 *
 * Vocabulário **separado** do de `filters.ts`, de propósito. Aquele é o
 * contrato compartilhado com `harvests/filters.py`: atravessa diagnóstico,
 * registros e exportação, e só existe porque o backend o aplica. Estes três
 * não têm contraparte no backend — a lista de regras de uma coleta chega
 * inteira numa requisição, dezenas de linhas, e o recorte é feito no
 * navegador. Misturá-los no mesmo tipo arrastaria nomes que o backend ignora
 * para dentro de um contrato que precisa ficar igual nos dois lados.
 *
 * Mesmo local, vivem na URL como os outros: é o que faz o recorte sobreviver
 * ao botão voltar e ao link colado para outra pessoa.
 */
export interface RuleFilters {
  /** Trecho do nome ou do identificador da regra. */
  name: string
  mandatory: '' | 'true' | 'false'
  /** `true` = só regras com registros inválidos; `false` = só as sem nenhum. */
  fails: '' | 'true' | 'false'
}

export const EMPTY_RULE_FILTERS: RuleFilters = { name: '', mandatory: '', fails: '' }

const NOME = 'ruleName'
const OBRIGATORIA = 'ruleMandatory'
const FALHAS = 'ruleFails'

const booleano = (valor: string | null): '' | 'true' | 'false' =>
  valor === 'true' || valor === 'false' ? valor : ''

export function ruleFiltersFromSearch(params: URLSearchParams): RuleFilters {
  return {
    name: params.get(NOME) ?? '',
    mandatory: booleano(params.get(OBRIGATORIA)),
    fails: booleano(params.get(FALHAS)),
  }
}

/**
 * Reescreve só os parâmetros das regras, preservando o resto da URL.
 *
 * O diagnóstico também carrega o recorte compartilhado (`valid`, `invalidRule`
 * e companhia), que vem de outra tela e não é desta barra: reconstruir a query
 * inteira aqui apagaria esse recorte a cada digitação.
 */
export function ruleFiltersToSearch(
  params: URLSearchParams,
  filters: RuleFilters,
): URLSearchParams {
  const saida = new URLSearchParams(params)
  const aplicar = (chave: string, valor: string) => {
    if (valor) saida.set(chave, valor)
    else saida.delete(chave)
  }
  aplicar(NOME, filters.name.trim())
  aplicar(OBRIGATORIA, filters.mandatory)
  aplicar(FALHAS, filters.fails)
  return saida
}

export function countActiveRuleFilters(filters: RuleFilters): number {
  return [filters.name.trim(), filters.mandatory, filters.fails].filter(Boolean).length
}

/** Sem acento e em minúsculas: quem busca "publicacao" espera achar "publicação". */
const comparavel = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

export function filterRules(rules: Rule[], filters: RuleFilters): Rule[] {
  const termo = comparavel(filters.name.trim())

  return rules.filter((regra) => {
    if (termo) {
      // O identificador entra na busca porque está na tela: quem vê "110" na
      // primeira coluna espera poder digitá-lo para achar a linha.
      const alvo = comparavel(`${regra.ruleId} ${regra.name ?? ''}`)
      if (!alvo.includes(termo)) return false
    }
    if (filters.mandatory && String(Boolean(regra.mandatory)) !== filters.mandatory) return false
    if (filters.fails) {
      const falhou = (regra.invalidCount ?? 0) > 0
      if (String(falhou) !== filters.fails) return false
    }
    return true
  })
}
