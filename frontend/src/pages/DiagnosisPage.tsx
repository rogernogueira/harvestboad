import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
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

import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { RuleOccurrencesModal } from '@/components/RuleOccurrencesModal'
import { RulesFilterBar } from '@/components/RulesFilterBar'
import { StatCard } from '@/components/StatCard'
import { filtersFromSearch, filtersToParams, toggleRule } from '@/lib/filters'
import { diagnosisQuery, rulesQuery } from '@/lib/queries'
import {
  filterRules,
  ruleFiltersFromSearch,
  ruleFiltersToSearch,
  type RuleFilters,
} from '@/lib/ruleFilters'
import type { Rule } from '@/lib/types'

/**
 * Diagnóstico da coleta.
 *
 * As contagens das regras são links para os registros já filtrados — é o
 * caminho pelo qual o gestor sai do "quantos falharam" para "quais são".
 */
export function DiagnosisPage() {
  const { t, i18n } = useTranslation()
  const { snapshotId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const filtros = filtersFromSearch(searchParams)
  const filtrosDeRegra = ruleFiltersFromSearch(searchParams)

  /** Troca só os parâmetros das regras, preservando o recorte compartilhado. */
  const aplicarFiltrosDeRegra = (novos: RuleFilters) =>
    setSearchParams(ruleFiltersToSearch(searchParams, novos), { replace: true })

  const diagnostico = useQuery(diagnosisQuery(snapshotId))
  const regras = useQuery(rulesQuery(snapshotId))

  // Um modal por vez, montado só quando há regra escolhida: a tabela tem
  // dezenas de linhas, e um `<dialog>` por linha encheria o HTML de dialogos
  // fechados só para manter estado que cabe aqui.
  const [regraAberta, setRegraAberta] = useState<Rule | null>(null)

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

  /*
   * O recorte vale para a tabela, não para o gráfico: ele é o retrato das oito
   * regras com mais violações na coleta, e filtrá-lo junto faria o "mais
   * violadas" mudar de significado conforme o que se digita na busca.
   */
  const regrasFiltradas = useMemo(
    () => filterRules(regras.data?.results ?? [], filtrosDeRegra),
    [regras.data, filtrosDeRegra],
  )

  const grafico = useMemo(() => {
    const itens = regras.data?.results ?? []
    return itens
      .filter((regra) => (regra.invalidCount ?? 0) > 0)
      .sort((a, b) => (b.invalidCount ?? 0) - (a.invalidCount ?? 0))
      .slice(0, 8)
      .map((regra) => ({
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
    <div id="diagnosis-page" className="d-flex flex-column gap-5">
      <section id="diagnosis-page-stats" className="row mb-4">
        <div id="diagnosis-page-stat-size-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="diagnosis-page-stat-size"
            label={t('diagnosis.size')}
            value={numero.format(d.size ?? 0)}
          />
        </div>
        <div id="diagnosis-page-stat-valid-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="diagnosis-page-stat-valid"
            label={t('diagnosis.valid')}
            value={
              <Link
                id="diagnosis-page-stat-valid-link"
                to={linkValidade('true')}
                className="inherit-color"
              >
                {numero.format(d.validSize ?? 0)}
              </Link>
            }
            tone="ok"
            hint={t('diagnosis.clickToFilter')}
          />
        </div>
        <div id="diagnosis-page-stat-invalid-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="diagnosis-page-stat-invalid"
            label={t('diagnosis.invalid')}
            value={
              <Link
                id="diagnosis-page-stat-invalid-link"
                to={linkValidade('false')}
                className="inherit-color"
              >
                {numero.format(d.invalidSize ?? 0)}
              </Link>
            }
            tone="down"
            hint={t('diagnosis.clickToFilter')}
          />
        </div>
        <div id="diagnosis-page-stat-transformed-col" className="col-sm-6 col-lg-3 mb-2">
          <StatCard
            id="diagnosis-page-stat-transformed"
            label={t('diagnosis.transformed')}
            value={numero.format(d.transformedSize ?? 0)}
          />
        </div>
      </section>

      {grafico.length > 0 ? (
        <section id="diagnosis-page-chart" className="br-card p-3 mb-4">
          <h2 id="diagnosis-page-chart-title" className="mb-4 text-base text-bold">
            {t('diagnosis.topInvalidRules')}
          </h2>
          {/*
            Barras deitadas, não em pé. O eixo de categoria leva o nome da regra
            ("Versão da publicação"), e nome longo em eixo horizontal só cabe
            girado ou cortado — girado fica ilegível, cortado perde justamente a
            informação que motivou a troca. Deitado, o nome se lê da esquerda
            para a direita e ainda sobra espaço quando a tela é estreita.

            A altura acompanha a quantidade de barras em vez de ser fixa: com
            altura fixa a faixa de rótulos fica de fora e o cartão ganha uma
            barra de rolagem interna.
          */}
          <div
            id="diagnosis-page-chart-canvas"
            style={{ height: `${grafico.length * 2.25 + 2.5}rem` }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={grafico}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 16, left: 0 }}
              >
                <CartesianGrid stroke="var(--color-border-subtle)" horizontal={false} />
                <XAxis
                  type="number"
                  stroke="var(--color-content-muted)"
                  tickLine={false}
                  fontSize={11}
                  allowDecimals={false}
                >
                  <Label
                    value={t('diagnosis.chart.valueAxis')}
                    position="insideBottom"
                    offset={-12}
                    fill="var(--color-content-muted)"
                    fontSize={11}
                  />
                </XAxis>
                {/*
                  O nome completo fica no tooltip; a marca do eixo corta os casos
                  extremos para não empurrar a área do gráfico até sumir.
                */}
                <YAxis
                  type="category"
                  dataKey="nome"
                  stroke="var(--color-content-muted)"
                  tickLine={false}
                  fontSize={11}
                  width={150}
                  interval={0}
                  tickFormatter={(nome: string) =>
                    nome.length > 24 ? `${nome.slice(0, 23)}…` : nome
                  }
                />
                <Tooltip
                  cursor={{ fill: 'var(--color-surface-muted)' }}
                  contentStyle={{
                    borderRadius: '0.5rem',
                    border: '1px solid var(--color-border-subtle)',
                    fontSize: '0.8rem',
                  }}
                  formatter={(value) => [
                    numero.format(Number(value)),
                    t('diagnosis.columns.invalidCount'),
                  ]}
                />
                <Bar dataKey="invalidos" fill="var(--color-down)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      <section id="diagnosis-page-rules" className="d-flex flex-column gap-3">
        <h2 id="diagnosis-page-rules-title" className="text-base text-bold">
          {t('diagnosis.rules', { count: regras.data?.count ?? d.ruleCount })}
          {/*
            Quantas sobraram do total, e não só o total: uma tabela de 3 linhas
            sob um título que anuncia 15 parece resultado errado.
          */}
          {regras.data && regrasFiltradas.length !== regras.data.results.length ? (
            <span id="diagnosis-page-rules-filtered" className="text-gray-70 text-regular">
              {' '}
              {t('diagnosis.filters.showing', { count: regrasFiltradas.length })}
            </span>
          ) : null}
        </h2>

        {regras.data ? (
          <RulesFilterBar
            id="diagnosis-page-rules-filters"
            filters={filtrosDeRegra}
            onChange={aplicarFiltrosDeRegra}
          />
        ) : null}

        {regras.isPending ? <Loading id="diagnosis-page-rules-loading" /> : null}
        {regras.isError ? (
          <ErrorState
            id="diagnosis-page-rules-error"
            error={regras.error}
            onRetry={() => void regras.refetch()}
          />
        ) : null}

        {regras.data && regrasFiltradas.length === 0 ? (
          <Empty id="diagnosis-page-rules-empty" label={t('diagnosis.filters.none')} />
        ) : null}

        {regras.data && regrasFiltradas.length > 0 ? (
          <div
            id="diagnosis-page-rules-table-wrapper"
            className="br-table"
            style={{ overflowX: 'auto' }}
          >
            <table id="diagnosis-page-rules-table">
              <thead id="diagnosis-page-rules-table-head">
                <tr id="diagnosis-page-rules-table-head-row" className="bg-gray-2 text-left">
                  <th id="diagnosis-page-column-rule" className="px-3 py-2 text-down-01 text-bold">
                    {t('diagnosis.columns.rule')}
                  </th>
                  <th
                    id="diagnosis-page-column-description"
                    className="px-3 py-2 text-down-01 text-bold"
                  >
                    {t('diagnosis.columns.name')}
                  </th>
                  <th
                    id="diagnosis-page-column-mandatory"
                    className="px-3 py-2 text-down-01 text-bold"
                  >
                    {t('diagnosis.columns.mandatory')}
                  </th>
                  <th
                    id="diagnosis-page-column-valid-count"
                    className="px-3 py-2 text-right text-down-01 text-bold"
                  >
                    {t('diagnosis.columns.validCount')}
                  </th>
                  <th
                    id="diagnosis-page-column-invalid-count"
                    className="px-3 py-2 text-right text-down-01 text-bold"
                  >
                    {t('diagnosis.columns.invalidCount')}
                  </th>
                  <th
                    id="diagnosis-page-column-occurrences"
                    className="px-3 py-2 text-right text-down-01 text-bold"
                  >
                    {t('diagnosis.columns.occurrences')}
                  </th>
                </tr>
              </thead>
              <tbody id="diagnosis-page-rules-table-body">
                {regrasFiltradas.map((regra) => (
                  <tr id={`diagnosis-page-rule-${regra.ruleId}`} key={regra.ruleId}>
                    {/*
                      A coluna "Regra" leva o nome, não o `ruleID`. O número é
                      chave da origem, não informação ao gestor: "110" não diz
                      nada, "Abstract" diz. Ele continua no `id` do elemento,
                      que é onde precisa ser único e estável.
                    */}
                    <td id={`diagnosis-page-rule-${regra.ruleId}-name`} className="px-3 py-2">
                      {/*
                        O identificador volta à tela, mas antes do nome e em tom
                        secundário, não em coluna própria: é a chave pela qual a
                        origem, o suporte e as próprias URLs de filtro
                        (`invalidRule=110`) chamam a regra, e sem ele não há como
                        casar o que está aqui com o que se lê lá. O nome
                        continua sendo o que se lê primeiro.
                      */}
                      <span
                        id={`diagnosis-page-rule-${regra.ruleId}-id`}
                        className="text-gray-70 mr-1"
                      >
                        {regra.ruleId}
                      </span>
                      <span
                        id={`diagnosis-page-rule-${regra.ruleId}-name-text`}
                        className="text-medium"
                      >
                        {regra.name}
                      </span>
                    </td>
                    <td
                      id={`diagnosis-page-rule-${regra.ruleId}-description`}
                      className="px-3 py-2 text-down-01 text-gray-70"
                    >
                      {regra.description}
                    </td>
                    <td
                      id={`diagnosis-page-rule-${regra.ruleId}-mandatory`}
                      className="px-3 py-2 text-gray-70"
                    >
                      {regra.mandatory ? t('common.yes') : t('common.no')}
                    </td>
                    <td
                      id={`diagnosis-page-rule-${regra.ruleId}-valid-count`}
                      className="px-3 py-2 text-right"
                    >
                      {regra.validCount ? (
                        <Link
                          id={`diagnosis-page-rule-${regra.ruleId}-valid-link`}
                          to={linkRegistros('validRule', String(regra.ruleId))}
                          className="text-green-cool-vivid-50"
                        >
                          {numero.format(regra.validCount)}
                        </Link>
                      ) : (
                        <span className="text-gray-70">—</span>
                      )}
                    </td>
                    <td
                      id={`diagnosis-page-rule-${regra.ruleId}-invalid-count`}
                      className="px-3 py-2 text-right"
                    >
                      {regra.invalidCount ? (
                        <Link
                          id={`diagnosis-page-rule-${regra.ruleId}-invalid-link`}
                          to={linkRegistros('invalidRule', String(regra.ruleId))}
                          className="text-red-vivid-50"
                        >
                          {numero.format(regra.invalidCount)}
                        </Link>
                      ) : (
                        <span className="text-gray-70">—</span>
                      )}
                    </td>
                    <td
                      id={`diagnosis-page-rule-${regra.ruleId}-occurrences`}
                      className="px-3 py-2 text-right"
                    >
                      <button
                        id={`diagnosis-page-rule-${regra.ruleId}-occurrences-button`}
                        type="button"
                        onClick={() => setRegraAberta(regra)}
                        aria-label={t('diagnosis.occurrences.open', { rule: regra.name })}
                        title={t('diagnosis.occurrences.openShort')}
                        className="br-button circle small"
                      >
                        <i className="fas fa-chart-bar" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {regraAberta ? (
        <RuleOccurrencesModal
          id={`diagnosis-page-rule-${regraAberta.ruleId}-occurrences-modal`}
          aberto
          onFechar={() => setRegraAberta(null)}
          snapshotId={snapshotId}
          ruleId={String(regraAberta.ruleId)}
          nome={regraAberta.name}
          filtros={filtros}
        />
      ) : null}
    </div>
  )
}
