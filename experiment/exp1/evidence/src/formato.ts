const NUM = new Intl.NumberFormat('pt-BR')
const UM = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : NUM.format(v))
export const n1 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : UM.format(v))

/** Fração 0–1 como porcentagem. Nunca inventa 0% a partir de nulo. */
export const pc = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : UM.format(v * 100) + '%'

export const razao = (a: number | null | undefined, b: number | null | undefined) =>
  !b || a === null || a === undefined ? '—' : pc(a / b)

export const data = (v: string | number | Date | null | undefined) =>
  v === null || v === undefined ? '—' : new Date(v).toLocaleDateString('pt-BR', { timeZone: 'UTC' })

/**
 * Texto livre como pedaço de id: sem acento, minúsculo, só letras, dígitos e
 * hífen. Para as linhas de tabela escrita à mão cuja chave é um rótulo.
 */
export const paraId = (v: string | number) =>
  String(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export const bytes = (v: number) =>
  v >= 1 << 20 ? `${UM.format(v / (1 << 20))} MB` : `${Math.round(v / 1024)} KB`
