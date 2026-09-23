import type { Tom } from './componentes/Basicos'

/*
 * Rótulo, tom e sentido de cada `record_harvest.reaction`.
 *
 * O código é gravado por `congelar._reacao`, que agrupa os ~20 desfechos crus
 * do ListRecords; aqui só se dá nome a ele. Um código novo lá sem entrada aqui
 * aparece cru na tela em vez de sumir — é o `?? código` de `rotuloReacao`.
 *
 * A ordem é a de leitura, não a de contagem: primeiro quem respondeu, depois a
 * causa única que mais pesa (o agregador desativado) e por fim quem nunca foi
 * pedido. Contagem muda com o filtro; a ordem não deve mudar junto.
 */
export const REACOES: { codigo: string; rotulo: string; tom: Tom; sentido: string }[] = [
  {
    codigo: 'respondeu',
    rotulo: 'Respondeu com registros',
    tom: 'ok',
    sentido: 'O ListRecords devolveu ao menos um registro vivo em oai_dc.',
  },
  {
    codigo: 'agregador-desativado',
    rotulo: 'SciELO — agregador desativado',
    tom: 'down',
    sentido:
      'O cadastro aponta para old.scielo.br ou www.scielo.br em vez do endpoint da revista. O 403 das primeiras abriu o disjuntor para as demais.',
  },
  {
    codigo: 'sem-resposta',
    rotulo: 'Fora do ar ou sem resposta',
    tom: 'down',
    sentido: 'Conexão recusada, timeout ou falha de TLS, mesmo depois de três tentativas.',
  },
  {
    codigo: 'nao-oai',
    rotulo: 'Respondeu, mas não em OAI-PMH',
    tom: 'warn',
    sentido: 'O servidor atendeu, mas o corpo não era XML OAI-PMH — em geral uma página HTML.',
  },
  {
    codigo: 'disjuntor',
    rotulo: 'Não pedida — disjuntor do host',
    tom: 'neutro',
    sentido:
      'Outras fontes do mesmo servidor falharam seguidamente e a coleta parou de pedir. Não diz nada sobre a fonte em si.',
  },
  {
    codigo: 'oai-sem-registro',
    rotulo: 'OAI respondeu sem registro utilizável',
    tom: 'warn',
    sentido: 'Resposta OAI-PMH válida, mas com erro de protocolo, lista vazia ou só registros excluídos.',
  },
  {
    codigo: 'recusou',
    rotulo: 'Recusou o acesso',
    tom: 'warn',
    sentido: 'HTTP 400, 401, 403 ou 468 — inclusive depois de repetir com agente de navegador.',
  },
  {
    codigo: 'endereco-inexistente',
    rotulo: 'Endereço não existe mais',
    tom: 'down',
    sentido: 'HTTP 404 ou 410 no endereço cadastrado.',
  },
  {
    codigo: 'erro-servidor',
    rotulo: 'Erro no servidor da fonte',
    tom: 'down',
    sentido: 'HTTP 500, 503, 504 ou 522.',
  },
  {
    codigo: 'sem-endpoint',
    rotulo: 'Sem endpoint cadastrado',
    tom: 'neutro',
    sentido: 'O cadastro não traz endereço OAI-PMH; não houve o que pedir.',
  },
]

const POR_CODIGO = new Map(REACOES.map((r) => [r.codigo, r]))
export const reacao = (codigo: string) => POR_CODIGO.get(codigo)
export const rotuloReacao = (codigo: string) => POR_CODIGO.get(codigo)?.rotulo ?? codigo
export const ordemReacao = (codigo: string) => {
  const i = REACOES.findIndex((r) => r.codigo === codigo)
  return i < 0 ? REACOES.length : i
}
