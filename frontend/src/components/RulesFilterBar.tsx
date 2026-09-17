import { BrInput, BrSelectStandard } from '@govbr-ds/react-components'
import { useTranslation } from 'react-i18next'

import { countActiveRuleFilters, EMPTY_RULE_FILTERS, type RuleFilters } from '@/lib/ruleFilters'

/**
 * Filtros da tabela de regras: nome, obrigatoriedade e existência de falhas.
 *
 * Os seletores são `BrSelectStandard` — o `<select>` nativo do design system —
 * pelo mesmo motivo do `FilterBar` dos registros: o `BrSelect` devolve o valor
 * cru em `onChange` em vez do evento, e traz busca e seleção múltipla que aqui
 * não servem.
 *
 * O recorte é aplicado no navegador, sobre a lista que já chegou inteira, então
 * a digitação não dispara requisição nenhuma — é o que permite filtrar por
 * nome a cada tecla, sem `debounce`.
 */
export function RulesFilterBar({
  id = 'rules-filter-bar',
  filters,
  onChange,
}: {
  id?: string
  filters: RuleFilters
  onChange: (filters: RuleFilters) => void
}) {
  const { t } = useTranslation()
  const ativos = countActiveRuleFilters(filters)

  return (
    <div
      id={id}
      className="d-flex flex-wrap align-items-end"
      style={{ gap: 'var(--spacing-scale-base)' }}
    >
      <BrInput
        id={`${id}-name`}
        label={t('diagnosis.filters.name')}
        value={filters.name}
        icon="fas fa-search"
        onChange={(evento) => onChange({ ...filters, name: evento.target.value })}
      />

      <BrSelectStandard
        id={`${id}-mandatory`}
        label={t('diagnosis.filters.mandatory')}
        value={filters.mandatory}
        onChange={(evento) =>
          onChange({
            ...filters,
            mandatory: evento.target.value as RuleFilters['mandatory'],
          })
        }
        options={[
          { label: t('diagnosis.filters.anyMandatory'), value: '' },
          { label: t('diagnosis.filters.onlyMandatory'), value: 'true' },
          { label: t('diagnosis.filters.onlyOptional'), value: 'false' },
        ]}
      />

      <BrSelectStandard
        id={`${id}-fails`}
        label={t('diagnosis.filters.fails')}
        value={filters.fails}
        onChange={(evento) =>
          onChange({ ...filters, fails: evento.target.value as RuleFilters['fails'] })
        }
        options={[
          { label: t('diagnosis.filters.anyFails'), value: '' },
          { label: t('diagnosis.filters.withFails'), value: 'true' },
          { label: t('diagnosis.filters.withoutFails'), value: 'false' },
        ]}
      />

      {ativos > 0 ? (
        <button
          id={`${id}-clear`}
          type="button"
          onClick={() => onChange(EMPTY_RULE_FILTERS)}
          className="br-button small"
        >
          {t('records.clearFilters')}
        </button>
      ) : null}
    </div>
  )
}
