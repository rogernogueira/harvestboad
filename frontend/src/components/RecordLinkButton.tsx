import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ExternalLinkIcon } from '@/components/ExternalLinkIcon'
import { recordLinkQuery } from '@/lib/queries'
import { preferredUrl, urlsFromOccurrences } from '@/lib/recordLink'
import type { RecordItem } from '@/lib/types'

/** Rótulo do botão por variante, com e sem a ressalva de endereço deduzido. */
const CHAVES = {
  completo: { certo: 'record.link.open', provavel: 'record.link.openProbable' },
  curto: { certo: 'record.link.itemPage', provavel: 'record.link.itemPageProbable' },
} as const

/**
 * Botão para o registro no site do repositório de origem.
 *
 * O identificador OAI não é navegável, e o endereço real mora no metadado. Há
 * duas fontes para ele, e as duas são usadas:
 *
 * - o diagnóstico já traz as ocorrências de `dc:identifier` do registro, então
 *   quando alguma delas é uma URL o link aparece na hora, sem requisição;
 * - o backend consulta o OAI-PMH da origem, que é mais completo mas depende de
 *   a origem estar de pé — e boa parte delas não está.
 *
 * A ausência de link não vira erro na interface: é o caso comum em origens fora
 * do ar ou com metadado pobre, e um alerta vermelho em toda visita treinaria o
 * usuário a ignorá-lo. Vira um aviso discreto, com o motivo no `title`.
 */
export function RecordLinkButton({
  id = 'record-link-button',
  record,
  rotulo = 'completo',
}: {
  id?: string
  record: RecordItem
  /*
   * `completo` diz a ação inteira — "Abrir no repositório" —, para quando o
   * botão aparece sozinho, como no modal de diagnóstico. `curto` diz só o
   * destino — "Página do item" —, para quando ele está num grupo cujo rótulo
   * já disse a ação e repeti-la sobraria em cada botão.
   */
  rotulo?: 'completo' | 'curto'
}) {
  const { t } = useTranslation()

  const origem = record.origin ?? ''
  const consulta = useQuery(recordLinkQuery(record.identifier, origem, record.metadataPrefix))
  const local = useMemo(() => preferredUrl(urlsFromOccurrences(record)), [record])

  const link = consulta.data?.link ?? local

  // Endereço deduzido da forma do identificador que o backend não conseguiu
  // conferir — por não alcançar a rede do repositório, não por indício de que
  // esteja errado. Vai para a tela rotulado, para não prometer o que não se
  // verificou. O endereço local, tirado do metadado do próprio registro, nunca
  // é palpite.
  const provavel = !local && (consulta.data?.source?.startsWith('derived-unverified') ?? false)

  if (link) {
    return (
      <a
        id={id}
        href={link}
        target="_blank"
        // `noopener` protege a aba de origem; `noreferrer` evita vazar o
        // endereço interno da aplicação para o site do repositório.
        rel="noopener noreferrer"
        title={provavel ? `${link}\n\n${t('record.link.probableHint')}` : link}
        className="br-button secondary small"
      >
        {t(CHAVES[rotulo][provavel ? 'provavel' : 'certo'])}
        <ExternalLinkIcon id={`${id}-icon`} />
      </a>
    )
  }

  // Uma query desligada (registro sem `origin`) também fica `isPending`; o
  // `fetchStatus` é o que separa "esperando resposta" de "nunca vai buscar".
  if (consulta.isPending && consulta.fetchStatus !== 'idle') {
    return (
      <span id={`${id}-resolving`} className="text-down-01 text-gray-70">
        {t('record.link.resolving')}
      </span>
    )
  }

  const motivo = consulta.data?.reason?.split(':')[0]
  return (
    <span
      id={`${id}-unavailable`}
      className="text-down-01 text-gray-70"
      title={motivo ? t(`record.link.reasons.${motivo}`) : undefined}
    >
      {t('record.link.unavailable')}
    </span>
  )
}
