import { useEffect, useState } from 'react'

/**
 * Atrasa a propagação de um valor.
 *
 * Usado na busca de repositórios: sem isso, cada tecla dispararia três
 * consultas ao Harvester, que já perde metade das conexões.
 */
export function useDebounced<T>(value: T, delay = 400): T {
  const [atrasado, setAtrasado] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setAtrasado(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])

  return atrasado
}
