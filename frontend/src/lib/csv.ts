/**
 * Gera e baixa um CSV a partir de linhas já em memória.
 *
 * Diferente de `CsvDownloadButton`/`ExportButton`, que baixam do servidor um
 * recorte grande demais para o navegador (os registros de uma coleta): aqui o
 * conjunto já está carregado (o índice do acervo, ~2.184 linhas), então montar
 * o arquivo no cliente evita um endpoint só para reempacotar o que já se tem.
 *
 * Campos vão entre aspas quando contêm separador, aspas ou quebra de linha, com
 * as aspas internas dobradas — a convenção do RFC 4180. O BOM inicial faz o
 * Excel abrir como UTF-8 em vez de Latin-1.
 */
type Celula = string | number | null | undefined

function _escapar(valor: Celula): string {
  const texto = valor == null ? '' : String(valor)
  return /["\n,;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

export function baixarCsv(nomeArquivo: string, cabecalho: string[], linhas: Celula[][]): void {
  const conteudo = [cabecalho, ...linhas].map((linha) => linha.map(_escapar).join(',')).join('\r\n')
  // BOM (U+FEFF) explícito — por `fromCharCode` para não deixar um caractere
  // invisível no código — para o Excel abrir como UTF-8 em vez de Latin-1.
  const bom = String.fromCharCode(0xfeff)
  const blob = new Blob([bom + conteudo], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const ancora = document.createElement('a')
  ancora.href = url
  ancora.download = nomeArquivo
  ancora.click()
  URL.revokeObjectURL(url)
}
