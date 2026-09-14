import { queryOptions } from '@tanstack/react-query'

import { apiGet, apiGetText } from './api'
import { filtersToParams, type RecordFilters } from './filters'
import type {
  Diagnosis,
  HarvestDetail,
  HarvestList,
  Paginated,
  RecordItem,
  RecordPage,
  Repository,
  RepositoryAccess,
  RuleList,
  RuleOccurrences,
} from './types'

export const myRepositoriesQuery = queryOptions({
  queryKey: ['repositories', 'mine'],
  queryFn: () => apiGet<Paginated<RepositoryAccess>>('/repositories/accesses/'),
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
    queryFn: () =>
      apiGet<RuleOccurrences>(`/harvests/${snapshotId}/rules/${ruleId}/occurrences`),
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
