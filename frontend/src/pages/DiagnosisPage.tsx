import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

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

  if (diagnostico.isPending) return <Loading />
  if (diagnostico.isError)
    return <ErrorState error={diagnostico.error} onRetry={() => void diagnostico.refetch()} />

  const d = diagnostico.data

  return (
    <div className="flex flex-col gap-8">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('diagnosis.size')} value={numero.format(d.size ?? 0)} />
        <StatCard
          label={t('diagnosis.valid')}
          value={
            <Link to={linkValidade('true')} className="hover:underline">
              {numero.format(d.validSize ?? 0)}
            </Link>
          }
          tone="ok"
          hint={t('diagnosis.clickToFilter')}
        />
        <StatCard
          label={t('diagnosis.invalid')}
          value={
            <Link to={linkValidade('false')} className="hover:underline">
              {numero.format(d.invalidSize ?? 0)}
            </Link>
          }
          tone="down"
          hint={t('diagnosis.clickToFilter')}
        />
        <StatCard label={t('diagnosis.transformed')} value={numero.format(d.transformedSize ?? 0)} />
      </section>

      {grafico.length > 0 ? (
        <section className="rounded-xl border border-border-subtle bg-surface-raised p-4">
          <h2 className="mb-4 text-sm font-medium">{t('diagnosis.topInvalidRules')}</h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grafico} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
                <XAxis
                  dataKey="regra"
                  stroke="var(--color-content-muted)"
                  tickLine={false}
                  fontSize={11}
                />
                <YAxis
                  stroke="var(--color-content-muted)"
                  tickLine={false}
                  fontSize={11}
                  width={56}
                />
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

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">
          {t('diagnosis.rules', { count: regras.data?.count ?? d.ruleCount })}
        </h2>

        {regras.isPending ? <Loading /> : null}
        {regras.isError ? (
          <ErrorState error={regras.error} onRetry={() => void regras.refetch()} />
        ) : null}

        {regras.data ? (
          <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-raised">
            <table className="w-full min-w-3xl border-collapse text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left">
                  <th className="px-4 py-3 font-medium">{t('diagnosis.columns.rule')}</th>
                  <th className="px-4 py-3 font-medium">{t('diagnosis.columns.name')}</th>
                  <th className="px-4 py-3 font-medium">{t('diagnosis.columns.mandatory')}</th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t('diagnosis.columns.validCount')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t('diagnosis.columns.invalidCount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {regras.data.results.map((regra) => (
                  <tr key={regra.ruleId} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">{regra.ruleId}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{regra.name}</span>
                      <span className="block text-xs text-content-muted">{regra.description}</span>
                    </td>
                    <td className="px-4 py-3 text-content-muted">
                      {regra.mandatory ? t('common.yes') : t('common.no')}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {regra.validCount ? (
                        <Link
                          to={linkRegistros('validRule', String(regra.ruleId))}
                          className="text-ok hover:underline"
                        >
                          {numero.format(regra.validCount)}
                        </Link>
                      ) : (
                        <span className="text-content-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {regra.invalidCount ? (
                        <Link
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
