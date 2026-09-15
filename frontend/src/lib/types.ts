export type Profile = 'ADMIN' | 'GESTOR'

export interface User {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  profile: Profile
  profileDisplay: string
  mustChangePassword: boolean
  lastLogin: string | null
}

export interface TokenPair {
  access: string
  refresh: string
  user: User
}

/** Envelope de paginação do DRF. */
export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface RepositoryAccess {
  id: number
  user: number
  username: string
  harvesterRepositoryId: string
  acronym: string
  acronymIsStale: boolean
  name: string | null
  institutionName: string | null
  grantedAt: string
}

/** Gestor vinculado a um repositório. `email` só vem para o perfil ADMIN. */
export interface RepositoryManager {
  id: number
  user: number
  username: string
  fullName: string
  email: string | null
  profile: Profile
  profileDisplay: string
  isActive: boolean
  grantedAt: string
}

export interface RepositoryManagerList {
  count: number
  results: RepositoryManager[]
}

export interface RuleViolation {
  ruleId: number
  name: string
  invalidCount: number
}

/** Estatísticas da última coleta, usadas no painel de repositórios. */
export interface LastHarvestSummary {
  snapshotId: string
  status: string | null
  endTime: string | null
  size: number | null
  validSize: number | null
  invalidSize: number | null
  transformedSize: number | null
  violatedRuleCount: number | null
  topViolations: RuleViolation[]
}

export interface RepositoryAccessSummary {
  id: number
  harvesterRepositoryId: string
  acronym: string
  name: string | null
  institutionName: string | null
  grantedAt: string
  lastHarvest: LastHarvestSummary | null
  /** O Harvester não respondeu por este repositório nesta requisição. */
  unavailable: boolean
}

export interface RepositoryAccessSummaryList {
  count: number
  results: RepositoryAccessSummary[]
}

/** Repositório disponível no Harvester, para o ADMIN escolher ao vincular. */
export interface AvailableRepository {
  harvesterRepositoryId: string
  acronym: string | null
  name: string | null
  institutionName: string | null
  published: boolean | null
}

/** Linha da busca de repositórios: cadastro + resumo da última coleta. */
export interface RepositoryHit {
  harvesterRepositoryId: string
  acronym: string | null
  name: string | null
  institutionName: string | null
  institutionAcronym: string | null
  lastSnapshotId: string | null
  lastSnapshotDate: string | null
  lastSnapshotStatus: string | null
  lastSize: number | null
  lastValidSize: number | null
}

export interface BulkLinkResult {
  user: number
  username: string
  createdCount: number
  skippedCount: number
  created: { id: number; harvesterRepositoryId: string; acronym: string }[]
  skipped: { harvesterRepositoryId: string; reason: string }[]
}

export interface RepositorySearchResult {
  query: string
  /** Campo em que a origem encontrou: sigla, nome ou instituição. */
  field: 'acronym' | 'name' | 'institution' | null
  page: number
  count: number
  totalElements: number
  totalPages: number
  results: RepositoryHit[]
}

export interface AvailableRepositoryPage {
  page: { totalElements?: number; totalPages?: number; number?: number; size?: number }
  results: AvailableRepository[]
}

export interface Repository {
  harvesterRepositoryId: string
  acronym: string | null
  name: string | null
  institutionAcronym: string | null
  institutionName: string | null
  metadataPrefix: string | null
  metadataStoreSchema: string | null
  oaiSource: string | null
  published: boolean | null
}

export type HarvestStatus = string

export interface Harvest {
  snapshotId: string
  status: HarvestStatus
  indexStatus: string | null
  startTime: string | null
  endTime: string | null
  lastIncrementalTime: string | null
  size: number | null
  validSize: number | null
  transformedSize: number | null
  deleted: boolean | null
  previousSnapshotId: string | null
}

export interface HarvestDetail extends Harvest {
  repository: {
    harvesterRepositoryId: string
    acronym: string | null
    name: string | null
    institutionName: string | null
  }
}

export interface HarvestList {
  harvesterRepositoryId: string
  count: number
  results: Harvest[]
}

export interface FacetValue {
  value: string
  valueCount: number
}

export interface Diagnosis {
  snapshotId: string
  size: number | null
  validSize: number | null
  invalidSize: number | null
  transformedSize: number | null
  ruleCount: number
  facets: Record<string, FacetValue[]> | null
}

export interface Rule {
  ruleId: number
  name: string
  description: string
  quantifier: string
  mandatory: boolean
  validCount: number | null
  invalidCount: number | null
}

export interface RuleList {
  snapshotId: string
  count: number
  results: Rule[]
}

export interface Occurrence {
  value: string | null
  count: number | null
}

export interface RuleOccurrences {
  snapshotId: string
  ruleId: string
  validTotal: number
  invalidTotal: number
  valid: Occurrence[]
  invalid: Occurrence[]
}

export interface RecordItem {
  id: string
  identifier: string
  snapshotID?: number
  origin?: string | null
  setSpec?: string | null
  metadataPrefix?: string | null
  networkAcronym?: string | null
  repositoryName?: string | null
  institutionName?: string | null
  isValid?: boolean | null
  isTransformed?: boolean | null
  validOccurrencesByRuleID?: Record<string, unknown> | null
  invalidOccurrencesByRuleID?: Record<string, unknown> | null
}

/** Eco dos filtros aplicados, devolvido pelo backend. */
export interface AppliedFilters {
  valid: string | null
  transformed: string | null
  validRule: string[]
  invalidRule: string[]
}

export interface RecordPage {
  snapshotId: string
  page: number
  count: number
  totalElements: number | null
  totalPages: number | null
  filters: AppliedFilters
  results: RecordItem[]
}
