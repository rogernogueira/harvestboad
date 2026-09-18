import { queryOptions } from '@tanstack/react-query'

import { apiGet, apiGetText } from './api'
import { filtersToParams, type RecordFilters } from './filters'
import type {
  AvailableRepositoryPage,
  Diagnosis,
  HarvestDetail,
  HarvestList,
  NotificationItem,
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
export const unreadNotificationsQuery = queryOptions({
  queryKey: ['notifications', 'unread-count'],
  queryFn: () => apiGet<{ unread: number }>('/notifications/unread-count/'),
})
