import type { Colunas } from '../componentes/Tabela'
import type { Tom } from '../componentes/Basicos'

export const TOM_COLETA: Record<string, Tom> = {
  VALID: 'ok',
  HARVESTING_FINISHED_VALID: 'ok',
  HARVESTING_FINISHED_ERROR: 'down',
  SEM_COLETA: 'neutro',
  HARVESTING: 'warn',
}

/** Coluna de identificação, com a instituição em segunda linha. */
export function colunaFonte<
  T extends { source_name_raw: string; institution_name: string },
>(cabecalho = 'Fonte'): Colunas<T>[number] {
  return {
    header: cabecalho,
    accessorKey: 'source_name_raw',
    cell: (c) => (
      <>
        <span className="font-medium">{c.row.original.source_name_raw}</span>
        <br />
        <span className="text-down-01 text-conteudo-fraco">{c.row.original.institution_name}</span>
      </>
    ),
  }
}
