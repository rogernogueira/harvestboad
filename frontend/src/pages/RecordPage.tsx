import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router'

import { ValidityBadge } from '@/components/Badges'
import { Breadcrumb } from '@/components/Breadcrumb'
import { ErrorState, Loading } from '@/components/Feedback'
import { RecordLinkButton } from '@/components/RecordLinkButton'
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

  if (registro.isPending) return <Loading id="record-page-loading" />
  if (registro.isError)
    return (
      <ErrorState
        id="record-page-error"
        error={registro.error}
        onRetry={() => void registro.refetch()}
      />
    )

  const r = registro.data
  const campos: [string, string, string | null | undefined][] = [
    ['identifier', t('record.identifier'), r.identifier],
    ['internal-id', t('record.internalId'), r.id],
    ['set', t('record.set'), r.setSpec],
    ['prefix', t('record.prefix'), r.metadataPrefix],
    ['origin', t('record.origin'), r.origin],
    ['repository', t('record.repository'), r.repositoryName],
    ['institution', t('record.institution'), r.institutionName],
  ]

  return (
    <div id="record-page" className="flex flex-col gap-6">
      <div id="record-page-heading">
        <Breadcrumb
          id="record-page-breadcrumb"
          items={[
            { label: t('repositories.title'), to: '/' },
            { label: t('harvest.breadcrumb', { id: snapshotId }), to: `/coletas/${snapshotId}` },
            { label: t('records.title'), to: voltar },
            { label: t('record.title') },
          ]}
        />
        <div id="record-page-title-row" className="flex flex-wrap items-center gap-3">
          <h1 id="record-page-title" className="font-mono text-base break-all">
            {r.identifier}
          </h1>
          <ValidityBadge id="record-page-validity" valid={r.isValid} />
          {/*
           * O registro já carrega tudo o que a resolução precisa: `origin` é o
           * baseURL OAI de onde ele foi coletado — não o cadastro atual do
           * repositório, que pode ter mudado desde a coleta.
           */}
          <RecordLinkButton id="record-page-link" record={r} />
        </div>
      </div>

      <section id="record-page-fields" className="panel">
        <dl id="record-page-fields-list" className="divide-y divide-border-subtle text-sm">
          {campos.map(([chave, rotulo, valor]) => (
            <div
              id={`record-page-field-${chave}`}
              key={chave}
              className="flex flex-wrap gap-2 px-4 py-3"
            >
              <dt
                id={`record-page-field-${chave}-label`}
                className="w-44 shrink-0 text-content-muted"
              >
                {rotulo}
              </dt>
              <dd id={`record-page-field-${chave}-value`} className="break-all">
                {valor ?? '—'}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="record-page-xml" className="flex flex-col gap-3">
        <h2 id="record-page-xml-title" className="font-heading text-sm font-bold">
          {t('record.xml')}
        </h2>

        {xml.isPending ? <Loading id="record-page-xml-loading" /> : null}

        {xml.isError ? (
          xml.error instanceof ApiError && xml.error.status === 404 ? (
            // O Harvester responde 200 com uma mensagem de texto quando o
            // relatório de diagnóstico está desatualizado; o backend traduz
            // isso em 404. Não é erro do usuário nem falha de rede.
            <p id="record-page-xml-unavailable" className="panel p-4 text-sm text-content-muted">
              {t('record.xmlUnavailable')}
            </p>
          ) : (
            <ErrorState
              id="record-page-xml-error"
              error={xml.error}
              onRetry={() => void xml.refetch()}
            />
          )
        ) : null}

        {xml.data ? (
          <pre id="record-page-xml-content" className="overflow-x-auto panel p-4 font-mono text-xs">
            <code id="record-page-xml-code">{xml.data}</code>
          </pre>
        ) : null}
      </section>
    </div>
  )
}
