/**
 * Sino de notificações.
 *
 * Existe pelo mesmo motivo do `UsersIcon`: carregar o `id` da convenção e o
 * `aria-hidden`. Quem nomeia a ação é o `title`/`aria-label` do botão que o
 * envolve — o ícone sozinho não diz nada a um leitor de tela.
 *
 * `fas` (Solid) do Font Awesome **5**, que é o que o Padrão Digital referencia.
 * Na 6 o mapa de glifos muda e o ícone cai na fonte de texto.
 */
export function BellIcon({ id = 'bell-icon', className }: { id?: string; className?: string }) {
  return <i id={id} className={`fas fa-bell ${className ?? ''}`} aria-hidden="true" />
}
