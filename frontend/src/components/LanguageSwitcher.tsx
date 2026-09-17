import { useTranslation } from 'react-i18next'

import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n'

const LABELS: Record<SupportedLanguage, { sigla: string; nome: string }> = {
  'pt-BR': { sigla: 'PT', nome: 'Português' },
  es: { sigla: 'ES', nome: 'Español' },
  en: { sigla: 'EN', nome: 'English' },
}

/*
 * Cores dos dois fundos em que o seletor aparece.
 *
 * Vão em `style`, e não em classe utilitária do design system, porque a classe
 * `.eyebrow` — que dá a tipografia — declara `color` e vive na camada
 * `components`, depois da camada `govbr` na ordem da cascata. Um
 * `text-gray-70` perderia para ela; o estilo inline não.
 */
const CORES = {
  claro: {
    ativo: 'var(--blue-warm-vivid-70)',
    inativo: 'var(--gray-70)',
    separador: 'var(--gray-30)',
  },
  invertido: {
    ativo: 'var(--pure-0)',
    inativo: 'rgba(255, 255, 255, 0.8)',
    separador: 'rgba(255, 255, 255, 0.3)',
  },
} as const

/**
 * Seletor de idioma.
 *
 * Aparece em dois fundos diferentes, e por isso tem os dois modos:
 *
 * - **claro** (padrão), no `header-actions` do cabeçalho do painel. O ativo em
 *   azul institucional dá 7,33 sobre branco e o inativo em `gray-70` dá 7,46.
 *   Ambos passam com folga dos 4,5 exigidos para o texto de 11px.
 * - **invertido**, sobre a faixa azul escura da tela de entrada. Ali o
 *   contraste vem da opacidade: 80% no inativo dá 4,61:1 sobre o azul da
 *   faixa. A 70% dava 3,97 e reprovava.
 *
 * Nos dois casos a cor não é o único sinal do estado ativo — o sublinhado e o
 * peso da fonte também o marcam.
 */
export function LanguageSwitcher({
  id = 'language-switcher',
  invertido = false,
}: {
  id?: string
  invertido?: boolean
}) {
  const { i18n, t } = useTranslation()
  const current = i18n.resolvedLanguage
  const cores = invertido ? CORES.invertido : CORES.claro

  return (
    <div
      id={id}
      className="d-flex align-items-center"
      role="group"
      aria-label={t('common.language')}
    >
      {SUPPORTED_LANGUAGES.map((lang, indice) => (
        <span id={`${id}-${lang}`} key={lang} className="d-flex align-items-center">
          {indice > 0 ? (
            <span
              id={`${id}-${lang}-separator`}
              aria-hidden="true"
              className="px-1"
              style={{ color: cores.separador }}
            >
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
            className="eyebrow"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0 var(--spacing-scale-half)',
              color: current === lang ? cores.ativo : cores.inativo,
              fontWeight: current === lang ? 'var(--font-weight-semi-bold)' : undefined,
              textDecoration: current === lang ? 'underline' : undefined,
              textUnderlineOffset: '0.25rem',
            }}
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
