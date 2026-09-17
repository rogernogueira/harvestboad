import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import es from './locales/es.json'
import ptBR from './locales/pt-BR.json'

export const SUPPORTED_LANGUAGES = ['pt-BR', 'es', 'en'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'pt-BR': { translation: ptBR },
      es: { translation: es },
      en: { translation: en },
    },
    fallbackLng: 'pt-BR',
    supportedLngs: SUPPORTED_LANGUAGES,
    // Variantes regionais caem no idioma base pelo comportamento padrão do
    // i18next ("es-AR" → "es"); o que não tiver base cai no fallback.
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'harvestboard.lang',
    },
  })

/*
 * Mantém o `lang` do documento igual ao idioma ativo.
 *
 * O `index.html` fixa `lang="pt-BR"`, e o atributo não acompanhava a troca de
 * idioma: a página se anunciava como portuguesa mesmo inteira em inglês. Quem
 * usa leitor de tela recebia texto inglês lido com fonética portuguesa, e o
 * navegador oferecia tradução de uma página que já estava no idioma pedido.
 *
 * Fica aqui, e não num efeito de componente, porque não há nada para
 * renderizar — é o próprio i18next quem sabe a hora, inclusive na carga
 * inicial, quando o detector escolhe a partir do localStorage ou do navegador.
 */
const sincronizarLangDoDocumento = (idioma: string) => {
  document.documentElement.lang = idioma
}

sincronizarLangDoDocumento(i18n.resolvedLanguage ?? 'pt-BR')
i18n.on('languageChanged', sincronizarLangDoDocumento)

export default i18n
