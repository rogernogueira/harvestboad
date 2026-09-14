import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { myRepositoriesQuery } from '@/lib/queries'

/**
 * Repositórios do gestor.
 *
 * A lista vem já filtrada pelo backend: o endpoint devolve apenas os vínculos
 * do usuário autenticado. Não há filtragem no cliente — nem haveria como
 * confiar nela.
 */
export function RepositoriesPage() {
  const { t } = useTranslation()
  const { data, isPending, isError, error, refetch } = useQuery(myRepositoriesQuery)

  if (isPending) return <Loading />
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold">{t('repositories.title')}</h1>
        <p className="text-sm text-content-muted">
          {t('repositories.subtitle', { count: data.count })}
        </p>
      </header>

      {data.results.length === 0 ? (
        <Empty label={t('repositories.none')} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.results.map((acesso) => (
            <li key={acesso.id}>
              <Link
                to={`/repositorios/${acesso.harvesterRepositoryId}`}
                className="flex h-full flex-col gap-1 rounded-xl border border-border-subtle bg-surface-raised p-4 transition-colors hover:border-brand"
              >
                <span className="font-mono text-xs text-brand-strong">{acesso.acronym}</span>
                <span className="font-medium">{acesso.name ?? t('repositories.unnamed')}</span>
                {acesso.institutionName ? (
                  <span className="text-sm text-content-muted">{acesso.institutionName}</span>
                ) : null}
                <span className="mt-auto pt-2 text-xs text-content-muted">
                  {t('repositories.grantedAt', {
                    date: new Date(acesso.grantedAt).toLocaleDateString(),
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
