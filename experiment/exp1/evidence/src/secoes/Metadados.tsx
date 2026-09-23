import { useEffect, useMemo, useRef, useState } from 'react'
import { onde, useConsulta, type Filtros } from '../ganchos'
import { consultar, lit, valoresDaFonte } from '../duckdb'
import { Barras, Cartao, Cartoes, Carregando, Erro, Guia, Nota, Painel, Pilula, Secao, type Tom } from '../componentes/Basicos'
import { Tabela } from '../componentes/Tabela'
import { Janela, useJanela } from '../componentes/Janela'
import { n, paraId, pc } from '../formato'
import { FICHAS_REGRA } from '../fichasRegra'
import { colunaFonte } from './comum'

/*
 * As 15 regras de metadado OpenAIRE aplicadas a cada registro vivo da amostra.
 *
 * A aba lê só `record_metadata` e `metadata_rules`, e responde aos filtros
 * globais pelo JOIN com `v_source`. O que é definição — obrigatoriedade,
 * quantificador, fidelidade — vem do dataset; o que é explicação vem de
 * `fichasRegra.ts`.
 *
 * "Conforme" nesta aba quer dizer uma coisa só: o registro atende **todas as
 * regras obrigatórias**. Regra opcional que viola não tira a conformidade, e a
 * 119 (nao-verificavel) não conta nem a favor nem contra.
 */

type Regra = {
  rule_id: number
  rule_name: string
  description: string
  required: boolean
  quantifier: string
  oai_dc_element: string
  fidelity: string
  fidelity_note: string | null
  avaliados: number
  atende: number
  viola: number
  nao_aplica: number
}

type Fonte = {
  source_id: string
  source_name_raw: string
  institution_name: string
  platform_analysis_group: string
  registros: number
  conformes: number
  taxa: number
  obrigatorias_violadas: number
}

type Registro = {
  oai_identifier: string
  violadas_obrig: number
  violadas_opc: number
  regras_violadas: string
}

type Avaliacao = {
  rule_id: number
  rule_name: string
  required: boolean
  quantifier: string
  fidelity: string
  fidelity_note: string | null
  applicable: boolean
  status: string
  occurrences: number | null
  valid_occurrences: number | null
  invalid_sample: string | null
}

type Valor = { rule_id: number; ordinal: number; value: string; value_length: number; valid: boolean }

/**
 * Os valores de cada regra para um registro, agrupados por `rule_id`.
 * `undefined` enquanto carrega; `null` quando os valores não estão
 * disponíveis — painel autocontido ou partição ausente —, e aí o relatório
 * volta às contagens de `record_metadata`.
 */
function useValores(source_id: string, oai_identifier: string) {
  const [valores, setValores] = useState<Map<number, Valor[]> | null | undefined>(undefined)
  useEffect(() => {
    let vivo = true
    setValores(undefined)
    ;(async () => {
      const visao = await valoresDaFonte(source_id)
      if (!visao) return vivo && setValores(null)
      try {
        const linhas = await consultar<Valor>(
          `SELECT rule_id, ordinal, value, value_length, valid FROM ${visao}
           WHERE oai_identifier = ${lit(oai_identifier)}
           ORDER BY rule_id, ordinal`,
        )
        const grupos = new Map<number, Valor[]>()
        for (const v of linhas) grupos.set(v.rule_id, [...(grupos.get(v.rule_id) ?? []), v])
        if (vivo) setValores(grupos)
      } catch {
        if (vivo) setValores(null)
      }
    })()
    return () => {
      vivo = false
    }
  }, [source_id, oai_identifier])
  return valores
}

/** O valor como o validador mostra: o começo, com reticências quando houve corte. */
const trecho = (v: Valor) => (v.value_length > v.value.length ? `${v.value}…` : v.value || '(vazio)')

const TOM_FIDELIDADE: Record<string, Tom> = { exata: 'ok', aproximada: 'warn', 'nao-verificavel': 'neutro' }
const ROTULO_FIDELIDADE: Record<string, string> = {
  exata: 'exata',
  aproximada: 'aproximada',
  'nao-verificavel': 'não verificável',
}
const TOM_STATUS: Record<string, Tom> = { atende: 'ok', viola: 'down', 'nao-verificavel': 'neutro' }
const ROTULO_STATUS: Record<string, string> = { atende: 'Atende', viola: 'Viola', 'nao-verificavel': 'Não verificável' }

/** Registro por registro: se atende todas as obrigatórias. É a base de todo número de conformidade da aba. */
const porRegistro = (w: string) => `
  SELECT m.source_id, m.oai_identifier,
         count(*) FILTER (r.required AND m.status = 'viola')     AS violadas_obrig,
         count(*) FILTER (NOT r.required AND m.status = 'viola') AS violadas_opc
  FROM record_metadata m
  JOIN metadata_rules r USING (rule_id)
  JOIN v_source s USING (source_id)
  ${w}
  GROUP BY 1, 2`

export function Metadados({ filtros }: { filtros: Filtros }) {
  const w = onde(filtros)
  const [fonte, setFonte] = useState<Fonte | null>(null)
  const lista = useRef<HTMLDivElement>(null)
  const ficha = useJanela<Regra>()
  const registro = useJanela<{ source_id: string; oai_identifier: string; fonte: string }>()

  const regras = useConsulta<Regra>(
    useMemo(
      () => `SELECT r.rule_id, r.rule_name, r.description, r.required, r.quantifier, r.oai_dc_element,
                    r.fidelity, r.fidelity_note,
                    count(m.rule_id)::INT                               AS avaliados,
                    count(*) FILTER (m.status = 'atende')::INT          AS atende,
                    count(*) FILTER (m.status = 'viola')::INT           AS viola,
                    count(*) FILTER (NOT m.applicable)::INT             AS nao_aplica
             FROM metadata_rules r
             LEFT JOIN (SELECT m.* FROM record_metadata m JOIN v_source s USING (source_id) ${w}) m
               USING (rule_id)
             GROUP BY ALL ORDER BY r.rule_id`,
      [w],
    ),
  )

  const totais = useConsulta<{ registros: number; conformes: number; fontes: number; so_uma: number }>(
    useMemo(
      () => `SELECT count(*)::INT AS registros,
                    count(*) FILTER (violadas_obrig = 0)::INT AS conformes,
                    count(DISTINCT source_id)::INT AS fontes,
                    count(*) FILTER (violadas_obrig = 1)::INT AS so_uma
             FROM (${porRegistro(w)})`,
      [w],
    ),
  )

  const fontes = useConsulta<Fonte>(
    useMemo(
      () => `SELECT p.source_id, s.source_name_raw, s.institution_name, s.platform_analysis_group,
                    count(*)::INT AS registros,
                    count(*) FILTER (p.violadas_obrig = 0)::INT AS conformes,
                    count(*) FILTER (p.violadas_obrig = 0) / count(*)::DOUBLE AS taxa,
                    avg(p.violadas_obrig) AS obrigatorias_violadas
             FROM (${porRegistro(w)}) p JOIN v_source s USING (source_id)
             GROUP BY ALL ORDER BY taxa DESC, registros DESC, p.source_id`,
      [w],
    ),
  )

  const registros = useConsulta<Registro>(
    useMemo(
      () =>
        fonte
          ? `SELECT m.oai_identifier,
                    count(*) FILTER (r.required AND m.status = 'viola')::INT     AS violadas_obrig,
                    count(*) FILTER (NOT r.required AND m.status = 'viola')::INT AS violadas_opc,
                    COALESCE(string_agg(m.rule_id::VARCHAR, ' · ' ORDER BY m.rule_id)
                             FILTER (m.status = 'viola'), '')                    AS regras_violadas
             FROM record_metadata m JOIN metadata_rules r USING (rule_id)
             WHERE m.source_id = ${lit(fonte.source_id)}
             GROUP BY 1 ORDER BY violadas_obrig DESC, violadas_opc DESC, 1`
          : null,
      [fonte],
    ),
  )

  // Levar a lista até a vista só quando a fonte escolhida muda.
  useEffect(() => {
    if (fonte) lista.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [fonte])

  const erro = [regras, totais, fontes].find((c) => c.erro)?.erro
  if (erro) return <Erro mensagem={erro} />
  const t = totais.dados?.[0]
  const obrigatorias = (regras.dados ?? []).filter((r) => r.required && r.avaliados)
  const pior = [...obrigatorias].sort((a, b) => b.viola / b.avaliados - a.viola / a.avaliados)[0]

  return (
    <>
      <Guia>
        As <b>15 regras de metadado OpenAIRE</b> aplicadas a cada registro vivo da amostra de{' '}
        <span className="tracking-[0.02em]">ListRecords</span> de 22/09/2026. Um registro é <b>conforme</b> quando
        atende todas as regras <b>obrigatórias</b>; regra opcional que viola aponta melhoria, não reprova. A amostra é
        em <span className="tracking-[0.02em]">oai_dc</span>, onde os campos qualificados do DSpace colapsam: duas
        regras são aproximadas e uma não é verificável — a coluna <b>Fidelidade</b> diz quais.
      </Guia>

      {t ? (
        <Cartoes>
          <Cartao chave="Registros avaliados" valor={n(t.registros)} nota={`de ${n(t.fontes)} fontes`} />
          <Cartao
            chave="Conformes"
            valor={n(t.conformes)}
            nota={`${pc(t.registros ? t.conformes / t.registros : null)} atendem todas as obrigatórias`}
            tom={t.registros && t.conformes / t.registros < 0.5 ? 'down' : 'ok'}
          />
          <Cartao
            chave="A uma regra de conformes"
            valor={n(t.so_uma)}
            nota="violam uma única obrigatória"
            tom="warn"
          />
          {pior && (
            <Cartao
              chave="Obrigatória mais violada"
              valor={pc(pior.viola / pior.avaliados)}
              nota={`${pior.rule_id} ${pior.rule_name}`}
              tom="down"
            />
          )}
        </Cartoes>
      ) : (
        <Carregando o="a avaliação" />
      )}

      <Secao>As 15 regras</Secao>
      <Guia>
        <b>Clique numa regra</b> para abrir a ficha: o que verifica, para que existe, um exemplo e os valores que mais
        reprovam no recorte.
      </Guia>
      {regras.dados ? (
        <>
          <Painel titulo="Registros que atendem cada regra">
            <Barras
              itens={regras.dados
                .filter((r) => r.fidelity !== 'nao-verificavel')
                .map((r) => ({
                  rotulo: `${r.rule_id} ${r.rule_name}${r.required ? ' *' : ''}`,
                  valor: r.avaliados ? Math.round((r.atende / r.avaliados) * 1000) / 10 : 0,
                  // Obrigatória abaixo de 95% é defeito; opcional é oportunidade.
                  tom: r.avaliados && r.atende / r.avaliados >= 0.95 ? 'ok' : r.required ? 'down' : 'warn',
                }))}
            />
            <p className="mt-3 text-down-01 text-conteudo-fraco">
              Em pontos percentuais. * obrigatória. A 119 fica de fora: não é verificável em oai_dc.
            </p>
          </Painel>

          <div className="mt-4">
            <Tabela
              id="metadados-regras"
              dados={regras.dados}
              nome="Regras de metadado OpenAIRE"
              aoClicarLinha={ficha.abrir}
              colunas={[
                { header: 'Id', accessorKey: 'rule_id', meta: { num: true } },
                {
                  header: 'Regra',
                  accessorKey: 'rule_name',
                  cell: (c) => (
                    <>
                      <span className="font-medium">{c.getValue() as string}</span>
                      <br />
                      <span className="text-down-01 text-marca">ver ficha</span>
                    </>
                  ),
                },
                {
                  header: 'Obrigatória',
                  accessorKey: 'required',
                  cell: (c) => <Pilula tom={c.getValue() ? 'marca' : 'neutro'}>{c.getValue() ? 'sim' : 'não'}</Pilula>,
                },
                {
                  header: 'Quantificador',
                  accessorKey: 'quantifier',
                  cell: (c) => <span className="text-down-01 tracking-[0.02em]">{c.getValue() as string}</span>,
                },
                {
                  header: 'Fidelidade',
                  accessorKey: 'fidelity',
                  cell: (c) => (
                    <Pilula tom={TOM_FIDELIDADE[c.getValue() as string] ?? 'neutro'}>
                      {ROTULO_FIDELIDADE[c.getValue() as string] ?? (c.getValue() as string)}
                    </Pilula>
                  ),
                },
                {
                  id: 'taxa_atende',
                  header: 'Atende',
                  accessorFn: (r) => (r.fidelity === 'nao-verificavel' || !r.avaliados ? null : r.atende / r.avaliados),
                  meta: { num: true },
                  cell: (c) => pc(c.getValue() as number | null),
                },
                { header: 'Violam', accessorKey: 'viola', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
              ]}
            />
          </div>
        </>
      ) : (
        <Carregando o="as regras" />
      )}

      <Nota>
        <b>Um registro, uma regra, um veredito.</b> A regra atende com ao menos uma ocorrência válida (
        <span className="tracking-[0.02em]">ONE_OR_MORE</span>) ou com exatamente uma (
        <span className="tracking-[0.02em]">ONE_ONLY</span> — versão e nível de acesso). Regra que não se aplica ao
        registro, como data de liberação sem embargo ou orientador fora de TCC, tese e dissertação, <b>atende</b>, como
        no validador de referência. Registro excluído não entra: vem só com cabeçalho.
      </Nota>

      <Secao>Por fonte</Secao>
      <Guia>
        A conformidade é configuração de quem publica, não de cada artigo: fontes com a mesma plataforma tendem a errar
        nas mesmas regras. <b>Clique numa fonte</b> para ver os registros dela, e num registro para o relatório das 15
        regras.
      </Guia>
      {fontes.dados ? (
        <Tabela
          id="metadados-fontes"
          dados={fontes.dados}
          nome="Conformidade OpenAIRE por fonte"
          porPagina={20}
          aoClicarLinha={(f) => setFonte((atual) => (atual?.source_id === f.source_id ? null : f))}
          colunas={[
            colunaFonte<Fonte>(),
            {
              header: 'Plataforma',
              accessorKey: 'platform_analysis_group',
              cell: (c) => <Pilula>{c.getValue() as string}</Pilula>,
            },
            { header: 'Registros', accessorKey: 'registros', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            { header: 'Conformes', accessorKey: 'conformes', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            { header: 'Taxa', accessorKey: 'taxa', meta: { num: true }, cell: (c) => pc(c.getValue() as number) },
            {
              header: 'Obrigatórias violadas',
              accessorKey: 'obrigatorias_violadas',
              meta: { num: true },
              cell: (c) => (c.getValue() as number).toLocaleString('pt-BR', { maximumFractionDigits: 2 }),
            },
          ]}
        />
      ) : (
        <Carregando o="as fontes" />
      )}

      <div ref={lista} className="scroll-mt-[240px] max-[700px]:scroll-mt-[100px]">
        {fonte ? (
          <>
            <Secao>
              Registros de {fonte.source_name_raw} — {n(fonte.registros)}
            </Secao>
            <Guia>
              Os que mais violam primeiro. A coluna de regras violadas usa o id da regra — a lista está na tabela acima.{' '}
              <button
                type="button"
                onClick={() => setFonte(null)}
                className="cursor-pointer text-marca underline underline-offset-2"
              >
                limpar seleção
              </button>
            </Guia>
            {registros.erro && <Erro mensagem={registros.erro} />}
            {registros.dados ? (
              <Tabela
                id="metadados-registros"
                dados={registros.dados}
                nome={`Registros — ${fonte.source_name_raw}`}
                porPagina={25}
                aoClicarLinha={(r) =>
                  registro.abrir({ source_id: fonte.source_id, oai_identifier: r.oai_identifier, fonte: fonte.source_name_raw })
                }
                colunas={[
                  {
                    header: 'Registro',
                    accessorKey: 'oai_identifier',
                    cell: (c) => (
                      <>
                        <span className="text-down-01 break-all">{c.getValue() as string}</span>
                        <br />
                        <span className="text-down-01 text-marca">ver relatório</span>
                      </>
                    ),
                  },
                  {
                    header: 'Obrigatórias violadas',
                    accessorKey: 'violadas_obrig',
                    meta: { num: true },
                    cell: (c) => {
                      const v = c.getValue() as number
                      return <Pilula tom={v ? 'down' : 'ok'}>{v ? n(v) : 'conforme'}</Pilula>
                    },
                  },
                  { header: 'Opcionais violadas', accessorKey: 'violadas_opc', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
                  {
                    header: 'Regras violadas',
                    accessorKey: 'regras_violadas',
                    cell: (c) => <span className="text-down-01 tracking-[0.02em] text-conteudo-fraco">{(c.getValue() as string) || '—'}</span>,
                  },
                ]}
              />
            ) : (
              !registros.erro && <Carregando o="os registros" />
            )}
          </>
        ) : (
          <Nota>
            <b>Nenhuma fonte escolhida.</b> Clique numa linha da tabela acima para listar os registros da fonte.
          </Nota>
        )}
      </div>

      <Janela aberta={ficha.aberta} aoFechar={ficha.fechar} titulo="metadados-ficha-titulo">
        {ficha.item && <FichaRegra regra={ficha.item} filtro={w} />}
      </Janela>
      <Janela aberta={registro.aberta} aoFechar={registro.fechar} titulo="metadados-relatorio-titulo" largura={720}>
        {registro.item && <Relatorio {...registro.item} />}
      </Janela>
    </>
  )
}

function FichaRegra({ regra, filtro }: { regra: Regra; filtro: string }) {
  const extra = FICHAS_REGRA[regra.rule_id]
  const invalidos = useConsulta<{ valor: string; registros: number }>(
    // Campo vazio entra na lista como valor próprio: na 112, a maioria das
    // violações é de registro sem dc:rights nenhum, e sem esta linha a ficha
    // mostraria só a minoria que preencheu errado.
    `SELECT COALESCE(m.invalid_sample, '(não preenchido)') AS valor, count(*)::INT AS registros
     FROM record_metadata m JOIN v_source s USING (source_id)
     ${filtro ? `${filtro} AND` : 'WHERE'} m.rule_id = ${regra.rule_id} AND m.applicable
       AND (m.invalid_sample IS NOT NULL OR m.occurrences = 0)
     GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8`,
  )
  // O tamanho da cauda: na 112 são 49 mil valores inválidos distintos, e os
  // oito da lista cobrem uma fração pequena. Sem este número a lista leria
  // como o retrato inteiro.
  const cauda = useConsulta<{ registros: number; distintos: number }>(
    `SELECT count(*)::INT AS registros, count(DISTINCT m.invalid_sample)::INT AS distintos
     FROM record_metadata m JOIN v_source s USING (source_id)
     ${filtro ? `${filtro} AND` : 'WHERE'} m.rule_id = ${regra.rule_id} AND m.applicable
       AND (m.invalid_sample IS NOT NULL OR m.occurrences = 0)`,
  )
  const como =
    regra.quantifier === 'ONE_ONLY'
      ? `Lê ${regra.oai_dc_element} e exige exatamente uma ocorrência válida: nenhuma ou duas violam.`
      : `Lê ${regra.oai_dc_element} e basta uma ocorrência válida para atender.`

  return (
    <>
      <h3 id="metadados-ficha-titulo" className="text-up-01 font-semibold">
        {regra.rule_id} {regra.rule_name}
      </h3>
      <p className="mt-1.5 mb-4 flex flex-wrap gap-1.5">
        <Pilula tom={regra.required ? 'marca' : 'neutro'}>{regra.required ? 'obrigatória' : 'opcional'}</Pilula>
        <Pilula tom="neutro">{regra.quantifier}</Pilula>
        <Pilula tom={TOM_FIDELIDADE[regra.fidelity] ?? 'neutro'}>
          {ROTULO_FIDELIDADE[regra.fidelity] ?? regra.fidelity}
        </Pilula>
      </p>

      <section className="mb-4">
        <h4 className="rotulo mb-1.5 border-b border-borda pb-1">O que verifica</h4>
        <p className="m-0">{regra.description}</p>
      </section>
      <section className="mb-4">
        <h4 className="rotulo mb-1.5 border-b border-borda pb-1">Como é avaliada</h4>
        <p className="m-0">
          {como}
          {regra.fidelity_note && <> {regra.fidelity_note}</>}
        </p>
      </section>
      {extra && (
        <section className="mb-4">
          <h4 className="rotulo mb-1.5 border-b border-borda pb-1">Para que existe</h4>
          <p className="m-0 font-medium">{extra.paraQue}</p>
        </section>
      )}
      {extra && (
        <section className="mb-4 rounded border-l-4 border-marca bg-superficie-alt px-4 py-3">
          <h4 className="rotulo mb-1.5">Exemplo de uso</h4>
          <p className="m-0">{extra.exemplo}</p>
        </section>
      )}

      {regra.fidelity !== 'nao-verificavel' && (
        <section>
          <h4 className="rotulo mb-1.5 border-b border-borda pb-1">No recorte atual</h4>
          <p className="m-0 mb-2">
            <b>{pc(regra.avaliados ? regra.atende / regra.avaliados : null)}</b> atendem —{' '}
            {n(regra.viola)} de {n(regra.avaliados)} registros violam
            {regra.nao_aplica > 0 && <>; em {n(regra.nao_aplica)} a regra não se aplica</>}.
          </p>
          {invalidos.erro && <Erro mensagem={invalidos.erro} />}
          {invalidos.dados && invalidos.dados.length > 0 && (
            <>
              <p className="m-0 mb-1 text-down-01 text-conteudo-fraco">
                Registros sem o campo e o primeiro valor que reprovou em cada um, dos mais frequentes:
              </p>
              <ul id="metadados-ficha-invalidos" className="m-0 flex list-none flex-col gap-1 p-0 text-down-01">
                {invalidos.dados.map((v) => (
                  <li
                    key={v.valor}
                    id={`metadados-ficha-invalido-${paraId(v.valor) || 'vazio'}`}
                    className="flex justify-between gap-3 border-b border-borda py-1 last:border-0"
                  >
                    <span className="min-w-0 break-all tracking-[0.02em]">⚠️ {v.valor}</span>
                    <span className="num shrink-0 text-conteudo-fraco">{n(v.registros)}</span>
                  </li>
                ))}
              </ul>
              {cauda.dados?.[0] && (
                <p id="metadados-ficha-cauda" className="m-0 mt-2 text-down-01 text-conteudo-fraco">
                  A lista soma {n(invalidos.dados.reduce((a, v) => a + v.registros, 0))} de{' '}
                  {n(cauda.dados[0].registros)} registros sem o campo ou com valor inválido
                  {cauda.dados[0].distintos > invalidos.dados.length && (
                    <>
                      , entre {n(cauda.dados[0].distintos)} valores inválidos diferentes
                    </>
                  )}
                  .
                </p>
              )}
            </>
          )}
        </section>
      )}
    </>
  )
}

/**
 * O relatório de um registro, no formato do validador de referência: as que
 * violam primeiro, depois as que atendem, cada uma com obrigatoriedade e
 * quantificador, e cada valor lido com o veredito dele. Os valores vêm da
 * partição por fonte de `record_metadata_values`; sem ela, o relatório cai
 * para as contagens e o primeiro valor que reprovou, de `record_metadata`.
 */
function Relatorio({ source_id, oai_identifier, fonte }: { source_id: string; oai_identifier: string; fonte: string }) {
  const avaliacao = useConsulta<Avaliacao>(
    `SELECT m.rule_id, r.rule_name, r.required, r.quantifier, r.fidelity, r.fidelity_note,
            m.applicable, m.status, m.occurrences, m.valid_occurrences, m.invalid_sample
     FROM record_metadata m JOIN metadata_rules r USING (rule_id)
     WHERE m.source_id = ${lit(source_id)} AND m.oai_identifier = ${lit(oai_identifier)}
     ORDER BY CASE m.status WHEN 'viola' THEN 0 WHEN 'atende' THEN 1 ELSE 2 END, m.rule_id`,
  )
  const documento = useConsulta<{ url: string }>(
    `SELECT first_identifier AS url FROM records
     WHERE source_id = ${lit(source_id)} AND oai_identifier = ${lit(oai_identifier)} AND NOT deleted
     LIMIT 1`,
  )
  const url = documento.dados?.[0]?.url
  const valores = useValores(source_id, oai_identifier)
  const violadas = (avaliacao.dados ?? []).filter((a) => a.required && a.status === 'viola').length

  return (
    <>
      <h3 id="metadados-relatorio-titulo" className="text-up-01 font-semibold break-all">
        {oai_identifier}
      </h3>
      <p className="m-0 text-down-01 text-conteudo-fraco">{fonte}</p>
      {url && /^https?:\/\//i.test(url) && (
        <p className="m-0 mt-1 text-down-01">
          <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-marca underline underline-offset-2">
            {url}
          </a>
        </p>
      )}
      {avaliacao.erro && <Erro mensagem={avaliacao.erro} />}
      {!avaliacao.dados && !avaliacao.erro && <Carregando o="o relatório" />}
      {avaliacao.dados && (
        <>
          <p className="mt-3 mb-4">
            <Pilula tom={violadas ? 'down' : 'ok'}>
              {violadas ? `${violadas} obrigatória${violadas > 1 ? 's' : ''} violada${violadas > 1 ? 's' : ''}` : 'conforme'}
            </Pilula>
          </p>
          {valores === null && (
            <p id="metadados-relatorio-sem-valores" className="mb-3 text-down-01 text-conteudo-fraco">
              Os valores de cada ocorrência não estão disponíveis nesta versão do painel — só as contagens. Eles vêm
              de <span className="tracking-[0.02em]">data/valores/</span>, um arquivo por fonte buscado sob demanda, e o
              painel autocontido não tem servidor de onde buscá-los.
            </p>
          )}
          <ol id="metadados-relatorio-regras" className="m-0 flex list-none flex-col gap-3 p-0">
            {avaliacao.dados.map((a) => (
              <li key={a.rule_id} id={`metadados-relatorio-regra-${a.rule_id}`} className="border-b border-borda pb-3 last:border-0">
                <h4 className="m-0 text-base font-semibold">
                  {a.rule_id} {a.rule_name}
                </h4>
                <p className="m-0 mt-1 flex flex-wrap items-center gap-1.5 text-down-01">
                  <Pilula tom={TOM_STATUS[a.status] ?? 'neutro'}>{ROTULO_STATUS[a.status] ?? a.status}</Pilula>
                  <b>{a.required ? 'Obrigatória' : 'Opcional'}</b>
                  <span className="text-conteudo-fraco">
                    · Quantificador: <span className="tracking-[0.02em]">{a.quantifier}</span>
                  </span>
                </p>
                <ul className="m-0 mt-1 list-none p-0 text-down-01">
                  {a.status === 'nao-verificavel' ? (
                    <li className="text-conteudo-fraco">{a.fidelity_note}</li>
                  ) : !a.applicable ? (
                    <li className="text-conteudo-fraco">— não se aplica a este registro</li>
                  ) : a.occurrences === 0 ? (
                    <li>⚠️ Não preenchido</li>
                  ) : valores ? (
                    (valores.get(a.rule_id) ?? []).map((v) => (
                      <li key={v.ordinal} id={`metadados-relatorio-regra-${a.rule_id}-valor-${v.ordinal}`}>
                        {v.valid ? '✓ Preenchido corretamente' : '⚠️ Preenchido incorretamente'}{' '}
                        <code className="break-all">{trecho(v)}</code>
                      </li>
                    ))
                  ) : valores === undefined ? (
                    <li className="text-conteudo-fraco">carregando os valores…</li>
                  ) : (
                    <>
                      {(a.valid_occurrences ?? 0) > 0 && (
                        <li>
                          ✓ {n(a.valid_occurrences)} de {n(a.occurrences)} {a.occurrences === 1 ? 'ocorrência preenchida' : 'ocorrências preenchidas'} corretamente
                        </li>
                      )}
                      {a.invalid_sample !== null && (
                        <li>
                          ⚠️ {n((a.occurrences ?? 0) - (a.valid_occurrences ?? 0))} preenchida
                          {(a.occurrences ?? 0) - (a.valid_occurrences ?? 0) > 1 ? 's' : ''} incorretamente, como{' '}
                          <code className="break-all">{a.invalid_sample}</code>
                        </li>
                      )}
                    </>
                  )}
                  {a.fidelity === 'aproximada' && a.status !== 'nao-verificavel' && (
                    <li className="mt-0.5 text-conteudo-fraco">Aproximada em oai_dc: {a.fidelity_note}</li>
                  )}
                </ul>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  )
}
