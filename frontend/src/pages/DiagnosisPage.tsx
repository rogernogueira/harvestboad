import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Label,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ErrorState, Loading } from '@/components/Feedback'
import { StatCard } from '@/components/StatCard'
import { filtersFromSearch, filtersToParams, toggleRule } from '@/lib/filters'
import { diagnosisQuery, rulesQuery } from '@/lib/queries'

/**
 * Diagnóstico da coleta.
 *
 * As contagens das regras são links para os registros já filtrados — é o
 * caminho pelo qual o gestor sai do "quantos falharam" para "quais são".
 */
export function DiagnosisPage() {
  const { t, i18n } = useTranslation()
  const { snapshotId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const filtros = filtersFromSearch(searchParams)

  const diagnostico = useQuery(diagnosisQuery(snapshotId))
  const regras = useQuery(rulesQuery(snapshotId))

  const numero = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage),
    [i18n.resolvedLanguage],
  )

  /** Link para os registros somando este filtro ao que já estiver aplicado. */
  const linkRegistros = (kind: 'validRule' | 'invalidRule', ruleId: string) => {
    const params = filtersToParams(toggleRule(filtros, kind, ruleId))
    return `/coletas/${snapshotId}/registros?${params}`
  }

  const linkValidade = (valid: 'true' | 'false') => {
    const params = filtersToParams({ ...filtros, valid })
    return `/coletas/${snapshotId}/registros?${params}`
  }

  const grafico = useMemo(() => {
    const itens = regras.data?.results ?? []
    return itens
      .filter((regra) => (regra.invalidCount ?? 0) > 0)
      .sort((a, b) => (b.invalidCount ?? 0) - (a.invalidCount ?? 0))
      .slice(0, 8)
      .map((regra) => ({
        regra: String(regra.ruleId),
        nome: regra.name,
        invalidos: regra.invalidCount ?? 0,
      }))
  }, [regras.data])

  if (diagnostico.isPending) return <Loading id="diagnosis-page-loading" />
  if (diagnostico.isError)
    return (
      <ErrorState
        id="diagnosis-page-error"
        error={diagnostico.error}
        onRetry={() => void diagnostico.refetch()}
      />
    )

  const d = diagnostico.data

  return (
    <div id="diagnosis-page" className="flex flex-col gap-8">
      <section id="diagnosis-page-stats" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          id="diagnosis-page-stat-size"
          label={t('diagnosis.size')}
          value={numero.format(d.size ?? 0)}
        />
        <StatCard
          id="diagnosis-page-stat-valid"
          label={t('diagnosis.valid')}
          value={
            <Link
              id="diagnosis-page-stat-valid-link"
              to={linkValidade('true')}
              className="hover:underline"
            >
              {numero.format(d.validSize ?? 0)}
            </Link>
          }
          tone="ok"
          hint={t('diagnosis.clickToFilter')}
        />
        <StatCard
          id="diagnosis-page-stat-invalid"
          label={t('diagnosis.invalid')}
          value={
            <Link
              id="diagnosis-page-stat-invalid-link"
              to={linkValidade('false')}
              className="hover:underline"
            >
              {numero.format(d.invalidSize ?? 0)}
            </Link>
          }
          tone="down"
          hint={t('diagnosis.clickToFilter')}
        />
        <StatCard
          id="diagnosis-page-stat-transformed"
          label={t('diagnosis.transformed')}
          value={numero.format(d.transformedSize ?? 0)}
        />
      </section>

      {grafico.length > 0 ? (
        <section id="diagnosis-page-chart" className="panel p-4">
          <h2 id="diagnosis-page-chart-title" className="mb-4 font-heading text-sm font-bold">
            {t('diagnosis.topInvalidRules')}
          </h2>
          <div id="diagnosis-page-chart-canvas" className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grafico} margin={{ top: 8, right: 12, bottom: 16, left: 0 }}>
                <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
                {/*
                  As marcas do eixo X são os identificadores das regras (110, 117…),
                  que não dizem nada sozinhos — daí o rótulo. O nome de cada regra
                  aparece no tooltip.
                */}
                <XAxis
                  dataKey="regra"
                  stroke="var(--color-content-muted)"
                  tickLine={false}
                  fontSize={11}
                >
                  <Label
                    value={t('diagnosis.chart.xAxis')}
                    position="insideBottom"
                    offset={-12}
                    fill="var(--color-content-muted)"
                    fontSize={11}
                  />
                </XAxis>
                <YAxis
                  stroke="var(--color-content-muted)"
                  tickLine={false}
                  fontSize={11}
                  width={68}
                >
                  <Label
                    value={t('diagnosis.chart.yAxis')}
                    angle={-90}
                    position="insideLeft"
                    style={{ textAnchor: 'middle' }}
                    fill="var(--color-content-muted)"
                    fontSize={11}
                  />
                </YAxis>
                <Tooltip
                  contentStyle={{
                    borderRadius: '0.5rem',
                    border: '1px solid var(--color-border-subtle)',
                    fontSize: '0.8rem',
                  }}
                  formatter={(value, _name, item) => [
                    numero.format(Number(value)),
                    (item?.payload as { nome?: string } | undefined)?.nome ?? '',
                  ]}
                />
                <Bar dataKey="invalidos" fill="var(--color-down)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      <section id="diagnosis-page-rules" className="flex flex-col gap-3">
        <h2 id="diagnosis-page-rules-title" className="font-heading text-sm font-bold">
          {t('diagnosis.rules', { count: regras.data?.count ?? d.ruleCount })}
        </h2>

        {regras.isPending ? <Loading id="diagnosis-page-rules-loading" /> : null}
        {regras.isError ? (
          <ErrorState
            id="diagnosis-page-rules-error"
            error={regras.error}
            onRetry={() => void regras.refetch()}
          />
        ) : null}

        {regras.data ? (
          <div id="diagnosis-page-rules-table-wrapper" className="overflow-x-auto panel">
            <table
              id="diagnosis-page-rules-table"
              className="w-full min-w-3xl border-collapse text-sm"
            >
              <thead id="diagnosis-page-rules-table-head">
                <tr
                  id="diagnosis-page-rules-table-head-row"
                  className="border-b border-border-subtle bg-surface-muted text-left"
                >
                  <th
                    id="diagnosis-page-column-rule"
                    className="px-4 py-3 font-heading text-xs font-bold"
                  >
                    {t('diagnosis.columns.rule')}
                  </th>
                  <th
                    id="diagnosis-page-column-name"
                    className="px-4 py-3 font-heading text-xs font-bold"
                  >
                    {t('diagnosis.columns.name')}
                  </th>
                  <th
                    id="diagnosis-page-column-mandatory"
                    className="px-4 py-3 font-heading text-xs font-bold"
                  >
                    {t('diagnosis.columns.mandatory')}
                  </th>
                  <th
                    id="diagnosis-page-column-valid-count"
                    className="px-4 py-3 text-right font-heading text-xs font-bold"
                  >
                    {t('diagnosis.columns.validCount')}
                  </th>
                  <th
                    id="diagnosis-page-column-invalid-count"
                    className="px-4 py-3 text-right font-heading text-xs font-bold"
                  >
                    {t('diagnosis.columns.invalidCount')}
                  </th>
                </tr>
              </thead>
              <tbody id="diagnosis-page-rules-table-body">
                {regras.data.results.map((regra) => (
                  <tr
                    id={`diagnosis-page-rule-${regra.ruleId}`}
                    key={regra.ruleId}
                    className="border-b border-border-subtle last:border-0"
                  >
                    <td
                      id={`diagnosis-page-rule-${regra.ruleId}-id`}
                      className="px-4 py-3 font-mono text-xs"
                    >
                      {regra.ruleId}
                    </td>
                    <td id={`diagnosis-page-rule-${regra.ruleId}-name`} className="px-4 py-3">
                      <span
                        id={`diagnosis-page-rule-${regra.ruleId}-name-text`}
                        className="font-medium"
                      >
                        {regra.name}
                      </span>
                      <span
                        id={`diagnosis-page-rule-${regra.ruleId}-description`}
                        className="block text-xs text-content-muted"
                      >
                        {regra.description}
                      </span>
                    </td>
                    <td
                      id={`diagnosis-page-rule-${regra.ruleId}-mandatory`}
                      className="px-4 py-3 text-content-muted"
                    >
                      {regra.mandatory ? t('common.yes') : t('common.no')}
                    </td>
                    <td
                      id={`diagnosis-page-rule-${regra.ruleId}-valid-count`}
                      className="px-4 py-3 text-right tabular-nums"
                    >
                      {regra.validCount ? (
                        <Link
                          id={`diagnosis-page-rule-${regra.ruleId}-valid-link`}
                          to={linkRegistros('validRule', String(regra.ruleId))}
                          className="text-ok hover:underline"
                        >
                          {numero.format(regra.validCount)}
                        </Link>
                      ) : (
                        <span className="text-content-muted">—</span>
                      )}
                    </td>
                    <td
                      id={`diagnosis-page-rule-${regra.ruleId}-invalid-count`}
                      className="px-4 py-3 text-right tabular-nums"
                    >
                      {regra.invalidCount ? (
                        <Link
                          id={`diagnosis-page-rule-${regra.ruleId}-invalid-link`}
                          to={linkRegistros('invalidRule', String(regra.ruleId))}
                          className="text-down hover:underline"
                        >
                          {numero.format(regra.invalidCount)}
                        </Link>
                      ) : (
                        <span className="text-content-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  )
}
