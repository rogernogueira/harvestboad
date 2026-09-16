/**
 * Guarda os tokens JWT.
 *
 * Fica em localStorage para a sessão sobreviver ao recarregamento da página.
 * A contrapartida é conhecida: um XSS consegue lê-los. A alternativa robusta é
 * cookie httpOnly, que exige o backend emitindo e renovando o cookie — decisão
 * do lado do servidor, não contornável só aqui.
 */
const ACCESS = 'harvestboard.access'
const REFRESH = 'harvestboard.refresh'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* modo privado ou armazenamento bloqueado: a sessão dura só esta aba */
  }
}

export const tokens = {
  get access() {
    return read(ACCESS)
  },
  get refresh() {
    return read(REFRESH)
  },
  set(access: string, refresh?: string) {
    write(ACCESS, access)
    if (refresh) write(REFRESH, refresh)
  },
  clear() {
    write(ACCESS, null)
    write(REFRESH, null)
  },
}
