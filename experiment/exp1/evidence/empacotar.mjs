// Empacota o build num fragmento HTML autocontido.
//
// O visualizador aninha o que recebe dentro do próprio documento e serve a
// página numa URL que não é um diretório: qualquer `./assets/...` resolve para
// fora e volta 404 — tela branca. Então nada aqui pode depender de caminho
// relativo, e tudo o que a página lê (script, estilo, Parquet, metadados, SQL)
// entra embutido.
//
// Os arquivos de apoio continuam publicados ao lado: são a cópia citável do
// dataset. A página é que não depende deles.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SAIDA = 'dashboard'
const ler = (p) => readFileSync(join(SAIDA, p), 'utf8')

const TABELAS = [
  'repositories', 'snapshots', 'platforms',
  'platform_evidence', 'harvest_metrics', 'repository_summary',
]
// Opcionais: o painel abre sem elas e as abas de registro somem.
const TABELAS_REGISTRO = ['records', 'record_values', 'record_metrics', 'record_harvest']
const METADADOS = ['dataset', 'codebook', 'vocabularies', 'hypotheses', 'provenance', 'protocol', 'hints']

// Opcionais também, e independentes das de registro: sem elas some só a aba Metadados.
const TABELAS_METADADO = ['metadata_rules', 'record_metadata']

const presentes = [...TABELAS_REGISTRO, ...TABELAS_METADADO].filter((t) =>
  existsSync(join(SAIDA, `data/${t}.parquet.txt`)),
)
const embutido = {
  parquet: Object.fromEntries(
    [...TABELAS, ...presentes].map((t) => [t, ler(`data/${t}.parquet.txt`).trim()]),
  ),
  metadata: Object.fromEntries(METADADOS.map((m) => [m, JSON.parse(ler(`metadata/${m}.json`))])),
  checksums: ler('metadata/checksums.sha256'),
  sql: ler('sql/views.sql'),
  ...(TABELAS_REGISTRO.every((t) => presentes.includes(t))
    ? { sqlRegistros: ler('sql/views-registros.sql') }
    : {}),
}

// O alfabeto base64 não tem `<`, então só o JSON dos metadados precisa de
// cuidado com `</script>`.
const dados = JSON.stringify(embutido).replaceAll('<', '\\u003c')

const css = ler('assets/app.css')
const js = ler('assets/app.js')
const PESOS = [400, 500, 600, 700]
const fontes = PESOS.map((peso) => {
  const b64 = readFileSync(join('fontes', `rawline-${peso}.woff2`)).toString('base64')
  return `@font-face{font-family:rawline;font-style:normal;font-weight:${peso};font-display:swap;` +
    `src:url(data:font/woff2;base64,${b64}) format('woff2')}`
}).join('')

const pagina = `<title>HarvestBoard Evidence</title>
<style>${fontes}</style>
<style>${css}</style>
<div id="raiz"></div>
<script>window.__EVIDENCE__=${dados};</script>
<script type="module">${js}</script>
`

const pagina_nome = 'painel-evidence.html'
writeFileSync(join(SAIDA, pagina_nome), pagina)

const mb = (n) => (n / 1024 / 1024).toFixed(2)
console.log(`${pagina_nome}: ${mb(Buffer.byteLength(pagina))} MB`)
for (const [rotulo, tamanho] of [
  ['  script', Buffer.byteLength(js)],
  ['  estilo', Buffer.byteLength(css)],
  ['  fontes', Buffer.byteLength(fontes)],
  ['  dados ', Buffer.byteLength(dados)],
]) console.log(`${rotulo}  ${mb(tamanho)} MB`)
console.log(`  tabelas de registro: ${presentes.length}/${TABELAS_REGISTRO.length + TABELAS_METADADO.length}`)
console.log(`  apoio ao lado: ${readdirSync(join(SAIDA, 'data')).length} em data/`)
