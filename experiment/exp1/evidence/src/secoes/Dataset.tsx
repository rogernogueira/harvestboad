import { useEffect, useState } from 'react'
import { metadados, type Pacote } from '../metadados'
import { Cartao, Cartoes, Carregando, Erro, Guia, Nota, Painel, Pilula, Secao } from '../componentes/Basicos'
import { Tabela } from '../componentes/Tabela'
import { bytes, n } from '../formato'

/** Negrito e código nas dicas, sem carregar um renderizador de Markdown por isso. */
function grifar(texto: string) {
  return texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((parte, i) => {
    if (parte.startsWith('**')) return <b key={i} className="text-conteudo">{parte.slice(2, -2)}</b>
    if (parte.startsWith('`')) return <span key={i} className="font-semibold tracking-[0.02em]">{parte.slice(1, -1)}</span>
    return parte
  })
}

export function Dataset() {
  const [p, setP] = useState<Pacote | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    metadados()
      .then(setP)
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : String(e)))
  }, [])

  if (erro) return <Erro mensagem={erro} />
  if (!p) return <Carregando o="os metadados" />
  const { dataset: d, provenance: pv } = p

  return (
    <>
      <Guia>
        O painel não consulta uma API: consulta estes arquivos. Tudo abaixo é baixável e o conteúdo é função pura dos
        dados de coleta — regenerar o dataset com as mesmas entradas devolve os mesmos bytes, e{' '}
        <span className="">checksums.sha256</span> serve para conferir.
      </Guia>

      <Cartoes>
        <Cartao chave="Identificador" valor={<span className="text-base">{d.dataset_id}</span>} nota={d.publisher} />
        <Cartao chave="Estado" valor={<span className="text-ok">{d.dataset_status}</span>} nota={`schema ${d.schema_version}`} />
        <Cartao chave="Data de referência" valor={d.reference_date} nota={`exportado em ${d.exported_at.slice(0, 10)}`} />
        <Cartao chave="Licença" valor={<span className="text-up-01">{d.license}</span>} nota={d.unit_of_observation} />
      </Cartoes>

      <Secao>Tabelas</Secao>
      <Tabela
        id="dataset-tabelas"
        dados={d.tables}
        nome="Tabelas do dataset"
        colunas={[
          {
            header: 'Arquivo',
            accessorKey: 'name',
            cell: (c) => <span className="text-down-01">{c.getValue() as string}.parquet</span>,
          },
          { header: 'Linhas', accessorKey: 'rows', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
          { header: 'Colunas', accessorKey: 'columns', meta: { num: true }, cell: (c) => n(c.getValue() as number) },
          { header: 'Tamanho', accessorKey: 'bytes', meta: { num: true }, cell: (c) => bytes(c.getValue() as number) },
        ]}
      />
      <Nota>
        A camada analítica que o painel executa está em{' '}
        <span className="font-semibold tracking-[0.02em]">sql/views.sql</span>
        . Quem pegar os Parquet e rodar esse mesmo arquivo num DuckDB local reproduz as telas — as definições de
        faixa, de critério de atenção e de persistência vivem no SQL justamente para não divergirem. Os binários
        canônicos ficam no repositório, em <span className="">exp1/evidence/public/data/</span>: esta página
        carrega cópias em base64 porque o visualizador só serve uma lista fechada de tipos de arquivo, e Parquet não
        está nela. São os mesmos bytes, e o checksum abaixo é o do binário.
      </Nota>

      <Secao>Proveniência</Secao>
      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(330px,1fr))]">
        <Painel titulo="Origem dos dados">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-base">
            {Object.entries(pv.source).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="rotulo pt-0.5">{k.replace(/_/g, ' ')}</dt>
                <dd className="num m-0 min-w-0 break-all">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </Painel>
        <Painel titulo="Extração">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-base">
            {Object.entries(pv.extraction).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="rotulo pt-0.5">{k.replace(/_/g, ' ')}</dt>
                <dd className="num m-0 min-w-0 break-all">
                  {k === 'git_commit' ? v.slice(0, 12) : v}
                </dd>
              </div>
            ))}
          </dl>
        </Painel>
        <Painel titulo="Origens consultadas">
          <ul className="m-0 list-none space-y-3 p-0">
            {pv.sources.map((s) => (
              <li key={s.name}>
                <span className="font-medium">{s.name}</span> <Pilula>{s.kind}</Pilula>
                <p className="mt-0.5 text-down-01 text-conteudo-fraco">{s.provides}</p>
                {s.note && <p className="mt-0.5 text-down-01 text-conteudo-fraco">{s.note}</p>}
              </li>
            ))}
          </ul>
        </Painel>
        <Painel titulo="Etapas">
          <ol className="m-0 list-none space-y-2.5 p-0">
            {pv.pipeline.map((e, i) => (
              <li key={e.step} className="flex gap-3">
                <span className="rotulo pt-0.5">{i + 1}</span>
                <span>
                  <span className="font-medium">{e.step}</span>
                  <p className="mt-0.5 text-down-01 break-all text-conteudo-fraco">{e.scripts.join(' · ')}</p>
                </span>
              </li>
            ))}
          </ol>
          <h4 className="rotulo mt-4 mb-1.5 border-t border-borda pt-3">Datas de coleta</h4>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-down-01">
            {Object.entries(pv.collected_at).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-conteudo-fraco">{k.replace(/_/g, ' ')}</dt>
                <dd className="num m-0 text-conteudo-fraco">{v}</dd>
              </div>
            ))}
          </dl>
        </Painel>
      </div>

      <Secao>Limitações conhecidas</Secao>
      <Painel>
        <ul className="m-0 list-none space-y-2 p-0">
          {pv.limitations.map((l) => (
            <li key={l} className="flex gap-2.5 text-base text-conteudo-fraco">
              <span aria-hidden className="text-erro">
                ▪
              </span>
              {l}
            </li>
          ))}
        </ul>
      </Painel>

      <Secao>Referência das colunas</Secao>
      <Guia>
        As {n(Object.values(p.hints).reduce((a, t) => a + Object.keys(t.colunas).length, 0))} colunas
        das {n(Object.keys(p.hints).length)} tabelas, com o que cada uma é e, onde existe, como ela
        engana. A mesma dica aparece ao passar o cursor no cabeçalho de qualquer tabela do painel.
      </Guia>
      {Object.entries(p.hints).map(([tabela, def]) => (
        <details key={tabela} className="mb-2 rounded-sm border border-borda bg-superficie">
          <summary className="cursor-pointer px-4 py-3 marker:text-conteudo-fraco hover:bg-superficie-alt">
            <span className="font-medium">{tabela}</span>{' '}
            <span className="text-down-01 text-conteudo-fraco">
              · {n(Object.keys(def.colunas).length)} colunas
            </span>
            <p className="mt-1 max-w-[76ch] text-down-01 text-conteudo-fraco">{def.descricao}</p>
          </summary>
          <dl className="grid gap-x-5 gap-y-2 border-t border-borda px-4 py-3 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
            {Object.entries(def.colunas).map(([coluna, texto]) => (
              <div key={coluna}>
                <dt className="text-down-01 font-semibold tracking-[0.02em]">{coluna}</dt>
                <dd className="m-0 text-down-01 text-conteudo-fraco">{grifar(texto)}</dd>
              </div>
            ))}
          </dl>
        </details>
      ))}

      <Secao>Dicionário de dados</Secao>
      <Guia>
        {n(p.codebook.length)} campos e {n(Object.keys(p.vocabularies).length)} vocabulários controlados.{' '}
        <span className="">M</span> é obrigatório, <span className="">C</span> condicional,{' '}
        <span className="">O</span> opcional.
      </Guia>
      <Tabela
        id="dataset-dicionario"
        dados={p.codebook}
        nome="Dicionário de dados"
        porPagina={20}
        colunas={[
          { header: 'Campo', accessorKey: 'field', cell: (c) => <span className="text-down-01">{c.getValue() as string}</span> },
          { header: 'Tipo', accessorKey: 'type', cell: (c) => <span className="text-down-01 text-conteudo-fraco">{c.getValue() as string}</span> },
          {
            header: 'Obrig.',
            accessorKey: 'requirement',
            cell: (c) => (
              <Pilula tom={c.getValue() === 'M' ? 'marca' : c.getValue() === 'C' ? 'warn' : 'neutro'}>
                {c.getValue() as string}
              </Pilula>
            ),
          },
          {
            header: 'Vocabulário',
            accessorKey: 'vocabulary',
            cell: (c) => {
              const v = c.getValue() as string | null
              if (!v) return <span className="text-conteudo-fraco">—</span>
              const termos = p.vocabularies[v]?.terms.length
              return (
                <span className="text-down-01">
                  {v} <span className="text-conteudo-fraco">({termos} termos)</span>
                </span>
              )
            },
          },
          {
            header: 'Condição',
            accessorKey: 'condition',
            cell: (c) => <span className="text-down-01 text-conteudo-fraco">{(c.getValue() as string) ?? '—'}</span>,
          },
        ]}
      />

      <Secao>Checksums</Secao>
      <Painel>
        <pre className="m-0 overflow-x-auto text-down-01 leading-relaxed text-conteudo-fraco">{p.checksums}</pre>
        <p className="mt-3 text-down-01 text-conteudo-fraco">
          <span className="">{pv.reproducibility.verify}</span>
        </p>
      </Painel>
    </>
  )
}
