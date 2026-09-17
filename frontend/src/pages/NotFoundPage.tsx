import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

export function NotFoundPage() {
  const { t } = useTranslation()

  return (
    <section id="not-found-page" className="py-16 text-center">
      <h1 id="not-found-page-title" className="text-2xl font-semibold">
        {t('notFound.title')}
      </h1>
      <p id="not-found-page-description" className="mt-2 text-content-muted">
        {t('notFound.description')}
      </p>
      <Link
        id="not-found-page-back"
        to="/"
        className="mt-6 inline-block bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong"
      >
        {t('notFound.back')}
      </Link>
    </section>
  )
}
