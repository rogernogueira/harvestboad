import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useLocation, useParams, useSearchParams } from 'react-router'

import { HarvestStatusBadge } from '@/components/Badges'
import { Breadcrumb } from '@/components/Breadcrumb'
import { ErrorState, Loading } from '@/components/Feedback'
import { harvestDuration } from '@/lib/duration'
import { filtersFromSearch, filtersToParams } from '@/lib/filters'
import { harvestQuery } from '@/lib/queries'

/**
 * Moldura das telas de coleta.
 *
 * As abas carregam a query string dos filtros adiante: é isso que faz o recorte
 * escolhido no diagnóstico continuar valendo ao abrir os registros, e vice-versa.
 *
 * São as classes `br-tab` do design system sobre `NavLink`, e não o componente
 * `BrTab`. Aqui cada aba é uma **rota**, não um painel: o `BrTab` é controlado
 * por índice (`activeIndex` + `onChange`) e esconde painéis irmãos, o que
 * substituiria a navegação real por troca de estado — e perderia o link
 * compartilhável e o botão voltar.
 */
export function HarvestLayout() {
  const { t, i18n } = useTranslation()
  const { snapshotId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const location = useLocation()

  const { data, isPending, isError, error, refetch } = useQuery(harvestQuery(snapshotId))

  // Só os filtros viajam entre as abas; paginação é específica de cada tela.
  const filtros = filtersToParams(filtersFromSearch(searchParams)).toString()
  const sufixo = filtros ? `?${filtros}` : ''

  if (isPending) return <Loading id="harvest-layout-loading" />
  if (isError)
    return <ErrorState id="harvest-layout-error" error={error} onRetry={() => void refetch()} />

  const dataHora = (valor: string | null | undefined) =>
    valor ? new Date(valor.replace(' ', 'T')).toLocaleString(i18n.resolvedLanguage) : '—'

  /*
   * Duração: a origem dá início e término, nunca a conta. Sem ela, saber se uma
   * coleta levou três segundos ou três horas exigia subtrair dois horários de
   * cabeça — e é justamente a duração que diz se a coleta travou.
   */
  const duracao = harvestDuration(data.startTime, data.endTime)
  const duracaoEmTexto = duracao
    ? [
        duracao.horas ? `${duracao.horas} ${t('harvest.units.hours')}` : '',
        duracao.minutos ? `${duracao.minutos} ${t('harvest.units.minutes')}` : '',
        // Os segundos só desaparecem quando há hora: "1 h 5 min" basta, mas
        // "3 min" sem os segundos perderia precisão numa coleta curta.
        !duracao.horas ? `${duracao.segundos} ${t('harvest.units.seconds')}` : '',
      ]
        .filter(Boolean)
        .join(' ')
    : null

  /*
   * Situação da indexação, ao lado da situação da coleta: uma coleta pode ter
   * terminado válida e não ter sido indexada, e nesse caso não há diagnóstico
   * nenhum — é a diferença entre "não tem erro" e "não foi avaliada".
   */
  const indexacao = data.indexStatus
    ? i18n.exists(`harvestStatus.${data.indexStatus.toLowerCase()}`)
      ? t(`harvestStatus.${data.indexStatus.toLowerCase()}`)
      : data.indexStatus
    : t('harvest.notIndexed')

  const registros = `/coletas/${snapshotId}/registros`
  const abas = [
    {
      id: 'diagnosis',
      to: `/coletas/${snapshotId}${sufixo}`,
      label: t('harvest.tabs.diagnosis'),
      end: true,
      ativo: location.pathname === `/coletas/${snapshotId}`,
    },
    {
      id: 'records',
      to: `${registros}${sufixo}`,
      label: t('harvest.tabs.records'),
      end: false,
      ativo: location.pathname.startsWith(registros),
    },
  ]

  return (
    <div id="harvest-layout">
      <div id="harvest-layout-heading" className="mb-3">
        <Breadcrumb
          id="harvest-layout-breadcrumb"
          items={[
            { label: t('repositories.title'), to: '/' },
            {
              label: data.repository.acronym ?? data.repository.harvesterRepositoryId,
              to: `/repositorios/${data.repository.harvesterRepositoryId}`,
            },
            { label: t('harvest.breadcrumb', { id: snapshotId }) },
          ]}
        />
        <div id="harvest-layout-title-row" className="d-flex flex-wrap align-items-center gap-3">
          <h1 id="harvest-layout-title" className="mt-0 mb-0">
            {t('harvest.title', { id: snapshotId })}
          </h1>
          <HarvestStatusBadge id="harvest-layout-status" status={data.status} />
        </div>
        <p id="harvest-layout-subtitle" className="text-gray-70 mt-1 mb-0">
          {data.repository.name}
        </p>
        <dl
          id="harvest-layout-timing"
          className="d-flex flex-wrap text-down-01 text-gray-70 mt-1 mb-0"
          style={{ columnGap: 'var(--spacing-scale-3x)', rowGap: 'var(--spacing-scale-half)' }}
        >
          {[
            { chave: 'started', rotulo: t('harvest.startedAt'), valor: dataHora(data.startTime) },
            { chave: 'ended', rotulo: t('harvest.endedAt'), valor: dataHora(data.endTime) },
            { chave: 'duration', rotulo: t('harvest.duration'), valor: duracaoEmTexto ?? '—' },
            { chave: 'index', rotulo: t('harvest.indexStatus'), valor: indexacao },
          ].map((item) => (
            <div id={`harvest-layout-timing-${item.chave}`} key={item.chave} className="d-flex">
              <dt id={`harvest-layout-timing-${item.chave}-label`} className="mr-1">
                {item.rotulo}
              </dt>
              <dd
                id={`harvest-layout-timing-${item.chave}-value`}
                className="text-medium mb-0"
                style={{ color: 'var(--color-content)' }}
              >
                {item.valor}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div id="harvest-layout-tabs" className="br-tab mb-3">
        <nav id="harvest-layout-tab-nav" className="tab-nav" aria-label={t('harvest.tabsLabel')}>
          {/*
            O `active` do design system fica no `<li>`, não no link — é ele que
            o CSS do `.br-tab` estiliza. Por isso o estado sai de
            `location.pathname` e não do render prop do `NavLink`: a classe
            precisa subir um nível, onde o render prop não alcança.
          */}
          <ul id="harvest-layout-tab-list">
            {abas.map((aba) => (
              <li
                id={`harvest-layout-tab-${aba.id}`}
                key={aba.label}
                className={`tab-item ${aba.ativo ? 'active' : ''}`}
              >
                <NavLink
                  id={`harvest-layout-tab-${aba.id}-link`}
                  to={aba.to}
                  end={aba.end}
                  aria-current={aba.ativo ? 'page' : undefined}
                >
                  <span className="name">{aba.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <Outlet />
    </div>
  )
}
