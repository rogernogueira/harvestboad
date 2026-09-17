const RECUO = '  '

/*
 * Largura a partir da qual a tag de abertura quebra em uma linha por atributo.
 *
 * A raiz do XOAI declara três namespaces e passa de 180 caracteres: numa linha
 * só, ela obriga a rolar o modal na horizontal para ler o começo do documento.
 * O valor não é a largura da caixa (que varia) — é o ponto em que a linha
 * deixou de caber em qualquer uma delas.
 */
const LARGURA_MAXIMA = 100

const escaparTexto = (valor: string) =>
  valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escaparAtributo = (valor: string) =>
  valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

/** Texto que é só espaço entre tags — o que a indentação antiga deixou. */
const ehEspacoEntreTags = (no: Node) =>
  no.nodeType === Node.TEXT_NODE && !(no.textContent ?? '').trim()

function serializar(no: Node, nivel: number, saida: string[]): void {
  const recuo = RECUO.repeat(nivel)

  if (no.nodeType === Node.TEXT_NODE) {
    const texto = (no.textContent ?? '').trim()
    if (texto) saida.push(recuo + escaparTexto(texto))
    return
  }
  if (no.nodeType === Node.COMMENT_NODE) {
    saida.push(`${recuo}<!--${no.textContent ?? ''}-->`)
    return
  }
  if (no.nodeType === Node.CDATA_SECTION_NODE) {
    saida.push(`${recuo}<![CDATA[${no.textContent ?? ''}]]>`)
    return
  }
  if (no.nodeType !== Node.ELEMENT_NODE) return

  const elemento = no as Element
  const declarados = [...elemento.attributes].map(
    (atributo) => `${atributo.name}="${escaparAtributo(atributo.value)}"`,
  )
  const emLinha = declarados.map((atributo) => ` ${atributo}`).join('')
  /* Alinhados sob o nome da tag, como o próprio XOAI os manda. */
  const quebrado =
    '\n' +
    declarados
      .map((atributo) => `${recuo}${' '.repeat(elemento.nodeName.length + 2)}${atributo}`)
      .join('\n')
  const atributos =
    declarados.length > 1 &&
    recuo.length + elemento.nodeName.length + emLinha.length > LARGURA_MAXIMA
      ? quebrado
      : emLinha
  const filhos = [...elemento.childNodes].filter((filho) => !ehEspacoEntreTags(filho))

  if (filhos.length === 0) {
    saida.push(`${recuo}<${elemento.nodeName}${atributos} />`)
    return
  }

  /*
   * Conteúdo misto (texto e elemento irmãos) sai como veio, numa linha só.
   * Quebrar as linhas aí mudaria o documento: em conteúdo misto o espaço em
   * volta do texto é significativo, e quem lê não tem como saber se o
   * espaço estava no metadado ou foi a indentação que o pôs.
   */
  const temTexto = filhos.some((filho) => filho.nodeType === Node.TEXT_NODE)
  const temElemento = filhos.some((filho) => filho.nodeType === Node.ELEMENT_NODE)
  if (temTexto && temElemento) {
    saida.push(
      `${recuo}<${elemento.nodeName}${atributos}>${elemento.innerHTML}</${elemento.nodeName}>`,
    )
    return
  }

  /* Só texto: fica ao lado das tags, como o valor de um campo. */
  if (temTexto) {
    const texto = escaparTexto((elemento.textContent ?? '').trim())
    saida.push(`${recuo}<${elemento.nodeName}${atributos}>${texto}</${elemento.nodeName}>`)
    return
  }

  saida.push(`${recuo}<${elemento.nodeName}${atributos}>`)
  for (const filho of filhos) serializar(filho, nivel + 1, saida)
  saida.push(`${recuo}</${elemento.nodeName}>`)
}

/**
 * Reindenta o XML de um registro para leitura.
 *
 * O XOAI que o Harvester devolve vem com indentação própria, herdada de quem o
 * gerou: linhas em branco no meio, atributos de `<metadata>` alinhados por
 * espaços e blocos com recuo de profundidade que não corresponde à do
 * documento. A interface do Harvester resolve isso com o `vkbeautify`; aqui o
 * navegador já tem o que é preciso — `DOMParser` entende o documento e a
 * indentação sai da árvore, não de contagem de `<`.
 *
 * Os espaços das pontas de cada valor são descartados (é o que a reindentação
 * significa); os de dentro, não — há metadado com espaço duplo intencional.
 *
 * XML mal formado volta como veio: a tela mostrando o texto cru ainda é mais
 * útil que uma mensagem de erro no lugar do conteúdo.
 */
export function indentarXml(texto: string): string {
  const cru = texto.trim()
  if (!cru) return texto

  const documento = new DOMParser().parseFromString(cru, 'application/xml')
  if (documento.getElementsByTagName('parsererror').length > 0) return texto

  const saida: string[] = []
  // O `DOMParser` não expõe a declaração como nó; se ela veio, é reposta.
  const declaracao = /^<\?xml[^?]*\?>/.exec(cru)
  if (declaracao) saida.push(declaracao[0])

  for (const no of documento.childNodes) serializar(no, 0, saida)
  return saida.join('\n')
}
