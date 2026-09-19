import type { NotificationCategoryItem } from './types'

/**
 * Nome da categoria no idioma da tela.
 *
 * A categoria deixou de ser um enum traduzido por `t()` e virou cadastro, mas
 * continua sendo texto de interface: aparece como selo ao lado do título, e uma
 * tela em inglês com "Comunicação" no selo denunciaria a tradução pela metade.
 * Daí o backend mandar os três nomes e a escolha acontecer aqui.
 *
 * O pt-BR é a reserva porque é o único obrigatório no cadastro — categoria nova
 * sem tradução mostra o nome em português, que é melhor que um selo vazio.
 *
 * Aceita `es-AR` como `es`: o i18next resolve a variante regional para o idioma
 * base, e o `resolvedLanguage` pode chegar assim.
 */
export function nomeDaCategoria(
  categoria: NotificationCategoryItem | null | undefined,
  idioma: string | undefined,
): string {
  if (!categoria) return '—'
  const base = (idioma ?? 'pt-BR').split('-')[0].toLowerCase()
  if (base === 'es') return categoria.nameEs || categoria.namePtBr
  if (base === 'en') return categoria.nameEn || categoria.namePtBr
  return categoria.namePtBr
}
