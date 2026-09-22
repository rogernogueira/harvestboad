import { BrSelectStandard } from '@govbr-ds/react-components'

/**
 * Seletor de filtro que mora na linha de filtros do cabeçalho de uma tabela.
 *
 * Difere do seletor da `FilterBar` num ponto: **não leva rótulo visível**. O
 * cabeçalho logo acima já nomeia a coluna, e repetir "Filtrar por validade"
 * dentro da célula gastaria duas linhas de altura em toda a largura da tabela.
 * O nome acessível vem por `aria-label`, com o texto passando por `t()`.
 *
 * Passar `label` junto com `id` ao `BrSelectStandard` não funcionaria de todo
 * jeito. O componente gera um id interno, aponta o `<label htmlFor>` para ele e
 * só depois espalha o resto das props sobre o `<select>`
 * (`dist/index.es.js`, na definição do componente):
 *
 *     <label htmlFor={gerado}>            // aponta para o id gerado
 *     <select id={gerado} {...resto} />   // `resto.id` sobrescreve o gerado
 *
 * Com um `id` nosso — que a convenção do projeto exige — o `htmlFor` fica
 * apontando para um id que não existe mais no documento, e o rótulo deixa de
 * nomear o campo. O `aria-label` não depende dessa associação.
 */
export function ColumnFilterSelect({
  id,
  rotulo,
  valor,
  onMudar,
  opcoes,
}: {
  id: string
  rotulo: string
  valor: string
  onMudar: (valor: string) => void
  opcoes: { label: string; value: string }[]
}) {
  return (
    <BrSelectStandard
      id={id}
      aria-label={rotulo}
      title={rotulo}
      value={valor}
      onChange={(evento) => onMudar(evento.target.value)}
      options={opcoes}
    />
  )
}
