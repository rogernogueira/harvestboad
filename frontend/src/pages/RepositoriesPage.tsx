import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { useAuth } from '@/auth/context'
import { HarvestStatusBadge, Tag } from '@/components/Badges'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { PageHeader } from '@/components/PageHeader'
import { RepositoryManagersModal } from '@/components/RepositoryManagersModal'
import { UsersIcon } from '@/components/UsersIcon'
import { repositoriesSummaryQuery } from '@/lib/queries'
import type { LastHarvestSummary, RepositoryAccessSummary } from '@/lib/types'

// Sob demanda: a tela do administrador carrega a TanStack Table, e o gestor
// nunca a abre — um import estático faria todo gestor baixar a biblioteca à toa.
const AdminRepositoriesPage = lazy(() =>
  import('@/pages/AdminRepositoriesPage').then((m) => ({
    default: m.AdminRepositoriesPage,
  })),
)

/**
 * Painel de repositórios do gestor.
 *
 * Um repositório por linha: à esquerda a identificação, à direita as
 * estatísticas da última coleta. A lista vem já filtrada pelo backend — o
 * endpoint devolve apenas os vínculos do usuário autenticado.
 */
export function RepositoriesPage() {
  const { user } = useAuth()

  // O administrador não tem "meus repositórios": para ele, esta é a tela de
  // gerenciamento de todo o acervo.
  if (user?.profile === 'ADMIN') {
    return (
      <Suspense fallback={<Loading />}>
        <AdminRepositoriesPage />
      </Suspense>
    )
  }

  return <MyRepositoriesPage />
}

/*
  Limiares de idade da última coleta.

  Escolhidos a partir da distribuição real deste acervo, onde as coletas se
  espaçam por meses: abaixo de 90 dias nada a fazer, acima de um ano o
  repositório está parado. São um ponto de partida para ajuste com quem opera,
  não uma regra do domínio.
*/
const DIAS_ATENCAO = 90
const DIAS_CRITICO = 365

/**
 * Ordena por necessidade de atenção.
 *
 * A regra é uma só, para o gestor conseguir prever a ordem olhando a lista:
 * coleta mais antiga primeiro. Antes dela vêm os casos que nem dá para avaliar
 * — repositório sem resposta da origem e repositório nunca coletado.
 *
 * A ordem anterior era a da origem, que segue a sigla (UFT, UFT-2, UFT-4…).
 * Sigla é código interno: por ela, o repositório parado há mais tempo caía no
 * meio da lista e o mais saudável no fim.
 *
 * O contador de inválidos de propósito não entra: neste acervo ele não passa de
 * 0,6% em nenhum repositório, e misturá-lo faria a ordem deixar de ser
 * explicável numa frase.
 */
function ordenarPorAtencao(itens: RepositoryAccessSummary[]) {
  const quando = (item: RepositoryAccessSummary) => {
    if (item.unavailable) return Number.NEGATIVE_INFINITY
    const fim = item.lastHarvest?.endTime
    if (!fim) return Number.NEGATIVE_INFINITY + 1
    const instante = Date.parse(fim.replace(' ', 'T'))
    return Number.isNaN(instante) ? Number.NEGATIVE_INFINITY + 1 : instante
  }
  // Desempate pelo nome: sem ele, duas coletas do mesmo instante trocariam de
  // lugar entre renderizações.
  return [...itens].sort(
    (a, b) => quando(a) - quando(b) || (a.name ?? '').localeCompare(b.name ?? ''),
  )
}

/** Painel do gestor: apenas os repositórios vinculados à sua conta. */
function MyRepositoriesPage() {
  const { t } = useTranslation()
  const { data, isPending, isError, error, refetch } = useQuery(repositoriesSummaryQuery)

  // Antes dos retornos antecipados: hook não pode ficar atrás de condicional.
  const ordenados = useMemo(() => ordenarPorAtencao(data?.results ?? []), [data?.results])

  if (isPending) return <Loading label={t('repositories.loadingStats')} />
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />

  return (
    <div className="flex flex-col gap-6">
      {/*
        Sem eyebrow: aqui ele repetiria o título. O rótulo existe para situar a
        tela numa seção — é o que faz em "Administração" —, e esta não está sob
        nenhuma.
      */}
      <PageHeader
        title={t('repositories.title')}
        description={
          <>
            {t('repositories.subtitle', { count: data.count })}
            {' · '}
            {t('repositories.sortedByAge')}
          </>
        }
      />

      {ordenados.length === 0 ? (
        <Empty label={t('repositories.none')} />
      ) : (
        <ul className="flex flex-col gap-4">
          {ordenados.map((acesso) => (
            <li key={acesso.id}>
              <RepositoryRow acesso={acesso} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Uma linha do painel: identificação + estatísticas lado a lado. */
function RepositoryRow({ acesso }: { acesso: RepositoryAccessSummary }) {
  const { t, i18n } = useTranslation()
  const [gestoresAbertos, setGestoresAbertos] = useState(false)
  const nomeRepositorio = acesso.name ?? acesso.acronym

  return (
    <article className="panel grid gap-px overflow-hidden bg-border-subtle lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      {/* Identificação */}
      <div className="flex flex-col gap-1 bg-surface p-5">
        <span className="flex items-center justify-between gap-2">
          <span className="eyebrow !text-brand-strong">{acesso.acronym}</span>
          <button
            type="button"
            onClick={() => setGestoresAbertos(true)}
            title={t('managers.open')}
            aria-label={t('managers.open')}
            className="-mt-1 -mr-1 p-1.5 text-content-muted transition-colors duration-150 hover:text-brand-strong"
          >
            <UsersIcon />
          </button>
        </span>
        <Link
          to={`/repositorios/${acesso.harvesterRepositoryId}`}
          className="font-heading text-lg font-bold tracking-tight hover:text-brand-strong hover:underline"
        >
          {acesso.name ?? t('repositories.unnamed')}
        </Link>
        {acesso.institutionName ? (
          <span className="text-sm text-content-muted">{acesso.institutionName}</span>
        ) : null}
        <span className="mt-auto pt-3 text-xs text-content-muted">
          {t('repositories.grantedAt', {
            date: new Date(acesso.grantedAt).toLocaleDateString(i18n.resolvedLanguage),
          })}
        </span>

        <RepositoryManagersModal
          aberto={gestoresAbertos}
          onFechar={() => setGestoresAbertos(false)}
          repositoryId={acesso.harvesterRepositoryId}
          repositorio={`${acesso.acronym} · ${nomeRepositorio}`}
        />
      </div>

      {/* Estatísticas da última coleta */}
      <div className="bg-surface p-5">
        {acesso.unavailable ? (
          <p className="border-l-2 border-warn bg-warn-soft px-3 py-2 text-sm text-warn">
            {t('repositories.statsUnavailable')}
          </p>
        ) : acesso.lastHarvest ? (
          <HarvestStats coleta={acesso.lastHarvest} repositoryId={acesso.harvesterRepositoryId} />
        ) : (
          <p className="text-sm text-content-muted">{t('harvests.none')}</p>
        )}
      </div>
    </article>
  )
}

/**
 * Cor de um indicador, aplicada só quando há o que sinalizar.
 *
 * Zero inválido é o melhor resultado possível e não podia continuar usando a
 * cor de erro; zero válido não é conquista e não pode usar a de sucesso. Vale
 * também para o traço de uma coleta sem indexação, que herdava a cor do
 * indicador que deixou vazio.
 */
function tom(valor: number | null | undefined, cor: string) {
  return valor ? cor : ''
}

/**
 * Idade da última coleta, em destaque e clicável.
 *
 * A data absoluta sozinha não tria: para saber se "07/05/2025" é problema, o
 * gestor precisa fazer a conta de cabeça, em cada cartão. O badge faz a conta e
 * a colore — e é o mesmo sinal que ordena a lista, então a ordem da tela passa
 * a se explicar sozinha.
 *
 * A data exata continua ao lado, porque o badge arredonda e há quem precise do
 * dia. Clicar abre a coleta.
 */
function IdadeDaColeta({ fim, snapshotId }: { fim: Date; snapshotId: string }) {
  const { t, i18n } = useTranslation()

  const relativo = useMemo(
    () => new Intl.RelativeTimeFormat(i18n.resolvedLanguage, { numeric: 'auto' }),
    [i18n.resolvedLanguage],
  )

  // Date.now() num inicializador de estado, não no corpo do render: a referência
  // de "agora" fica presa à montagem e a idade não oscila a cada renderização.
  const [agora] = useState(() => Date.now())
  const dias = Math.max(0, Math.floor((agora - fim.getTime()) / 86_400_000))

  // Meses até dois anos: "há 16 meses" localiza melhor que "há 1 ano", que
  // esconderia quatro meses de diferença entre dois repositórios parados.
  const rotulo =
    dias < 30
      ? relativo.format(-dias, 'day')
      : dias < 730
        ? relativo.format(-Math.round(dias / 30.44), 'month')
        : relativo.format(-Math.round(dias / 365.25), 'year')

  const tone = dias >= DIAS_CRITICO ? 'down' : dias >= DIAS_ATENCAO ? 'warn' : 'ok'

  return (
    <Link
      to={`/coletas/${snapshotId}`}
      aria-label={t('repositories.openLastHarvest')}
      className="transition-opacity duration-150 hover:opacity-80"
    >
      <Tag tone={tone}>{rotulo}</Tag>
    </Link>
  )
}

function HarvestStats({
  coleta,
  repositoryId,
}: {
  coleta: LastHarvestSummary
  repositoryId: string
}) {
  const { t, i18n } = useTranslation()

  const numero = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage),
    [i18n.resolvedLanguage],
  )
  const dataHora = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        dateStyle: 'short',
        timeStyle: 'short',
      }),
    [i18n.resolvedLanguage],
  )

  // O Harvester devolve "2024-06-25 12:10:33"; sem o T o Safari não converte.
  const fim = coleta.endTime ? new Date(coleta.endTime.replace(' ', 'T')) : null
  const fimValido = fim && !Number.isNaN(fim.getTime())

  const registros = `/coletas/${coleta.snapshotId}/registros`

  /*
    Cada número leva à lista que ele resume — mas só quando essa lista existe.
    Registros e regras vêm do índice de diagnóstico, que só é escrito quando a
    coleta é indexada: com `UNKNOWN` ou `FAILED` o link abriria uma tela vazia.
    E zero inválidos não tem o que listar.
  */
  const indicadores = [
    {
      rotulo: t('diagnosis.size'),
      valor: coleta.size,
      cor: '',
      para: coleta.evaluated ? registros : null,
      titulo: t('repositories.openRecords'),
    },
    {
      rotulo: t('diagnosis.valid'),
      valor: coleta.validSize,
      cor: tom(coleta.validSize, 'text-ok'),
      para: coleta.validSize ? `${registros}?valid=true` : null,
      titulo: t('repositories.openValidRecords'),
    },
    {
      rotulo: t('diagnosis.invalid'),
      valor: coleta.invalidSize,
      cor: tom(coleta.invalidSize, 'text-down'),
      para: coleta.invalidSize ? `${registros}?valid=false` : null,
      titulo: t('repositories.openInvalidRecords'),
    },
    {
      rotulo: t('repositories.violatedRules'),
      valor: coleta.violatedRuleCount,
      cor: tom(coleta.violatedRuleCount, 'text-warn'),
      para: coleta.violatedRuleCount ? `/coletas/${coleta.snapshotId}` : null,
      titulo: t('repositories.openDiagnosis'),
    },
  ]

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="eyebrow">{t('repositories.lastHarvest')}</span>
        <Link
          to={`/coletas/${coleta.snapshotId}`}
          className="font-mono text-xs text-brand-strong hover:underline"
        >
          #{coleta.snapshotId}
        </Link>
        {coleta.status ? <HarvestStatusBadge status={coleta.status} /> : null}
        {fimValido ? <IdadeDaColeta fim={fim} snapshotId={coleta.snapshotId} /> : null}
        <span className="text-xs text-content-muted">{fimValido ? dataHora.format(fim) : '—'}</span>
        {/*
          Coleta sem indexação não passou por validação: os campos de válidos,
          inválidos e regras vêm vazios, e o aviso explica o porquê uma vez só,
          em vez de repetir "não avaliado" em cada indicador.
        */}
        {coleta.evaluated ? null : (
          <span className="text-xs text-content-muted italic" title={coleta.indexStatus ?? ''}>
            {t('repositories.notEvaluated')}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {indicadores.map((item) => (
          <div key={item.rotulo}>
            <dt className="eyebrow">{item.rotulo}</dt>
            <dd className={`font-heading text-xl font-extrabold tabular-nums ${item.cor}`}>
              {item.valor === null || item.valor === undefined ? (
                '—'
              ) : item.para ? (
                <Link to={item.para} title={item.titulo} className="hover:underline">
                  {numero.format(item.valor)}
                </Link>
              ) : (
                numero.format(item.valor)
              )}
            </dd>
          </div>
        ))}
      </dl>

      {coleta.topViolations.length > 0 ? (
        <div className="mt-auto">
          <p className="eyebrow mb-1.5">{t('repositories.topViolations')}</p>
          <ul className="flex flex-col gap-1">
            {coleta.topViolations.map((violacao) => (
              <li key={violacao.ruleId} className="flex items-baseline gap-2 text-xs">
                <Link
                  to={`/coletas/${coleta.snapshotId}/registros?invalidRule=${violacao.ruleId}`}
                  className="text-brand-strong hover:underline"
                  title={t('repositories.seeRecords')}
                >
                  {violacao.name}
                </Link>
                <span className="flex-1 border-b border-dotted border-border-strong" />
                <span className="tabular-nums text-content-muted">
                  {numero.format(violacao.invalidCount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-xs text-content-muted">
        <Link to={`/repositorios/${repositoryId}`} className="hover:underline">
          {t('repositories.seeHistory')}
        </Link>
      </p>
    </div>
  )
}
