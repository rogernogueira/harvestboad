import { useEffect, useMemo, useRef, useState } from 'react'
import { onde, useConsulta, type Filtros } from '../ganchos'
import { lit } from '../duckdb'
import { Barras, Cartao, Cartoes, Carregando, Erro, Guia, Nota, Painel, Pilula, Secao } from '../componentes/Basicos'
import { Tabela } from '../componentes/Tabela'
import { n, pc } from '../formato'
import { REACOES, ordemReacao, reacao, rotuloReacao } from '../reacao'
import { colunaFonte } from './comum'

type Contagem = { reaction: string; outcome: string; n: number; registros: number }

export type Reacao = {
  codigo: string
  rotulo: string
  fontes: number
  registros: number
  /** Os desfechos crus da reação, do mais frequente ao menos: "25 http-403 · 187 disjuntor". */
  desfechos: string
}

type FonteReacao = {
  source_id: string
  source_name_raw: string
  institution_name: string
  platform_analysis_group: string
  endpoint_host: string | null
  outcome: string
  outcome_detail: string | null
  breaker_cause: string | null
  attempts: number
  live_records: number | null
}

/**
 * Contagem por reação no recorte dos filtros globais.
 *
 * Diferente do resto das tabelas de registro, `record_harvest` tem uma linha
 * por fonte do cadastro — as 610 que não responderam inclusive —, então o
 * JOIN com `v_source` não perde ninguém e o filtro vale como em qualquer aba.
 */
export function useReacoes(filtros: Filtros) {
  const w = onde(filtros)
  const consulta = useConsulta<Contagem>(
    useMemo(
      () => `SELECT h.reaction, h.outcome, count(*)::INT AS n,
                    COALESCE(sum(h.records_harvested), 0)::INT AS registros
             FROM record_harvest h JOIN v_source s USING (source_id) ${w}
             GROUP BY 1, 2`,
      [w],
    ),
  )
  const linhas = useMemo<Reacao[] | null>(() => {
    if (!consulta.dados) return null
    const grupos = new Map<string, Contagem[]>()
    for (const c of consulta.dados) grupos.set(c.reaction, [...(grupos.get(c.reaction) ?? []), c])
    return [...grupos.entries()]
      .map(([codigo, cs]) => ({
        codigo,
        rotulo: rotuloReacao(codigo),
        fontes: cs.reduce((a, c) => a + c.n, 0),
        registros: cs.reduce((a, c) => a + c.registros, 0),
        desfechos: [...cs]
          .sort((a, b) => b.n - a.n)
          .map((c) => `${n(c.n)} ${c.outcome}`)
          .join(' · '),
      }))
      .sort((a, b) => ordemReacao(a.codigo) - ordemReacao(b.codigo))
  }, [consulta.dados])
  // Pelo desfecho, não pela reação: 187 das fontes da SciELO também caíram no
  // disjuntor e não foram pedidas, embora a reação delas seja outra.
  const naoPedidas = useMemo(
    () =>
      (consulta.dados ?? [])
        .filter((c) => c.outcome === 'disjuntor' || c.outcome === 'sem-endpoint')
        .reduce((a, c) => a + c.n, 0),
    [consulta.dados],
  )
  return { linhas, naoPedidas, erro: consulta.erro }
}

/** As barras de reação, clicáveis quando há quem receba o clique. */
export function BarrasReacao({
  linhas,
  ativa,
  aoEscolher,
}: {
  linhas: Reacao[]
  ativa?: string | null
  aoEscolher?: (codigo: string) => void
}) {
  const porRotulo = new Map(linhas.map((l) => [l.rotulo, l.codigo]))
  return (
    <Barras
      itens={linhas.map((l) => ({ rotulo: l.rotulo, valor: l.fontes, tom: reacao(l.codigo)?.tom ?? 'neutro' }))}
      aoClicar={aoEscolher && ((r) => aoEscolher(porRotulo.get(r)!))}
      ativo={ativa ? rotuloReacao(ativa) : undefined}
    />
  )
}

/** "rede · ConnectTimeout", "disjuntor ← http-403": o desfecho numa célula só. */
const desfechoCompleto = (f: FonteReacao) =>
  [f.outcome, f.outcome_detail && `· ${f.outcome_detail}`, f.breaker_cause && `← ${f.breaker_cause}`]
    .filter(Boolean)
    .join(' ')

export function Repositorios({ filtros, aoAbrirFonte }: { filtros: Filtros; aoAbrirFonte: (id: string) => void }) {
  const [ativa, setAtiva] = useState<string | null>(null)
  const lista = useRef<HTMLDivElement>(null)
  const { linhas, naoPedidas, erro } = useReacoes(filtros)

  const w = onde(filtros)
  const fontes = useConsulta<FonteReacao>(
    useMemo(
      () =>
        ativa
          ? `SELECT s.source_id, s.source_name_raw, s.institution_name, s.platform_analysis_group,
                    h.endpoint_host, h.outcome, h.outcome_detail, h.breaker_cause, h.attempts,
                    h.live_records
             FROM record_harvest h JOIN v_source s USING (source_id)
             ${w ? `${w} AND` : 'WHERE'} h.reaction = ${lit(ativa)}
             ORDER BY h.endpoint_host NULLS LAST, s.source_name_raw`
          : null,
      [w, ativa],
    ),
  )

  // Vivos e distintos, não recebidos: dos 318.953 cabeçalhos, 22.934 são de
  // registro excluído — sem metadado — e 359 são o mesmo registro servido de
  // novo pela paginação. Somar records_harvested contaria os dois como coleta.
  const coletados = useConsulta<{ vivos: number; excluidos: number }>(
    useMemo(
      () => `SELECT count(DISTINCT r.source_id || '|' || r.oai_identifier) FILTER (NOT r.deleted)::INT AS vivos,
                    count(*) FILTER (r.deleted)::INT AS excluidos
             FROM records r JOIN v_source s USING (source_id) ${w}`,
      [w],
    ),
  )

  const escolher = (codigo: string) => setAtiva((a) => (a === codigo ? null : codigo))

  // Levar a lista até a vista só quando a escolha muda — não a cada filtro,
  // que refaz a consulta com a mesma reação e não deve arrastar a página.
  useEffect(() => {
    if (ativa) lista.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [ativa])

  if (erro) return <Erro mensagem={erro} />
  if (!linhas) return <Carregando o="os desfechos" />

  const total = linhas.reduce((a, l) => a + l.fontes, 0)
  const ok = linhas.find((l) => l.codigo === 'respondeu')
  const pedidas = total - naoPedidas
  const escolhida = ativa ? reacao(ativa) : undefined

  return (
    <>
      <Guia>
        Como cada fonte reagiu ao <span className="tracking-[0.02em]">ListRecords</span> de <b>22/09/2026</b>, pedido
        direto à origem, sem passar pelo agregador. <b>Clique numa reação</b> para listar as fontes dela, e numa
        fonte para abrir a ficha.
      </Guia>

      <Cartoes>
        <Cartao chave="Fontes no recorte" valor={n(total)} nota={`${n(pedidas)} efetivamente pedidas`} />
        <Cartao
          chave="Responderam"
          valor={n(ok?.fontes ?? 0)}
          nota={pc(total ? (ok?.fontes ?? 0) / total : 0)}
          tom="ok"
        />
        <Cartao
          chave="Não responderam"
          valor={n(total - (ok?.fontes ?? 0))}
          nota={`em ${n(linhas.length - (ok ? 1 : 0))} reações`}
          tom={total - (ok?.fontes ?? 0) ? 'warn' : 'ok'}
        />
        <Cartao
          chave="Registros coletados"
          valor={coletados.dados ? n(coletados.dados[0].vivos) : '…'}
          nota={coletados.dados ? `vivos e distintos · mais ${n(coletados.dados[0].excluidos)} excluídos, sem metadado` : ''}
        />
      </Cartoes>

      <Secao>Reação à coleta de registros</Secao>
      <Painel>
        <BarrasReacao linhas={linhas} ativa={ativa} aoEscolher={escolher} />
      </Painel>

      <div className="mt-4">
        <Tabela
          id="repositorios-reacoes"
          dados={linhas}
          nome="Reação das fontes à coleta de registros"
          aoClicarLinha={(l) => escolher(l.codigo)}
          colunas={[
            {
              header: 'Reação',
              accessorKey: 'rotulo',
              cell: (c) => (
                <span className={`font-medium ${c.row.original.codigo === ativa ? 'text-marca' : ''}`}>
                  {c.row.original.codigo === ativa ? '▸ ' : ''}
                  {c.getValue() as string}
                </span>
              ),
            },
            { header: 'Fontes', accessorKey: 'fontes', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            {
              id: 'parcela',
              header: 'Parcela',
              accessorFn: (l) => (total ? l.fontes / total : 0),
              meta: { num: true },
              cell: (c) => pc(c.getValue() as number),
            },
            {
              header: 'Desfechos',
              accessorKey: 'desfechos',
              cell: (c) => <span className="text-down-01 break-words text-conteudo-fraco">{c.getValue() as string}</span>,
            },
          ]}
        />
      </div>

      <div ref={lista} className="scroll-mt-[240px] max-[700px]:scroll-mt-[100px]">
        {escolhida ? (
          <>
            <Secao>
              {escolhida.rotulo} — {n(linhas.find((l) => l.codigo === ativa)?.fontes ?? 0)} fontes
            </Secao>
            <Guia>
              {escolhida.sentido}{' '}
              <button
                type="button"
                onClick={() => setAtiva(null)}
                className="cursor-pointer text-marca underline underline-offset-2"
              >
                limpar seleção
              </button>
            </Guia>
            {fontes.erro && <Erro mensagem={fontes.erro} />}
            {fontes.dados ? (
              <Tabela
                id="repositorios-fontes"
                dados={fontes.dados}
                nome={`Fontes — ${escolhida.rotulo}`}
                porPagina={25}
                aoClicarLinha={(f) => aoAbrirFonte(f.source_id)}
                vazio="Nenhuma fonte desta reação no recorte atual."
                colunas={[
                  colunaFonte<FonteReacao>(),
                  {
                    header: 'Plataforma',
                    accessorKey: 'platform_analysis_group',
                    cell: (c) => <Pilula>{c.getValue() as string}</Pilula>,
                  },
                  {
                    header: 'Servidor',
                    accessorKey: 'endpoint_host',
                    cell: (c) => <span className="text-down-01 break-all">{(c.getValue() as string) ?? '—'}</span>,
                  },
                  {
                    id: 'desfecho',
                    header: 'Desfecho',
                    accessorFn: desfechoCompleto,
                    cell: (c) => <span className="text-down-01 tracking-[0.02em]">{c.getValue() as string}</span>,
                  },
                  { header: 'Tentativas', accessorKey: 'attempts', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
                  {
                    header: 'Vivos',
                    accessorKey: 'live_records',
                    meta: { num: true },
                    cell: (c) => (c.getValue() === null ? <span className="text-conteudo-fraco">—</span> : n(c.getValue() as number)),
                  },
                ]}
              />
            ) : (
              !fontes.erro && <Carregando o="as fontes" />
            )}
          </>
        ) : (
          <Nota>
            <b>Nenhuma reação escolhida.</b> Clique numa barra ou numa linha da tabela acima para listar as fontes.
          </Nota>
        )}
      </div>

      <Secao>O que cada reação quer dizer</Secao>
      <Tabela
        id="repositorios-sentidos"
        dados={REACOES}
        nome="Sentido das reações"
        colunas={[
          { header: 'Reação', accessorKey: 'rotulo', cell: (c) => <Pilula tom={c.row.original.tom}>{c.getValue() as string}</Pilula> },
          { header: 'Código', accessorKey: 'codigo', cell: (c) => <span className="text-down-01 tracking-[0.02em] text-conteudo-fraco">{c.getValue() as string}</span> },
          { header: 'Sentido', accessorKey: 'sentido', cell: (c) => <span className="text-down-01 text-conteudo-fraco">{c.getValue() as string}</span> },
        ]}
      />
      <Nota>
        <b>Disjuntor não é falha da fonte.</b> Depois de falhas seguidas no mesmo servidor, a coleta parou de pedir às
        fontes restantes dele. O desfecho mostra o que abriu o disjuntor — <span className="tracking-[0.02em]">disjuntor ← http-403</span>{' '}
        —, mas a fonte em si não foi consultada, e pode estar no ar.
      </Nota>
    </>
  )
}
