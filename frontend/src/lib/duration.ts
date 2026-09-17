/**
 * Duração de uma coleta, em horas, minutos e segundos.
 *
 * `null` quando falta uma das pontas — coleta em execução não tem término, e
 * uma coleta antiga pode ter vindo da origem sem início. Nesses casos não há
 * duração a mostrar, e inventar zero diria algo falso.
 *
 * As datas do Harvester chegam como "2026-09-16 15:54:58", sem fuso. O
 * `Date` do navegador lê esse formato como hora local, e é o que se quer: as
 * duas pontas vêm do mesmo relógio, então a diferença entre elas é a mesma em
 * qualquer fuso em que a string seja interpretada.
 */
export function harvestDuration(
  start: string | null | undefined,
  end: string | null | undefined,
): { horas: number; minutos: number; segundos: number } | null {
  if (!start || !end) return null

  const inicio = new Date(start.replace(' ', 'T')).getTime()
  const fim = new Date(end.replace(' ', 'T')).getTime()
  if (Number.isNaN(inicio) || Number.isNaN(fim)) return null

  const total = Math.max(0, Math.round((fim - inicio) / 1000))
  return {
    horas: Math.floor(total / 3600),
    minutos: Math.floor((total % 3600) / 60),
    segundos: total % 60,
  }
}
