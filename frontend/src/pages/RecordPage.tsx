import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router'

import { ValidityBadge } from '@/components/Badges'
import { Breadcrumb } from '@/components/Breadcrumb'
import { ErrorState, Loading } from '@/components/Feedback'
import { ApiError } from '@/lib/api'
import { filtersFromSearch, filtersToParams } from '@/lib/filters'
import { recordQuery, recordXmlQuery } from '@/lib/queries'

/** Registro individual e seu XML transformado. */
export function RecordPage() {
  const { t } = useTranslation()
  const { snapshotId = '', '*': identifier = '' } = useParams()
  const [searchParams] = useSearchParams()

  const filtros = filtersFromSearch(searchParams)
  const registro = useQuery(recordQuery(snapshotId, identifier, filtros))
  const xml = useQuery(recordXmlQuery(snapshotId, identifier))

  // Preserva o recorte ao voltar para a listagem.
  const query = filtersToParams(filtros).toString()
  const voltar = `/coletas/${snapshotId}/registros${query ? `?${query}` : ''}`

  if (registro.isPending) return <Loading />
  if (registro.isError)
    return <ErrorState error={registro.error} onRetry={() => void registro.refetch()} />

  const r = registro.data
  const campos: [string, string | null | undefined][] = [
    [t('record.identifier'), r.identifier],
    [t('record.internalId'), r.id],
    [t('record.set'), r.setSpec],
    [t('record.prefix'), r.metadataPrefix],
    [t('record.origin'), r.origin],
    [t('record.repository'), r.repositoryName],
    [t('record.institution'), r.institutionName],
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb
          items={[
            { label: t('repositories.title'), to: '/' },
            { label: t('harvest.breadcrumb', { id: snapshotId }), to: `/coletas/${snapshotId}` },
            { label: t('records.title'), to: voltar },
            { label: t('record.title') },
          ]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-base break-all">{r.identifier}</h1>
          <ValidityBadge valid={r.isValid} />
        </div>
      </div>

      <section className="panel">
        <dl className="divide-y divide-border-subtle text-sm">
          {campos.map(([rotulo, valor]) => (
            <div key={rotulo} className="flex flex-wrap gap-2 px-4 py-3">
              <dt className="w-44 shrink-0 text-content-muted">{rotulo}</dt>
              <dd className="break-all">{valor ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-sm font-bold">{t('record.xml')}</h2>

        {xml.isPending ? <Loading /> : null}

        {xml.isError ? (
          xml.error instanceof ApiError && xml.error.status === 404 ? (
            // O Harvester responde 200 com uma mensagem de texto quando o
            // relatório de diagnóstico está desatualizado; o backend traduz
            // isso em 404. Não é erro do usuário nem falha de rede.
            <p className="panel p-4 text-sm text-content-muted">{t('record.xmlUnavailable')}</p>
          ) : (
            <ErrorState error={xml.error} onRetry={() => void xml.refetch()} />
          )
        ) : null}

        {xml.data ? (
          <pre className="overflow-x-auto panel p-4 font-mono text-xs">
            <code>{xml.data}</code>
          </pre>
        ) : null}
      </section>
    </div>
  )
}
