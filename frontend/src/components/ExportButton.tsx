import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError, apiDownload } from '@/lib/api'
import { filtersToParams, type RecordFilters } from '@/lib/filters'

/**
 * Exportação CSV dos registros.
 *
 * Usa os mesmos filtros da tela, e o download passa pelo cliente autenticado:
 * um `<a href>` simples não carregaria o token JWT.
 */
export function ExportButton({
  snapshotId,
  filters,
}: {
  snapshotId: string
  filters: RecordFilters
}) {
  const { t } = useTranslation()
  const [baixando, setBaixando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const exportar = async () => {
    setBaixando(true)
    setErro(null)
    try {
      const params = filtersToParams(filters)
      const query = params.toString()
      await apiDownload(
        `/reports/harvests/${snapshotId}/records.csv${query ? `?${query}` : ''}`,
        `coleta-${snapshotId}.csv`,
      )
    } catch (error) {
      setErro(error instanceof ApiError ? error.detail : t('common.error'))
    } finally {
      setBaixando(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void exportar()}
        disabled={baixando}
        className="rounded-md border border-border-subtle px-3 py-1.5 text-sm hover:bg-border-subtle disabled:opacity-60"
      >
        {baixando ? t('records.exporting') : t('records.export')}
      </button>
      {erro ? (
        <span role="alert" className="text-xs text-down">
          {erro}
        </span>
      ) : null}
    </div>
  )
}
