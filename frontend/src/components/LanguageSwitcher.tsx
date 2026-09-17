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
 *
 * A opacidade do estado inativo é 80%, e não menos: sobre o azul da faixa isso
 * dá 4,61:1, acima do mínimo de 4,5 exigido para texto de 11px. A 70% dava
 * 3,97 e reprovava. O sublinhado e o peso continuam marcando o ativo, então a
 * diferença de opacidade menor não confunde os dois estados.
 */
export function LanguageSwitcher({ id = 'language-switcher' }: { id?: string }) {
  const { i18n, t } = useTranslation()
  const current = i18n.resolvedLanguage

  return (
    <div id={id} className="flex items-center" role="group" aria-label={t('common.language')}>
      {SUPPORTED_LANGUAGES.map((lang, indice) => (
        <span id={`${id}-${lang}`} key={lang} className="flex items-center">
          {indice > 0 ? (
            <span id={`${id}-${lang}-separator`} aria-hidden="true" className="px-1 text-white/30">
              ·
            </span>
          ) : null}
          <button
            id={`${id}-${lang}-button`}
            type="button"
            onClick={() => void i18n.changeLanguage(lang)}
            aria-pressed={current === lang}
            // O nome por extenso fica no title e no rótulo acessível; a sigla
            // basta visualmente numa faixa estreita.
            title={LABELS[lang].nome}
            className={`px-1 font-mono text-[0.6875rem] tracking-[0.18em] uppercase transition-colors duration-150 ${
              current === lang
                ? 'font-semibold text-white underline decoration-2 underline-offset-4'
                : 'text-white/80 hover:text-white'
            }`}
          >
            <span id={`${id}-${lang}-code`} aria-hidden="true">
              {LABELS[lang].sigla}
            </span>
            <span id={`${id}-${lang}-name`} className="sr-only">
              {LABELS[lang].nome}
            </span>
          </button>
        </span>
      ))}
    </div>
  )
}
