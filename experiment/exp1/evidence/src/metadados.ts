import { METADADOS, embutido } from './duckdb'

export type Estatistica = {
  teste: string
  H?: number
  gl?: number
  p?: number
  n?: number
  grupos?: number
  efeito_nome?: string
  efeito?: number
  [k: string]: unknown
}

export type Hipotese = {
  id: string
  statement: string
  veredito: string
  verdict_label: string
  populacao: string
  unidade: string
  cobertura_temporal: string
  variavel_dependente: string
  variavel_independente: string
  confundidores: string[]
  inclusao: string
  exclusao: string
  estatistica: Estatistica
  ic95: [number, number] | null
  grupos_rotulos?: string[]
  medianas?: Record<string, number>
  contraste?: {
    par: string
    mediana_a: number
    mediana_b: number
    efeito_nome: string
    efeito: number
    ic95: [number, number]
  }
  confundimento?: { nome: string; rho: number; p: number }
  sobredispersao?: number
  distribuicao?: Record<string, number>
  concentracao?: { instituicoes: number; fontes: number; maior: number; media: number }
  conflito?: string
  sensibilidade: { recorte: string; n: number; grupos: number; efeito: number; p: number }[]
  identificacao: string
}

export type Protocolo = {
  checklist: { item: string; situacao: string; evidencia: string; ressalva?: string }[]
  criterios: { nome: string; pergunta: string; situacao: string; texto: string }[]
  semente: number
  reamostragens: number
  permutacoes: number
}

export type CampoCodebook = {
  field: string
  type: string
  dtype: string
  requirement: string
  vocabulary: string | null
  condition: string | null
  max_length: number | null
}

export type Dataset = {
  dataset_id: string
  title: string
  subtitle: string
  exported_at: string
  reference_date: string
  repositories: number
  records_last_snapshot: number
  valid_records_last_snapshot: number
  transformed_records_last_snapshot: number
  snapshots_total: number
  dataset_status: string
  schema_version: string
  version: string
  publisher: string
  license: string
  spatial_coverage: string
  unit_of_observation: string
  tables: { name: string; rows: number; columns: number; bytes: number }[]
}

export type Proveniencia = {
  source: Record<string, string | number>
  extraction: Record<string, string>
  collected_at: Record<string, string>
  sources: { name: string; kind: string; provides: string; note?: string }[]
  pipeline: { step: string; scripts: string[] }[]
  limitations: string[]
  reproducibility: { invariant: string; verify: string }
}

export type Hints = Record<string, { descricao: string; colunas: Record<string, string> }>

export type Vocabularios = Record<string, { field: string; terms: { code: string; label: string }[] }>

export type Pacote = {
  dataset: Dataset
  codebook: CampoCodebook[]
  vocabularies: Vocabularios
  hypotheses: Hipotese[]
  provenance: Proveniencia
  protocol: Protocolo
  hints: Hints
  checksums: string
}

let pacote: Promise<Pacote> | null = null

export function metadados(): Promise<Pacote> {
  const url = (c: string) => new URL(c, document.baseURI).href
  const pronto = embutido()
  if (pronto) return (pacote ??= Promise.resolve({ ...pronto.metadata, checksums: pronto.checksums } as Pacote))
  pacote ??= Promise.all([
    ...METADADOS.map((n) =>
      fetch(url(`metadata/${n}.json`))
        .then((r) => r.json())
        .then((v) => [n, v] as const),
    ),
    fetch(url('metadata/checksums.sha256'))
      .then((r) => r.text())
      .then((v) => ['checksums', v] as const),
  ]).then((pares) => Object.fromEntries(pares)) as Promise<Pacote>
  return pacote
}
