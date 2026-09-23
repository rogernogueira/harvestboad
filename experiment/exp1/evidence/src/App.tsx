import { useEffect, useMemo, useState } from 'react'
import { comMetadados, comRegistros, conectar, consultar } from './duckdb'
import { metadados, type Dataset as MetaDataset } from './metadados'
import { carregarDicas } from './dicas'
import { FILTROS_VAZIOS, algumFiltro, onde, useAtraso, type Filtros } from './ganchos'
import { Erro } from './componentes/Basicos'
import { VisaoGeral } from './secoes/VisaoGeral'
import { Coleta } from './secoes/Coleta'
import { Qualidade } from './secoes/Qualidade'
import { Plataformas } from './secoes/Plataformas'
import { Fontes } from './secoes/Fontes'
import { Dimensoes } from './secoes/Dimensoes'
import { Repositorios } from './secoes/Repositorios'
import { Metadados } from './secoes/Metadados'
import { Instituicoes } from './secoes/Instituicoes'
import { Historico } from './secoes/Historico'
import { Evidencias } from './secoes/Evidencias'
import { Dataset } from './secoes/Dataset'
import { Perfil } from './secoes/Perfil'
import { n } from './formato'

const ABAS = [
  ['visao', 'Visão geral'],
  ['coleta', 'Coleta'],
  ['qualidade', 'Qualidade'],
  ['plataformas', 'Plataformas'],
  ['fontes', 'Fontes'],
  ['repositorios', 'Repositórios'],
  ['dimensoes', 'Dimensões'],
  ['metadados', 'Metadados'],
  ['instituicoes', 'Instituições'],
  ['historico', 'Histórico'],
  ['evidencias', 'Evidências'],
  ['dataset', 'Dataset'],
] as const
type Aba = (typeof ABAS)[number][0]

/** Abas que não respondem aos filtros globais, e por isso escondem a barra. */
const SEM_FILTRO: Aba[] = ['historico', 'evidencias', 'dataset']

type Opcoes = { plataforma: string[]; tipo: string[]; coleta: string[]; uf: string[] }

export default function App() {
  const [pronto, setPronto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aba, setAba] = useState<Aba>('visao')
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS)
  const [busca, setBusca] = useState('')
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null)
  const [meta, setMeta] = useState<MetaDataset | null>(null)
  const [fonte, setFonte] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)

  const buscaAtrasada = useAtraso(busca, 220)
  useEffect(() => setFiltros((f) => ({ ...f, busca: buscaAtrasada })), [buscaAtrasada])

  useEffect(() => {
    ;(async () => {
      try {
        await conectar()
        const distintos = async (campo: string) =>
          (
            await consultar<{ v: string }>(
              `SELECT DISTINCT ${campo} AS v FROM repository_summary WHERE ${campo} IS NOT NULL ORDER BY 1`,
            )
          ).map((r) => r.v)
        setOpcoes({
          plataforma: await distintos('platform_analysis_group'),
          tipo: await distintos('source_type_detail'),
          coleta: await distintos('latest_snapshot_status'),
          uf: await distintos('subdivision_code'),
        })
        const pacote = await metadados()
        carregarDicas(pacote.hints)
        setMeta(pacote.dataset)
        setPronto(true)
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  const sqlTotal = useMemo(() => `SELECT count(*) AS t FROM v_source ${onde(filtros)}`, [filtros])
  useEffect(() => {
    if (!pronto) return
    consultar<{ t: number }>(sqlTotal)
      .then((r) => setTotal(r[0].t))
      .catch(() => setTotal(null))
  }, [pronto, sqlTotal])

  const limpar = () => {
    setFiltros(FILTROS_VAZIOS)
    setBusca('')
  }
  const trocar = (campo: keyof Filtros) => (e: React.ChangeEvent<HTMLSelectElement>) =>
    setFiltros((f) => ({ ...f, [campo]: e.target.value }))

  if (erro)
    return (
      <div className="mx-auto max-w-[1180px] px-4 py-16">
        <h1 className="mb-3 text-up-02 font-semibold">Não foi possível abrir o dataset</h1>
        <Erro mensagem={erro} />
        <p className="mt-4 max-w-[60ch] text-conteudo-fraco">
          O painel carrega o motor DuckDB do jsDelivr e lê os Parquet servidos ao lado desta página. Um bloqueio de
          rede em qualquer um dos dois produz esta tela.
        </p>
      </div>
    )

  if (!pronto)
    return (
      <div className="mx-auto max-w-[1180px] px-4 py-24 text-center">
        <p className="rotulo mb-2">HarvestBoard Evidence</p>
        <p className="text-conteudo-fraco">abrindo o dataset congelado…</p>
        <p className="mt-2 text-down-01 text-conteudo-fraco">carregando DuckDB e seis tabelas Parquet</p>
      </div>
    )

  const filtroVisivel = !SEM_FILTRO.includes(aba)

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-borda bg-superficie">
        <div className="mx-auto max-w-[1180px] px-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-3.5 pb-2.5">
            <h1 className="text-up-02 font-semibold tracking-tight">HarvestBoard Evidence</h1>
            <span className="ml-auto text-down-01 tracking-[0.02em] text-conteudo-fraco">
              {meta?.dataset_id} · {meta?.dataset_status}
            </span>
          </div>
          <nav role="tablist" aria-label="Seções do painel" className="flex gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {ABAS.filter(
              ([id]) =>
                (!['dimensoes', 'repositorios', 'instituicoes'].includes(id) || comRegistros()) &&
                (id !== 'metadados' || comMetadados()),
            ).map(([id, rotulo]) => (
              <button
                key={id}
                role="tab"
                id={`aba-${id}`}
                aria-selected={aba === id}
                aria-controls={`sec-${id}`}
                onClick={() => {
                  setAba(id)
                  window.scrollTo({ top: 0 })
                }}
                className={`shrink-0 cursor-pointer border-b-2 px-3 py-2.5 text-base font-medium whitespace-nowrap ${
                  aba === id
                    ? 'border-marca text-marca'
                    : 'border-transparent text-conteudo-fraco hover:text-conteudo'
                }`}
              >
                {rotulo}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {filtroVisivel && opcoes && (
        <div className="sticky top-[89px] z-15 border-b border-borda bg-superficie-alt max-[700px]:static">
          <div className="mx-auto flex max-w-[1180px] flex-wrap items-end gap-2 px-4 py-2">
            {(
              [
                ['plataforma', 'Plataforma', opcoes.plataforma, 'todas'],
                ['tipo', 'Tipo de fonte', opcoes.tipo, 'todos'],
                ['coleta', 'Estado da coleta', opcoes.coleta, 'todos'],
                ['uf', 'UF', opcoes.uf, 'todas'],
              ] as const
            ).map(([campo, rotulo, lista, vazio]) => (
              <div key={campo} className="flex flex-col gap-0.5">
                <label htmlFor={`filtro-${campo}`} className="rotulo">
                  {rotulo}
                </label>
                <select
                  id={`filtro-${campo}`}
                  value={filtros[campo]}
                  onChange={trocar(campo)}
                  className="min-w-[130px] rounded-sm border border-borda-forte bg-superficie px-2 py-1.5 text-down-01 text-conteudo"
                >
                  <option value="">{vazio}</option>
                  {lista.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="flex flex-col gap-0.5">
              <label htmlFor="filtro-busca" className="rotulo">
                Buscar
              </label>
              <input
                id="filtro-busca"
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="nome ou instituição"
                autoComplete="off"
                className="min-w-[160px] rounded-sm border border-borda-forte bg-superficie px-2 py-1.5 text-down-01 text-conteudo"
              />
            </div>
            {algumFiltro(filtros) && (
              <button
                type="button"
                onClick={limpar}
                className="cursor-pointer rounded-sm border border-borda-forte bg-superficie px-2.5 py-1.5 text-down-01 text-conteudo-fraco hover:border-marca hover:text-marca"
              >
                limpar
              </button>
            )}
            <span className="num ml-auto pb-1.5 text-down-01 text-conteudo-fraco">
              {total === null
                ? '…'
                : algumFiltro(filtros)
                  ? `${n(total)} de ${n(meta?.repositories ?? 0)} fontes`
                  : `${n(total)} fontes`}
            </span>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1180px] px-4 pt-5 pb-16">
        <div role="tabpanel" id={`sec-${aba}`} aria-labelledby={`aba-${aba}`}>
          {aba === 'visao' && <VisaoGeral filtros={filtros} />}
          {aba === 'coleta' && (
            <Coleta
              filtros={filtros}
              aoFiltrarColeta={(v) => setFiltros((f) => ({ ...f, coleta: f.coleta === v ? '' : v }))}
              aoAbrirFonte={setFonte}
            />
          )}
          {aba === 'qualidade' && <Qualidade filtros={filtros} aoAbrirFonte={setFonte} />}
          {aba === 'plataformas' && <Plataformas filtros={filtros} />}
          {aba === 'fontes' && <Fontes filtros={filtros} aoAbrirFonte={setFonte} />}
          {aba === 'repositorios' && <Repositorios filtros={filtros} aoAbrirFonte={setFonte} />}
          {aba === 'dimensoes' && <Dimensoes filtros={filtros} aoAbrirFonte={setFonte} />}
          {aba === 'metadados' && <Metadados filtros={filtros} />}
          {aba === 'instituicoes' && <Instituicoes filtros={filtros} />}
          {aba === 'historico' && <Historico />}
          {aba === 'evidencias' && <Evidencias />}
          {aba === 'dataset' && <Dataset />}
        </div>

        <footer className="mt-11 border-t border-borda pt-4 text-down-01 text-conteudo-fraco">
          <p className="m-0">
            {meta?.title} · versão {meta?.version} · {n(meta?.repositories ?? 0)} fontes ·{' '}
            {n(meta?.snapshots_total ?? 0)} snapshots · dados de {meta?.reference_date}. Consultado por DuckDB-WASM
            sobre Parquet congelado; nenhuma requisição a API em tempo de leitura.
          </p>
        </footer>
      </main>

      <Perfil id={fonte} aoFechar={() => setFonte(null)} />
    </>
  )
}
