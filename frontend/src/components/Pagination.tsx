import { useTranslation } from 'react-i18next'

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number
  totalPages: number
  onChange: (page: number) => void
}) {
  const { t } = useTranslation()
  const total = Math.max(totalPages, 1)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-content-muted">{t('pagination.page', { page, total })}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="rounded-md border border-border-subtle px-3 py-1.5 disabled:opacity-40"
        >
          {t('pagination.previous')}
        </button>
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page >= total}
          className="rounded-md border border-border-subtle px-3 py-1.5 disabled:opacity-40"
        >
          {t('pagination.next')}
        </button>
      </div>
    </div>
  )
}
