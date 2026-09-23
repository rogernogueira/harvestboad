import { baixarCsv } from '../csv'

/**
 * Baixa uma tabela em CSV. O conteúdo é montado no clique, não a cada
 * renderização: a maior tabela do painel tem 2.183 linhas e o botão fica
 * visível o tempo todo.
 *
 * `nome` é o rótulo humano da tabela — vira o nome do arquivo sem acento e é
 * o que o leitor de tela anuncia.
 */
export function BotaoCsv({
  id,
  nome,
  montar,
}: {
  id?: string
  nome: string
  montar: () => { cabecalho: string[]; linhas: unknown[][] }
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={() => {
        const { cabecalho, linhas } = montar()
        baixarCsv(nome, cabecalho, linhas)
      }}
      title={`Baixar ${nome} em CSV`}
      aria-label={`Baixar ${nome} em CSV`}
      className="cursor-pointer rounded-sm border border-borda-forte px-2.5 py-1 text-down-01 text-conteudo-fraco hover:border-marca hover:text-marca"
    >
      <span aria-hidden className="mr-1">↓</span>
      exportar CSV
    </button>
  )
}

/** A mesma barra em que o botão vive, para as tabelas escritas à mão. */
export function BarraCsv({ id, nome, montar }: Parameters<typeof BotaoCsv>[0]) {
  return (
    <div className="mb-1.5 flex justify-end">
      <BotaoCsv id={id} nome={nome} montar={montar} />
    </div>
  )
}
