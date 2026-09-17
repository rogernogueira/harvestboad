import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { Modal } from '@/components/Modal'
import { repositoryManagersQuery } from '@/lib/queries'

/**
 * Gestores vinculados a um repositório.
 *
 * Só consulta quando aberto: a lista não interessa a quem não abriu o modal, e
 * são N repositórios por tela.
 *
 * O `id` padrão embute o repositório porque a tela do gestor monta um modal por
 * linha — todos no HTML ao mesmo tempo, abertos ou não.
 */
export function RepositoryManagersModal({
  id,
  aberto,
  onFechar,
  repositoryId,
  repositorio,
}: {
  id?: string
  aberto: boolean
  onFechar: () => void
  repositoryId: string
  repositorio: string
}) {
  const { t, i18n } = useTranslation()
  const { data, isPending, isError, error, refetch } = useQuery({
    ...repositoryManagersQuery(repositoryId),
    enabled: aberto && repositoryId.length > 0,
  })

  const idBase = id ?? `repository-managers-modal-${repositoryId}`
  const data_ = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'short' })

  return (
    <Modal
      id={idBase}
      aberto={aberto}
      onFechar={onFechar}
      titulo={t('managers.title')}
      descricao={repositorio}
    >
      {isPending ? <Loading id={`${idBase}-loading`} /> : null}
      {isError ? (
        <ErrorState id={`${idBase}-error`} error={error} onRetry={() => void refetch()} />
      ) : null}

      {data ? (
        data.count === 0 ? (
          <Empty id={`${idBase}-empty`} label={t('managers.none')} />
        ) : (
          <ul id={`${idBase}-list`} className="plain-list">
            {data.results.map((gestor, indice) => (
              <li
                id={`${idBase}-item-${gestor.id}`}
                key={gestor.id}
                className="d-flex flex-wrap align-items-baseline py-2"
                style={{
                  gap: 'var(--spacing-scale-baseh)',
                  borderTop: indice > 0 ? '1px solid var(--border-color)' : undefined,
                }}
              >
                <span id={`${idBase}-item-${gestor.id}-username`} className="text-semi-bold">
                  {gestor.username}
                </span>
                {gestor.fullName ? (
                  <span id={`${idBase}-item-${gestor.id}-fullname`} className="text-gray-70">
                    {gestor.fullName}
                  </span>
                ) : null}
                <span
                  id={`${idBase}-item-${gestor.id}-profile`}
                  className="eyebrow"
                  style={{ color: 'var(--blue-warm-vivid-80)' }}
                >
                  {gestor.profileDisplay}
                </span>
                {!gestor.isActive ? (
                  <span
                    id={`${idBase}-item-${gestor.id}-inactive`}
                    className="br-tag text warning"
                    // Mesma correção do `Badges.tsx`: o amarelo do design
                    // system com o texto branco dele dá 1,50 de contraste, e o
                    // padrão exige 4,5:1. Em `--gray-80`, a cor da função
                    // Leitura, dá 8,42.
                    style={{ color: 'var(--gray-80)' }}
                  >
                    {t('managers.inactive')}
                  </span>
                ) : null}
                <span
                  id={`${idBase}-item-${gestor.id}-since`}
                  className="text-down-01 text-gray-70 ml-auto"
                >
                  {t('access.since', { date: data_.format(new Date(gestor.grantedAt)) })}
                </span>
                {/* O e-mail só chega para o ADMIN; para o gestor vem nulo. */}
                {gestor.email ? (
                  <span
                    id={`${idBase}-item-${gestor.id}-email`}
                    className="text-down-01 text-gray-70"
                    style={{ width: '100%' }}
                  >
                    {gestor.email}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Modal>
  )
}
