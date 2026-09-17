import { useTranslation } from 'react-i18next'

export function Pagination({
  id = 'pagination',
  page,
  totalPages,
  onChange,
}: {
  id?: string
  page: number
  totalPages: number
  onChange: (page: number) => void
}) {
  const { t } = useTranslation()
  const total = Math.max(totalPages, 1)

  return (
    <div id={id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p id={`${id}-status`} className="text-content-muted">
        {t('pagination.page', { page, total })}
      </p>
      <div id={`${id}-controls`} className="flex gap-2">
        <button
          id={`${id}-previous`}
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="border border-border-subtle px-3 py-1.5 disabled:opacity-40"
        >
          {t('pagination.previous')}
        </button>
        <button
          id={`${id}-next`}
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page >= total}
          className="border border-border-subtle px-3 py-1.5 disabled:opacity-40"
        >
          {t('pagination.next')}
        </button>
      </div>
    </div>
  )
}
