import { useTranslation } from 'react-i18next'

import { countActiveFilters, EMPTY_FILTERS, type RecordFilters } from '@/lib/filters'

/**
 * Filtros ativos, sempre visíveis.
 *
 * Como o recorte chega pela URL (vindo do diagnóstico), o usuário precisa ver
 * o que está aplicado — senão uma lista de 12 registros entre 26 mil parece
 * um erro.
 */
export function FilterBar({
  filters,
  onChange,
}: {
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
        filters.transformed === 'true'
          ? t('records.transformed')
          : t('records.notTransformed'),
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
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-2">
        <select
          value={filters.valid ?? ''}
          onChange={(event) =>
            onChange({
              ...filters,
              valid: (event.target.value || undefined) as RecordFilters['valid'],
            })
          }
          aria-label={t('records.filterValidity')}
          className="rounded-md border border-border-subtle bg-surface-raised px-3 py-1.5 text-sm"
        >
          <option value="">{t('records.anyValidity')}</option>
          <option value="true">{t('records.valid')}</option>
          <option value="false">{t('records.invalid')}</option>
        </select>

        <select
          value={filters.transformed ?? ''}
          onChange={(event) =>
            onChange({
              ...filters,
              transformed: (event.target.value || undefined) as RecordFilters['transformed'],
            })
          }
          aria-label={t('records.filterTransformed')}
          className="rounded-md border border-border-subtle bg-surface-raised px-3 py-1.5 text-sm"
        >
          <option value="">{t('records.anyTransformed')}</option>
          <option value="true">{t('records.transformed')}</option>
          <option value="false">{t('records.notTransformed')}</option>
        </select>
      </div>

      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.remove}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-xs text-brand-strong hover:bg-brand/20"
        >
          {chip.label}
          <span aria-hidden="true">×</span>
          <span className="sr-only">{t('records.removeFilter')}</span>
        </button>
      ))}

      {ativos > 0 ? (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="text-xs text-content-muted underline hover:text-content"
        >
          {t('records.clearFilters')}
        </button>
      ) : null}
    </div>
  )
}
