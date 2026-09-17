import { useTranslation } from 'react-i18next'

/**
 * Janela de páginas em torno da atual.
 *
 * Com dezenas de milhares de registros a lista de páginas fica longa demais
 * para caber na tela, então mostra no máximo cinco números centrados na página
 * corrente, encostando nas pontas quando se chega perto delas.
 */
function janela(page: number, total: number, maximo = 5): number[] {
  const quantidade = Math.min(maximo, total)
  let inicio = Math.max(1, page - Math.floor(quantidade / 2))
  if (inicio + quantidade - 1 > total) inicio = total - quantidade + 1
  return Array.from({ length: quantidade }, (_, i) => inicio + i)
}

/**
 * Paginação.
 *
 * Markup próprio sobre as classes `br-pagination` do core, e não o
 * `BrPagination`. O componente foi testado e descartado por três motivos, todos
 * verificados no DOM renderizado com `lang="en"`:
 *
 * 1. Ele imprime "Primeira página" e "Última página" como **texto visível** em
 *    português, sem prop que os traduza — só `previousPageLabel` e
 *    `nextPageLabel` são configuráveis.
 * 2. O `aria-label` da região sai como "paginação" e o de cada número como
 *    "Página N", também fixos em português.
 * 3. Os botões recebem ids gerados (`button_____3`) e os links de número não
 *    recebem id nenhum, o que contraria a convenção de ids do projeto.
 *
 * Ele também conta itens, não páginas, e quem chama aqui só conhece
 * `totalPages`.
 */
export function Pagination({
  id = 'pagination',
  page,
  totalPages,
  onChange,
}: {
  id?: string
  page: number
  totalPages: number
  onChange: (page: number) => void
}) {
  const { t } = useTranslation()
  const total = Math.max(totalPages, 1)

  return (
    <nav
      id={id}
      className="br-pagination"
      aria-label={t('pagination.label')}
      data-total={total}
      data-current={page}
    >
      <ul id={`${id}-list`}>
        <li>
          <button
            id={`${id}-previous`}
            className="br-button circle"
            type="button"
            onClick={() => onChange(page - 1)}
            disabled={page <= 1}
            aria-label={t('pagination.previous')}
          >
            <i className="fas fa-angle-left" aria-hidden="true" />
          </button>
        </li>

        {janela(page, total).map((numero) => (
          <li key={numero}>
            <button
              id={`${id}-page-${numero}`}
              type="button"
              className={`page ${numero === page ? 'active' : ''}`}
              onClick={() => onChange(numero)}
              aria-label={t('pagination.goToPage', { page: numero })}
              aria-current={numero === page ? 'page' : undefined}
            >
              {numero}
            </button>
          </li>
        ))}

        <li>
          <button
            id={`${id}-next`}
            className="br-button circle"
            type="button"
            onClick={() => onChange(page + 1)}
            disabled={page >= total}
            aria-label={t('pagination.next')}
          >
            <i className="fas fa-angle-right" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </nav>
  )
}
