import { useCallback, useMemo } from 'react'
import { onde, useConsulta, type Filtros } from '../ganchos'
import { Cartao, Cartoes, Carregando, Erro, Guia, Nota, Painel, Pilula, Secao } from '../componentes/Basicos'
import { Grafico, type Paleta } from '../componentes/Grafico'
import { Tabela } from '../componentes/Tabela'
import { n, n1, pc } from '../formato'

type Natureza = {
  institution_type: string
  instituicoes: number
  fontes: number
  completude: number | null
  conformidade: number | null
  validade: number | null
  dias: number | null
  erros: number
}
type Instituicao = {
  institution_name: string
  institution_type: string
  subdivision_code: string
  outlier: boolean
  fontes: number
  plataformas: number
  tipos: number
  registros: number
  validade_mediana: number | null
  completude: number | null
  dias_mediana: number | null
  erros: number
}
type Faixa = { faixa: string; instituicoes: number; fontes: number }

export function Instituicoes({ filtros }: { filtros: Filtros }) {
  const w = onde(filtros)
  // O filtro global vale sobre as fontes; a instituição entra se ao menos uma
  // fonte dela sobreviver ao recorte.
  const dentro = w ? `WHERE institution_name IN (SELECT institution_name FROM v_source ${w})` : ''

  const totais = useConsulta<{
    instituicoes: number
    fontes: number
    maior: number
    media: number
    uma_fonte: number
    com_amostra: number
  }>(
    useMemo(
      () => `SELECT count(*)::INT AS instituicoes, sum(fontes)::INT AS fontes,
                    max(fontes)::INT AS maior, avg(fontes)::DOUBLE AS media,
                    count(*) FILTER (fontes = 1)::INT AS uma_fonte,
                    count(*) FILTER (completude IS NOT NULL)::INT AS com_amostra
             FROM v_instituicao ${dentro}`,
      [dentro],
    ),
  )

  const naturezas = useConsulta<Natureza>(
    useMemo(
      () => `SELECT institution_type, count(*)::INT AS instituicoes, sum(fontes)::INT AS fontes,
                    median(completude) AS completude, median(conformidade) AS conformidade,
                    median(validade_mediana) AS validade, median(dias_mediana) AS dias,
                    sum(erros)::INT AS erros
             FROM v_instituicao ${dentro} GROUP BY 1 ORDER BY instituicoes DESC`,
      [dentro],
    ),
  )

  // A concentração é o achado metodológico desta aba, e o filtro global não a
  // altera: a distribuição de fontes por instituição é propriedade da base.
  const faixas = useConsulta<Faixa>(
    `SELECT CASE WHEN fontes = 1 THEN '1 fonte'
                 WHEN fontes <= 3 THEN '2 a 3'
                 WHEN fontes <= 10 THEN '4 a 10'
                 WHEN fontes <= 40 THEN '11 a 40'
                 ELSE 'mais de 40' END AS faixa,
            count(*)::INT AS instituicoes, sum(fontes)::INT AS fontes
     FROM v_instituicao GROUP BY 1`,
  )

  const lista = useConsulta<Instituicao>(
    useMemo(
      () => `SELECT institution_name, institution_type, subdivision_code, outlier, fontes,
                    plataformas::INT AS plataformas, tipos::INT AS tipos, registros::BIGINT AS registros,
                    validade_mediana, completude, dias_mediana, erros::INT AS erros
             FROM v_instituicao ${dentro} ORDER BY fontes DESC`,
      [dentro],
    ),
  )

  const ORDEM = ['1 fonte', '2 a 3', '4 a 10', '11 a 40', 'mais de 40']
  const opcao = useCallback(
    (p: Paleta) => {
      const d = ORDEM.map((f) => faixas.dados?.find((x) => x.faixa === f)).filter(Boolean) as Faixa[]
      return {
        grid: { left: 70, right: 16, top: 28, bottom: 26 },
        legend: { top: 0, right: 0, textStyle: { color: p.conteudoFraco, fontSize: 10.5 }, itemHeight: 8 },
        xAxis: {
          type: 'category',
          data: d.map((x) => x.faixa),
          axisLine: { lineStyle: { color: p.borda } },
          axisTick: { show: false },
          axisLabel: { color: p.conteudoFraco },
        },
        yAxis: { type: 'value', splitLine: { lineStyle: { color: p.borda } }, axisLabel: { color: p.conteudoFraco } },
        tooltip: { trigger: 'axis' },
        series: [
          { name: 'instituições', type: 'bar', data: d.map((x) => x.instituicoes), itemStyle: { color: p.marca } },
          { name: 'fontes que elas somam', type: 'bar', data: d.map((x) => x.fontes), itemStyle: { color: p.neutro } },
        ],
      }
    },
    [faixas.dados],
  )

  const erro = [totais, naturezas, faixas, lista].find((c) => c.erro)?.erro
  if (erro) return <Erro mensagem={erro} />
  const t = totais.dados?.[0]

  return (
    <>
      <Guia>
        A fonte é a unidade errada para qualquer pergunta sobre instituição. Esta aba agrega por
        instituição — <b>a mediana das fontes de cada uma</b>, não a média dos registros —, que é o
        comportamento típico da instituição e não o do maior periódico que ela publica.
      </Guia>

      {t ? (
        <Cartoes>
          <Cartao chave="Instituições" valor={n(t.instituicoes)} nota={`${n(t.fontes)} fontes no total`} />
          <Cartao chave="Fontes por instituição" valor={n1(t.media)} nota={`mediana 1 · máximo ${n(t.maior)}`} />
          <Cartao
            chave="Com uma fonte só"
            valor={n(t.uma_fonte)}
            nota={pc(t.uma_fonte / t.instituicoes) + ' das instituições'}
          />
          <Cartao chave="Com amostra de registros" valor={n(t.com_amostra)} nota="base das medidas de completude" />
        </Cartoes>
      ) : (
        <Carregando o="as instituições" />
      )}

      <Secao>Concentração — por que a unidade importa</Secao>
      <Painel>
        {faixas.dados ? (
          <Grafico opcao={opcao} altura={250} rotulo="Instituições e fontes por faixa de concentração" />
        ) : (
          <Carregando o="a distribuição" />
        )}
      </Painel>
      <Nota>
        <b>Pseudo-replicação.</b> Analisar por fonte faz a USP entrar 87 vezes no mesmo teste e uma
        faculdade com um periódico entrar uma. Numa pergunta sobre instituições isso é indefensível
        — e não muda só o valor de <i>p</i>: muda a estimativa. Em H7, a validade por natureza sai
        de ε² = 0,0189 por fonte para <b>0,0396</b> por instituição.
      </Nota>

      <Secao>Por natureza institucional</Secao>
      {naturezas.dados ? (
        <Tabela
          id="instituicoes-natureza"
          dados={naturezas.dados}
          nome="Por natureza institucional"
          ordemInicial={[{ id: 'instituicoes', desc: true }]}
          colunas={[
            { header: 'Natureza', accessorKey: 'institution_type', cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
            { header: 'Instituições', accessorKey: 'instituicoes', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            { header: 'Fontes', accessorKey: 'fontes', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            { header: 'Completude', accessorKey: 'completude', meta: { num: true }, cell: (c) => pc(c.getValue() as number) },
            { header: 'Conformidade', accessorKey: 'conformidade', meta: { num: true }, cell: (c) => pc(c.getValue() as number) },
            { header: 'Validade', accessorKey: 'validade', meta: { num: true }, cell: (c) => pc(c.getValue() as number) },
            { header: 'Dias', accessorKey: 'dias', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            { header: 'Erros', accessorKey: 'erros', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
          ]}
        />
      ) : (
        <Carregando o="as naturezas" />
      )}
      <Nota>
        Estas colunas <b>não</b> são o teste de H7: aqui a natureza ainda está confundida com a
        plataforma — sociedade científica tende a SCIELO, universidade a DSpace mais OJS. A ficha
        H7, na aba Evidências, refaz a comparação com tipo de fonte e plataforma fixos, e é lá que
        o efeito aparente de 0,0581 encolhe para <b>0,0325</b>.
      </Nota>

      <Secao>Todas as instituições</Secao>
      {lista.dados ? (
        <Tabela
          id="instituicoes-todas"
          dados={lista.dados}
          nome="Todas as instituições"
          porPagina={25}
          colunas={[
            {
              header: 'Instituição',
              accessorKey: 'institution_name',
              cell: (c) => (
                <>
                  <span className="font-medium">{c.row.original.institution_name}</span>
                  {c.row.original.outlier && (
                    <>
                      {' '}
                      <Pilula tom="warn">outlier declarado</Pilula>
                    </>
                  )}
                  <br />
                  <span className="text-down-01 text-conteudo-fraco">
                    {c.row.original.institution_type} · {c.row.original.subdivision_code}
                  </span>
                </>
              ),
            },
            { header: 'Fontes', accessorKey: 'fontes', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            { header: 'Plataformas', accessorKey: 'plataformas', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            { header: 'Registros', accessorKey: 'registros', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            { header: 'Completude', accessorKey: 'completude', meta: { num: true }, cell: (c) => pc(c.getValue() as number) },
            { header: 'Validade', accessorKey: 'validade_mediana', meta: { num: true }, cell: (c) => pc(c.getValue() as number) },
            { header: 'Dias', accessorKey: 'dias_mediana', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
            { header: 'Erros', accessorKey: 'erros', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
          ]}
        />
      ) : (
        <Carregando o="a lista" />
      )}

      <Nota>
        <b>A USP é outlier declarado, e excluí-la não muda nada.</b> São 87 fontes — o dobro da
        segunda colocada (UnB, 43), trinta vezes a média e 4,0% de toda a base. A regra é exceção
        nomeada, não estatística: a cerca de Tukey nesta distribuição cai em 3,5 fontes e pegaria
        104 instituições, inútil quando {n(totais.dados?.[0]?.uma_fonte ?? 515)} têm uma fonte só.
        O que a isola é o vão observado entre 87 e 43.
        <br />
        <br />
        Ela sai como <b>recorte de sensibilidade, nunca de inclusão</b>: H7 controlado vai de
        0,0325 para 0,0329 sem ela, e H4 de 0,1874 para 0,1936. É outlier em concentração, não em
        influência — a qualidade dela é típica (completude 0,80, contra 0,80 da base). A regra e a
        justificativa estão em <span className="tracking-[0.02em]">sql/views-registros.sql</span>,
        versionadas junto do dataset.
      </Nota>
    </>
  )
}
