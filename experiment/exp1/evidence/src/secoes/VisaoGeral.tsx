import { useMemo } from 'react'
import { onde, useConsulta, type Filtros } from '../ganchos'
import { Cartao, Cartoes, Carregando, Erro, Guia, Nota, Painel, Secao } from '../componentes/Basicos'
import { n, pc, razao } from '../formato'

type Resumo = {
  fontes: number
  instituicoes: number
  com_acervo: number
  coletados: number
  validos: number
  transformados: number
  erros: number
  persistentes: number
  indexadas: number
  dias_mediana: number | null
}

export function VisaoGeral({ filtros }: { filtros: Filtros }) {
  const sql = useMemo(
    () => `
    SELECT
      count(*)                                                        AS fontes,
      count(DISTINCT institution_name)                                AS instituicoes,
      count(*) FILTER (latest_size > 0)                               AS com_acervo,
      COALESCE(sum(latest_size), 0)                                   AS coletados,
      COALESCE(sum(latest_valid_size), 0)                             AS validos,
      COALESCE(sum(latest_transformed_size), 0)                       AS transformados,
      count(*) FILTER (crit_erro)                                     AS erros,
      count(*) FILTER (crit_persistente)                              AS persistentes,
      count(*) FILTER (latest_index_status = 'INDEXED')               AS indexadas,
      median(days_since_last_harvest)                                 AS dias_mediana
    FROM v_source ${onde(filtros)}`,
    [filtros],
  )
  const { dados, erro } = useConsulta<Resumo>(sql)

  if (erro) return <Erro mensagem={erro} />
  if (!dados) return <Carregando o="o resumo" />
  const r = dados[0]
  if (!r.fontes) return <Guia>Nenhuma fonte no recorte atual.</Guia>

  const etapas = [
    ['Coletados', r.coletados, 'registros trazidos do endpoint OAI-PMH'],
    ['Válidos', r.validos, 'aprovados no perfil DRIVER/OpenAIRE'],
    ['Transformados', r.transformados, 'convertidos para o formato do índice'],
  ] as const

  return (
    <>
      <Guia>
        Retrato de <b className="font-semibold text-conteudo">{n(r.fontes)}</b> fontes de acesso aberto registradas no
        Oasisbr, cruzando o cadastro do Harvester, o <span className="">Identify</span> de cada endpoint
        OAI-PMH, cinco sondas de detecção de plataforma e o histórico completo de coletas. Toda a tela é consultada
        por SQL, no navegador, contra os Parquet congelados.
      </Guia>

      <Cartoes>
        <Cartao chave="Fontes" valor={n(r.fontes)} nota={`${n(r.instituicoes)} instituições`} />
        <Cartao chave="Registros coletados" valor={n(r.coletados)} nota={`em ${n(r.com_acervo)} fontes com acervo`} />
        <Cartao
          chave="Taxa de validade"
          valor={razao(r.validos, r.coletados)}
          nota={`${n(r.coletados - r.validos)} registros inválidos`}
          tom={r.coletados && r.validos / r.coletados < 0.9 ? 'warn' : 'ok'}
        />
        <Cartao
          chave="Erro na última coleta"
          valor={n(r.erros)}
          nota={`${pc(r.erros / r.fontes)} das fontes`}
          tom={r.erros ? 'down' : 'ok'}
        />
        <Cartao
          chave="Persistentemente problemáticas"
          valor={n(r.persistentes)}
          nota="falham em série no histórico"
          tom={r.persistentes ? 'down' : 'ok'}
        />
        <Cartao
          chave="Mediana sem coletar"
          valor={r.dias_mediana === null ? '—' : `${n(r.dias_mediana)} d`}
          nota="desde a última coleta"
          tom={(r.dias_mediana ?? 0) > 180 ? 'warn' : 'ok'}
        />
      </Cartoes>

      <Secao>Funil de processamento</Secao>
      <Painel>
        <div className="flex flex-col">
          {etapas.map(([nome, valor, desc], i) => (
            <div key={nome}>
              <div className="flex items-baseline justify-between gap-3 pt-2.5">
                <span className="rotulo">{nome}</span>
                <span className="num text-up-01 font-semibold">
                  {n(valor)} <span className="text-down-01 font-normal text-conteudo-fraco">{razao(valor, r.coletados)}</span>
                </span>
              </div>
              <span
                className="mt-1.5 block h-6 rounded-sm bg-marca"
                style={{ width: `${r.coletados ? (valor / r.coletados) * 100 : 0}%` }}
              />
              <div className="my-1 ml-2 border-l-2 border-borda-forte py-1 pl-3.5 text-down-01 text-conteudo-fraco">
                {desc}
                {i > 0 && (
                  <>
                    {' · fora: '}
                    <b className="font-semibold text-erro">{n(r.coletados - valor)}</b>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Painel>

      <Nota>
        <b>Não é um funil em série.</b> Validação e transformação rodam em paralelo sobre o mesmo lote de coletados, e
        é por isso que transformados ({n(r.transformados)}) supera válidos ({n(r.validos)}): um registro reprovado no
        perfil DRIVER ainda é convertido. A última etapa, a indexação, o Harvester só reporta por fonte, não por
        registro — <b>{n(r.indexadas)}</b> das {n(r.fontes)} fontes constam como indexadas.
      </Nota>
    </>
  )
}
