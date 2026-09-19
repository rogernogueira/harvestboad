import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ExternalLinkIcon } from '@/components/ExternalLinkIcon'
import { oaiGetRecordUrl } from '@/lib/recordLink'
import type { RecordItem } from '@/lib/types'

/**
 * Botão para o registro no OAI-PMH da origem.
 *
 * É o par do `RecordLinkButton`, e a diferença entre os dois é o que cada um
 * mostra: aquele leva à página do item, feita para leitura; este leva à
 * resposta crua do `GetRecord`, que é o que o Harvester de fato coletou. Quem
 * investiga um registro inválido precisa ver o segundo — a página do item já é
 * o metadado renderizado, e some justamente o que se quer conferir.
 *
 * Aqui não há consulta nem espera: o endereço sai do próprio registro. Por
 * isso o botão não tem estado "localizando", que no outro existe porque a
 * resolução depende de o backend alcançar a origem.
 */
export function RecordOaiButton({
  id = 'record-oai-button',
  record,
}: {
  id?: string
  record: RecordItem
}) {
  const { t } = useTranslation()
  const link = useMemo(() => oaiGetRecordUrl(record), [record])

  if (!link) {
    return (
      <span
        id={`${id}-unavailable`}
        className="text-down-01 text-gray-70"
        title={t('record.link.oaiUnavailableHint')}
      >
        {t('record.link.oaiUnavailable')}
      </span>
    )
  }

  return (
    <a
      id={id}
      href={link}
      target="_blank"
      // Mesmo par do outro botão: `noopener` protege a aba de origem e
      // `noreferrer` evita vazar o endereço interno da aplicação.
      rel="noopener noreferrer"
      title={`${link}\n\n${t('record.link.oaiHint')}`}
      className="br-button secondary small"
    >
      {t('record.link.oai')}
      <ExternalLinkIcon id={`${id}-icon`} />
    </a>
  )
}
