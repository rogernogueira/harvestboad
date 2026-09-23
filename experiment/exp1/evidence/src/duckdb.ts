import * as duckdb from '@duckdb/duckdb-wasm'

/** Tabelas congeladas, registradas como views de mesmo nome. */
export const TABELAS = [
  'repositories',
  'snapshots',
  'platforms',
  'platform_evidence',
  'harvest_metrics',
  'repository_summary',
] as const

/**
 * Tabelas do nível de registro. São opcionais: quem baixa só a Base 1 abre o
 * painel sem elas, e as abas Dimensões, Repositórios e Instituições não aparecem.
 */
export const TABELAS_REGISTRO = ['records', 'record_values', 'record_metrics', 'record_harvest'] as const

let temRegistros = false
export const comRegistros = () => temRegistros

/**
 * As 15 regras OpenAIRE avaliadas por registro. Camada à parte da de registro
 * porque é a mais pesada do pacote — 4,4 milhões de linhas — e a única que só
 * uma aba usa: se faltar, some a aba Metadados e nada mais.
 */
export const TABELAS_METADADO = ['metadata_rules', 'record_metadata'] as const

let temMetadados = false
export const comMetadados = () => temMetadados

export const METADADOS = [
  'dataset',
  'codebook',
  'vocabularies',
  'hypotheses',
  'provenance',
  'protocol',
  'hints',
] as const

const url = (caminho: string) => new URL(caminho, document.baseURI).href

type Embutido = {
  parquet: Record<string, string>
  metadata: Record<string, unknown>
  checksums: string
  sql: string
  sqlRegistros?: string
}
export const embutido = (): Embutido | null =>
  (window as unknown as { __EVIDENCE__?: Embutido }).__EVIDENCE__ ?? null

const bytesDeBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

let conexao: Promise<duckdb.AsyncDuckDBConnection> | null = null
let banco: duckdb.AsyncDuckDB | null = null

async function abrir(): Promise<duckdb.AsyncDuckDBConnection> {
  // O binário do DuckDB tem 33 MB e não cabe no limite por arquivo do
  // publicador, então vem do jsDelivr — que é a via documentada do
  // duckdb-wasm e a única origem de script permitida aqui além do cdnjs.
  const pacotes = duckdb.getJsDelivrBundles()
  const pacote = await duckdb.selectBundle(pacotes)

  // O worker precisa ser de mesma origem; o blob com importScripts é o
  // contorno padrão para carregá-lo de um CDN.
  const ponte = URL.createObjectURL(
    new Blob([`importScripts("${pacote.mainWorker!}");`], { type: 'text/javascript' }),
  )
  const worker = new Worker(ponte)
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker)
  banco = db
  await db.instantiate(pacote.mainModule, pacote.pthreadWorker)
  URL.revokeObjectURL(ponte)

  const pronto = embutido()
  await Promise.all(
    TABELAS.map(async (t) => {
      const b64 = pronto?.parquet[t] ?? (await buscarTexto(`data/${t}.parquet.txt`))
      db.registerFileBuffer(`${t}.parquet`, bytesDeBase64(b64))
    }),
  )

  const c = await db.connect()
  for (const t of TABELAS) {
    await c.query(`CREATE OR REPLACE VIEW ${t} AS SELECT * FROM read_parquet('${t}.parquet')`)
  }
  // A camada analítica é um arquivo versionado junto do dataset: quem baixa o
  // pacote roda exatamente as mesmas definições que o painel mostra.
  await c.query(pronto?.sql ?? (await buscarTexto('sql/views.sql')))

  // As de registro entram só se as três tabelas chegarem. Falha aqui não
  // derruba o painel — tira uma aba.
  try {
    const partes = await Promise.all(
      TABELAS_REGISTRO.map(async (t) => {
        const b64 = pronto?.parquet[t] ?? (await buscarTexto(`data/${t}.parquet.txt`))
        return [t, bytesDeBase64(b64)] as const
      }),
    )
    for (const [t, bytes] of partes) {
      db.registerFileBuffer(`${t}.parquet`, bytes)
      await c.query(`CREATE OR REPLACE VIEW ${t} AS SELECT * FROM read_parquet('${t}.parquet')`)
    }
    await c.query(pronto?.sqlRegistros ?? (await buscarTexto('sql/views-registros.sql')))
    temRegistros = true
  } catch {
    temRegistros = false
  }

  try {
    const partes = await Promise.all(
      TABELAS_METADADO.map(async (t) => {
        const b64 = pronto?.parquet[t] ?? (await buscarTexto(`data/${t}.parquet.txt`))
        return [t, bytesDeBase64(b64)] as const
      }),
    )
    for (const [t, bytes] of partes) {
      db.registerFileBuffer(`${t}.parquet`, bytes)
      await c.query(`CREATE OR REPLACE VIEW ${t} AS SELECT * FROM read_parquet('${t}.parquet')`)
    }
    temMetadados = true
  } catch {
    temMetadados = false
  }

  return c
}

async function buscarTexto(caminho: string): Promise<string> {
  const r = await fetch(url(caminho))
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`)
  return r.text()
}

/**
 * Os valores de `record_metadata_values` de uma fonte, sob demanda.
 *
 * A tabela inteira tem 55 MB: não cabe no pacote embutido nem vale o download
 * para abrir um relatório. `congelar.py` grava ao lado uma cópia partida por
 * fonte, `data/valores/<source_id>.parquet` (~35 KB em média), e aqui se busca
 * só a da fonte do relatório — um `fetch` simples, que qualquer servidor
 * estático atende.
 *
 * Tentou-se antes ler o arquivo inteiro por intervalo HTTP (`Range`). O
 * servidor atendia, mas o DuckDB 1.32 no navegador não chegou a mandar a
 * sonda HEAD e caía no download dos 55 MB; a partição não depende disso.
 *
 * Devolve o nome da view registrada, ou `null` quando não há como ter os
 * valores — painel autocontido, que não tem servidor, ou arquivo ausente.
 */
const valoresRegistrados = new Map<string, Promise<string | null>>()
export function valoresDaFonte(sourceId: string): Promise<string | null> {
  let p = valoresRegistrados.get(sourceId)
  if (!p) {
    p = (async () => {
      if (embutido()) return null
      try {
        const r = await fetch(url(`data/valores/${encodeURIComponent(sourceId)}.parquet`))
        if (!r.ok) return null
        const c = await conectar()
        const arquivo = `valores_${paraIdentificador(sourceId)}.parquet`
        await banco!.registerFileBuffer(arquivo, new Uint8Array(await r.arrayBuffer()))
        const visao = `valores_${paraIdentificador(sourceId)}`
        await c.query(`CREATE OR REPLACE VIEW ${visao} AS SELECT * FROM read_parquet('${arquivo}')`)
        return visao
      } catch {
        return null
      }
    })()
    valoresRegistrados.set(sourceId, p)
  }
  return p
}

/** source_id como pedaço de identificador SQL: só letra, dígito e sublinhado. */
const paraIdentificador = (v: string) => v.replace(/[^A-Za-z0-9]/g, '_')

export function conectar(): Promise<duckdb.AsyncDuckDBConnection> {
  conexao ??= abrir()
  return conexao
}

/** Executa SQL e devolve as linhas já em objetos JS simples. */
export async function consultar<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const c = await conectar()
  const tabela = await c.query(sql)
  return tabela.toArray().map((linha) => {
    const objeto = linha.toJSON() as Record<string, unknown>
    for (const [k, v] of Object.entries(objeto)) {
      // Arrow devolve inteiro de 64 bits como BigInt e HUGEINT — que é o que
      // `sum()` sobre um `count(*)` produz — como vetor de 32 bits. Nenhum dos
      // dois o React renderiza, e o ECharts quebra com "cannot mix BigInt".
      // Number() basta para contagens desta ordem.
      if (typeof v === 'bigint') objeto[k] = Number(v)
      else if (ArrayBuffer.isView(v) && !(v instanceof DataView)) objeto[k] = Number(v.toString())
    }
    return objeto as T
  })
}

/** Escapa literal de texto para interpolação segura em SQL. */
export const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
