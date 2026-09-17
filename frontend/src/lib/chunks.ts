/**
 * Marca da última recarga automática, no armazenamento da aba.
 *
 * Existe para o remédio não virar laço: se o arquivo faltando não for o do
 * deploy anterior — um build quebrado, a rede fora, um proxy devolvendo 404 —
 * recarregar não resolve, e sem a marca a página recarregaria sem parar.
 */
const MARCA = 'harvestboard.chunk-reload'

/**
 * Janela em que uma segunda falha é tratada como "recarregar não resolve".
 *
 * Dez segundos cobrem com folga a carga da página e a nova tentativa de buscar
 * o pedaço; passado isso, uma falha nova é outra falha, e ganha a sua recarga.
 */
const JANELA_MS = 10_000

const lerMarca = () => {
  try {
    return Number(sessionStorage.getItem(MARCA) ?? 0)
  } catch {
    /* modo privado ou armazenamento bloqueado: sem marca, cai no limite abaixo */
    return 0
  }
}

/**
 * Recarrega a página quando um pedaço do bundle não é encontrado.
 *
 * As páginas entram por `import()` preguiçoso e cada pedaço leva o hash do
 * conteúdo no nome. A cada deploy os nomes mudam e os antigos deixam de existir,
 * então a aba que já estava aberta guarda um mapa de assets que morreu: navegar
 * para uma rota ainda não carregada pede um arquivo que responde 404, o
 * `import()` rejeita e a rota fica em branco, com
 * "Failed to fetch dynamically imported module" no console.
 *
 * O `index.html` não é cacheado (`Cache-Control: no-store` no nginx), então uma
 * recarga basta: a aba pega o mapa novo e segue. É o que isto faz, uma vez.
 *
 * O evento é do Vite, emitido pelo próprio carregador de módulos, e é
 * cancelável — cancelar evita que a rejeição apareça no console de quem só vai
 * ver a página recarregar.
 */
export function recarregarQuandoFaltarChunk(): void {
  window.addEventListener('vite:preloadError', (evento) => {
    const agora = Date.now()
    if (agora - lerMarca() < JANELA_MS) return

    try {
      sessionStorage.setItem(MARCA, String(agora))
    } catch {
      /* sem onde marcar: a recarga acontece, e a próxima falha volta aqui */
    }

    evento.preventDefault()
    window.location.reload()
  })
}
