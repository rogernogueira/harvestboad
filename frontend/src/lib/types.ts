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
  /** Estado da indexação; só `INDEXED` tem diagnóstico e, portanto, inválidos. */
  indexStatus: string | null
  /** Falso quando a coleta não foi indexada: não há o que contar como inválido. */
  evaluated: boolean
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
  /** Notificações do repositório ainda sem leitura. */
  unreadNotificationCount: number
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
  lastTransformedSize: number | null
  /** `INDEXED` é a condição para haver diagnóstico e registros. */
  lastIndexStatus: string | null
  /** Quantos gestores estão vinculados — dado nosso, não da origem. */
  managerCount: number
  /** Notificações do repositório ainda sem leitura — também dado nosso. */
  unreadNotificationCount: number
  /** Fração de inválidos na última coleta (0 a 1). Nulo sem coleta. */
  invalidRatio?: number | null
  invalidSize?: number | null
}

export interface BulkLinkResult {
  user: number
  username: string
  createdCount: number
  skippedCount: number
  created: { id: number; harvesterRepositoryId: string; acronym: string }[]
  skipped: { harvesterRepositoryId: string; reason: string }[]
}

/** Acervo inteiro, para ordenar e filtrar no navegador. */
export interface RepositoryIndex {
  count: number
  results: RepositoryHit[]
}

export interface RepositorySearchResult {
  query: string
  /** Presente quando a listagem vem ordenada por critério calculado. */
  ordering?: 'invalidRatio'
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

/**
 * Ocorrências de uma regra, agrupadas por valor.
 *
 * Os totais são a soma dos valores listados, e a origem corta a lista em 1.000
 * — daí os sinalizadores: com `true`, o total acima é o da lista cortada, não
 * o da coleta.
 */
export interface RuleOccurrences {
  snapshotId: string
  ruleId: string
  validTotal: number
  invalidTotal: number
  validTruncated: boolean
  invalidTruncated: boolean
  filters: AppliedFilters
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
  /*
   * Resultado da validação regra a regra, como a origem devolve no próprio
   * registro — é o que alimenta o modal de detalhes sem uma segunda ida ao
   * Harvester. Os ids vêm como string, embora `Rule.ruleId` seja número.
   *
   * As duas listas não particionam as regras: uma regra pode estar em
   * `validRulesID` e ainda ter entrada em `invalidOccurrencesByRuleID` — é o
   * caso das condicionais, em que o campo ausente não invalida o registro mas
   * fica registrado como ocorrência.
   */
  validRulesID?: string[] | null
  invalidRulesID?: string[] | null
  validOccurrencesByRuleID?: Record<string, string[]> | null
  invalidOccurrencesByRuleID?: Record<string, string[]> | null
}

/**
 * Endereço público do registro, resolvido pelo backend no OAI-PMH da origem.
 *
 * `link` nulo não é erro: a rota responde 200 e `reason` diz se a origem não
 * respondeu (`unreachable`), se o metadado não trazia endereço utilizável
 * (`no-usable-url`) ou se o próprio OAI recusou (`oai-error:<código>`).
 */
export interface RecordLink {
  oaiId: string
  link: string | null
  source: string | null
  reason: string | null
  candidates: string[]
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

/**
 * Categoria cadastrada, com os três nomes.
 *
 * O backend manda os três e a tela escolhe: quem sabe o idioma ativo é o
 * i18next, e resolver no servidor obrigaria a propagar `Accept-Language` por
 * toda chamada. Use `nomeDaCategoria` de `lib/categorias`.
 */
export interface NotificationCategoryItem {
  id: number
  slug: string
  namePtBr: string
  nameEs: string
  nameEn: string
  /** Desativada sai do formulário de envio, mas segue nomeando o histórico. */
  active: boolean
}

/** Texto padrão de uma categoria. Um idioma só, como o aviso que ele preenche. */
export interface NotificationTemplateItem {
  id: number
  category: number
  label: string
  title: string
  message: string
  active: boolean
}

/**
 * Um aviso do administrador.
 *
 * O nome não é `Notification` de propósito: esse já existe como tipo global do
 * `lib.dom` (a API de notificação do navegador), e a colisão passa despercebida
 * até alguém importar o errado.
 *
 * `harvesterRepositoryId` vem vazio no recado direto, e `recipient` vem nulo na
 * notificação de repositório — nunca os dois preenchidos.
 */
export interface NotificationItem {
  id: number
  title: string
  message: string
  category: NotificationCategoryItem
  harvesterRepositoryId: string
  acronym: string
  recipient: number | null
  recipientUsername?: string
  authorUsername?: string
  createdAt: string
  /** A leitura é compartilhada: lida por um gestor, lida para todos. */
  read: boolean
  readAt: string | null
  readByUsername?: string
  /** Não se dispensa de passagem: exige um botão de confirmação na tela. */
  requiresAcknowledgement: boolean
  /**
   * Gestores que ainda não deram o visto. Só vem na listagem do que foi
   * enviado; nas outras rotas é `null`.
   *
   * Como o visto é compartilhado, a lista é tudo ou nada: ou ninguém viu — e
   * todos os gestores do repositório constam — ou alguém viu e ela é vazia.
   */
  pendingManagers: string[] | null
}
