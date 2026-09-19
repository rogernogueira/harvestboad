import { BrInput, BrSelectStandard } from '@govbr-ds/react-components'
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'

import { useAuth } from '@/auth/context'
import { HarvestStatusBadge, Tag } from '@/components/Badges'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { PageHeader } from '@/components/PageHeader'
import { HarvestRequestButton } from '@/components/HarvestRequestButton'
import { NotificationsButton } from '@/components/NotificationsButton'
import { NotificationsPanel } from '@/components/NotificationsPanel'
import { Pagination } from '@/components/Pagination'
import { RepositoryManagersModal } from '@/components/RepositoryManagersModal'
import { UsersIcon } from '@/components/UsersIcon'
import { estadoExcepcional } from '@/lib/harvestStatus'
import { tamanhoDaUrl, tamanhoParaUrl, TUDO } from '@/lib/pagination'
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
      <Suspense fallback={<Loading id="repositories-page-admin-loading" />}>
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

/** Critérios oferecidos no seletor, na ordem em que aparecem. */
const ORDENS = ['recentes-za', 'recentes-az', 'validos-pct', 'validos-total'] as const
type Ordem = (typeof ORDENS)[number]

/**
 * O padrão é a coleta mais antiga primeiro — a ordem por necessidade de
 * atenção, que era a única até aqui e continua sendo o que se vê ao abrir a
 * tela. O seletor só deu nome a ela e abriu as outras três.
 */
const ORDEM_PADRAO: Ordem = 'recentes-za'

/**
 * Instante da última coleta, para ordenar.
 *
 * Os dois casos que não têm instante são separados de propósito, e não
 * empilhados num só: repositório sem resposta da origem (`unavailable`) e
 * repositório nunca coletado são ausências diferentes, e mantê-las distintas
 * dá uma ordem estável entre elas.
 */
function instanteDaColeta(item: RepositoryAccessSummary): number {
  if (item.unavailable) return Number.NEGATIVE_INFINITY
  const fim = item.lastHarvest?.endTime
  if (!fim) return Number.NEGATIVE_INFINITY + 1
  const instante = Date.parse(fim.replace(' ', 'T'))
  return Number.isNaN(instante) ? Number.NEGATIVE_INFINITY + 1 : instante
}

// Desempate pelo nome: sem ele, duas coletas do mesmo instante — ou dois
// repositórios com a mesma medida — trocariam de lugar entre renderizações.
const peloNome = (a: RepositoryAccessSummary, b: RepositoryAccessSummary) =>
  (a.name ?? '').localeCompare(b.name ?? '')

/**
 * Ordena pela data da última coleta.
 *
 * Com a mais antiga primeiro (`recentes-za`) é a ordem por necessidade de
 * atenção: na frente vêm os casos que nem dá para avaliar — sem resposta da
 * origem e nunca coletado —, depois o que está parado há mais tempo. A ordem
 * anterior a ela era a da origem, que segue a sigla (UFT, UFT-2, UFT-4…);
 * sigla é código interno, e por ela o repositório parado há mais tempo caía no
 * meio da lista e o mais saudável no fim.
 *
 * Com a mais recente primeiro (`recentes-az`) é o espelho exato: quem não tem
 * coleta passa para o fim, que é o outro extremo da mesma régua.
 */
function ordenarPorColeta(itens: RepositoryAccessSummary[], recentesPrimeiro: boolean) {
  const sinal = recentesPrimeiro ? -1 : 1
  return [...itens].sort(
    (a, b) => sinal * (instanteDaColeta(a) - instanteDaColeta(b)) || peloNome(a, b),
  )
}

/**
 * Ordena por uma medida da última coleta, do maior para o menor.
 *
 * Quem não tem a medida vai para o fim em vez de valer zero: zero validados é
 * um resultado ruim, "não avaliado" é ausência de resultado — coleta sem
 * indexação não passa por validação —, e tratá-los como iguais poria no mesmo
 * degrau quem falhou e quem nem chegou a ser medido.
 */
function ordenarPorMedida(
  itens: RepositoryAccessSummary[],
  medida: (item: RepositoryAccessSummary) => number | null,
) {
  return [...itens].sort((a, b) => {
    const va = medida(a)
    const vb = medida(b)
    if (va === null || vb === null) {
      if (va === vb) return peloNome(a, b)
      return va === null ? 1 : -1
    }
    return vb - va || peloNome(a, b)
  })
}

/**
 * Proporção de validados na última coleta.
 *
 * Divide por `size`, e não por `validSize + invalidSize`: o total é o que a
 * origem declara ter coletado, e é sobre ele que a porcentagem da tela é lida.
 * Coleta vazia não vira 0% — `0/0` não é uma taxa, é ausência de amostra.
 */
function percentualValidado(item: RepositoryAccessSummary): number | null {
  const coleta = item.lastHarvest
  if (item.unavailable || !coleta?.evaluated) return null
  const { size, validSize } = coleta
  if (size === null || validSize === null || size === 0) return null
  return validSize / size
}

/** Quantidade absoluta de validados na última coleta. */
function totalValidado(item: RepositoryAccessSummary): number | null {
  const coleta = item.lastHarvest
  if (item.unavailable || !coleta?.evaluated) return null
  return coleta.validSize
}

function ordenar(itens: RepositoryAccessSummary[], ordem: Ordem) {
  switch (ordem) {
    case 'recentes-az':
      return ordenarPorColeta(itens, true)
    case 'validos-pct':
      return ordenarPorMedida(itens, percentualValidado)
    case 'validos-total':
      return ordenarPorMedida(itens, totalValidado)
    default:
      return ordenarPorColeta(itens, false)
  }
}

/**
 * Quantos repositórios por página, e o conjunto oferecido no seletor.
 *
 * O padrão segue seis, e não vinte e cinco: cada linha é um cartão alto —
 * identificação de um lado, quatro indicadores e as regras mais violadas do
 * outro —, e seis já ocupam mais de uma tela. A paginação existe para não
 * obrigar a rolar o acervo inteiro à procura de um repositório.
 *
 * O seletor abre a saída oposta, para quem quer justamente varrer tudo de uma
 * vez: como a paginação é no navegador e o acervo já está em memória, "tudo"
 * aqui não custa requisição nenhuma. Não há 1.000 no meio porque um gestor tem
 * dezenas de vínculos, não milhares — entre 100 e "tudo" não sobra nada.
 */
const POR_PAGINA = 6
const TAMANHOS = [6, 25, 100, TUDO] as const

/** Sem acento e em minúsculas: quem busca "institucao" espera achar "instituição". */
const comparavel = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/** Painel do gestor: apenas os repositórios vinculados à sua conta. */
function MyRepositoriesPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data, isPending, isError, error, refetch } = useQuery(repositoriesSummaryQuery)

  const busca = searchParams.get('q') ?? ''
  const pagina = Math.max(1, Number(searchParams.get('page') ?? 1))
  const porPagina = tamanhoDaUrl(searchParams.get('por'), TAMANHOS, POR_PAGINA)
  const ordemUrl = searchParams.get('ordem')
  // Um `?ordem=` desconhecido cai no padrão: senão o seletor ficaria vazio e a
  // lista, numa ordem que ele não sabe nomear.
  const ordem: Ordem = ORDENS.includes(ordemUrl as Ordem) ? (ordemUrl as Ordem) : ORDEM_PADRAO

  /*
   * Busca e paginação acontecem no navegador, e não no servidor.
   *
   * O `/repositories/summary/` compõe cada linha a partir do Harvester e devolve
   * o painel inteiro numa requisição cacheada; paginar no servidor não pouparia
   * nada dessa ida à origem — ele teria de compor tudo de novo para saber o que
   * cabe na página — e cada tecla digitada custaria uma requisição. É a mesma
   * razão pela qual a tela de administração pagina no navegador e a de registros
   * pagina no servidor: escala, não gosto. Um gestor tem dezenas de vínculos,
   * uma coleta tem dezenas de milhares de registros.
   *
   * O recorte vive na URL, como o resto da aplicação: sobrevive ao botão voltar
   * e pode ser colado para outra pessoa.
   */
  const ordenados = useMemo(() => ordenar(data?.results ?? [], ordem), [data?.results, ordem])

  const filtrados = useMemo(() => {
    const termo = comparavel(busca.trim())
    if (!termo) return ordenados
    return ordenados.filter((acesso) =>
      comparavel(
        [acesso.name, acesso.acronym, acesso.institutionName].filter(Boolean).join(' '),
      ).includes(termo),
    )
  }, [ordenados, busca])

  const totalDePaginas = Math.max(1, Math.ceil(filtrados.length / porPagina))
  const paginaAtual = Math.min(pagina, totalDePaginas)
  const visiveis = filtrados.slice((paginaAtual - 1) * porPagina, paginaAtual * porPagina)

  const alterarParams = (mudanca: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams)
    mudanca(params)
    setSearchParams(params, { replace: true })
  }

  /** Buscar volta para a primeira página: a antiga pode não existir mais. */
  const buscar = (valor: string) =>
    alterarParams((params) => {
      if (valor) params.set('q', valor)
      else params.delete('q')
      params.delete('page')
    })

  const irParaPagina = (destino: number) =>
    alterarParams((params) => {
      if (destino > 1) params.set('page', String(destino))
      else params.delete('page')
    })

  /** Trocar a ordem volta à primeira página: a página 3 mostra outros seis. */
  const mudarOrdem = (nova: Ordem) =>
    alterarParams((params) => {
      if (nova === ORDEM_PADRAO) params.delete('ordem')
      else params.set('ordem', nova)
      params.delete('page')
    })

  /** Trocar o tamanho reinicia a paginação: a página 4 de 6 não existe com 100. */
  const mudarTamanho = (novo: number) =>
    alterarParams((params) => {
      const por = tamanhoParaUrl(novo, POR_PAGINA)
      if (por) params.set('por', por)
      else params.delete('por')
      params.delete('page')
    })

  if (isPending)
    return <Loading id="my-repositories-loading" label={t('repositories.loadingStats')} />
  if (isError)
    return <ErrorState id="my-repositories-error" error={error} onRetry={() => void refetch()} />

  return (
    <div id="my-repositories-page" className="d-flex flex-column gap-4">
      {/*
        Sem eyebrow: aqui ele repetiria o título. O rótulo existe para situar a
        tela numa seção — é o que faz em "Administração" —, e esta não está sob
        nenhuma.
      */}
      <PageHeader
        id="my-repositories-header"
        title={t('repositories.title')}
        description={
          <>
            {t('repositories.subtitle', { count: data.count })}
            {busca.trim() ? ` · ${t('repositories.found', { count: filtrados.length })}` : ''}
          </>
        }
      />

      {/*
        A busca fica sempre visível, mesmo com poucos vínculos: quem sabe o que
        procura digita a sigla em vez de percorrer os cartões, e esconder o
        campo abaixo de um limiar faz o controle aparecer e desaparecer conforme
        o acervo cresce.
      */}
      <div
        id="my-repositories-toolbar"
        className="d-flex flex-wrap align-items-end"
        style={{ gap: 'var(--spacing-scale-2x)' }}
      >
        {/*
          A busca cresce e o seletor fica no tamanho do seu conteúdo: o campo de
          texto é que ganha com a largura, e a lista de critérios tem rótulos
          longos que o `flex-grow` esticaria à toa.
        */}
        <div id="my-repositories-search-field" className="flex-grow-1">
          <BrInput
            id="my-repositories-search"
            label={t('repositories.search')}
            value={busca}
            icon="fas fa-search"
            onChange={(evento) => buscar(evento.target.value)}
          />
        </div>

        <BrSelectStandard
          id="my-repositories-sort"
          label={t('repositories.sort.label')}
          value={ordem}
          onChange={(evento) => mudarOrdem(evento.target.value as Ordem)}
          options={ORDENS.map((opcao) => ({
            label: t(`repositories.sort.${opcao}`),
            value: opcao,
          }))}
        />
      </div>

      {filtrados.length === 0 ? (
        <Empty
          id="my-repositories-empty"
          label={busca.trim() ? t('repositories.noneFound') : t('repositories.none')}
        />
      ) : (
        <>
          <ul id="my-repositories-list" className="plain-list d-flex flex-column gap-4">
            {visiveis.map((acesso) => (
              <li id={`my-repositories-item-${acesso.harvesterRepositoryId}`} key={acesso.id}>
                <RepositoryRow acesso={acesso} />
              </li>
            ))}
          </ul>

          {/*
            Sem o `totalDePaginas > 1` que havia aqui: esconder o bloco inteiro
            numa página só levava junto o seletor, e quem escolhesse "tudo"
            ficava sem como voltar a paginar. Quem some agora são só os botões,
            dentro do componente.
          */}
          <Pagination
            id="my-repositories-pagination"
            page={paginaAtual}
            totalPages={totalDePaginas}
            onChange={irParaPagina}
            tamanho={porPagina}
            tamanhos={TAMANHOS}
            onTamanho={mudarTamanho}
          />
        </>
      )}
    </div>
  )
}

/** Uma linha do painel: identificação + estatísticas lado a lado. */
function RepositoryRow({ acesso }: { acesso: RepositoryAccessSummary }) {
  const { t, i18n } = useTranslation()
  const [gestoresAbertos, setGestoresAbertos] = useState(false)
  const [notificacoesAbertas, setNotificacoesAbertas] = useState(false)
  const nomeRepositorio = acesso.name ?? acesso.acronym
  // Uma linha por repositório: o id do repositório é o que mantém únicos todos
  // os ids desta subárvore.
  const id = `repository-row-${acesso.harvesterRepositoryId}`

  /*
   * `mb-0` anula a margem inferior que o `.br-card` traz de fábrica (16px). A
   * lista já separa os cartões com `gap-4` (24px), e o padrão manda que entre
   * dois espaçamentos em sequência prevaleça o maior — não a soma. Sem isto a
   * distância sai 40px, que é a soma dos dois.
   */
  return (
    <article id={id} className="br-card mb-0">
      {/*
        Gutter zerado. O `.row` do design system aplica margem negativa de meio
        gutter (−12px) nas laterais, para que o padding das colunas produza o
        respiro. Aqui as colunas usam `p-3` (16px), e a margem negativa comia
        12px dela: o texto ficava a **4px** da borda do cartão, encostado nela.
        Sem gutter, os 16px do padding valem inteiros.
      */}
      <div id={`${id}-grid`} className="row" style={{ ['--grid-gutter' as string]: '0' }}>
        {/* Identificação */}
        <div id={`${id}-identity`} className="col-lg-5 d-flex flex-column gap-half p-3">
          <span
            id={`${id}-identity-top`}
            className="d-flex align-items-center justify-content-between gap-2"
          >
            <span
              id={`${id}-acronym`}
              className="eyebrow"
              style={{ color: 'var(--blue-warm-vivid-80)' }}
            >
              {acesso.acronym}
            </span>
            {/*
              O sino vem antes do ícone de gestores, e como irmão dele: são dois
              alvos de clique distintos, e um dentro do outro seria HTML
              inválido. Só aparece quando há notificação sem leitura — aceso com
              "0" em toda linha ele deixaria de chamar atenção.
            */}
            <span id={`${id}-actions`} className="d-flex align-items-center gap-2">
              <NotificationsButton
                id={`${id}-unread`}
                count={acesso.unreadNotificationCount}
                onAbrir={() => setNotificacoesAbertas(true)}
                className="br-button circle small"
              />
              <button
                id={`${id}-managers-button`}
                type="button"
                onClick={() => setGestoresAbertos(true)}
                title={t('managers.open')}
                aria-label={t('managers.open')}
                className="br-button circle small"
              >
                <UsersIcon id={`${id}-managers-icon`} />
              </button>
            </span>
          </span>
          <Link
            id={`${id}-name`}
            to={`/repositorios/${acesso.harvesterRepositoryId}`}
            className="text-up-01 text-bold"
          >
            {acesso.name ?? t('repositories.unnamed')}
          </Link>
          {acesso.institutionName ? (
            <span id={`${id}-institution`} className="text-base text-gray-70">
              {acesso.institutionName}
            </span>
          ) : null}
          <span id={`${id}-granted-at`} className="mt-auto pt-3 text-down-01 text-gray-70">
            {t('repositories.grantedAt', {
              date: new Date(acesso.grantedAt).toLocaleDateString(i18n.resolvedLanguage),
            })}
          </span>

          {/*
            O pedido de nova coleta fica no cartão do repositório, que é onde o
            gestor percebe que a coleta está velha — e onde ele acompanha o
            desfecho, sem precisar abrir outra tela.
          */}
          <HarvestRequestButton
            id={`${id}-harvest-request`}
            repositoryId={acesso.harvesterRepositoryId}
            acronym={acesso.acronym}
          />

          <RepositoryManagersModal
            id={`${id}-managers-modal`}
            aberto={gestoresAbertos}
            onFechar={() => setGestoresAbertos(false)}
            repositoryId={acesso.harvesterRepositoryId}
            repositorio={`${acesso.acronym} · ${nomeRepositorio}`}
          />

          <NotificationsPanel
            id={`${id}-notifications-panel`}
            aberto={notificacoesAbertas}
            onFechar={() => setNotificacoesAbertas(false)}
            repositoryId={acesso.harvesterRepositoryId}
            titulo={t('notifications.title')}
            descricao={`${acesso.acronym} · ${nomeRepositorio}`}
          />
        </div>

        {/* Estatísticas da última coleta */}
        <div id={`${id}-stats`} className="col-lg-7 column-divider p-3">
          {acesso.unavailable ? (
            <p
              id={`${id}-stats-unavailable`}
              className="bg-yellow-vivid-5 px-2 py-2 text-base text-gold-vivid-60"
              style={{ borderLeft: '2px solid var(--gold-vivid-60)' }}
            >
              {t('repositories.statsUnavailable')}
            </p>
          ) : acesso.lastHarvest ? (
            <HarvestStats
              id={`${id}-harvest`}
              coleta={acesso.lastHarvest}
              repositoryId={acesso.harvesterRepositoryId}
            />
          ) : (
            <p id={`${id}-stats-none`} className="text-base text-gray-70">
              {t('harvests.none')}
            </p>
          )}
        </div>
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
function IdadeDaColeta({ id, fim, snapshotId }: { id: string; fim: Date; snapshotId: string }) {
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
      id={id}
      to={`/coletas/${snapshotId}`}
      aria-label={t('repositories.openLastHarvest')}
      className="d-block"
    >
      <Tag id={`${id}-tag`} tone={tone}>
        {rotulo}
      </Tag>
    </Link>
  )
}

interface Indicador {
  chave: string
  rotulo: string
  valor: number | null | undefined
  cor: string
  para: string | null
  titulo: string
}

/**
 * Um par rótulo/valor da fileira de indicadores.
 *
 * A altura mínima do valor (`4xh`, 36px) mantém as quatro células iguais: sem
 * ela, cada valor mede o próprio conteúdo e as bases dos números saem
 * desalinhadas — degrau visível numa fileira curta.
 */
function Indicador({
  id,
  item,
  numero,
}: {
  id: string
  item: Indicador
  numero: Intl.NumberFormat
}) {
  const destino = item.para
  const conteudo = item.valor === null || item.valor === undefined ? '—' : numero.format(item.valor)

  return (
    /*
      Cada indicador é um cartão, e o cartão inteiro é o alvo — não só os
      dígitos. Em "Inválidos: 1" o número tinha menos de 10px de largura
      clicável; agora o alvo é o bloco.

      `position: relative` é requisito do `.stretched-link`: sem ele o pseudo se
      estica até o primeiro ancestral posicionado. A classe `hover` só entra
      quando há destino, para o cartão não sugerir clique onde não há.
    */
    <div
      id={id}
      className={`br-card mb-0 ${destino ? 'hover' : ''}`}
      style={{ position: 'relative' }}
    >
      <div id={`${id}-body`} className="card-content p-2">
        <dt id={`${id}-label`} className="eyebrow">
          {item.rotulo}
        </dt>
        <dd
          id={`${id}-value`}
          className={`text-up-02 text-bold d-flex align-items-center mb-0 ${item.cor}`}
          style={{
            fontVariantNumeric: 'tabular-nums',
            minHeight: 'var(--spacing-scale-4xh)',
          }}
        >
          {destino ? (
            <Link
              id={`${id}-link`}
              to={destino}
              title={item.titulo}
              className="inherit-color stretched-link"
            >
              {conteudo}
            </Link>
          ) : (
            conteudo
          )}
        </dd>
      </div>
    </div>
  )
}

function HarvestStats({
  id,
  coleta,
  repositoryId,
}: {
  id: string
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
  const contagensDeRegistro = [
    {
      chave: 'size',
      rotulo: t('diagnosis.size'),
      valor: coleta.size,
      cor: '',
      para: coleta.evaluated ? registros : null,
      titulo: t('repositories.openRecords'),
    },
    {
      chave: 'valid',
      rotulo: t('diagnosis.valid'),
      valor: coleta.validSize,
      cor: tom(coleta.validSize, 'text-green-cool-vivid-50'),
      para: coleta.validSize ? `${registros}?valid=true` : null,
      titulo: t('repositories.openValidRecords'),
    },
    {
      chave: 'invalid',
      rotulo: t('diagnosis.invalid'),
      valor: coleta.invalidSize,
      cor: tom(coleta.invalidSize, 'text-red-vivid-50'),
      para: coleta.invalidSize ? `${registros}?valid=false` : null,
      titulo: t('repositories.openInvalidRecords'),
    },
  ]

  /*
    As violações contam **regras**, não registros — por isso saem da lista
    acima. Os três números de cima somam entre si (válidos + inválidos = total);
    este mede outra coisa, e ficar na mesma fileira sugeria uma relação
    aritmética que não existe.
  */
  const contagensDeRegra = [
    {
      chave: 'violated-rules',
      rotulo: t('repositories.violatedRules'),
      valor: coleta.violatedRuleCount,
      /*
        Amarelo no número, como nos vizinhos verde e vermelho — e não o Alerta
        do padrão, que como texto é ilegível: #ffcd07 (`--yellow-vivid-20`) dá
        1,50 sobre o fundo do cartão. Era por esse 1,50 que o número vinha em
        ficha, onde a cor é preenchimento e não texto.

        Três passos abaixo na mesma família, o `--yellow-vivid-50` (#947100)
        mede **4,28** sobre o #f8f8f8 do cartão. O valor renderiza a 20,16px em
        negrito, que é texto grande para a WCAG (≥18,66px com peso ≥700) e pede
        3:1 — e é o mesmo patamar do verde ao lado, que ali mede 4,32. Medido na
        tela em 17/09/2026.

        Só com violação, como no `tom()` dos outros: pintar "0" de amarelo
        anunciaria como aviso justamente a ausência dele.
      */
      cor: tom(coleta.violatedRuleCount, 'text-yellow-vivid-50'),
      para: coleta.violatedRuleCount ? `/coletas/${coleta.snapshotId}` : null,
      titulo: t('repositories.openDiagnosis'),
    },
  ]

  return (
    <div id={id} className="d-flex flex-column gap-2">
      <div
        id={`${id}-summary`}
        className="d-flex flex-wrap align-items-center"
        style={{ columnGap: 'var(--spacing-scale-2x)', rowGap: 'var(--spacing-scale-half)' }}
      >
        {/*
          O rótulo e o número da coleta viraram um alvo só. Antes o "Última
          coleta" era texto morto e quem clicava era o `#105828` ao lado — um
          alvo de poucos pixels, feito de um número que só quem conhece o
          Harvester reconhece. O botão nomeia o destino e dá área de clique; o
          número saiu do rótulo para o balão, onde identifica a coleta sem
          disputar a leitura com o nome da ação.

          Sem `secondary`: a base do `.br-button` é transparente e sem borda.
          Com o contorno o botão era o elemento mais pesado da linha — 8.226px²,
          quatro vezes a área do selo mais chamativo — e competia com a
          identidade do repositório, que é o que deve ser lido primeiro.

          O estilo do ícone é `fas` (Solid), não `fal` (Light): o Light é
          exclusivo do Font Awesome Pro e o projeto usa o pacote livre. Com
          `fal` a classe não existe, o glifo cai na fonte de texto e sai uma
          caixa vazia; com `far` este ícone específico não tem variante no peso
          400 e não renderiza nada.
        */}
        <Link
          id={`${id}-snapshot-link`}
          to={`/coletas/${coleta.snapshotId}`}
          title={t('repositories.harvestAnalysis', { snapshotId: coleta.snapshotId })}
          className="br-button small px-0"
        >
          <i className="fas fa-file-medical-alt" aria-hidden="true" />
          {t('repositories.lastHarvestAnalysis')}
        </Link>
        {fimValido ? (
          <IdadeDaColeta id={`${id}-age`} fim={fim} snapshotId={coleta.snapshotId} />
        ) : null}
        {/*
          O selo só aparece no que foge do normal. Numa lista de seis
          repositórios todos válidos, ele era seis vezes o mesmo verde — ocupava
          o lugar mais chamativo da linha sem distinguir nada, e disputava
          atenção com a ficha de idade, que é o dado que varia.
        */}
        {estadoExcepcional(coleta.status) ? (
          <HarvestStatusBadge id={`${id}-status`} status={coleta.status as string} />
        ) : null}
        <span id={`${id}-end-time`} className="text-down-01 text-gray-70">
          {fimValido ? dataHora.format(fim) : '—'}
        </span>
        {/*
          Coleta sem indexação não passou por validação: os campos de válidos,
          inválidos e regras vêm vazios, e o aviso explica o porquê uma vez só,
          em vez de repetir "não avaliado" em cada indicador.
        */}
        {coleta.evaluated ? null : (
          <span
            id={`${id}-not-evaluated`}
            className="text-down-01 text-gray-70"
            style={{ fontStyle: 'italic' }}
            title={coleta.indexStatus ?? ''}
          >
            {t('repositories.notEvaluated')}
          </span>
        )}
      </div>

      {/*
        Uma fileira só, em grade de quatro colunas iguais. A separação por
        distância que havia entre contagens de registro e de regra saiu: com
        cada indicador em cartão, é a borda que delimita cada medida, e o vão
        maior no meio virava um buraco sem função.

        Grade, e não flex: em flex cada cartão media o próprio conteúdo, e
        "65.529" ficava com o dobro da largura de "1". A grade dá a mesma
        coluna a todos, o que faz a fileira ler como uma unidade.
      */}
      <dl id={`${id}-indicators-records`} className="indicator-grid mb-0">
        {[...contagensDeRegistro, ...contagensDeRegra].map((item) => (
          <Indicador
            key={item.chave}
            id={`${id}-indicator-${item.chave}`}
            item={item}
            numero={numero}
          />
        ))}
      </dl>

      {coleta.topViolations.length > 0 ? (
        <div id={`${id}-violations`} className="mt-auto">
          <p id={`${id}-violations-label`} className="eyebrow mb-1">
            {t('repositories.topViolations')}
          </p>
          <ul id={`${id}-violations-list`} className="plain-list d-flex flex-column gap-half">
            {coleta.topViolations.map((violacao) => (
              <li id={`${id}-violation-${violacao.ruleId}`} key={violacao.ruleId}>
                {/*
                  A linha inteira é o link — nome, linha pontilhada e contagem.
                  Antes só o nome clicava, num alvo de 45×17px: abaixo dos 24px
                  que a WCAG 2.2 pede, e difícil de acertar no toque. Com o
                  `Link` em `flex` o alvo passa a ocupar a largura da coluna, e
                  a contagem, que é o número que motiva o clique, deixa de ser
                  texto morto ao lado do que se clica.
                */}
                <Link
                  id={`${id}-violation-${violacao.ruleId}-link`}
                  to={`/coletas/${coleta.snapshotId}/registros?invalidRule=${violacao.ruleId}`}
                  title={t('repositories.seeRecords')}
                  className="d-flex align-items-baseline gap-2 text-down-01 py-1"
                >
                  <span id={`${id}-violation-${violacao.ruleId}-name`}>{violacao.name}</span>
                  <span
                    id={`${id}-violation-${violacao.ruleId}-leader`}
                    className="flex-grow-1"
                    style={{ borderBottom: '1px dotted var(--border-color)' }}
                  />
                  <span id={`${id}-violation-${violacao.ruleId}-count`} className="text-gray-70">
                    {numero.format(violacao.invalidCount)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p id={`${id}-history`} className="text-down-01 text-gray-70 mb-0">
        <Link id={`${id}-history-link`} to={`/repositorios/${repositoryId}`}>
          {t('repositories.seeHistory')}
        </Link>
      </p>
    </div>
  )
}
