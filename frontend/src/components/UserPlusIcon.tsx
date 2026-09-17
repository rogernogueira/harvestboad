/**
 * Ícone de adicionar usuário.
 *
 * Era um SVG desenhado inline "para não puxar uma biblioteca inteira". A
 * biblioteca agora já vem: o Font Awesome 5 é dependência do Padrão Digital de
 * Governo e é carregado de qualquer forma, então o desenho à mão deixou de
 * economizar peso e só divergia do traço dos demais ícones da interface.
 *
 * O componente continua existindo, em vez de o `<i>` ir direto nas páginas,
 * porque ele carrega o `id` da convenção e o `aria-hidden` — o texto ao lado é
 * que nomeia a ação.
 */
export function UserPlusIcon({
  id = 'user-plus-icon',
  className,
}: {
  id?: string
  className?: string
}) {
  return <i id={id} className={`fas fa-user-plus ${className ?? ''}`} aria-hidden="true" />
}
