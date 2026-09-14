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
 */
export function RepositoryManagersModal({
  aberto,
  onFechar,
  repositoryId,
  repositorio,
}: {
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

  const data_ = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'short' })

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo={t('managers.title')} descricao={repositorio}>
      {isPending ? <Loading /> : null}
      {isError ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}

      {data ? (
        data.count === 0 ? (
          <Empty label={t('managers.none')} />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {data.results.map((gestor) => (
              <li key={gestor.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
                <span className="font-semibold">{gestor.username}</span>
                {gestor.fullName ? (
                  <span className="text-sm text-content-muted">{gestor.fullName}</span>
                ) : null}
                <span className="eyebrow !text-brand-strong">{gestor.profileDisplay}</span>
                {!gestor.isActive ? (
                  <span className="bg-warn-soft px-1.5 py-0.5 text-[0.65rem] text-warn">
                    {t('managers.inactive')}
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-content-muted">
                  {t('access.since', { date: data_.format(new Date(gestor.grantedAt)) })}
                </span>
                {/* O e-mail só chega para o ADMIN; para o gestor vem nulo. */}
                {gestor.email ? (
                  <span className="w-full text-xs text-content-muted">{gestor.email}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Modal>
  )
}
