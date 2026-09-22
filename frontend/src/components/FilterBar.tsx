import { useTranslation } from 'react-i18next'

import { countActiveFilters, EMPTY_FILTERS, type RecordFilters } from '@/lib/filters'

/**
 * Filtros ativos, sempre visíveis.
 *
 * Como o recorte chega pela URL (vindo do diagnóstico), o usuário precisa ver
 * o que está aplicado — senão uma lista de 12 registros entre 26 mil parece
 * um erro.
 *
 * **Só mostra, não escolhe.** Os seletores de validade e transformação moravam
 * aqui e passaram para a linha de filtros do cabeçalho da tabela
 * (`RecordsPage`): um seletor rotulado "Filtrar por validade" longe da coluna
 * "Validade" obriga a adivinhar a que coluna ele se refere, e ter o mesmo
 * filtro nos dois lugares seria pior. O que sobra é o que a coluna não consegue
 * mostrar: as fichas das regras, que vêm do diagnóstico e não têm coluna
 * própria, e o botão que limpa tudo de uma vez.
 *
 * As fichas de filtro não usam `BrTag type="interaction"`: aquele tipo emite
 * `id="tag"` fixo no código da biblioteca, e como há uma ficha por filtro a
 * página sairia com ids repetidos.
 *
 * O `<div>` continua sendo emitido mesmo sem nenhuma ficha porque é ele que
 * empurra o botão de exportar para a direita no `justify-content-between` da
 * barra de ferramentas; vazio, não ocupa altura.
 */
export function FilterBar({
  id = 'filter-bar',
  filters,
  onChange,
}: {
  id?: string
  filters: RecordFilters
  onChange: (filters: RecordFilters) => void
}) {
  const { t } = useTranslation()
  const ativos = countActiveFilters(filters)

  const chips: { key: string; label: string; remove: () => void }[] = []

  if (filters.valid) {
    chips.push({
      key: 'valid',
      label: filters.valid === 'true' ? t('records.valid') : t('records.invalid'),
      remove: () => onChange({ ...filters, valid: undefined }),
    })
  }
  if (filters.transformed) {
    chips.push({
      key: 'transformed',
      label:
        filters.transformed === 'true' ? t('records.transformed') : t('records.notTransformed'),
      remove: () => onChange({ ...filters, transformed: undefined }),
    })
  }
  filters.invalidRule.forEach((rule) =>
    chips.push({
      key: `invalid-${rule}`,
      label: t('records.ruleViolated', { rule }),
      remove: () =>
        onChange({
          ...filters,
          invalidRule: filters.invalidRule.filter((item) => item !== rule),
        }),
    }),
  )
  filters.validRule.forEach((rule) =>
    chips.push({
      key: `valid-${rule}`,
      label: t('records.ruleMet', { rule }),
      remove: () =>
        onChange({ ...filters, validRule: filters.validRule.filter((item) => item !== rule) }),
    }),
  )

  return (
    <div
      id={id}
      className="d-flex flex-wrap align-items-center"
      style={{ gap: 'var(--spacing-scale-base)' }}
    >
      {chips.map((chip) => (
        <button
          id={`${id}-chip-${chip.key}`}
          key={chip.key}
          type="button"
          onClick={chip.remove}
          className="br-tag text-down-01"
          style={{ cursor: 'pointer', border: 'none' }}
        >
          {chip.label}
          <i
            id={`${id}-chip-${chip.key}-remove-icon`}
            className="fas fa-times ml-1"
            aria-hidden="true"
          />
          <span id={`${id}-chip-${chip.key}-remove-label`} className="sr-only">
            {t('records.removeFilter')}
          </span>
        </button>
      ))}

      {ativos > 0 ? (
        <button
          id={`${id}-clear`}
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="br-button small"
        >
          {t('records.clearFilters')}
        </button>
      ) : null}
    </div>
  )
}
