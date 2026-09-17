import { BrSelectStandard } from '@govbr-ds/react-components'
import { useTranslation } from 'react-i18next'

import { countActiveFilters, EMPTY_FILTERS, type RecordFilters } from '@/lib/filters'

/**
 * Filtros ativos, sempre visíveis.
 *
 * Como o recorte chega pela URL (vindo do diagnóstico), o usuário precisa ver
 * o que está aplicado — senão uma lista de 12 registros entre 26 mil parece
 * um erro.
 *
 * Os seletores usam `BrSelectStandard`, o `<select>` nativo do design system, e
 * não o `BrSelect`: este último devolve o valor cru em `onChange`, em vez do
 * evento, e traz busca e seleção múltipla que aqui não servem. O rótulo agora é
 * visível — antes existia só como `aria-label`, invisível para quem enxerga.
 *
 * As fichas de filtro não usam `BrTag type="interaction"`: aquele tipo emite
 * `id="tag"` fixo no código da biblioteca, e como há uma ficha por filtro a
 * página sairia com ids repetidos.
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
      className="d-flex flex-wrap align-items-end"
      style={{ gap: 'var(--spacing-scale-base)' }}
    >
      <BrSelectStandard
        id={`${id}-valid`}
        label={t('records.filterValidity')}
        value={filters.valid ?? ''}
        onChange={(event) =>
          onChange({
            ...filters,
            valid: (event.target.value || undefined) as RecordFilters['valid'],
          })
        }
        options={[
          { label: t('records.anyValidity'), value: '' },
          { label: t('records.valid'), value: 'true' },
          { label: t('records.invalid'), value: 'false' },
        ]}
      />

      <BrSelectStandard
        id={`${id}-transformed`}
        label={t('records.filterTransformed')}
        value={filters.transformed ?? ''}
        onChange={(event) =>
          onChange({
            ...filters,
            transformed: (event.target.value || undefined) as RecordFilters['transformed'],
          })
        }
        options={[
          { label: t('records.anyTransformed'), value: '' },
          { label: t('records.transformed'), value: 'true' },
          { label: t('records.notTransformed'), value: 'false' },
        ]}
      />

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
