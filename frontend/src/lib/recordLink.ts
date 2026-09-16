import type { RecordItem } from './types'

/**
 * Mesma ordem de preferência do backend: o identificador persistente primeiro,
 * depois as rotas canônicas de OJS e DSpace, que levam à página do item. O
 * download vem por último entre as regras porque entrega o arquivo em vez da
 * página.
 *
 * Entre os dois endereços de DSpace, o `/handle/` vem antes: ele aponta direto
 * para a página do item no repositório, enquanto o `hdl.handle.net` é o
 * resolvedor global, que só redireciona para lá.
 */
const REGRAS: ((url: string) => boolean)[] = [
  (url) => url.includes('doi.org'),
  (url) => url.includes('/article/view/'),
  (url) => url.includes('/handle/'),
  (url) => url.includes('hdl.handle.net'),
  (url) => url.includes('/article/download/'),
]

/** O diagnóstico anexa " | <contagem>" a alguns valores de ocorrência. */
const stripCount = (valor: string) => valor.split(' | ')[0]?.trim() ?? ''

/**
 * URLs que o diagnóstico já registrou para este registro.
 *
 * A regra "URL Válida" guarda as ocorrências de `dc:identifier` que apontam
 * para uma URL — ou seja, o endereço do item já veio junto com o registro. O ID
 * dessa regra muda entre coletas, então a varredura passa por todas em vez de
 * fixar um número.
 */
export function urlsFromOccurrences(record: RecordItem): string[] {
  const grupos = [record.validOccurrencesByRuleID, record.invalidOccurrencesByRuleID]
  const urls: string[] = []

  for (const grupo of grupos) {
    for (const valores of Object.values(grupo ?? {})) {
      for (const bruto of Array.isArray(valores) ? valores : [valores]) {
        if (typeof bruto !== 'string') continue
        const valor = stripCount(bruto)
        if (valor.startsWith('http://') || valor.startsWith('https://')) urls.push(valor)
      }
    }
  }

  return [...new Set(urls)]
}

/** Melhor URL entre as candidatas, ou `null` quando não há nenhuma. */
export function preferredUrl(urls: string[]): string | null {
  for (const regra of REGRAS) {
    const achada = urls.find(regra)
    if (achada) return achada
  }
  return urls[0] ?? null
}
