import { useTranslation } from 'react-i18next'

import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n'

const LABELS: Record<SupportedLanguage, { sigla: string; nome: string }> = {
  'pt-BR': { sigla: 'PT', nome: 'Português' },
  es: { sigla: 'ES', nome: 'Español' },
  en: { sigla: 'EN', nome: 'English' },
}

/**
 * Seletor de idioma.
 *
 * Vive sobre a faixa institucional azul escura, então as cores são claras e o
 * estado ativo é marcado por contraste de opacidade e sublinhado — sobre fundo
 * escuro, um preenchimento azul não se distinguiria do fundo.
 */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const current = i18n.resolvedLanguage

  return (
    <div className="flex items-center" role="group" aria-label={t('common.language')}>
      {SUPPORTED_LANGUAGES.map((lang, indice) => (
        <span key={lang} className="flex items-center">
          {indice > 0 ? (
            <span aria-hidden="true" className="px-1 text-white/30">
              ·
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void i18n.changeLanguage(lang)}
            aria-pressed={current === lang}
            // O nome por extenso fica no title e no rótulo acessível; a sigla
            // basta visualmente numa faixa estreita.
            title={LABELS[lang].nome}
            className={`px-1 font-mono text-[0.6875rem] tracking-[0.18em] uppercase transition-colors duration-150 ${
              current === lang
                ? 'font-semibold text-white underline decoration-2 underline-offset-4'
                : 'text-white/70 hover:text-white'
            }`}
          >
            <span aria-hidden="true">{LABELS[lang].sigla}</span>
            <span className="sr-only">{LABELS[lang].nome}</span>
          </button>
        </span>
      ))}
    </div>
  )
}
