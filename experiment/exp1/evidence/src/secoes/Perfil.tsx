import { useEffect, useRef } from 'react'
import { useConsulta } from '../ganchos'
import { comRegistros, lit } from '../duckdb'
import { Carregando, Erro, Pilula } from '../componentes/Basicos'
import { reacao } from '../reacao'
import { n, data, razao } from '../formato'
import { BarraCsv } from '../componentes/BotaoCsv'
import { TOM_COLETA } from './comum'

type Ficha = Record<string, string | number | null>
type Coleta = {
  snapshot_id: string
  status: string
  start_time: string
  size: number
  valid_size: number
}
type Desfecho = {
  reaction: string
  outcome: string
  outcome_detail: string | null
  breaker_cause: string | null
  requested_url: string | null
  attempts: number
  tls_verified: boolean | null
  browser_agent: boolean
  pages: number | null
  live_records: number | null
  records_harvested: number
  has_more: boolean | null
  datestamp_min: string | null
  datestamp_max: string | null
}

/** Perfil individual num <dialog> nativo: traz `inert` e captura de foco de graça. */
export function Perfil({ id, aoFechar }: { id: string | null; aoFechar: () => void }) {
  const caixa = useRef<HTMLDialogElement>(null)

  const ficha = useConsulta<Ficha>(
    id
      ? `SELECT source_name_raw, institution_name, institution_acronym, institution_type,
                subdivision_code, source_type_detail, source_status, harvest_endpoint_url,
                platform_analysis_group, platform_product, platform_confidence,
                platform_detection_method, harvest_scope, oai_repository_name,
                harvest_metadata_prefix, metadata_profile,
                latest_snapshot_status, latest_index_status, latest_size, latest_valid_size,
                latest_transformed_size, days_since_last_harvest, snapshot_count,
                failure_count, max_failure_streak, current_failure_streak, persistent
         FROM v_source WHERE source_id = ${lit(id)}`
      : null,
  )
  const historico = useConsulta<Coleta>(
    id
      ? `SELECT snapshot_id, status, start_time::VARCHAR AS start_time, size, valid_size
         FROM snapshots WHERE source_id = ${lit(id)} ORDER BY ordem LIMIT 12`
      : null,
  )

  // Só existe com a camada de registro; sem ela a ficha abre sem o bloco.
  const desfecho = useConsulta<Desfecho>(
    id && comRegistros()
      ? `SELECT reaction, outcome, outcome_detail, breaker_cause, requested_url, attempts,
                tls_verified, browser_agent, pages, live_records, records_harvested, has_more,
                datestamp_min, datestamp_max
         FROM record_harvest WHERE source_id = ${lit(id)}`
      : null,
  )

  useEffect(() => {
    const d = caixa.current
    if (!d) return
    if (id && !d.open) d.showModal()
    if (!id && d.open) d.close()
  }, [id])

  const f = ficha.dados?.[0]
  // A consulta anterior fica em `dados` até a nova chegar; sem `id` não há o que mostrar.
  const r = id && comRegistros() ? desfecho.dados?.[0] : undefined
  const rr = r ? reacao(r.reaction) : undefined

  return (
    <dialog
      ref={caixa}
      onClose={aoFechar}
      onClick={(e) => e.target === caixa.current && aoFechar()}
      className="m-auto w-[calc(100vw-32px)] max-w-[620px] rounded border border-borda-forte bg-superficie p-0 text-conteudo backdrop:bg-black/55"
    >
      <div className="p-5">
        {ficha.erro && <Erro mensagem={ficha.erro} />}
        {!f && !ficha.erro && <Carregando o="a fonte" />}
        {f && (
          <>
            <h3 className="text-base font-semibold">{f.source_name_raw}</h3>
            <p className="mb-4 text-down-01 text-conteudo-fraco">{f.institution_name}</p>

            <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-base">
              {(
                [
                  ['Identificador', id],
                  ['Natureza', f.institution_type],
                  ['UF', f.subdivision_code],
                  ['Tipo de fonte', f.source_type_detail],
                  ['Situação cadastral', f.source_status],
                  ['Plataforma', f.platform_analysis_group],
                  ['Produto', f.platform_product],
                  ['Confiança', f.platform_confidence],
                  ['Método de detecção', f.platform_detection_method],
                  ['Escopo', f.harvest_scope],
                  ['Formato', f.harvest_metadata_prefix],
                  ['Perfil', f.metadata_profile],
                  ['Coleta', f.latest_snapshot_status],
                  ['Índice', f.latest_index_status],
                  ['Coletados', n(f.latest_size as number)],
                  ['Válidos', `${n(f.latest_valid_size as number)} (${razao(f.latest_valid_size as number, f.latest_size as number)})`],
                  ['Transformados', `${n(f.latest_transformed_size as number)} (${razao(f.latest_transformed_size as number, f.latest_size as number)})`],
                  ['Dias sem coletar', n(f.days_since_last_harvest as number)],
                  ['Histórico', `${n(f.snapshot_count as number)} coletas · ${n(f.failure_count as number)} falhas`],
                  ['Maior sequência de falhas', n(f.max_failure_streak as number)],
                  ['Falha persistente', f.persistent ? 'sim' : 'não'],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="rotulo pt-0.5">{k}</dt>
                  <dd className="num m-0 min-w-0 break-all">{v ?? '—'}</dd>
                </div>
              ))}
            </dl>

            {f.harvest_endpoint_url && (
              <p className="mt-3 text-down-01 break-all text-conteudo-fraco">{f.harvest_endpoint_url}</p>
            )}

            {r && (
              <>
                <h4 className="rotulo mt-5 mb-2 border-b border-borda pb-1.5">Coleta de registros — 22/09/2026</h4>
                <p className="mb-2">
                  <Pilula tom={rr?.tom ?? 'neutro'}>{rr?.rotulo ?? r.reaction}</Pilula>
                </p>
                {rr && <p className="mb-2.5 text-down-01 text-conteudo-fraco">{rr.sentido}</p>}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-base">
                  {(
                    [
                      ['Desfecho', r.outcome],
                      ['Detalhe', r.outcome_detail],
                      ['Disjuntor aberto por', r.breaker_cause],
                      ['Tentativas', n(r.attempts)],
                      ['TLS verificado', r.tls_verified === null ? null : r.tls_verified ? 'sim' : 'não'],
                      ['Agente de navegador', r.browser_agent ? 'sim' : null],
                      ['Páginas', r.pages === null ? null : n(r.pages)],
                      ['Registros recebidos', r.records_harvested ? n(r.records_harvested) : null],
                      ['Vivos', r.live_records === null ? null : n(r.live_records)],
                      ['Amostra truncada', r.has_more === null ? null : r.has_more ? 'sim' : 'não'],
                      [
                        'Datestamps',
                        r.datestamp_min ? `${data(r.datestamp_min)} a ${data(r.datestamp_max)}` : null,
                      ],
                    ] as const
                  )
                    .filter(([, v]) => v !== null && v !== undefined)
                    .map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="rotulo pt-0.5">{k}</dt>
                        <dd className="num m-0 min-w-0 break-all">{v}</dd>
                      </div>
                    ))}
                </dl>
                {r.requested_url && r.requested_url !== f.harvest_endpoint_url && (
                  <p className="mt-2 text-down-01 break-all text-conteudo-fraco">pedido em {r.requested_url}</p>
                )}
              </>
            )}

            {historico.dados && historico.dados.length > 0 && (
              <>
                <h4 className="rotulo mt-5 mb-2 border-b border-borda pb-1.5">Últimas coletas</h4>
                <BarraCsv
                  id="perfil-coletas-csv"
                  nome={`Coletas de ${f.source_name_raw}`}
                  montar={() => ({
                    cabecalho: ['snapshot_id', 'start_time', 'status', 'size', 'valid_size'],
                    linhas: historico.dados!.map((c) => [
                      c.snapshot_id,
                      c.start_time,
                      c.status,
                      c.size,
                      c.valid_size,
                    ]),
                  })}
                />
                <table id="perfil-coletas" className="w-full text-down-01">
                  <tbody>
                    {historico.dados.map((c) => (
                      <tr key={c.snapshot_id} id={`perfil-coletas-linha-${c.snapshot_id}`} className="border-b border-borda last:border-0">
                        <td className="py-1 text-conteudo-fraco">{data(c.start_time)}</td>
                        <td className="py-1">
                          <Pilula tom={TOM_COLETA[c.status]}>{c.status}</Pilula>
                        </td>
                        <td className="num py-1 text-right">{n(c.size)}</td>
                        <td className="num py-1 text-right text-conteudo-fraco">{razao(c.valid_size, c.size)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <button
              type="button"
              onClick={aoFechar}
              className="mt-5 w-full cursor-pointer rounded-sm border border-borda-forte bg-superficie-alt py-2 text-base hover:border-marca hover:text-marca"
            >
              fechar
            </button>
          </>
        )}
      </div>
    </dialog>
  )
}
