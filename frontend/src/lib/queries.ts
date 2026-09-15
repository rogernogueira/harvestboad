import { queryOptions } from '@tanstack/react-query'

import { apiGet, apiGetText } from './api'
import { filtersToParams, type RecordFilters } from './filters'
import type {
  AvailableRepositoryPage,
  Diagnosis,
  HarvestDetail,
  HarvestList,
  Paginated,
  RecordItem,
  RecordPage,
  Repository,
  RepositoryAccess,
  RepositoryAccessSummaryList,
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
 * Busca de repositórios no Harvester. Exclusivo do ADMIN.
 *
 * Só dispara com termo: são 2.181 repositórios na origem, e listar todos de
 * saída não ajuda quem sabe o que procura — além de custar uma consulta a uma
 * origem instável a cada abertura da tela.
 */
export const repositorySearchQuery = (term: string, page: number, count = 10) =>
  queryOptions({
    queryKey: ['repositories', 'search', term, page, count],
    queryFn: () =>
      apiGet<RepositorySearchResult>(
        `/repositories/accesses/search/?search=${encodeURIComponent(term)}&page=${page}&count=${count}`,
      ),
    enabled: term.trim().length > 0,
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

export const occurrencesQuery = (snapshotId: string, ruleId: string) =>
  queryOptions({
    queryKey: ['harvest', snapshotId, 'rules', ruleId, 'occurrences'],
    queryFn: () => apiGet<RuleOccurrences>(`/harvests/${snapshotId}/rules/${ruleId}/occurrences`),
  })

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
