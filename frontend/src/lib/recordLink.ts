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

/**
 * Prefixo assumido quando o registro não declara o seu.
 *
 * É o mesmo padrão do backend (`prefix` do `/oai/record-link`), de propósito:
 * os dois montam o mesmo `GetRecord`, e divergir aqui faria o botão abrir uma
 * resposta diferente da que o servidor consultou para achar o link.
 */
const PREFIXO_PADRAO = 'oai_dc'

/**
 * Endereço do `GetRecord` deste registro no OAI-PMH da origem.
 *
 * Diferente do link para a página do item, este não precisa de resolução: o
 * registro já traz as três partes que o verbo exige — `origin` é o `baseURL`
 * que o Harvester coletou, mais o identificador e o prefixo. Por isso o botão
 * aparece de imediato, sem a espera da consulta ao backend.
 *
 * A montagem passa pelo `URL` em vez de concatenar `?`: há origens cujo
 * `baseURL` já vem com query string, e o identificador OAI tem `:` e `/`, que
 * precisam ser escapados. `searchParams` resolve os dois casos do mesmo jeito
 * que o `httpx` do backend.
 *
 * Devolve `null` quando não dá para montar — origem ausente, ou um `baseURL`
 * que não é http(s). Aí a interface mostra o mesmo aviso discreto do outro
 * botão, em vez de um link quebrado.
 */
export function oaiGetRecordUrl(record: RecordItem): string | null {
  const origem = record.origin?.trim()
  if (!origem || !record.identifier) return null

  let url: URL
  try {
    url = new URL(origem)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  url.searchParams.set('verb', 'GetRecord')
  url.searchParams.set('identifier', record.identifier)
  url.searchParams.set('metadataPrefix', record.metadataPrefix || PREFIXO_PADRAO)
  return url.toString()
}
