import { useState } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { Vazio } from './Basicos'
import { BotaoCsv } from './BotaoCsv'
import { dicaDe } from '../dicas'

/** As colunas de uma tabela têm tipos de valor diferentes entre si, então o
 *  parâmetro de valor do TanStack fica aberto — fechá-lo exigiria uma união
 *  por tabela sem ganho nenhum de segurança. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Colunas<T> = ColumnDef<T, any>[]

/**
 * O que o `meta` de uma coluna aceita.
 *
 * `csv` existe porque a célula da tela nem sempre serve de valor exportado: a
 * coluna de critérios não tem acessador nenhum (o conteúdo são fichas montadas
 * a partir de vários campos) e a de validade acessa `-1` de propósito, para
 * que a fonte sem registro ordene no fim — exportar esse `-1` como validade
 * seria mentira. `false` tira a coluna do arquivo; a função diz o que entra
 * no lugar.
 */
export type MetaColuna<T> = {
  num?: boolean
  csv?: false | ((linha: T) => unknown)
}

export const coluna = createColumnHelper

export function Tabela<T>({
  id,
  dados,
  colunas,
  nome,
  porPagina = 0,
  aoClicarLinha,
  ordemInicial,
  vazio = 'Nenhuma fonte no recorte atual.',
}: {
  /**
   * Obrigatório, e não com padrão: duas tabelas na mesma aba sairiam com o
   * mesmo id. Os filhos derivam dele — `-csv`, `-linha-<n>`, `-paginacao`.
   */
  id: string
  dados: T[]
  colunas: Colunas<T>
  /** Rótulo humano da tabela: vira o nome do arquivo exportado. */
  nome: string
  /** 0 desliga a paginação — para as tabelas curtas de resumo. */
  porPagina?: number
  aoClicarLinha?: (linha: T) => void
  ordemInicial?: SortingState
  vazio?: string
}) {
  const [ordem, setOrdem] = useState<SortingState>(ordemInicial ?? [])
  const tabela = useReactTable({
    data: dados,
    columns: colunas,
    state: { sorting: ordem },
    onSortingChange: setOrdem,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(porPagina ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    initialState: porPagina ? { pagination: { pageSize: porPagina, pageIndex: 0 } } : undefined,
  })

  if (!dados.length) return <Vazio id={`${id}-vazio`}>{vazio}</Vazio>
  const p = tabela.getState().pagination

  /**
   * O CSV leva a tabela **inteira** na ordem da tela, não a página visível:
   * `getPrePaginationRowModel` já vem ordenado. Baixar só as 50 linhas à vista
   * seria a armadilha óbvia — quem exporta quer o recorte, e o recorte são os
   * filtros globais, que já entraram na consulta.
   */
  const montarCsv = () => {
    const meta = (c: { columnDef: { meta?: unknown } }) => c.columnDef.meta as MetaColuna<T> | undefined
    const exportaveis = tabela
      .getAllLeafColumns()
      .filter((c) => meta(c)?.csv !== false && (typeof meta(c)?.csv === 'function' || !!c.accessorFn))
    return {
      cabecalho: exportaveis.map((c) =>
        typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id,
      ),
      linhas: tabela.getPrePaginationRowModel().rows.map((linha) =>
        exportaveis.map((c) => {
          const como = meta(c)?.csv
          return typeof como === 'function' ? como(linha.original) : linha.getValue(c.id)
        }),
      ),
    }
  }

  return (
    <>
      <div className="mb-1.5 flex justify-end">
        <BotaoCsv id={`${id}-csv`} nome={nome} montar={montarCsv} />
      </div>
      <div className="overflow-x-auto rounded-sm border border-borda bg-superficie">
        <table id={id} className="w-full border-collapse text-base">
          <thead>
            {tabela.getHeaderGroups().map((g) => (
              <tr key={g.id}>
                {g.headers.map((h) => {
                  const num = (h.column.columnDef.meta as MetaColuna<T> | undefined)?.num
                  const ordenavel = h.column.getCanSort()
                  const dir = h.column.getIsSorted()
                  // A dica sai da accessorKey, que já é o nome real da coluna
                  // no Parquet — nenhuma definição de coluna precisou mudar.
                  const dica = dicaDe(
                    (h.column.columnDef as { accessorKey?: string }).accessorKey ?? h.column.id,
                  )
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      title={dica}
                      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                      className={`rotulo border-b border-borda-forte bg-superficie px-2.5 py-2.5 font-medium whitespace-nowrap ${
                        num ? 'text-right' : 'text-left'
                      }`}
                    >
                      {ordenavel ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className="cursor-pointer hover:text-marca"
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          <span aria-hidden className="ml-1 inline-block w-2 text-marca">
                            {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : ''}
                          </span>
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {tabela.getRowModel().rows.map((linha) => (
              <tr
                key={linha.id}
                // `linha.id` é o índice no array de dados, não a posição na
                // tela: não muda ao ordenar nem ao paginar.
                id={`${id}-linha-${linha.id}`}
                {...(aoClicarLinha
                  ? {
                      onClick: () => aoClicarLinha(linha.original),
                      tabIndex: 0,
                      onKeyDown: (e) => e.key === 'Enter' && aoClicarLinha(linha.original),
                      className: 'cursor-pointer hover:bg-superficie-alt focus-visible:bg-superficie-alt',
                    }
                  : { className: 'hover:bg-superficie-alt' })}
              >
                {linha.getVisibleCells().map((c) => {
                  const num = (c.column.columnDef.meta as MetaColuna<T> | undefined)?.num
                  return (
                    <td
                      key={c.id}
                      className={`border-b border-borda px-2.5 py-2 align-top last:border-0 ${
                        num ? 'text-right whitespace-nowrap' : ''
                      }`}
                    >
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {porPagina > 0 && tabela.getPageCount() > 1 && (
        <div id={`${id}-paginacao`} className="mt-3 flex items-center justify-between gap-3 text-down-01 text-conteudo-fraco">
          <span>
            {(p.pageIndex * p.pageSize + 1).toLocaleString('pt-BR')}–
            {Math.min((p.pageIndex + 1) * p.pageSize, dados.length).toLocaleString('pt-BR')} de{' '}
            {dados.length.toLocaleString('pt-BR')}
          </span>
          <span className="flex gap-1.5">
            <button
              type="button"
              onClick={() => tabela.previousPage()}
              disabled={!tabela.getCanPreviousPage()}
              className="cursor-pointer rounded-sm border border-borda-forte px-2.5 py-1 hover:enabled:border-marca hover:enabled:text-marca disabled:opacity-40"
            >
              anterior
            </button>
            <button
              type="button"
              onClick={() => tabela.nextPage()}
              disabled={!tabela.getCanNextPage()}
              className="cursor-pointer rounded-sm border border-borda-forte px-2.5 py-1 hover:enabled:border-marca hover:enabled:text-marca disabled:opacity-40"
            >
              próxima
            </button>
          </span>
        </div>
      )}
    </>
  )
}
