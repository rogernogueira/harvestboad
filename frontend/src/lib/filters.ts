import type { AppliedFilters } from './types'

/**
 * Estado de filtro compartilhado entre diagnóstico e registros.
 *
 * Os filtros moram na URL, não em estado de componente: é o que permite ir do
 * diagnóstico para os registros preservando o recorte, voltar pelo botão do
 * navegador e compartilhar o link. O vocabulário é o mesmo aceito pelo backend.
 */
export interface RecordFilters {
  valid?: 'true' | 'false'
  transformed?: 'true' | 'false'
  validRule: string[]
  invalidRule: string[]
}

export const EMPTY_FILTERS: RecordFilters = { validRule: [], invalidRule: [] }

function parseBool(value: string | null): 'true' | 'false' | undefined {
  return value === 'true' || value === 'false' ? value : undefined
}

export function filtersFromSearch(params: URLSearchParams): RecordFilters {
  return {
    valid: parseBool(params.get('valid')),
    transformed: parseBool(params.get('transformed')),
    validRule: params.getAll('validRule'),
    invalidRule: params.getAll('invalidRule'),
  }
}

/** Converte os filtros para query string, sem incluir paginação. */
export function filtersToParams(filters: RecordFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.valid) params.set('valid', filters.valid)
  if (filters.transformed) params.set('transformed', filters.transformed)
  filters.validRule.forEach((rule) => params.append('validRule', rule))
  filters.invalidRule.forEach((rule) => params.append('invalidRule', rule))
  return params
}

export function countActiveFilters(filters: RecordFilters): number {
  return (
    (filters.valid ? 1 : 0) +
    (filters.transformed ? 1 : 0) +
    filters.validRule.length +
    filters.invalidRule.length
  )
}

export function toggleRule(
  filters: RecordFilters,
  kind: 'validRule' | 'invalidRule',
  ruleId: string,
): RecordFilters {
  const current = filters[kind]
  const next = current.includes(ruleId)
    ? current.filter((item) => item !== ruleId)
    : [...current, ruleId]
  return { ...filters, [kind]: next }
}

/** Normaliza o eco do backend para o mesmo formato usado na UI. */
export function filtersFromApplied(applied: AppliedFilters): RecordFilters {
  return {
    valid: parseBool(applied.valid),
    transformed: parseBool(applied.transformed),
    validRule: applied.validRule,
    invalidRule: applied.invalidRule,
  }
}
