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
    <div id="record-page">
      <div id="record-page-heading" className="mb-3">
        <Breadcrumb
          id="record-page-breadcrumb"
          items={[
            { label: t('repositories.title'), to: '/' },
            { label: t('harvest.breadcrumb', { id: snapshotId }), to: `/coletas/${snapshotId}` },
            { label: t('records.title'), to: voltar },
            { label: t('record.title') },
          ]}
        />
        <div id="record-page-title-row" className="d-flex flex-wrap align-items-center gap-3">
          {/*
            Também abaixo do tamanho de h1 do core: o título aqui é o
            identificador OAI cru, uma string longa e sem espaços que já quebra
            em mais de uma linha. A 29px ele ocuparia a tela inteira antes do
            conteúdo do registro.
          */}
          <h1
            id="record-page-title"
            className="text-up-01 mt-0 mb-0"
            style={{ wordBreak: 'break-all' }}
          >
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

      <section id="record-page-fields" className="br-card mb-4">
        <dl id="record-page-fields-list" className="card-content mb-0">
          {campos.map(([chave, rotulo, valor], indice) => (
            <div
              id={`record-page-field-${chave}`}
              key={chave}
              className="d-flex flex-wrap py-2"
              style={{
                gap: 'var(--spacing-scale-base)',
                borderTop: indice > 0 ? '1px solid var(--border-color)' : undefined,
              }}
            >
              <dt
                id={`record-page-field-${chave}-label`}
                className="text-gray-70 flex-shrink-0"
                style={{ width: '11rem' }}
              >
                {rotulo}
              </dt>
              <dd
                id={`record-page-field-${chave}-value`}
                className="mb-0"
                style={{ wordBreak: 'break-all' }}
              >
                {valor ?? '—'}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="record-page-xml">
        <h2 id="record-page-xml-title" className="text-up-01 text-bold mt-0 mb-2">
          {t('record.xml')}
        </h2>

        {xml.isPending ? <Loading id="record-page-xml-loading" /> : null}

        {xml.isError ? (
          xml.error instanceof ApiError && xml.error.status === 404 ? (
            // O Harvester responde 200 com uma mensagem de texto quando o
            // relatório de diagnóstico está desatualizado; o backend traduz
            // isso em 404. Não é erro do usuário nem falha de rede.
            <div id="record-page-xml-unavailable" className="br-card">
              <p className="card-content text-gray-70 mb-0">{t('record.xmlUnavailable')}</p>
            </div>
          ) : (
            <ErrorState
              id="record-page-xml-error"
              error={xml.error}
              onRetry={() => void xml.refetch()}
            />
          )
        ) : null}

        {xml.data ? (
          <pre
            id="record-page-xml-content"
            className="br-card p-3 text-down-01 mb-0"
            style={{ overflowX: 'auto' }}
          >
            <code id="record-page-xml-code">{xml.data}</code>
          </pre>
        ) : null}
      </section>
    </div>
  )
}
