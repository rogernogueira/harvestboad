import { useCallback, useMemo, type ReactNode } from 'react'
import { onde, useConsulta, type Filtros } from '../ganchos'
import { Barras, Cartao, Cartoes, Carregando, Erro, Guia, Nota, Painel, Pilula, Secao } from '../componentes/Basicos'
import { Grafico, type Paleta } from '../componentes/Grafico'
import { Tabela } from '../componentes/Tabela'
import { BarraCsv } from '../componentes/BotaoCsv'
import { n, paraId, pc } from '../formato'
import { FICHAS } from '../fichasDimensao'
import { Janela, useJanela } from '../componentes/Janela'
import { lit } from '../duckdb'

/*
 * As dez dimensões de qualidade, e o que o dataset responde de cada uma.
 *
 * O corte é único: **seis** delas são perguntas sobre o registro, e a Base 1 tem
 * granularidade de fonte e de coleta. A amostra de `ListRecords` abriu cinco —
 * completude, conformidade, duplicação, normalização e consistência —, e como
 * amostra de até 200 registros vivos por fonte, não como censo do acervo. A
 * sexta, latência, continua fora, e não é medida em lugar nenhum deste trabalho.
 *
 * Perda e transformação estão na tabela para fechar a conta das dez, não porque
 * sejam medidas aqui: elas saem de `size`, `valid_size` e `transformed_size` do
 * agregador, na camada de coleta, e são grandezas de volume e não de conteúdo —
 * dizem quantos registros foram rejeitados ou convertidos, não o que se perdeu
 * em cada um. Quem as mostra é a aba Qualidade.
 */
const DIMENSOES = [
  { nome: 'Validação', nivel: 'coleta', grau: 'forte', tipo: 'indicador', onde: 'size × valid_size em 38.491 snapshots' },
  { nome: 'Estabilidade', nivel: 'coleta', grau: 'forte', tipo: 'indicador', onde: '42.358 snapshots, sequências de falha' },
  { nome: 'Completude', nivel: 'registro', grau: 'amostra', tipo: 'indicador', onde: 'presença dos 15 elementos Dublin Core' },
  { nome: 'Conformidade', nivel: 'registro', grau: 'amostra', tipo: 'indicador', onde: '4 critérios DRIVER verificáveis no registro' },
  { nome: 'Duplicação', nivel: 'registro', grau: 'amostra', tipo: 'indicador', onde: 'hash do título ÷ títulos elegíveis, dentro e entre fontes' },
  { nome: 'Transformação', nivel: 'coleta', grau: 'parcial', tipo: 'indicador', onde: 'transformed_size — volume, não conteúdo' },
  { nome: 'Perda', nivel: 'coleta', grau: 'parcial', tipo: 'indicador', onde: 'size − valid_size; o lado do destino não é observável' },
  { nome: 'Normalização', nivel: 'registro', grau: 'amostra', tipo: 'descritiva', onde: 'valores de type, language, rights, date, format' },
  { nome: 'Consistência', nivel: 'registro', grau: 'amostra', tipo: 'descritiva', onde: 'elemento fora do esquema, concentrado em 9 fontes' },
  { nome: 'Latência', nivel: 'registro', grau: 'fora', tipo: '—', onde: 'exige data de publicação, que o OAI não entrega' },
] as const

const TOM_GRAU = { forte: 'ok', amostra: 'marca', parcial: 'warn', fora: 'neutro' } as const

/*
 * A regra de campo multivalorado **não** é uniforme entre os quatro critérios de
 * conformidade, e a assimetria é deliberada.
 *
 * `type` e `rights` são aditivos: o repositório legitimamente emite o termo
 * controlado *e* um rótulo livre ao lado. Medido na amostra — em 72,4% dos
 * registros com texto livre em `dc:type` (70.531 de 97.484) o termo
 * `info:eu-repo` está no mesmo registro. Exigir que todos os valores conformem
 * penalizaria justamente quem publica certo.
 *
 * `language` e `date` são enumerativos: cada valor é asserção independente, e
 * uma data malformada é defeito ainda que as outras estejam corretas.
 *
 * Quem assumir regra uniforme não reproduz os números desta aba.
 */
const MULTIVALOR = [
  { criterio: 'dc:type', regra: 'qualquer', natureza: 'aditivo', decisao: 'conforme se ao menos um valor começa por info:eu-repo/semantics/' },
  { criterio: 'dc:rights', regra: 'qualquer', natureza: 'aditivo', decisao: 'conforme se ao menos um valor é info:eu-repo/semantics/*Access' },
  { criterio: 'dc:language', regra: 'todos', natureza: 'enumerativo', decisao: 'conforme só se todos os valores casam ISO 639' },
  { criterio: 'dc:date', regra: 'todos', natureza: 'enumerativo', decisao: 'conforme só se todos os valores casam ISO 8601' },
] as const

const DC = [
  'title', 'creator', 'subject', 'description', 'publisher', 'contributor', 'date',
  'type', 'format', 'identifier', 'source', 'language', 'relation', 'coverage', 'rights',
] as const

type Cobertura = { campo: string; taxa: number }
type Conformidade = { criterio: string; taxa: number }
type Vocabulario = { field: string; value: string; ocorrencias: number; fontes: number; conforme: boolean | null }
type Duplicata = { title_hash: string; ocorrencias: number; fontes: number; exemplo_identificador: string }
type Negligenciada = {
  source_id: string
  source_name_raw: string
  institution_name: string
  platform_analysis_group: string
  completude: number
  days_since_last_harvest: number
  latest_size: number
}
type Cruzamento = { faixa: string; boas: number; total: number }
type Contraste = { faixa: string; n: number; completude: number; conformidade: number }

type Linha = {
  source_id: string
  source_name_raw: string
  institution_name: string
  platform_analysis_group: string
  records_sampled: number
  titles_eligible: number
  completude: number
  conformidade: number
  /** Nulo quando a fonte não tem título elegível: sem denominador, não há taxa. */
  taxa_duplicacao: number | null
  off_schema_records: number
}

export function Dimensoes({ filtros, aoAbrirFonte }: { filtros: Filtros; aoAbrirFonte: (id: string) => void }) {
  const w = onde(filtros)
  // v_dimensao já traz as colunas de v_source, então a cláusula global serve.
  const wd = w.replace('WHERE', 'WHERE')

  const ficha = useJanela<string>()
  const duplicata = useJanela<Duplicata>()

  const totais = useConsulta<{
    fontes: number
    recebidos: number
    excluidos: number
    completude: number
    conformidade: number
    duplicados: number
    secoes: number
    fora_esquema: number
  }>(
    useMemo(
      () => `SELECT count(*) AS fontes,
                    COALESCE(sum(records_sampled), 0) AS recebidos,
                    COALESCE(sum(records_deleted), 0) AS excluidos,
                    avg(completude) AS completude,
                    avg(conformidade) AS conformidade,
                    COALESCE(sum(duplicate_titles), 0) AS duplicados,
                    COALESCE(sum(section_titles), 0) AS secoes,
                    COALESCE(sum(off_schema_records), 0) AS fora_esquema
             FROM v_dimensao ${wd}`,
      [wd],
    ),
  )

  // O total que se apresenta como amostra é o de registros vivos e distintos.
  // `records_sampled` conta cabeçalho recebido, com excluído e com o registro
  // que a paginação repetiu — é o tamanho da coleta, não o da amostra medida.
  const vivos = useConsulta<{ vivos: number }>(
    useMemo(
      () => `SELECT count(DISTINCT r.source_id || '|' || r.oai_identifier)::INT AS vivos
             FROM records r JOIN v_dimensao d USING (source_id)
             ${wd ? `${wd} AND` : 'WHERE'} NOT r.deleted`,
      [wd],
    ),
  )

  const cobertura = useConsulta<Cobertura>(
    useMemo(
      () => `SELECT * FROM (VALUES ${DC.map(
        (c) => `('${c}', (SELECT avg(has_${c}_rate) FROM v_dimensao ${wd}))`,
      ).join(', ')}) AS t(campo, taxa) ORDER BY taxa DESC`,
      [wd],
    ),
  )

  const conformidade = useConsulta<Conformidade>(
    useMemo(
      () => `SELECT * FROM (
               SELECT 'dc:type em info:eu-repo' AS criterio, avg(type_eurepo_rate) AS taxa FROM v_dimensao ${wd}
               UNION ALL SELECT 'dc:rights em info:eu-repo', avg(rights_eurepo_rate) FROM v_dimensao ${wd}
               UNION ALL SELECT 'dc:language em ISO 639', avg(language_iso_rate) FROM v_dimensao ${wd}
               UNION ALL SELECT 'dc:date em ISO 8601', avg(date_iso_rate) FROM v_dimensao ${wd}
               UNION ALL SELECT 'set driver declarado', avg(driver_set_rate) FROM v_dimensao ${wd}
             ) ORDER BY taxa DESC`,
      [wd],
    ),
  )

  // Vocabulário e duplicação entre fontes ignoram o filtro: o valor de uma é
  // justamente aparecer em várias fontes ao mesmo tempo.
  const vocabulario = useConsulta<Vocabulario>(
    `SELECT field, value, ocorrencias, fontes, conforme FROM v_vocabulario
     WHERE field IN ('type', 'language', 'rights') ORDER BY ocorrencias DESC LIMIT 18`,
  )
  const duplicatas = useConsulta<Duplicata>(
    `SELECT title_hash, ocorrencias, fontes, exemplo_identificador FROM v_duplicata
     WHERE fontes > 1 ORDER BY ocorrencias DESC LIMIT 12`,
  )
  const porFonte = useConsulta<Linha>(
    useMemo(
      () => `SELECT source_id, source_name_raw, institution_name, platform_analysis_group,
                    records_sampled, titles_eligible, completude, conformidade,
                    taxa_duplicacao, off_schema_records
             FROM v_dimensao ${wd} ORDER BY conformidade ASC, records_sampled DESC`,
      [wd],
    ),
  )

  // O cruzamento que separa "fonte ruim" de "fonte esquecida". Ter amostra de
  // registros **prova que o endpoint respondeu** na data da coleta, então uma
  // fonte com metadado bom e coleta velha não tem defeito: está sendo deixada
  // de fora dos lotes.
  const ORDEM_FAIXA = ['até 90 dias', '91 a 365', '1 a 2 anos', 'mais de 2 anos']
  const faixaSQL = `CASE
      WHEN days_since_last_harvest <= 90  THEN 'até 90 dias'
      WHEN days_since_last_harvest <= 365 THEN '91 a 365'
      WHEN days_since_last_harvest <= 730 THEN '1 a 2 anos'
      ELSE 'mais de 2 anos' END`

  const cruzamento = useConsulta<Cruzamento>(
    useMemo(
      () => `SELECT ${faixaSQL} AS faixa,
                    count(*) FILTER (completude >= 0.8)::INT AS boas,
                    count(*)::INT AS total
             FROM v_dimensao ${wd} ${wd ? 'AND' : 'WHERE'} days_since_last_harvest IS NOT NULL
             GROUP BY 1`,
      [wd],
    ),
  )

  const contraste = useConsulta<Contraste>(
    useMemo(
      () => `SELECT CASE WHEN days_since_last_harvest > 365 THEN 'parada há mais de um ano'
                         ELSE 'coletada no último ano' END AS faixa,
                    count(*)::INT AS n, median(completude) AS completude,
                    median(conformidade) AS conformidade
             FROM v_dimensao ${wd} ${wd ? 'AND' : 'WHERE'} days_since_last_harvest IS NOT NULL
             GROUP BY 1 ORDER BY 1`,
      [wd],
    ),
  )

  const negligenciadas = useConsulta<Negligenciada>(
    useMemo(
      () => `SELECT source_id, source_name_raw, institution_name, platform_analysis_group,
                    completude, days_since_last_harvest, latest_size
             FROM v_dimensao ${wd} ${wd ? 'AND' : 'WHERE'} completude >= 0.8
               AND days_since_last_harvest > 365
               AND latest_snapshot_status <> 'HARVESTING_FINISHED_ERROR'
             ORDER BY latest_size DESC`,
      [wd],
    ),
  )

  const opcaoCobertura = useCallback(
    (p: Paleta) => {
      const d = [...(cobertura.dados ?? [])].reverse()
      return {
        grid: { left: 92, right: 52, top: 6, bottom: 22 },
        xAxis: {
          type: 'value',
          max: 1,
          splitLine: { lineStyle: { color: p.borda } },
          axisLabel: { color: p.conteudoFraco, formatter: (v: number) => `${Math.round(v * 100)}%` },
        },
        yAxis: {
          type: 'category',
          data: d.map((c) => `dc:${c.campo}`),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: p.conteudoFraco, fontSize: 10.5 },
        },
        tooltip: { trigger: 'axis' },
        series: [
          {
            type: 'bar',
            data: d.map((c) => ({
              value: c.taxa,
              // O perfil DRIVER exige title, creator, date, type e identifier.
              // Abaixo de 95% neles é defeito, não variação editorial.
              itemStyle: {
                color:
                  ['title', 'creator', 'date', 'type', 'identifier'].includes(c.campo) && c.taxa < 0.95
                    ? p.down
                    : c.taxa >= 0.9
                      ? p.marca
                      : p.warn,
              },
            })),
            label: {
              show: true,
              position: 'right',
              color: p.conteudoFraco,
              fontSize: 10.5,
              formatter: (a: { value: number }) => `${(a.value * 100).toFixed(0)}%`,
            },
          },
        ],
      }
    },
    [cobertura.dados],
  )

  const erro = [totais, vivos, cobertura, conformidade, vocabulario, duplicatas, porFonte,
    cruzamento, contraste, negligenciadas].find((c) => c.erro)?.erro
  if (erro) return <Erro mensagem={erro} />
  const t = totais.dados?.[0]
  const nVivos = vivos.dados?.[0]?.vivos

  return (
    <>
      <Guia>
        Seis das dez dimensões de qualidade são perguntas sobre o <b>registro</b>, e a Base 1 tem granularidade de
        fonte e de coleta. Esta aba abre <b>cinco</b> delas — completude, conformidade, duplicação, normalização e
        consistência — a partir de uma amostra de <span className="tracking-[0.02em]">ListRecords</span> em{' '}
        <span className="tracking-[0.02em]">oai_dc</span>, até 200 registros vivos por fonte. Serve para medir taxa e comparar
        fontes, <b>não para contar acervo</b>: quem conta acervo é o <span className="tracking-[0.02em]">size</span>{' '}
        do Harvester. Perda e transformação não são medidas aqui — elas vivem na camada de coleta, e quem as mostra
        é a aba Qualidade.
      </Guia>

      {t ? (
        <Cartoes>
          <Cartao
            chave="Registros vivos na amostra"
            valor={nVivos === undefined ? '…' : n(nVivos)}
            nota={`de ${n(t.fontes)} fontes · ${n(t.recebidos)} cabeçalhos recebidos`}
          />
          <Cartao chave="Completude média" valor={pc(t.completude)} nota="dos 15 elementos Dublin Core" />
          <Cartao
            chave="Conformidade média"
            valor={pc(t.conformidade)}
            nota="4 critérios DRIVER verificáveis"
            tom={t.conformidade < 0.8 ? 'warn' : 'ok'}
          />
          <Cartao
            chave="Títulos duplicados"
            valor={n(t.duplicados)}
            nota="na mesma fonte, título longo"
            tom={t.duplicados ? 'warn' : 'ok'}
          />
          <Cartao
            chave="Campo fora do esquema"
            valor={n(t.fora_esquema)}
            nota="registros com elemento não-DC"
            tom={t.fora_esquema ? 'warn' : 'ok'}
          />
        </Cartoes>
      ) : (
        <Carregando o="a amostra" />
      )}

      <Nota>
        <b>Das 2.183 fontes, 1.573 responderam.</b> O restante recusou, está fora do ar ou tem cadastrado um
        endpoint que não atende — o caso maior são as <b>215 fontes da plataforma SciELO</b>, integralmente
        ausentes por causa determinada: 212 apontam para o agregador{' '}
        <span className="tracking-[0.02em]">old.scielo.br</span>, que respondeu HTTP 403 às 25 primeiras — e o
        disjuntor do host poupou as outras 187 —, e 3 para{' '}
        <span className="tracking-[0.02em]">www.scielo.br</span>, que responde 404. Nenhuma tem endpoint próprio
        registrado; é defeito de cadastro, não característica da plataforma.
        <br />
        <br />
        A amostra é, portanto, <b>enviesada em favor de fontes operacionalmente acessíveis</b>, e as estimativas
        agregadas de qualidade podem ser otimistas em relação ao universo completo. O que <i>não</i> se pode
        concluir é que o metadado ausente seria pior: entre as fontes presentes, as paradas há mais de um ano têm
        completude mediana <b>maior</b> (0,822, n=553) que as coletadas no último ano (0,799, n=1.017). No
        subconjunto observável, a associação entre abandono operacional e qualidade de metadado tem sinal
        contrário.
      </Nota>

      <Secao>O que cada dimensão alcança</Secao>
      <Guia>
        <b>Clique numa dimensão</b> para abrir a ficha dela: o que é, como é gerada, para que existe e um exemplo de
        uso.
      </Guia>
      <Tabela
        id="dimensoes-alcance"
        dados={DIMENSOES as unknown as (typeof DIMENSOES)[number][]}
        nome="Alcance das dimensões"
        aoClicarLinha={(d) => ficha.abrir(d.nome)}
        colunas={[
          {
            header: 'Dimensão',
            accessorKey: 'nome',
            cell: (c) => (
              <>
                <span className="font-medium">{c.getValue() as string}</span>
                <br />
                <span className="text-down-01 text-marca">ver ficha</span>
              </>
            ),
          },
          {
            header: 'Alcance',
            accessorKey: 'grau',
            cell: (c) => {
              const g = c.getValue() as keyof typeof TOM_GRAU
              return <Pilula tom={TOM_GRAU[g]}>{g === 'fora' ? 'não atendida' : g}</Pilula>
            },
          },
          {
            header: 'Estatuto',
            accessorKey: 'tipo',
            cell: (c) =>
              c.getValue() === '—' ? (
                <span className="text-conteudo-fraco">—</span>
              ) : (
                <Pilula tom={c.getValue() === 'indicador' ? 'marca' : 'neutro'}>{c.getValue() as string}</Pilula>
              ),
          },
          { header: 'Granularidade', accessorKey: 'nivel', cell: (c) => <span className="text-down-01 text-conteudo-fraco">{c.getValue() as string}</span> },
          { header: 'Medida por', accessorKey: 'onde', cell: (c) => <span className="text-down-01 text-conteudo-fraco">{c.getValue() as string}</span> },
        ]}
      />
      <Nota>
        <b>Indicador e descritiva não são a mesma coisa medida com rigor diferente.</b> Nesta aba os
        indicadores são <b>três</b> — completude, conformidade e duplicação: grandeza em escala 0–1,
        definida por registro, agregada por fonte, comparável entre fontes e passível de entrar em
        teste. Os outros quatro indicadores da tabela são da camada de coleta. Só esses três admitem
        ordenação ou comparação entre fontes.
        <br />
        <br />
        As duas descritivas caracterizam padrões <b>sem produzir índice</b>, e não devem ser lidas como
        escores: consistência porque o fenômeno está integralmente em 9 fontes — e em cada uma atinge{' '}
        <b>100% dos registros amostrados</b> —, de modo que a informação útil é <i>quais</i>, não{' '}
        <i>quanto</i>; normalização porque o que importa é saber que o português circula como{' '}
        <span className="tracking-[0.02em]">por</span>, <span className="tracking-[0.02em]">pt_BR</span>,{' '}
        <span className="tracking-[0.02em]">pt</span> e <span className="tracking-[0.02em]">Português</span>
        {' '}— e não um índice de dispersão que esconderia isso.
      </Nota>

      <Nota>
        <b>Latência não é medida em lugar nenhum deste trabalho</b>, e a razão é instrutiva. Ela pede a data de
        publicação confrontada com a de disponibilidade; o <span className="tracking-[0.02em]">datestamp</span> do
        OAI-PMH é a data da última alteração do registro no repositório, que muda a cada correção de metadado.
        Pôr <span className="tracking-[0.02em]">dc:date</span> no lugar produz medida <b>espúria</b>: confrontado
        com a primeira coleta da fonte, ele dá mediana da ordem de sete anos, que é a idade do acervo retroativo no
        momento em que a fonte entrou no agregador — não atraso de disponibilização. Medir latência exigiria coleta
        por janela temporal, e nenhuma foi feita.
      </Nota>

      <Secao>Completude — presença dos elementos Dublin Core</Secao>
      <Painel>
        {cobertura.dados ? (
          <Grafico opcao={opcaoCobertura} altura={330} rotulo="Presença de cada elemento Dublin Core" />
        ) : (
          <Carregando o="a cobertura" />
        )}
      </Painel>
      <Nota>
        Vermelho marca os cinco que o perfil DRIVER <b>exige</b> — title, creator, date, type e identifier — quando
        ficam abaixo de 95%. Nos demais, ausência pode ser escolha editorial legítima:{' '}
        <span className="tracking-[0.02em]">dc:coverage</span> e{' '}
        <span className="tracking-[0.02em]">dc:contributor</span> são opcionais e quase ninguém preenche.
      </Nota>

      <Secao>Conformidade — os critérios verificáveis no registro</Secao>
      <Guia>
        Presente e conforme são coisas diferentes, e é aqui que a distinção paga. Um{' '}
        <span className="tracking-[0.02em]">dc:type</span> escrito "Artigo avaliado pelos Pares" está preenchido e
        não é legível por máquina; o perfil pede o termo{' '}
        <span className="tracking-[0.02em]">info:eu-repo/semantics/article</span>.
      </Guia>
      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(330px,1fr))]">
        <Painel>
          {conformidade.dados ? (
            <Barras
              itens={conformidade.dados.map((c) => ({
                rotulo: c.criterio,
                valor: Math.round(c.taxa * 1000) / 10,
                tom: c.taxa >= 0.9 ? 'ok' : c.taxa >= 0.6 ? 'warn' : 'down',
              }))}
            />
          ) : (
            <Carregando o="a conformidade" />
          )}
          <p className="mt-3 text-down-01 text-conteudo-fraco">Média das taxas por fonte, em pontos percentuais.</p>
        </Painel>
        <Painel titulo="Normalização — o que os campos controlados recebem">
          {vocabulario.dados ? (
            <Tabela
              id="dimensoes-normalizacao"
              dados={vocabulario.dados}
              nome="Normalização dos campos controlados"
              porPagina={9}
              colunas={[
                { header: 'Campo', accessorKey: 'field', cell: (c) => <span className="text-down-01 text-conteudo-fraco">dc:{c.getValue() as string}</span> },
                {
                  header: 'Valor',
                  accessorKey: 'value',
                  cell: (c) => (
                    <span className="text-down-01 break-all">{(c.getValue() as string) || '—'}</span>
                  ),
                },
                {
                  header: 'Conforme',
                  accessorKey: 'conforme',
                  cell: (c) =>
                    c.getValue() === null ? (
                      <span className="text-conteudo-fraco">—</span>
                    ) : (
                      <Pilula tom={c.getValue() ? 'ok' : 'down'}>{c.getValue() ? 'sim' : 'não'}</Pilula>
                    ),
                },
                { header: 'Ocorrências', accessorKey: 'ocorrencias', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
              ]}
            />
          ) : (
            <Carregando o="o vocabulário" />
          )}
        </Painel>
      </div>

      <Secao>Conformidade — a regra do campo multivalorado</Secao>
      <Guia>
        Um registro traz vários <span className="tracking-[0.02em]">dc:type</span> ou várias{' '}
        <span className="tracking-[0.02em]">dc:date</span>, e a regra de decisão <b>não é a mesma</b> nos quatro
        critérios. A assimetria é deliberada: quem assumir regra uniforme não reproduz os números acima.
      </Guia>
      <Tabela
        id="dimensoes-multivalor"
        dados={MULTIVALOR as unknown as (typeof MULTIVALOR)[number][]}
        nome="Regra do campo multivalorado"
        colunas={[
          { header: 'Critério', accessorKey: 'criterio', cell: (c) => <span className="font-medium tracking-[0.02em]">{c.getValue() as string}</span> },
          {
            header: 'Regra',
            accessorKey: 'regra',
            cell: (c) => <Pilula tom={c.getValue() === 'qualquer' ? 'marca' : 'neutro'}>{c.getValue() as string}</Pilula>,
          },
          { header: 'Natureza', accessorKey: 'natureza', cell: (c) => <span className="text-down-01 text-conteudo-fraco">{c.getValue() as string}</span> },
          { header: 'Decisão', accessorKey: 'decisao', cell: (c) => <span className="text-down-01 text-conteudo-fraco">{c.getValue() as string}</span> },
        ]}
      />
      <Nota>
        <b>Aditivo e enumerativo pedem regras opostas.</b> Em{' '}
        <span className="tracking-[0.02em]">dc:type</span> e <span className="tracking-[0.02em]">dc:rights</span> o
        repositório legitimamente emite o termo controlado <i>e</i> um rótulo livre ao lado — em <b>72,4%</b> dos
        registros com texto livre em <span className="tracking-[0.02em]">dc:type</span> (70.531 de 97.484) o termo{' '}
        <span className="tracking-[0.02em]">info:eu-repo</span> está no mesmo registro. Exigir que todos os valores
        conformem penalizaria justamente quem publica certo. Já em{' '}
        <span className="tracking-[0.02em]">dc:language</span> e <span className="tracking-[0.02em]">dc:date</span>{' '}
        cada valor é asserção independente, e uma data malformada é defeito ainda que as outras estejam corretas.
      </Nota>

      <Nota>
        <b>O gargalo é um só, e não é falta de informação.</b> O{' '}
        <span className="tracking-[0.02em]">dc:rights</span> está preenchido em mais da metade dos registros — quase
        sempre com uma licença Creative Commons ou com "Acesso Aberto" por extenso. O que falta é o termo de{' '}
        <i>nível de acesso</i> que o perfil exige,{' '}
        <span className="tracking-[0.02em]">info:eu-repo/semantics/openAccess</span>, que aparece em{' '}
        <b>1.203 de 257.397</b> valores — e cinco fontes respondem por 984 deles. A licença diz o que se pode fazer
        com o documento; o termo eu-repo diz se ele está aberto. Um não substitui o outro, e é o segundo que o
        agregador precisa ler.
        <br />
        <br />
        Por isso a taxa de "conforme nos quatro critérios" fica em 0,4%: ela é inteiramente governada por{' '}
        <span className="tracking-[0.02em]">dc:rights</span>. Os outros três passam de 90%.
      </Nota>

      <Secao>Duplicação entre fontes</Secao>
      <Guia>
        Mesmo título normalizado aparecendo em mais de uma origem — sem acento, sem pontuação, sem caixa.{' '}
        <b>Ignora os filtros globais</b>, porque o achado é justamente o cruzamento entre fontes.
      </Guia>
      <Nota>
        <b>Só conta título com sete palavras ou mais, e o corte muda tudo.</b> Sem ele a medida devolve "Editorial"
        em 752 revistas, "Apresentação" em 457 e "EXPEDIENTE" em 220 — toda revista tem um, e cada número traz o
        seu. Repetição de rótulo de seção não é duplicação de documento. Com o corte, as duplicatas dentro da mesma
        fonte caem de 14.870 para <b>{n(t?.duplicados ?? 0)}</b>, e entre fontes o caso extremo passa de 752 origens
        para 3. Ficam de fora {n(t?.secoes ?? 0)} registros com título de seção — não são defeito, mas explicam por
        que uma deduplicação ingênua por título colapsaria milhares de registros distintos.
      </Nota>
      <Nota>
        <b>O corte também governa o denominador, e por isso ele mudou.</b> A taxa por fonte é títulos longos
        repetidos ÷ <span className="tracking-[0.02em]">titles_eligible</span> — registros vivos com título de sete
        palavras ou mais —, não ÷ registros amostrados: numerador e denominador têm de contar a mesma população. O
        que mais move o denominador não são os registros excluídos, é a própria guarda de sete palavras — a mediana
        cai de <b>200</b> registros amostrados para <b>166</b> elegíveis. Efeito medido: a mediana da taxa segue
        zero, a média sobe de 0,00444 para <b>0,00571</b> (cerca de 29%) e o caso extremo, de 0,551 para{' '}
        <b>0,800</b>. Fonte sem título comparável fica com taxa <b>indefinida</b>, não zero — não se mede
        duplicação onde não há denominador. Nesta amostra não há nenhuma: como a coleta segue até juntar
        registros vivos, nenhuma fonte amostrada ficou só com excluídos ou só com títulos curtos.
      </Nota>
      <Nota>
        <b>Registro excluído não participa de nenhuma medida de conteúdo.</b> Os{' '}
        <b>{n(t?.excluidos ?? 0)}</b> marcados como excluídos no cabeçalho OAI vêm só com cabeçalho, sem bloco de
        metadados: <b>todos</b> têm hash de título vazio e zero elementos Dublin Core presentes. Entram apenas na
        caracterização da amostra: aparecem em 677 fontes, mas em nenhuma compõem a amostra inteira. As{' '}
        <b>7 fontes</b> que em até 12 páginas só serviram excluídos ficam fora dela, com desfecho{' '}
        <span className="tracking-[0.02em]">so-excluidos</span>.
      </Nota>
      {duplicatas.dados ? (
        <Tabela
          id="dimensoes-duplicacao"
          dados={duplicatas.dados}
          nome="Duplicação entre fontes"
          aoClicarLinha={duplicata.abrir}
          vazio="Nenhum título repetido entre fontes distintas na amostra."
          colunas={[
            {
              header: 'Identificador de exemplo',
              accessorKey: 'exemplo_identificador',
              cell: (c) => (
                <>
                  <span className="text-down-01 break-all">{(c.getValue() as string) || '—'}</span>
                  <br />
                  <span className="text-down-01 text-marca">ver as fontes</span>
                </>
              ),
            },
            { header: 'Ocorrências', accessorKey: 'ocorrencias', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            { header: 'Fontes distintas', accessorKey: 'fontes', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
          ]}
        />
      ) : (
        <Carregando o="as duplicatas" />
      )}

      <Secao>Metadado bom, coleta parada</Secao>
      <Guia>
        O cruzamento mais acionável da base, e ele só existe porque a amostra existe: <b>ter
        registros amostrados prova que o endpoint respondeu</b> em 22/09/2026. Uma fonte que
        publica metadado completo, responde hoje e mesmo assim não é coletada há mais de um ano não
        tem defeito — está fora dos lotes.
      </Guia>
      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(330px,1fr))]">
        <Painel titulo="Completude ≥ 0,80 por faixa de atualidade">
          {cruzamento.dados ? (
            <Barras
              itens={ORDEM_FAIXA.map((f) => {
                const d = cruzamento.dados!.find((x) => x.faixa === f)
                return {
                  rotulo: `${f} — ${n(d?.boas ?? 0)} de ${n(d?.total ?? 0)}`,
                  valor: d?.boas ?? 0,
                  tom: f === 'até 90 dias' || f === '91 a 365' ? 'ok' : 'down',
                }
              })}
            />
          ) : (
            <Carregando o="o cruzamento" />
          )}
        </Painel>
        <Painel titulo="As paradas têm metadado pior?">
          {contraste.dados ? (
            <>
              <BarraCsv
                id="dimensoes-contraste-csv"
                nome="Metadado por faixa de atualidade"
                montar={() => ({
                  cabecalho: ['Grupo', 'Fontes', 'Completude', 'Conformidade'],
                  linhas: contraste.dados!.map((x) => [x.faixa, x.n, x.completude, x.conformidade]),
                })}
              />
              <div className="overflow-x-auto">
              <table id="dimensoes-contraste" className="w-full text-base">
                <thead>
                  <tr>
                    <th className="rotulo border-b border-borda-forte px-2.5 py-2 text-left" title="Fontes agrupadas por quanto tempo faz desde a última coleta">Grupo</th>
                    <th className="rotulo border-b border-borda-forte px-2.5 py-2 text-right" title="Fontes no grupo, entre as que têm amostra de registros">Fontes</th>
                    <th className="rotulo border-b border-borda-forte px-2.5 py-2 text-right" title="Mediana dos elementos Dublin Core presentes ÷ 15">Completude</th>
                    <th className="rotulo border-b border-borda-forte px-2.5 py-2 text-right" title="Mediana dos quatro critérios DRIVER verificáveis no registro">Conformidade</th>
                  </tr>
                </thead>
                <tbody>
                  {contraste.dados.map((x) => (
                    <tr key={x.faixa} id={`dimensoes-contraste-linha-${paraId(x.faixa)}`} className="border-b border-borda last:border-0">
                      <td className="px-2.5 py-2">{x.faixa}</td>
                      <td className="num px-2.5 py-2 text-right">{n(x.n)}</td>
                      <td className="num px-2.5 py-2 text-right font-semibold">{pc(x.completude)}</td>
                      <td className="num px-2.5 py-2 text-right">{pc(x.conformidade)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          ) : (
            <Carregando o="o contraste" />
          )}
          <p className="mt-3 text-down-01 text-conteudo-fraco">
            Não têm. É o que torna a lista abaixo uma fila de trabalho, e não um diagnóstico.
          </p>
        </Painel>
      </div>

      {negligenciadas.dados && negligenciadas.dados.length > 0 && (
        <Nota>
          <b>
            {n(negligenciadas.dados.length)} fontes publicam metadado completo, respondem hoje e não
            são coletadas há mais de um ano
          </b>{' '}
          — somando {n(negligenciadas.dados.reduce((a, x) => a + (x.latest_size ?? 0), 0))} registros
          já indexados que estão envelhecendo. E as paradas têm completude mediana{' '}
          <b>maior</b> que as recentes, não menor: a seleção dos lotes não é guiada por qualidade.
          Recoletar estas é o trabalho de menor custo e maior retorno da base, e não exige consertar
          nada em nenhuma fonte.
        </Nota>
      )}

      <div className="mt-4">
        {negligenciadas.dados ? (
          <Tabela
            id="dimensoes-coleta-parada"
            dados={negligenciadas.dados}
            nome="Metadado bom, coleta parada"
            porPagina={15}
            aoClicarLinha={(l) => aoAbrirFonte(l.source_id)}
            vazio="Nenhuma fonte do recorte publica metadado bom e está parada."
            colunas={[
              {
                header: 'Fonte',
                accessorKey: 'source_name_raw',
                cell: (c) => (
                  <>
                    <span className="font-medium">{c.row.original.source_name_raw}</span>
                    <br />
                    <span className="text-down-01 text-conteudo-fraco">{c.row.original.institution_name}</span>
                  </>
                ),
              },
              { header: 'Plataforma', accessorKey: 'platform_analysis_group', cell: (c) => <Pilula>{c.getValue() as string}</Pilula> },
              { header: 'Completude', accessorKey: 'completude', meta: { num: true }, cell: (c) => pc(c.getValue() as number) },
              { header: 'Dias parada', accessorKey: 'days_since_last_harvest', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
              { header: 'Registros', accessorKey: 'latest_size', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            ]}
          />
        ) : (
          <Carregando o="a fila" />
        )}
      </div>

      <Secao>Por fonte</Secao>
      {porFonte.dados ? (
        <Tabela
          id="dimensoes-por-fonte"
          dados={porFonte.dados}
          nome="Dimensões por fonte"
          porPagina={25}
          aoClicarLinha={(l) => aoAbrirFonte(l.source_id)}
          colunas={[
            {
              header: 'Fonte',
              accessorKey: 'source_name_raw',
              cell: (c) => (
                <>
                  <span className="font-medium">{c.row.original.source_name_raw}</span>
                  <br />
                  <span className="text-down-01 text-conteudo-fraco">{c.row.original.institution_name}</span>
                </>
              ),
            },
            { header: 'Plataforma', accessorKey: 'platform_analysis_group', cell: (c) => <Pilula>{c.getValue() as string}</Pilula> },
            { header: 'Recebidos', accessorKey: 'records_sampled', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            { header: 'Elegíveis', accessorKey: 'titles_eligible', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            { header: 'Completude', accessorKey: 'completude', meta: { num: true }, cell: (c) => pc(c.getValue() as number) },
            { header: 'Conformidade', accessorKey: 'conformidade', meta: { num: true }, cell: (c) => pc(c.getValue() as number) },
            { header: 'Duplicação', accessorKey: 'taxa_duplicacao', meta: { num: true }, cell: (c) => pc(c.getValue() as number) },
            { header: 'Fora do esquema', accessorKey: 'off_schema_records', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
          ]}
        />
      ) : (
        <Carregando o="as fontes" />
      )}

      {t && (
        <Nota>
          A amostra cobre <b>{n(nVivos)}</b> registros vivos e distintos de {n(t.fontes)} fontes — de{' '}
          {n(t.recebidos)} cabeçalhos recebidos, dos quais {n(t.excluidos)} de registros excluídos, sem metadado, e{' '}
          {n(nVivos === undefined ? null : t.recebidos - t.excluidos - nVivos)} de registros que a paginação serviu
          mais de uma vez. Duzentos registros vivos por
          fonte bastam para estimar taxa — completude e conformidade são propriedades do <i>pipeline</i> de quem
          publica, não de cada artigo —, mas <b>não</b> para afirmar nada sobre o acervo inteiro de uma fonte
          grande. Aumentar a amostra é questão de rodar{' '}
          <span className="tracking-[0.02em]">coletar_registros.py --registros N</span>.
          <br />
          <br />
          <b>A meta é em registros vivos, não em páginas.</b> Seguiu-se o{' '}
          <span className="tracking-[0.02em]">resumptionToken</span> até juntar 200 registros vivos, com teto de 12
          páginas; os excluídos que vieram antes do corte ficam na amostra. A mediana é de 2 páginas e 200 vivos, e{' '}
          <b>235 fontes</b> ficaram abaixo da meta — 178 porque o acervo acabou antes, 20 por baterem no teto de
          páginas. O tamanho de cada página é do provedor e não foi negociado: onde as primeiras páginas são quase
          só de excluídos, a amostra chega a 1.200 registros para juntar menos de 200 vivos.
          <br />
          <br />
          <b>Duas datas, e elas não são a mesma.</b> A data de referência do conjunto é <b>20/09/2026</b>: é o
          estado operacional registrado no agregador, e é contra ela que se calcula{' '}
          <span className="tracking-[0.02em]">days_since_last_harvest</span>. A coleta de registros junto aos
          provedores é de dois dias depois, <b>22/09/2026</b>, e é camada independente — não consulta o agregador,
          consulta as origens.
        </Nota>
      )}

      <Janela aberta={ficha.aberta} aoFechar={ficha.fechar} titulo="ficha-dimensao-titulo">
        {ficha.item && <FichaDimensao nome={ficha.item} />}
      </Janela>
      <Janela aberta={duplicata.aberta} aoFechar={duplicata.fechar} titulo="duplicata-titulo" largura={760}>
        {duplicata.item && (
          <OcorrenciasDuplicata
            duplicata={duplicata.item}
            aoAbrirFonte={(id) => {
              // Uma janela por vez: o Perfil abre no lugar desta, não por cima.
              duplicata.fechar()
              aoAbrirFonte(id)
            }}
          />
        )}
      </Janela>
    </>
  )
}

function FichaDimensao({ nome }: { nome: string }) {
  const dimensao = DIMENSOES.find((d) => d.nome === nome)
  const f = FICHAS[nome]
  if (!dimensao || !f) return null
  return (
    <>
      <h3 id="ficha-dimensao-titulo" className="text-up-01 font-semibold">
        {dimensao.nome}
      </h3>
      <p className="mt-1.5 mb-4 flex flex-wrap gap-1.5">
        <Pilula tom={TOM_GRAU[dimensao.grau]}>{dimensao.grau === 'fora' ? 'não atendida' : dimensao.grau}</Pilula>
        {dimensao.tipo !== '—' && (
          <Pilula tom={dimensao.tipo === 'indicador' ? 'marca' : 'neutro'}>{dimensao.tipo}</Pilula>
        )}
        <Pilula tom="neutro">nível de {dimensao.nivel}</Pilula>
      </p>

      {(
        [
          ['O que é', f.oQue],
          ['Como é gerada', f.como],
          ['Para que existe', f.paraQue],
        ] as const
      ).map(([titulo, texto]) => (
        <section key={titulo} className="mb-4">
          <h4 className="rotulo mb-1.5 border-b border-borda pb-1">{titulo}</h4>
          <p className={`m-0 ${titulo === 'Para que existe' ? 'font-medium' : ''}`}>{texto}</p>
        </section>
      ))}

      <section className="rounded border-l-4 border-marca bg-superficie-alt px-4 py-3">
        <h4 className="rotulo mb-1.5">Exemplo de uso</h4>
        <p className="m-0">{f.exemplo}</p>
      </section>
    </>
  )
}

type Ocorrencia = {
  source_id: string
  source_name_raw: string
  institution_name: string
  platform_analysis_group: string
  source_url: string | null
  oai_identifier: string
  first_identifier: string
}

/** Só vira link o que é endereço web: dc:identifier também carrega ISSN, DOI cru e texto livre. */
const ehUrl = (v: string | null | undefined): v is string => !!v && /^https?:\/\//i.test(v)

/** Agrupa preservando a ordem da consulta: a primeira ocorrência carrega os dados da fonte. */
const porFonte = (lista: Ocorrencia[]) => {
  const grupos = new Map<string, Ocorrencia[]>()
  for (const o of lista) grupos.set(o.source_id, [...(grupos.get(o.source_id) ?? []), o])
  return [...grupos.values()].map((docs) => [docs[0], docs] as const)
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-marca underline underline-offset-2">
      {children}
    </a>
  )
}

/**
 * Cada registro com o título repetido, e por qual fonte ele chegou.
 *
 * Os mesmos cortes de `v_duplicata` — vivo, com título, sete palavras ou mais —,
 * senão a janela listaria ocorrências que a contagem da tabela não viu.
 */
function OcorrenciasDuplicata({
  duplicata,
  aoAbrirFonte,
}: {
  duplicata: Duplicata
  aoAbrirFonte: (id: string) => void
}) {
  const ocorrencias = useConsulta<Ocorrencia>(
    `SELECT r.source_id, s.source_name_raw, s.institution_name, s.platform_analysis_group, s.source_url,
            r.oai_identifier, r.first_identifier
     FROM records r JOIN repositories s USING (source_id)
     WHERE r.title_hash = ${lit(duplicata.title_hash)} AND NOT r.deleted AND r.title_words >= 7
     ORDER BY s.source_name_raw, r.oai_identifier`,
  )
  return (
    <>
      <h3 id="duplicata-titulo" className="text-up-01 font-semibold">
        Mesmo título em {n(duplicata.fontes)} fontes
      </h3>
      <p className="mt-1 mb-4 text-down-01 text-conteudo-fraco">
        {n(duplicata.ocorrencias)} ocorrências do mesmo título normalizado. O texto do título não está no dataset — só
        o hash —, então a prova está nos links: abra os documentos e compare.
      </p>
      {ocorrencias.erro && <Erro mensagem={ocorrencias.erro} />}
      {!ocorrencias.dados && !ocorrencias.erro && <Carregando o="as ocorrências" />}
      {ocorrencias.dados && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {porFonte(ocorrencias.dados).map(([primeira, docs]) => (
            <li key={primeira.source_id} className="rounded border border-borda p-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium">{primeira.source_name_raw}</span>
                <Pilula>{primeira.platform_analysis_group}</Pilula>
                <span className="text-down-01 text-conteudo-fraco">
                  {n(docs.length)} {docs.length === 1 ? 'ocorrência' : 'ocorrências'}
                </span>
              </div>
              <p className="m-0 text-down-01 text-conteudo-fraco">{primeira.institution_name}</p>
              <p className="m-0 mt-1 mb-2 text-down-01">
                {ehUrl(primeira.source_url) ? <Link href={primeira.source_url}>{primeira.source_url}</Link> : '—'}
                {' · '}
                <button
                  type="button"
                  onClick={() => aoAbrirFonte(primeira.source_id)}
                  className="cursor-pointer text-marca underline underline-offset-2"
                >
                  abrir a ficha da fonte
                </button>
              </p>
              <h4 className="rotulo mb-1">Documentos</h4>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-down-01">
                {docs.map((o) => (
                  <li key={o.oai_identifier} className="min-w-0">
                    {ehUrl(o.first_identifier) ? (
                      <Link href={o.first_identifier}>{o.first_identifier}</Link>
                    ) : (
                      <span className="break-all text-conteudo-fraco">{o.first_identifier || o.oai_identifier}</span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
