import { useTranslation } from 'react-i18next'

import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n'

const LABELS: Record<SupportedLanguage, string> = {
  'pt-BR': 'PT',
  en: 'EN',
}

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const current = i18n.resolvedLanguage

  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('common.language')}>
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => void i18n.changeLanguage(lang)}
          aria-pressed={current === lang}
          className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            current === lang
              ? 'bg-brand text-white'
              : 'text-content-muted hover:bg-border-subtle'
          }`}
        >
          {LABELS[lang]}
        </button>
      ))}
    </div>
  )
}
