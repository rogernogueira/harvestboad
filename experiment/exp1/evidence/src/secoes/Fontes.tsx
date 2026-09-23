import { useMemo } from 'react'
import { onde, useConsulta, type Filtros } from '../ganchos'
import { Carregando, Erro, Guia, Pilula, Secao, type Tom } from '../componentes/Basicos'
import { Tabela } from '../componentes/Tabela'
import { n, razao } from '../formato'
import { TOM_COLETA, colunaFonte } from './comum'

const CRITERIOS: { campo: string; rotulo: string; tom: Tom }[] = [
  { campo: 'crit_erro', rotulo: 'erro na coleta', tom: 'down' },
  { campo: 'crit_persistente', rotulo: 'falha persistente', tom: 'down' },
  { campo: 'crit_vazio', rotulo: 'acervo vazio', tom: 'down' },
  { campo: 'crit_parada', rotulo: 'parada há +2 anos', tom: 'warn' },
  { campo: 'crit_baixa_validade', rotulo: 'validade abaixo de 50%', tom: 'warn' },
  { campo: 'crit_fora_indice', rotulo: 'fora do índice', tom: 'warn' },
  { campo: 'crit_inativa', rotulo: 'cadastro inativo', tom: 'neutro' },
]

type Linha = {
  source_id: string
  source_name_raw: string
  institution_name: string
  subdivision_code: string
  platform_analysis_group: string
  source_type_detail: string
  latest_snapshot_status: string
  latest_size: number | null
  latest_valid_size: number | null
  days_since_last_harvest: number | null
  snapshot_count: number | null
  failure_count: number | null
  n_criterios: number
} & Record<string, unknown>

const CAMPOS = `source_id, source_name_raw, institution_name, subdivision_code,
  platform_analysis_group, source_type_detail, latest_snapshot_status,
  latest_size, latest_valid_size, days_since_last_harvest,
  snapshot_count, failure_count, n_criterios,
  ${CRITERIOS.map((c) => c.campo).join(', ')}`

export function Fontes({ filtros, aoAbrirFonte }: { filtros: Filtros; aoAbrirFonte: (id: string) => void }) {
  const w = onde(filtros)

  const atencao = useConsulta<Linha>(
    useMemo(
      () => `SELECT ${CAMPOS} FROM v_attention ${w} ${w ? 'AND' : 'WHERE'} n_criterios > 0
             ORDER BY n_criterios DESC, latest_size DESC NULLS LAST LIMIT 25`,
      [w],
    ),
  )
  const todas = useConsulta<Linha>(
    useMemo(() => `SELECT ${CAMPOS} FROM v_attention ${w} ORDER BY latest_size DESC NULLS LAST`, [w]),
  )

  const primeiroErro = [atencao, todas].find((c) => c.erro)
  if (primeiroErro?.erro) return <Erro mensagem={primeiroErro.erro} />

  return (
    <>
      <Secao>Fontes que requerem atenção</Secao>
      <Guia>
        Sem ranking de "piores": cada fonte abaixo satisfaz um ou mais critérios objetivos, listados na linha. A
        ordenação é pelo número de critérios e, em empate, pelo volume de registros afetados.
      </Guia>
      {atencao.dados ? (
        <Tabela
          id="fontes-atencao"
          dados={atencao.dados}
          nome="Fontes em atenção"
          aoClicarLinha={(l) => aoAbrirFonte(l.source_id)}
          vazio="Nenhuma fonte do recorte atende a algum critério de atenção."
          colunas={[
            {
              header: 'Fonte',
              accessorKey: 'source_name_raw',
              cell: (c) => (
                <>
                  <span className="font-medium">{c.row.original.source_name_raw}</span>
                  <br />
                  <span className="text-down-01 text-conteudo-fraco">
                    {c.row.original.institution_name} · {c.row.original.subdivision_code}
                  </span>
                </>
              ),
            },
            {
              header: 'Critérios atendidos',
              id: 'criterios',
              enableSorting: false,
              // A coluna não tem acessador — o conteúdo são fichas montadas de
              // sete campos booleanos —, então o CSV precisa dizer o que leva.
              meta: {
                csv: (l: Linha) =>
                  CRITERIOS.filter((k) => l[k.campo])
                    .map((k) => k.rotulo)
                    .join(' · '),
              },
              cell: (c) => (
                <span className="flex flex-wrap gap-1">
                  {CRITERIOS.filter((k) => c.row.original[k.campo]).map((k) => (
                    <Pilula key={k.campo} tom={k.tom}>
                      {k.rotulo}
                    </Pilula>
                  ))}
                </span>
              ),
            },
            { header: 'Registros', accessorKey: 'latest_size', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            {
              header: 'Falhas',
              accessorKey: 'failure_count',
              meta: { num: true },
              cell: (c) => (
                <>
                  {n(c.row.original.failure_count)}
                  <span className="text-down-01 text-conteudo-fraco">/{n(c.row.original.snapshot_count)}</span>
                </>
              ),
            },
          ]}
        />
      ) : (
        <Carregando o="os critérios" />
      )}

      <Secao>Todas as fontes</Secao>
      <Guia>
        Ordenável por qualquer coluna, paginada no navegador. Clique numa linha para o perfil individual.
      </Guia>
      {todas.dados ? (
        <Tabela
          id="fontes-todas"
          dados={todas.dados}
          nome="Todas as fontes"
          porPagina={50}
          aoClicarLinha={(l) => aoAbrirFonte(l.source_id)}
          colunas={[
            colunaFonte<Linha>(),
            { header: 'UF', accessorKey: 'subdivision_code', cell: (c) => <span className="text-down-01 text-conteudo-fraco">{c.getValue() as string}</span> },
            { header: 'Plataforma', accessorKey: 'platform_analysis_group', cell: (c) => <Pilula>{c.getValue() as string}</Pilula> },
            { header: 'Tipo', accessorKey: 'source_type_detail', cell: (c) => <span className="text-down-01 text-conteudo-fraco">{c.getValue() as string}</span> },
            {
              header: 'Coleta',
              accessorKey: 'latest_snapshot_status',
              cell: (c) => <Pilula tom={TOM_COLETA[c.getValue() as string]}>{c.getValue() as string}</Pilula>,
            },
            { header: 'Registros', accessorKey: 'latest_size', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            {
              header: 'Validade',
              id: 'validade',
              // O `-1` do acessador é sentinela de ordenação — manda a fonte
              // sem registro para o fim. Exportado viria como validade de
              // -100%, então o CSV leva o nulo que a tela mostra como "—".
              meta: {
                num: true,
                csv: (l: Linha) => (l.latest_size ? (l.latest_valid_size ?? 0) / l.latest_size : null),
              },
              accessorFn: (l) => (l.latest_size ? (l.latest_valid_size ?? 0) / l.latest_size : -1),
              cell: (c) => razao(c.row.original.latest_valid_size, c.row.original.latest_size),
            },
            { header: 'Dias', accessorKey: 'days_since_last_harvest', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
          ]}
        />
      ) : (
        <Carregando o="as fontes" />
      )}
    </>
  )
}
