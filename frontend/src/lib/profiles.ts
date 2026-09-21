import type { Profile } from './types'

/**
 * Rótulo do perfil, por chave de tradução.
 *
 * O backend sabe escrever isso (`get_profile_display`), mas só em português:
 * os rótulos de `models.TextChoices` não passam pelo `t()`. Por isso a API
 * manda apenas o código — `ADMIN`, `GESTOR` — e quem escolhe a palavra é a
 * interface, no idioma de quem está olhando.
 *
 * O mapa é explícito, e não `profiles.${profile}`: assim um perfil novo não
 * chega à tela com a chave crua na cara: o TypeScript cobra a entrada aqui.
 */
export const CHAVE_DO_PERFIL: Record<Profile, string> = {
  ADMIN: 'roles.admin',
  GESTOR: 'roles.manager',
}
