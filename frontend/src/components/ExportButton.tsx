import { useTranslation } from 'react-i18next'

import { CsvDownloadButton } from '@/components/CsvDownloadButton'
import { filtersToParams, type RecordFilters } from '@/lib/filters'

/**
 * Exportação CSV dos registros da coleta.
 *
 * O que este componente acrescenta ao `CsvDownloadButton` é uma coisa só, e é
 * a que importa: os filtros da tela vão na query string, e o backend aplica os
 * mesmos. O arquivo sai com o recorte que está à vista — exportar a coleta
 * inteira quando a tela mostra 12 registros filtrados seria outra resposta.
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
  const query = filtersToParams(filters).toString()

  return (
    <CsvDownloadButton
      id={id}
      path={`/reports/harvests/${snapshotId}/records.csv${query ? `?${query}` : ''}`}
      filename={`coleta-${snapshotId}.csv`}
      label={t('records.export')}
      loadingLabel={t('records.exporting')}
    />
  )
}
