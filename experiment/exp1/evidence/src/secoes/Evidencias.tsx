import { useEffect, useState } from 'react'
import { metadados, type Hipotese, type Protocolo } from '../metadados'
import { Carregando, Erro, Guia, Nota, Pilula, Secao, type Tom } from '../componentes/Basicos'
import { Tabela } from '../componentes/Tabela'
import { BarraCsv } from '../componentes/BotaoCsv'
import { n, paraId } from '../formato'

const TOM_VEREDITO: Record<string, Tom> = {
  supported: 'ok',
  null_result: 'neutro',
  not_identifiable: 'neutro',
  not_estimable: 'neutro',
  supported_confounded: 'warn',
  partly_tautological: 'warn',
  supported_small: 'ok',
  refuted: 'down',
}
const TOM_SITUACAO: Record<string, Tom> = { atendido: 'ok', parcial: 'warn', nao: 'down' }
const ROTULO_SITUACAO: Record<string, string> = {
  atendido: 'atendido',
  parcial: 'parcial',
  nao: 'não atendido',
}

/** Científica só quando o número não cabe lido; decimal no resto. */
const fp = (p: number | undefined) => {
  if (p === undefined) return '—'
  if (p >= 0.001) return p.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
  const [base, expo] = p.toExponential(1).split('e')
  const sobrescrito = [...String(Number(expo))].map(
    (ch) => ({ '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' })[ch] ?? ch,
  ).join('')
  return `${base.replace('.', ',')} × 10${sobrescrito}`
}

const ic = (v: [number, number] | null | undefined) => (v ? `[${v[0]}, ${v[1]}]` : '—')

export function Evidencias() {
  const [h, setH] = useState<Hipotese[] | null>(null)
  const [p, setP] = useState<Protocolo | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    metadados()
      .then((pac) => {
        setH(pac.hypotheses)
        setP(pac.protocol)
      })
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : String(e)))
  }, [])

  if (erro) return <Erro mensagem={erro} />
  if (!h || !p) return <Carregando o="as fichas" />

  const atendidos = p.checklist.filter((i) => i.situacao === 'atendido').length

  return (
    <>
      <Secao>Os três critérios</Secao>
      <Guia>
        Rastreabilidade, reprodutibilidade e validade. Se os três estiverem firmes, o experimento deixa de ser
        diagnóstico operacional e passa a ter base metodológica defensável. <b>Um deles não está</b>, e por razão
        estrutural.
      </Guia>
      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        {p.criterios.map((c) => (
          <div key={c.nome} className="rounded-sm border border-borda bg-superficie p-4">
            <div className="mb-1 flex items-baseline gap-2">
              <h3 className="font-serif text-up-01 font-semibold">{c.nome}</h3>
              <span className="ml-auto">
                <Pilula tom={TOM_SITUACAO[c.situacao]}>{ROTULO_SITUACAO[c.situacao]}</Pilula>
              </span>
            </div>
            <p className="mb-2 text-down-01 text-conteudo-fraco italic">{c.pergunta}</p>
            <p className="m-0 text-conteudo-fraco">{c.texto}</p>
          </div>
        ))}
      </div>

      <Secao>Checklist de qualidade — {atendidos} de {p.checklist.length}</Secao>
      <Tabela
        id="evidencias-checklist"
        dados={p.checklist}
        nome="Checklist de qualidade"
        colunas={[
          { header: 'Item', accessorKey: 'item', cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
          {
            header: 'Situação',
            accessorKey: 'situacao',
            cell: (c) => (
              <Pilula tom={TOM_SITUACAO[c.getValue() as string]}>{ROTULO_SITUACAO[c.getValue() as string]}</Pilula>
            ),
          },
          {
            header: 'Evidência',
            accessorKey: 'evidencia',
            cell: (c) => (
              <>
                <span className="text-down-01 text-conteudo-fraco">{c.getValue() as string}</span>
                {c.row.original.ressalva && (
                  <p className="mt-1 border-l-2 border-alerta pl-2 text-down-01 text-conteudo-fraco">
                    {c.row.original.ressalva}
                  </p>
                )}
              </>
            ),
          },
        ]}
      />
      <Nota>
        <b>Um checklist todo verde não informa nada.</b> Os três itens acima que não fecham são a parte útil, e dois
        não têm conserto retroativo: pré-registro não se faz depois, e a coleta não se repete porque as origens
        mudam. O que existe a partir da v1.0.0 é congelamento — a definição de cada métrica está em{' '}
        <span className="tracking-[0.02em]">analisar.py</span> e em{' '}
        <span className="tracking-[0.02em]">views.sql</span>, e mudá-las muda o hash do pacote.
      </Nota>

      <Secao>Fichas das hipóteses</Secao>
      <Guia>
        Cada ficha é um protocolo: população, unidade de análise, variáveis, confundidores, critérios, teste,
        tamanho de efeito com intervalo e análise de sensibilidade. Todos os números saem de{' '}
        <span className="tracking-[0.02em]">analisar.py</span>, com semente {n(p.semente)} e{' '}
        {n(p.reamostragens)} reamostragens. <b>Esta seção ignora os filtros globais</b> — um teste recalculado sobre
        um recorte escolhido à mão não é mais um teste.
      </Guia>

      {h.filter((f) => !f.id.match(/^H(8|9|1[0-5])$/)).map((f) => (Ficha(f)))}

      <Secao>Achados da amostra de registros</Secao>
      <Guia>
        Oito fichas de natureza diferente das anteriores: <b>descrevem a amostra, não testam
        relação</b>. Chamar descrição de efeito seria o mesmo erro que H1 comete ao contrário.
        Duas foram refutadas e uma é nula — e a primeira delas, H8, qualifica as outras sete:
        as 633 fontes que não responderam estão em pior estado, então tudo aqui é teto, não média.
      </Guia>
      {h.filter((f) => f.id.match(/^H(8|9|1[0-5])$/)).map((f) => (Ficha(f)))}

      <Nota>
        <b>Significância, tamanho de efeito e identificação são três perguntas diferentes.</b> Com mil e setecentas
        fontes, diferença irrelevante dá p minúsculo — por isso toda ficha traz o efeito com intervalo. E efeito bem
        medido ainda não é atribuição: H1 tem <span className="tracking-[0.02em]">ε² = 0,14</span> estável em todos
        os recortes e mesmo assim não sustenta a conclusão do enunciado, porque plataforma e tipo de fonte não
        variam independentemente nesta população. Consertar isso não é questão de mais dados — é questão de coletar
        uma população onde as duas variem separadas, o que significaria fontes fora do Oasisbr.
      </Nota>
    </>
  )
}

function Ficha(f: Hipotese) {
  // Sub-hipótese entra recuada e com barra à esquerda: a árvore de H6 é
  // estrutura real — H6.2 corrige H6.1 —, não agrupamento visual.
  const sub = f.id.includes('.') && !f.id.endsWith('.1')
  return (
        <article
          key={f.id}
          className={`mb-4 overflow-hidden rounded-sm border border-borda bg-superficie ${
            sub ? 'border-l-2 border-l-marca sm:ml-8' : ''
          }`}
        >
          <header className="flex flex-wrap items-baseline gap-3 border-b border-borda bg-superficie-alt px-4 py-3">
            <span className="text-down-01 font-semibold tracking-[0.06em] text-marca">{f.id}</span>
            <h3 className="font-serif text-up-01 font-semibold">{f.statement}</h3>
            <span className="ml-auto">
              <Pilula tom={TOM_VEREDITO[f.veredito] ?? 'neutro'}>{f.verdict_label}</Pilula>
            </span>
          </header>
          <div className="px-4 py-4">
            <dl className="mb-4 grid gap-x-5 gap-y-2 text-base [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
              {(
                [
                  ['População', f.populacao],
                  ['Unidade de análise', f.unidade],
                  ['Cobertura temporal', f.cobertura_temporal],
                  ['Variável dependente', f.variavel_dependente],
                  ['Variável independente', f.variavel_independente],
                  ['Confundidores', f.confundidores.join(' · ')],
                  ['Inclusão', f.inclusao],
                  ['Exclusão', f.exclusao],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="rotulo">{k}</dt>
                  <dd className="m-0 text-conteudo-fraco">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mb-4 flex flex-wrap gap-x-7 gap-y-2 border-t border-borda pt-3">
              <Medida rotulo="Teste" valor={f.estatistica.teste} />
              {f.estatistica.n !== undefined && <Medida rotulo="n" valor={n(f.estatistica.n)} />}
              {f.estatistica.efeito !== undefined && (
                <Medida
                  rotulo={f.estatistica.efeito_nome ?? 'efeito'}
                  valor={`${f.estatistica.efeito}${f.ic95 ? `  IC95 ${ic(f.ic95)}` : ''}`}
                />
              )}
              {f.estatistica.p !== undefined && <Medida rotulo="p" valor={fp(f.estatistica.p)} />}
              {f.sobredispersao && <Medida rotulo="sobredispersão" valor={`${f.sobredispersao}×`} />}
              {f.confundimento && (
                <Medida rotulo={f.confundimento.nome} valor={`${f.confundimento.rho}`} />
              )}
            </div>

            {f.contraste && (
              <div className="mb-4 rounded-sm border border-borda bg-superficie-alt px-3.5 py-2.5">
                <span className="rotulo">Contraste par a par — {f.contraste.par}</span>
                <p className="m-0 mt-1 text-conteudo-fraco">
                  medianas {n(f.contraste.mediana_a)} e {n(f.contraste.mediana_b)} ·{' '}
                  {f.contraste.efeito_nome} = <b className="text-conteudo">{f.contraste.efeito}</b> IC95{' '}
                  {ic(f.contraste.ic95)}
                </p>
              </div>
            )}

            {f.sensibilidade.length > 0 && (
              <>
                <h4 className="rotulo mb-2">Análise de sensibilidade</h4>
                <BarraCsv
                  id={`evidencias-${paraId(f.id)}-sensibilidade-csv`}
                  nome={`Sensibilidade ${f.id}`}
                  montar={() => ({
                    cabecalho: ['Recorte', 'n', 'Grupos', 'Efeito', 'p'],
                    linhas: f.sensibilidade.map((s) => [s.recorte, s.n, s.grupos, s.efeito, s.p]),
                  })}
                />
                <div className="mb-4 overflow-x-auto rounded-sm border border-borda">
                  <table id={`evidencias-${paraId(f.id)}-sensibilidade`} className="w-full text-base">
                    <thead>
                      <tr>
                        <th className="rotulo border-b border-borda-forte px-2.5 py-2 text-left" title="A sub-população sobre a qual o teste foi refeito">Recorte</th>
                        <th className="rotulo border-b border-borda-forte px-2.5 py-2 text-right" title="Observações no teste. Muda com o recorte e com a unidade de análise">n</th>
                        <th className="rotulo border-b border-borda-forte px-2.5 py-2 text-right" title="Categorias comparadas. Só entram as que têm tamanho mínimo">Grupos</th>
                        <th className="rotulo border-b border-borda-forte px-2.5 py-2 text-right" title="Epsilon-quadrado: fração da variação de postos que o grupo explica">Efeito</th>
                        <th className="rotulo border-b border-borda-forte px-2.5 py-2 text-right" title="Probabilidade de ver esta diferença se não houvesse nenhuma. Não diz se o efeito é grande">p</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.sensibilidade.map((s) => (
                        <tr key={s.recorte} id={`evidencias-${paraId(f.id)}-sensibilidade-linha-${paraId(s.recorte)}`} className="border-b border-borda last:border-0">
                          <td className="px-2.5 py-1.5">{s.recorte}</td>
                          <td className="num px-2.5 py-1.5 text-right">{n(s.n)}</td>
                          <td className="num px-2.5 py-1.5 text-right">{n(s.grupos)}</td>
                          <td className="num px-2.5 py-1.5 text-right font-semibold">{s.efeito}</td>
                          <td className="num px-2.5 py-1.5 text-right text-conteudo-fraco">{fp(s.p)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {f.distribuicao && (
              <p className="mb-3 text-conteudo-fraco">
                {Object.entries(f.distribuicao)
                  .map(([k, v]) => `${n(v)} ${k.replace(/_/g, ' ')}`)
                  .join(' · ')}
              </p>
            )}

            {f.conflito && (
              <div className="mb-3 rounded-r-sm border-l-2 border-alerta bg-superficie-alt px-3.5 py-2.5">
                <span className="rotulo">Conflito de construção</span>
                <p className="m-0 mt-1 max-w-[74ch] text-conteudo-fraco">{f.conflito}</p>
              </div>
            )}

            <div className="rounded-r-sm border-l-2 border-marca bg-superficie-alt px-3.5 py-2.5">
              <span className="rotulo">Identificação</span>
              <p className="m-0 mt-1 max-w-[74ch] text-conteudo-fraco">{f.identificacao}</p>
            </div>
          </div>
        </article>
  )
}

function Medida({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="rotulo">{rotulo}</span>
      <span className="num font-semibold">{valor}</span>
    </div>
  )
}
