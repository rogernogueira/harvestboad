import type { ReactNode } from 'react'

/*
 * Fichas de estado, no modelo `.br-tag`: fundo na cor do estado, texto por
 * cima. É o que o frontend faz, e por um motivo medido — o par principal sobre
 * o alternativo da mesma família é seguro como componente, não como texto
 * pequeno (sucesso 4,02, erro 3,69). Virando fundo, o texto volta a ter
 * contraste de verdade.
 *
 * Branco sobre cada fundo: sucesso 4,59 · erro 4,60 · neutro 6,01 · marca
 * 7,33. Sobre o amarelo de Alerta branco dá **1,50**, reprova por larga
 * margem — ali o texto é a cor principal da função Leitura, que dá 8,42.
 */
export const TONS = {
  ok: 'bg-ok text-white',
  warn: 'bg-alerta text-conteudo',
  down: 'bg-erro text-white',
  neutro: 'bg-grafico-neutro text-white',
  marca: 'bg-marca text-white',
} as const
export type Tom = keyof typeof TONS

export function Pilula({ children, tom = 'marca' }: { children: ReactNode; tom?: Tom }) {
  return (
    <span className={`inline-block rounded-sm px-1.5 py-px text-down-01 whitespace-nowrap ${TONS[tom]}`}>
      {children}
    </span>
  )
}

export function Cartao({
  chave,
  valor,
  nota,
  tom,
}: {
  chave: string
  valor: ReactNode
  nota?: ReactNode
  tom?: Tom
}) {
  // Número grande é texto grande, 3:1 basta — sucesso e erro passam. O amarelo
  // de Alerta não passa nem isso (1,50), então quem colore é o laranja gráfico.
  const cor =
    tom === 'down' ? 'text-erro' : tom === 'warn' ? 'text-grafico-alerta' : tom === 'ok' ? 'text-ok' : ''
  return (
    <div className="bg-superficie px-3.5 py-3">
      <span className="rotulo mb-1.5 block">{chave}</span>
      <span className={`block text-up-03 leading-tight font-semibold tracking-tight ${cor}`}>{valor}</span>
      {nota && <span className="mt-0.5 block text-down-01 text-conteudo-fraco">{nota}</span>}
    </div>
  )
}

export function Cartoes({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-sm border border-borda bg-borda [grid-template-columns:repeat(auto-fit,minmax(168px,1fr))]">
      {children}
    </div>
  )
}

export function Secao({ children }: { children: ReactNode }) {
  return (
    <h2 className="rotulo mt-8 mb-3 border-b border-borda pb-1.5 tracking-[0.09em] first:mt-0">{children}</h2>
  )
}

export function Painel({ children, titulo }: { children: ReactNode; titulo?: string }) {
  return (
    <div className="min-w-0 rounded-sm border border-borda bg-superficie p-4">
      {titulo && <h3 className="mb-3 text-down-01 font-semibold text-conteudo-fraco">{titulo}</h3>}
      {children}
    </div>
  )
}

export function Nota({ children }: { children: ReactNode }) {
  return (
    <p className="my-3.5 max-w-[72ch] rounded-r-sm border-l-2 border-marca bg-superficie-alt px-3.5 py-2.5 text-down-01 text-conteudo-fraco [&_b]:text-conteudo [&_strong]:text-conteudo">
      {children}
    </p>
  )
}

export function Guia({ children }: { children: ReactNode }) {
  return <p className="mb-5 max-w-[66ch] text-conteudo-fraco">{children}</p>
}

/** Barras horizontais com rótulo e valor. Clicáveis quando `aoClicar` existe. */
export function Barras({
  itens,
  aoClicar,
  ativo,
}: {
  itens: { rotulo: string; valor: number; tom?: Tom }[]
  aoClicar?: (rotulo: string) => void
  ativo?: string
}) {
  const max = Math.max(1, ...itens.map((i) => i.valor))
  // Preenchimento de barra é elemento gráfico (3:1). O amarelo dá 1,41 sobre a
  // superfície alternativa, então entra o laranja da mesma paleta.
  const cor = {
    ok: 'bg-ok',
    warn: 'bg-grafico-alerta',
    down: 'bg-erro',
    neutro: 'bg-grafico-neutro',
    marca: 'bg-marca',
  }
  return (
    <div className="flex flex-col gap-1">
      {itens.map((i) => {
        const Etiqueta = aoClicar ? 'button' : 'div'
        return (
          <Etiqueta
            key={i.rotulo}
            {...(aoClicar ? { type: 'button' as const, onClick: () => aoClicar(i.rotulo) } : {})}
            className={`grid w-full grid-cols-[minmax(86px,auto)_1fr_56px] items-center gap-2.5 py-0.5 text-left sm:grid-cols-[minmax(120px,auto)_1fr_60px] ${
              aoClicar ? 'group cursor-pointer' : ''
            }`}
          >
            <span
              className={`truncate text-down-01 ${
                ativo === i.rotulo ? 'text-marca' : 'text-conteudo-fraco'
              } ${aoClicar ? 'group-hover:text-marca' : ''}`}
            >
              {i.rotulo}
            </span>
            <span className="block h-[15px] overflow-hidden rounded-sm bg-superficie-alt">
              <span
                className={`block h-full ${cor[i.tom ?? 'marca']}`}
                style={{ width: `${(i.valor / max) * 100}%` }}
              />
            </span>
            <span className="num text-right text-down-01">{i.valor.toLocaleString('pt-BR')}</span>
          </Etiqueta>
        )
      })}
    </div>
  )
}

export function Carregando({ o }: { o: string }) {
  return <p className="px-2 py-6 text-center text-base text-conteudo-fraco">carregando {o}…</p>
}

export function Erro({ mensagem }: { mensagem: string }) {
  return (
    <p className="rounded-sm border border-erro bg-erro-alt px-3.5 py-2.5 text-down-01 text-erro">
      {mensagem}
    </p>
  )
}

export function Vazio({ children, id }: { children: ReactNode; id?: string }) {
  return <p id={id} className="px-2 py-6 text-center text-base text-conteudo-fraco">{children}</p>
}
