import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

export function NotFoundPage() {
  const { t } = useTranslation()

  return (
    <section id="not-found-page" className="text-center py-6">
      <h1 id="not-found-page-title" className="mt-0 mb-1">
        {t('notFound.title')}
      </h1>
      <p id="not-found-page-description" className="text-base mb-3">
        {t('notFound.description')}
      </p>
      <Link id="not-found-page-back" to="/" className="br-button primary">
        {t('notFound.back')}
      </Link>
    </section>
  )
}
