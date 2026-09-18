import { BrSelectStandard } from '@govbr-ds/react-components'
import { useTranslation } from 'react-i18next'

import { TUDO } from '@/lib/pagination'

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
 * Um só controle para as quatro listas da aplicação — o que muda entre elas é
 * de onde vêm as páginas, não como se anda por elas. As duas que paginam no
 * servidor (registros, busca de acessos) oferecem tamanhos até o teto que o
 * backend aceita; as duas que paginam no navegador (meus repositórios,
 * administração) já têm o acervo em memória e podem oferecer "tudo". Quem
 * chama decide o conjunto em `tamanhos`; o componente só o apresenta.
 *
 * O seletor de tamanho existe porque só havia o "Próxima": para ver o 300º de
 * 2.181 repositórios eram doze cliques, cada um recarregando a tabela inteira.
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
  tamanho,
  tamanhos,
  onTamanho,
}: {
  id?: string
  page: number
  totalPages: number
  onChange: (page: number) => void
  /** Itens por página em vigor. Omitido, o seletor não aparece. */
  tamanho?: number
  /** Conjunto oferecido nesta tela, incluindo `TUDO` quando couber. */
  tamanhos?: readonly number[]
  onTamanho?: (tamanho: number) => void
}) {
  const { t } = useTranslation()
  const total = Math.max(totalPages, 1)
  const comSeletor = tamanho !== undefined && tamanhos !== undefined && onTamanho !== undefined

  return (
    <div id={id} className="d-flex flex-wrap align-items-center justify-content-between gap-2">
      {comSeletor ? (
        <BrSelectStandard
          id={`${id}-size`}
          label={t('pagination.perPage')}
          value={Number.isFinite(tamanho) ? String(tamanho) : 'tudo'}
          onChange={(evento) =>
            onTamanho(evento.target.value === 'tudo' ? TUDO : Number(evento.target.value))
          }
          options={tamanhos.map((opcao) => ({
            label: Number.isFinite(opcao) ? String(opcao) : t('pagination.all'),
            value: Number.isFinite(opcao) ? String(opcao) : 'tudo',
          }))}
        />
      ) : (
        /* Mantém o bloco de páginas à direita mesmo sem seletor à esquerda. */
        <span id={`${id}-spacer`} aria-hidden="true" />
      )}

      {/*
        Uma página só não tem para onde ir: com "tudo" escolhido, ou com um
        acervo curto, os botões seriam um "1" aceso e duas setas mortas. O
        seletor continua na tela — é por ele que se volta a paginar.
      */}
      {total > 1 ? (
        <nav
          id={`${id}-nav`}
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
      ) : null}
    </div>
  )
}
