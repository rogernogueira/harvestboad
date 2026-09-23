/*
 * Exportação das tabelas do painel em CSV.
 *
 * O valor sai **cru**, não formatado: 0.8732 e não "87,3%", 2183 e não "2.183".
 * O destino do arquivo é a mesma planilha ou o mesmo DuckDB que lê
 * `data/base-fontes.csv`, gerado pelo `to_csv` do pandas — e uma coluna
 * exportada em pt-BR volta como texto, o que faria o número de quem baixa
 * divergir do número da tela. É a mesma razão pela qual faixa e critério vivem
 * no `views.sql`.
 *
 * Daí também a vírgula como separador e a ausência de BOM: é o que os CSV do
 * dataset usam. O Excel em pt-BR abre isso numa coluna só — quem precisa dele
 * importa como texto, ou lê o Parquet, que é o formato canônico.
 */

/** RFC 4180: aspas só quando precisa, e aspas dentro viram duas. */
function escapar(texto: string): string {
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

/**
 * Valor JS como célula de CSV. `null` e `undefined` viram campo vazio — não
 * "—" nem "0": a ausência do dado é informação, e o `pc()` da tela já se
 * recusa a inventar 0% a partir de nulo.
 */
export function celula(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : ''
  if (typeof valor === 'bigint') return String(valor)
  if (typeof valor === 'boolean') return valor ? 'true' : 'false'
  if (valor instanceof Date) return valor.toISOString()
  if (typeof valor === 'object') return escapar(JSON.stringify(valor))
  return escapar(String(valor))
}

export function paraCsv(cabecalho: string[], linhas: readonly unknown[][]): string {
  return [cabecalho.map((c) => escapar(c)), ...linhas.map((l) => l.map(celula))]
    .map((l) => l.join(','))
    .join('\r\n')
}

/** `nome-da-tabela` → `nome-da-tabela.csv`, sem acento e sem espaço. */
export function nomeDeArquivo(nome: string): string {
  const limpo = nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${limpo || 'tabela'}.csv`
}

/**
 * Dispara o download. O blob com `URL.createObjectURL` é o que funciona nas
 * duas entradas do build: a página autocontida é servida numa URL que não é
 * diretório, onde qualquer caminho relativo resolve para fora.
 */
export function baixarCsv(nome: string, cabecalho: string[], linhas: readonly unknown[][]): void {
  const blob = new Blob([paraCsv(cabecalho, linhas)], { type: 'text/csv;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = nomeDeArquivo(nome)
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(href)
}
