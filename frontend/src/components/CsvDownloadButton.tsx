import { BrButton } from '@govbr-ds/react-components'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError, apiDownload } from '@/lib/api'

/**
 * Baixa um CSV autenticado.
 *
 * O download passa pelo cliente da aplicação, e não por um `<a href>`: o link
 * comum não carrega o cabeçalho `Authorization`, e a rota de exportação exige
 * o mesmo token das telas.
 *
 * Genérico porque há duas exportações com a mesma mecânica — registros de uma
 * coleta e histórico de um repositório — e uma só forma de errar: engolir a
 * falha. O erro aparece ao lado do botão, com `role="alert"`, porque o arquivo
 * que não vem não deixa outro rastro na tela.
 */
export function CsvDownloadButton({
  id = 'csv-download-button',
  path,
  filename,
  label,
  loadingLabel,
}: {
  id?: string
  /** Caminho na API, já com a query string que a exportação precisa. */
  path: string
  filename: string
  label: string
  loadingLabel?: string
}) {
  const { t } = useTranslation()
  const [baixando, setBaixando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const baixar = async () => {
    setBaixando(true)
    setErro(null)
    try {
      await apiDownload(path, filename)
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
        onClick={() => void baixar()}
        loading={baixando}
        disabled={baixando}
      >
        {baixando ? (loadingLabel ?? t('records.exporting')) : label}
      </BrButton>
      {erro ? (
        <span id={`${id}-error`} role="alert" className="text-down-01 text-red-vivid-60 mt-1">
          {erro}
        </span>
      ) : null}
    </div>
  )
}
