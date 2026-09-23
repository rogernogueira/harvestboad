import { useEffect, useRef, useState } from 'react'
import { consultar, lit } from './duckdb'

export type Filtros = {
  plataforma: string
  tipo: string
  coleta: string
  uf: string
  busca: string
}

export const FILTROS_VAZIOS: Filtros = { plataforma: '', tipo: '', coleta: '', uf: '', busca: '' }

export const algumFiltro = (f: Filtros) => Object.values(f).some(Boolean)

/** Cláusula WHERE a partir dos filtros globais, aplicável a `v_source`. */
export function onde(f: Filtros): string {
  const partes: string[] = []
  if (f.plataforma) partes.push(`platform_analysis_group = ${lit(f.plataforma)}`)
  if (f.tipo) partes.push(`source_type_detail = ${lit(f.tipo)}`)
  if (f.coleta) partes.push(`latest_snapshot_status = ${lit(f.coleta)}`)
  if (f.uf) partes.push(`subdivision_code = ${lit(f.uf)}`)
  if (f.busca) {
    const t = lit(`%${f.busca.trim().toLowerCase()}%`)
    partes.push(`(lower(source_name_raw) LIKE ${t} OR lower(institution_name) LIKE ${t})`)
  }
  return partes.length ? `WHERE ${partes.join(' AND ')}` : ''
}

export type Estado<T> = { dados: T[] | null; erro: string | null; carregando: boolean }

/**
 * Executa SQL e devolve as linhas. Consultas fora de ordem são descartadas
 * pelo contador: sem isso, um filtro digitado rápido pinta a tela com o
 * resultado de uma tecla anterior.
 */
export function useConsulta<T = Record<string, unknown>>(sql: string | null): Estado<T> {
  const [estado, setEstado] = useState<Estado<T>>({ dados: null, erro: null, carregando: true })
  const geracao = useRef(0)

  useEffect(() => {
    if (sql === null) return
    const minha = ++geracao.current
    setEstado((e) => ({ ...e, carregando: true }))
    consultar<T>(sql)
      .then((dados) => {
        if (minha === geracao.current) setEstado({ dados, erro: null, carregando: false })
      })
      .catch((e: unknown) => {
        if (minha === geracao.current)
          setEstado({ dados: null, erro: e instanceof Error ? e.message : String(e), carregando: false })
      })
  }, [sql])

  return estado
}

/** Atraso para não disparar uma consulta por tecla digitada. */
export function useAtraso<T>(valor: T, ms = 200): T {
  const [atrasado, setAtrasado] = useState(valor)
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms)
    return () => clearTimeout(t)
  }, [valor, ms])
  return atrasado
}

/**
 * Tokens resolvidos para o ECharts, que desenha em canvas e não lê `var()`.
 *
 * `warn` **não** é o amarelo da função Feedback: #ffcd07 dá 1,41 sobre a
 * superfície alternativa e reprova até no critério de elemento gráfico (3:1).
 * Em traço e barra entra o laranja da mesma paleta, que dá 4,59. O amarelo
 * continua valendo como fundo de ficha, onde quem precisa de contraste é o
 * texto sobre ele.
 */
export function cores() {
  const cs = getComputedStyle(document.documentElement)
  const ler = (nome: string) => cs.getPropertyValue(`--${nome}`).trim()
  return {
    conteudo: ler('conteudo'),
    conteudoFraco: ler('conteudo-fraco'),
    borda: ler('borda'),
    superficie: ler('superficie'),
    superficieAlt: ler('superficie-alt'),
    marca: ler('marca'),
    ok: ler('ok'),
    warn: ler('grafico-alerta'),
    down: ler('erro'),
    neutro: ler('grafico-neutro'),
  }
}
