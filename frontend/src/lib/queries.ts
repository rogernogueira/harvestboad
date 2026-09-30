import { queryOptions } from '@tanstack/react-query'

import { apiGet, apiGetText } from './api'
import { filtersToParams, type RecordFilters } from './filters'
import type {
  HarvestRequestItem,
  AvailableRepositoryPage,
  Diagnosis,
  HarvestDetail,
  HarvestList,
  LinkedHarvests,
  NotificationCategoryItem,
  NotificationItem,
  NotificationTemplateItem,
  Paginated,
  RecordItem,
  RecordLink,
  RecordPage,
  Repository,
  RepositoryAccess,
  RepositoryAccessSummaryList,
  RepositoryIndex,
  RepositoryManagerList,
  RepositorySearchResult,
  RuleList,
  RuleOccurrences,
  User,
} from './types'

export const myRepositoriesQuery = queryOptions({
  queryKey: ['repositories', 'mine'],
  queryFn: () => apiGet<Paginated<RepositoryAccess>>('/repositories/accesses/'),
})

/**
 * Painel de repositórios com estatísticas da última coleta.
 *
 * O backend compõe histórico, diagnóstico e regras numa resposta só; montar
 * isso no cliente seriam três requisições por repositório contra uma origem
 * instável. Em compensação, a primeira carga é lenta — daí o staleTime longo.
 */
export const repositoriesSummaryQuery = queryOptions({
  queryKey: ['repositories', 'summary'],
  queryFn: () => apiGet<RepositoryAccessSummaryList>('/repositories/summary/'),
  staleTime: 5 * 60_000,
})

/** Todos os vínculos (ADMIN) — a mesma rota devolve só os próprios ao gestor. */
export const allAccessesQuery = queryOptions({
  queryKey: ['accesses', 'all'],
  queryFn: () => apiGet<Paginated<RepositoryAccess>>('/repositories/accesses/'),
})

/** Contas de gestor, para escolher a quem conceder acesso. Exclusivo do ADMIN. */
export const gestoresQuery = (search: string) =>
  queryOptions({
    queryKey: ['users', 'gestores', search],
    queryFn: () => {
      const params = new URLSearchParams({ profile: 'GESTOR', active: 'true' })
      if (search) params.set('search', search)
      return apiGet<Paginated<User>>(`/accounts/users/?${params}`)
    },
  })

/**
 * Acervo inteiro do Harvester. Exclusivo do ADMIN.
 *
 * São ~960 KB para 2.181 repositórios, buscados uma vez e mantidos por bastante
 * tempo: é o que permite ordenar e filtrar a tabela de administração sem ida ao
 * servidor. O backend já tem o índice em cache, então o custo aqui é só tráfego.
 */
export const repositoryIndexQuery = queryOptions({
  queryKey: ['repositories', 'index'],
  queryFn: () => apiGet<RepositoryIndex>('/repositories/accesses/index/'),
  staleTime: 30 * 60_000,
})

/**
 * Busca de repositórios no Harvester. Exclusivo do ADMIN.
 *
 * Sem termo, o backend devolve o acervo inteiro ordenado pelo percentual de
 * registros inválidos — é o que o painel de administração mostra ao abrir. A
 * tela de acessos, que quer um repositório específico, desliga a consulta sem
 * termo passando `enabled` por fora.
 */
export const repositorySearchQuery = (term: string, page: number, count = 10) =>
  queryOptions({
    queryKey: ['repositories', 'search', term, page, count],
    queryFn: () =>
      apiGet<RepositorySearchResult>(
        `/repositories/accesses/search/?search=${encodeURIComponent(term)}&page=${page}&count=${count}`,
      ),
    staleTime: 5 * 60_000,
  })

/**
 * Gestores vinculados a um repositório, para quem já tem acesso a ele.
 *
 * Diferente de `accessesByRepositoryQuery`, que ao gestor devolve só o próprio
 * vínculo: esta lista todos os que cuidam do repositório.
 */
export const repositoryManagersQuery = (repositoryId: string) =>
  queryOptions({
    queryKey: ['repository', repositoryId, 'managers'],
    queryFn: () => apiGet<RepositoryManagerList>(`/repositories/${repositoryId}/managers`),
    enabled: repositoryId.length > 0,
  })

/** Gestores com acesso a um repositório (rota de administração). */
export const accessesByRepositoryQuery = (repositoryId: string) =>
  queryOptions({
    queryKey: ['accesses', 'repository', repositoryId],
    queryFn: () =>
      apiGet<Paginated<RepositoryAccess>>(
        `/repositories/accesses/?repository=${encodeURIComponent(repositoryId)}`,
      ),
    enabled: repositoryId.length > 0,
  })

/** Repositórios do Harvester disponíveis para vínculo. Exclusivo do ADMIN. */
export const availableRepositoriesQuery = (page: number, size: number) =>
  queryOptions({
    queryKey: ['repositories', 'available', page, size],
    queryFn: () =>
      apiGet<AvailableRepositoryPage>(
        `/repositories/accesses/available/?page=${page}&size=${size}`,
      ),
  })

export const repositoryQuery = (id: string) =>
  queryOptions({
    queryKey: ['repository', id],
    queryFn: () => apiGet<Repository>(`/repositories/${id}`),
  })

export const repositoryHarvestsQuery = (id: string) =>
  queryOptions({
    queryKey: ['repository', id, 'harvests'],
    queryFn: () => apiGet<HarvestList>(`/repositories/${id}/harvests`),
  })

/**
 * Coletas de todos os repositórios vinculados, para a seção Coleta.
 *
 * Vem inteira, sem filtro de repositório: as duas abas e o seletor de
 * repositório recortam no navegador. Um gestor tem poucos repositórios, e
 * cada um custa uma ida ao Harvester no backend — pedir de novo a cada troca
 * de seletor repetiria essa espera por um recorte que já está em memória.
 */
export const linkedHarvestsQuery = queryOptions({
  queryKey: ['repositories', 'harvests'],
  queryFn: () => apiGet<LinkedHarvests>('/repositories/harvests/'),
  staleTime: 5 * 60_000,
})

export const harvestQuery = (snapshotId: string) =>
  queryOptions({
    queryKey: ['harvest', snapshotId],
    queryFn: () => apiGet<HarvestDetail>(`/harvests/${snapshotId}`),
  })

export const diagnosisQuery = (snapshotId: string) =>
  queryOptions({
    queryKey: ['harvest', snapshotId, 'diagnosis'],
    queryFn: () => apiGet<Diagnosis>(`/harvests/${snapshotId}/diagnosis`),
  })

export const rulesQuery = (snapshotId: string) =>
  queryOptions({
    queryKey: ['harvest', snapshotId, 'rules'],
    queryFn: () => apiGet<RuleList>(`/harvests/${snapshotId}/rules`),
  })

/**
 * Ocorrências de uma regra, no mesmo recorte da tela.
 *
 * Os filtros seguem junto porque a origem os aplica também aqui: sem eles as
 * contagens do modal seriam as da coleta inteira e discordariam do número em
 * que o usuário clicou.
 */
export const occurrencesQuery = (snapshotId: string, ruleId: string, filters: RecordFilters) => {
  const params = filtersToParams(filters)
  const query = params.toString()
  return queryOptions({
    queryKey: ['harvest', snapshotId, 'rules', ruleId, 'occurrences', query],
    queryFn: () =>
      apiGet<RuleOccurrences>(
        `/harvests/${snapshotId}/rules/${ruleId}/occurrences${query ? `?${query}` : ''}`,
      ),
  })
}

export const recordsQuery = (
  snapshotId: string,
  page: number,
  count: number,
  filters: RecordFilters,
) => {
  const params = filtersToParams(filters)
  params.set('page', String(page))
  params.set('count', String(count))
  return queryOptions({
    queryKey: ['harvest', snapshotId, 'records', page, count, params.toString()],
    queryFn: () => apiGet<RecordPage>(`/harvests/${snapshotId}/records?${params}`),
  })
}

/**
 * O identificador OAI contém "/" e o backend o espera cru no caminho — o
 * conversor `path` do Django o recebe inteiro.
 *
 * Os filtros da listagem seguem junto: o id interno do registro nem sempre é
 * derivável, e nesse caso o backend varre páginas. Chegando pelo mesmo recorte
 * da tela, essa varredura fica pequena.
 */
export const recordQuery = (snapshotId: string, identifier: string, filters: RecordFilters) => {
  const params = filtersToParams(filters)
  const query = params.toString()
  return queryOptions({
    queryKey: ['harvest', snapshotId, 'record', identifier, query],
    queryFn: () =>
      apiGet<RecordItem>(
        `/harvests/${snapshotId}/records/${identifier}${query ? `?${query}` : ''}`,
      ),
  })
}

export const recordXmlQuery = (snapshotId: string, identifier: string) =>
  queryOptions({
    queryKey: ['harvest', snapshotId, 'record', identifier, 'xml'],
    queryFn: () => apiGetText(`/harvests/${snapshotId}/records/${identifier}/xml`),
    retry: false,
  })

/**
 * Endereço público do registro no repositório de origem.
 *
 * `baseUrl` vem do próprio registro (`origin`), não de um cadastro nosso: é a
 * origem que o Harvester coletou, e é contra ela que o `GetRecord` precisa ir.
 *
 * `retry: false` porque o backend já responde 200 com o motivo quando a origem
 * não colabora — repetir aqui só atrasaria a tela. E a resolução é estável o
 * bastante (o backend cacheia por 24 h) para um `staleTime` longo.
 */
export const recordLinkQuery = (oaiId: string, baseUrl: string, prefix?: string | null) => {
  const params = new URLSearchParams({ oaiId, baseUrl })
  if (prefix) params.set('prefix', prefix)
  return queryOptions({
    queryKey: ['record-link', oaiId, baseUrl, prefix ?? ''],
    queryFn: () => apiGet<RecordLink>(`/oai/record-link?${params}`),
    enabled: oaiId.length > 0 && baseUrl.length > 0,
    staleTime: 30 * 60_000,
    retry: false,
  })
}

/**
 * Notificações visíveis para quem pergunta.
 *
 * Sem `repository`, a resposta é a caixa de entrada: os recados diretos mais os
 * dos repositórios que a pessoa gerencia. Com ele, são as de um repositório só
 * — e aí o backend exige o vínculo.
 */
export const notificationsQuery = (
  opcoes: {
    repository?: string
    unread?: boolean
    sent?: boolean
  } = {},
) => {
  const params = new URLSearchParams()
  if (opcoes.repository) params.set('repository', opcoes.repository)
  if (opcoes.unread) params.set('unread', 'true')
  if (opcoes.sent) params.set('sent', 'true')
  const query = params.toString()

  return queryOptions({
    queryKey: [
      'notifications',
      'list',
      opcoes.repository ?? '',
      opcoes.unread ?? false,
      opcoes.sent ?? false,
    ],
    queryFn: () =>
      apiGet<Paginated<NotificationItem>>(`/notifications/${query ? `?${query}` : ''}`),
  })
}

/**
 * Só o número do sino.
 *
 * Existe para o cabeçalho não baixar a lista inteira a cada tela: o painel só
 * consulta quando é aberto.
 */
/**
 * Catálogo de categorias, ativas e inativas.
 *
 * Vem inteiro porque a tela precisa nomear o selo de uma notificação antiga
 * cuja categoria saiu de circulação; quem filtra por `active` é o formulário de
 * envio. Muda pouco, então o `staleTime` é longo.
 */
export const notificationCategoriesQuery = queryOptions({
  queryKey: ['notifications', 'categories'],
  queryFn: () => apiGet<NotificationCategoryItem[]>('/notifications/categories/'),
  staleTime: 30 * 60_000,
})

/** Textos padrão de uma categoria. Só consulta depois de escolhida. */
export const notificationTemplatesQuery = (categoryId: number | null) =>
  queryOptions({
    queryKey: ['notifications', 'templates', categoryId ?? 0],
    queryFn: () =>
      apiGet<NotificationTemplateItem[]>(`/notifications/templates/?category=${categoryId}`),
    enabled: categoryId !== null,
    staleTime: 30 * 60_000,
  })

/**
 * A caixa de entrada de quem pergunta, paginada.
 *
 * Mesmo recorte de `notificationsQuery()` sem argumento — recados diretos mais
 * os avisos dos repositórios que a pessoa gerencia —, só que com página: a
 * modal do sino mostra a primeira leva e basta, enquanto a aba da seção é onde
 * se procura o que já foi lido, e aí a lista cresce sem teto.
 *
 * A chave é separada da de `['notifications', 'list', …]` de propósito: as duas
 * consultam a mesma rota, mas com recortes diferentes de página, e compartilhar
 * a chave faria uma servir o cache da outra truncado.
 */
export const inboxNotificationsQuery = (page: number, count: number) =>
  queryOptions({
    queryKey: ['notifications', 'inbox', page, count],
    queryFn: () =>
      apiGet<Paginated<NotificationItem>>(`/notifications/?page=${page}&count=${count}`),
  })

/**
 * O que o usuário enviou, para a tela de gestão do administrador.
 *
 * Pagina no servidor, como os registros e a busca de acessos: o administrador
 * que envia em lote acumula centenas de avisos, e a lista não tem outro uso que
 * pedisse o conjunto inteiro em memória — não alimenta gráfico nem exportação.
 */
export const sentNotificationsQuery = (page: number, count: number) =>
  queryOptions({
    queryKey: ['notifications', 'sent', page, count],
    queryFn: () =>
      apiGet<Paginated<NotificationItem>>(`/notifications/?sent=true&page=${page}&count=${count}`),
  })

/**
 * Avisos que exigem visto e seguem sem leitura.
 *
 * Alimenta a modal que o gestor não consegue dispensar de passagem, e por isso
 * pede a lista, não só o número: é o conteúdo do aviso que vai à tela.
 *
 * O recorte por `requiresAcknowledgement` acontece no cliente porque a rota não
 * oferece o filtro — e cabe: o conjunto de não lidas é pequeno por construção,
 * já que a leitura é compartilhada e zera o item para todos os gestores do
 * repositório de uma vez. O `count=200` é o teto da rota, e existe como
 * salvaguarda para o caso de a caixa crescer, não como expectativa.
 */
export const pendingAcknowledgementQuery = queryOptions({
  queryKey: ['notifications', 'pending-ack'],
  queryFn: () => apiGet<Paginated<NotificationItem>>('/notifications/?unread=true&count=200'),
})

export const unreadNotificationsQuery = queryOptions({
  queryKey: ['notifications', 'unread-count'],
  queryFn: () => apiGet<{ unread: number }>('/notifications/unread-count/'),
})

/**
 * Demandas de coleta.
 *
 * Sem filtro, o ADMIN recebe todas e o gestor as dos repositórios que gerencia
 * — o recorte é do backend. `repository` serve ao cartão do repositório, que
 * mostra só a dele.
 */
export const harvestRequestsQuery = (
  filtros: { repository?: string; status?: string; page?: number; count?: number } = {},
) => {
  const params = new URLSearchParams()
  if (filtros.repository) params.set('repository', filtros.repository)
  if (filtros.status) params.set('status', filtros.status)
  // Página e tamanho só entram quando a tela os controla. O cartão do
  // repositório consulta a mesma rota para saber se há demanda pendente, e ali
  // não há paginação nenhuma a informar — mandar `page=1` fixo mudaria a chave
  // de cache sem mudar a pergunta.
  if (filtros.page) params.set('page', String(filtros.page))
  if (filtros.count) params.set('count', String(filtros.count))
  const query = params.toString()

  return queryOptions({
    queryKey: [
      'demands',
      filtros.repository ?? '',
      filtros.status ?? '',
      filtros.page ?? 0,
      filtros.count ?? 0,
    ],
    queryFn: () => apiGet<Paginated<HarvestRequestItem>>(`/demands/${query ? `?${query}` : ''}`),
  })
}
