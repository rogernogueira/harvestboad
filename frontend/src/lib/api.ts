import { tokens } from '@/auth/tokens'

/** Em dev o Vite faz proxy de /api para o Django (ver vite.config.ts). */
const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

export class ApiError extends Error {
  // Campos declarados explicitamente: o tsconfig usa `erasableSyntaxOnly`,
  // que proíbe propriedades de parâmetro no construtor.
  readonly status: number
  readonly payload: unknown

  constructor(status: number, payload: unknown, message?: string) {
    super(message ?? `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }

  /** Mensagem legível, achatando os erros de campo do DRF. */
  get detail(): string {
    const payload = this.payload
    if (typeof payload === 'string') return payload
    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>
      if (typeof record.detail === 'string') return record.detail
      const first = Object.values(record)[0]
      if (Array.isArray(first) && typeof first[0] === 'string') return first[0]
    }
    return this.message
  }
}

/** Disparado quando a sessão não pode mais ser renovada. */
export const SESSION_EXPIRED = 'harvestboard:session-expired'

let refreshing: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  const refresh = tokens.refresh
  if (!refresh) return false

  // Uma renovação por vez: várias requisições falhando juntas não podem
  // disparar vários refresh (o backend rotaciona o refresh token).
  refreshing ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      })
      if (!response.ok) return false
      const data = (await response.json()) as { access: string; refresh?: string }
      tokens.set(data.access, data.refresh)
      return true
    } catch {
      return false
    } finally {
      refreshing = null
    }
  })()

  return refreshing
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  /** Rotas de autenticação não devem tentar renovar o token. */
  skipAuth?: boolean
  raw?: boolean
}

async function send(path: string, options: RequestOptions, retry = true): Promise<Response> {
  const { body, skipAuth, raw, headers, ...rest } = options
  const finalHeaders = new Headers(headers)

  if (!raw) finalHeaders.set('Accept', 'application/json')
  if (body !== undefined) finalHeaders.set('Content-Type', 'application/json')

  const access = tokens.access
  if (access && !skipAuth) finalHeaders.set('Authorization', `Bearer ${access}`)

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 401 && retry && !skipAuth) {
    if (await refreshAccessToken()) return send(path, options, false)
    tokens.clear()
    window.dispatchEvent(new Event(SESSION_EXPIRED))
  }

  return response
}

async function parseError(response: Response): Promise<never> {
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  throw new ApiError(response.status, payload)
}

export async function apiGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, { ...options, method: 'GET' })
  if (!response.ok) await parseError(response)
  return (await response.json()) as T
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const response = await send(path, { ...options, method: 'POST', body })
  if (!response.ok) await parseError(response)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function apiDelete(path: string): Promise<void> {
  const response = await send(path, { method: 'DELETE' })
  if (!response.ok) await parseError(response)
}

/** Busca texto bruto — usado pelo XML transformado. */
export async function apiGetText(path: string): Promise<string> {
  const response = await send(path, { method: 'GET', raw: true })
  if (!response.ok) await parseError(response)
  return response.text()
}

/**
 * Baixa um arquivo autenticado.
 *
 * Um `<a href>` comum não carrega o cabeçalho Authorization, então o arquivo é
 * buscado com o token e entregue como blob.
 */
export async function apiDownload(path: string, fallbackName: string): Promise<void> {
  const response = await send(path, { method: 'GET', raw: true })
  if (!response.ok) await parseError(response)

  const disposition = response.headers.get('Content-Disposition') ?? ''
  const match = /filename="([^"]+)"/.exec(disposition)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = match?.[1] ?? fallbackName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export { API_BASE }
