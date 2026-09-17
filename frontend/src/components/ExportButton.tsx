import { BrButton } from '@govbr-ds/react-components'
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
  id = 'export-button',
  snapshotId,
  filters,
}: {
  id?: string
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
    <div id={id} className="d-flex flex-column align-items-end">
      <BrButton
        id={`${id}-trigger`}
        type="button"
        secondary
        size="small"
        icon="fas fa-download"
        onClick={() => void exportar()}
        loading={baixando}
        disabled={baixando}
      >
        {baixando ? t('records.exporting') : t('records.export')}
      </BrButton>
      {erro ? (
        <span id={`${id}-error`} role="alert" className="text-down-01 text-red-vivid-60 mt-1">
          {erro}
        </span>
      ) : null}
    </div>
  )
}
