/**
 * Classificação dos estados de coleta do Harvester.
 *
 * Fica em `lib`, e não junto do badge, porque não é componente: exportar
 * função de um módulo de componentes quebra o Fast Refresh do Vite — é o que a
 * regra `react/only-export-components` do oxlint acusa.
 */

/** Classifica o status de coleta do Harvester em três níveis visuais. */
export function harvestTone(status: string): 'ok' | 'warn' | 'down' {
  const value = status.toUpperCase()
  if (value.includes('ERROR')) return 'down'
  if (value.includes('VALID')) return 'ok'
  return 'warn'
}

/**
 * O estado merece selo?
 *
 * Reaproveita `harvestTone`: `ok` é o caso normal — coleta válida — e mostrá-lo
 * em toda linha de uma lista gasta um dos lugares mais chamativos do cartão com
 * informação que nunca muda. Os outros dois tons, `warn` e `down`, são os que o
 * gestor precisa notar.
 *
 * Vem da mesma classificação, e não de uma lista própria de status, para que um
 * estado novo da origem seja tratado num lugar só.
 */
export function estadoExcepcional(status: string | null | undefined): boolean {
  return Boolean(status) && harvestTone(status as string) !== 'ok'
}
