/**
 * Dicas de coluna, resolvidas por nome de campo.
 *
 * Ficam num módulo com estado em vez de descer por props porque toda tabela do
 * painel precisaria receber o mesmo objeto por oito níveis de componente. A
 * `Tabela` busca a dica pela `accessorKey`, que já é o nome real da coluna —
 * então nenhuma definição de coluna precisou mudar para ganhar a sua.
 */
import type { Hints } from './metadados'

let mapa: Record<string, string> = {}

/** Achata o hints.json por nome de coluna. Onde duas tabelas divergem, a mais
 *  específica vence: `records` e `snapshots` dão sentidos diferentes a
 *  `deleted`, e o painel mostra sobretudo as tabelas de fonte e coleta. */
export function carregarDicas(hints: Hints): void {
  const ordem = [
    'repositories',
    'harvest_metrics',
    'repository_summary',
    'record_metrics',
    'records',
    'snapshots',
    'platforms',
    'platform_evidence',
    'record_values',
  ]
  const novo: Record<string, string> = {}
  for (const tabela of ordem) {
    for (const [coluna, texto] of Object.entries(hints[tabela]?.colunas ?? {})) {
      if (texto && !novo[coluna]) novo[coluna] = texto
    }
  }
  mapa = { ...novo, ...DERIVADAS }
}

/** Colunas que o painel calcula e que não existem em nenhum Parquet. */
const DERIVADAS: Record<string, string> = {
  validade: 'valid_size ÷ size na última coleta. Em branco quando não houve registro coletado.',
  invalidos: 'size − valid_size: registros que a coleta trouxe e o perfil DRIVER rejeitou.',
  criterios: 'Quais critérios objetivos de atenção esta fonte satisfaz. Não é um ranking de piores.',
  completude:
    'Média, entre os registros vivos da amostra da fonte, dos elementos Dublin Core presentes ÷ 15.',
  conformidade:
    'Média dos quatro critérios DRIVER verificáveis no registro — type, rights, language e date —, cada um a proporção de registros vivos da fonte que o satisfazem.',
  titles_eligible:
    'Registros vivos da amostra com título de sete palavras ou mais: o denominador da taxa de duplicação.',
  taxa_duplicacao:
    'Títulos longos repetidos ÷ títulos elegíveis, dentro da própria fonte. O denominador exclui registro sem título e título curto de seção — não são comparáveis.',
  instituicoes: 'Quantas instituições distintas, não quantas fontes.',
  fontes: 'Quantas fontes a instituição publica. A USP tem 87; 515 instituições têm uma só.',
  plataformas: 'Quantas plataformas distintas a instituição usa entre as fontes dela.',
  registros: 'Soma dos registros da última coleta de cada fonte da instituição.',
  dias: 'Mediana de dias desde a última coleta, entre as fontes do grupo.',
  erros: 'Fontes do grupo cuja última coleta terminou em erro.',
  recorte: 'A sub-população sobre a qual o teste foi refeito.',
  efeito: 'Epsilon-quadrado: a fração da variação de postos que o grupo explica. Adimensional.',
  faixa: 'Faixa de dias desde a última coleta.',
  ocorrencias: 'Quantas vezes o valor aparece na amostra inteira.',
  conforme: 'Se o valor pertence ao vocabulário que o perfil DRIVER exige para este campo.',

  // Agregados por plataforma e por instituição.
  plataforma: 'Plataforma detectada, agrupada para análise.',
  validade_mediana: 'Mediana da taxa de validade entre as fontes do grupo. Não é a taxa do grupo inteiro.',
  validade_agregada: 'Válidos ÷ coletados somando todas as fontes do grupo. Difere da mediana quando poucas fontes dominam o volume.',
  dias_mediana: 'Mediana de dias desde a última coleta, entre as fontes do grupo.',
  persistentes: 'Fontes do grupo que falham em série de um modo que o acaso não produz.',
  institution_type: 'Natureza jurídica da instituição (CV01). Inferida por nós do nome e conferida contra o e-MEC.',

  // A tabela do alcance das dimensões de qualidade.
  nome: 'A dimensão de qualidade avaliada.',
  grau: 'Quanto o dataset alcança: forte, por amostra, parcial, ou não atendida.',
  tipo:
    'Indicador produz grandeza 0–1 comparável entre fontes e passível de teste; descritiva caracteriza padrão sem produzir índice.',
  nivel: 'Se a dimensão é pergunta sobre a coleta, sobre o registro, ou sobre os dois.',
  onde: 'De que campo a medida sai.',

  // Fichas e protocolo.
  item: 'O item do checklist de qualidade.',
  situacao: 'Se o item está atendido, parcial ou não atendido.',
  evidencia: 'Onde no pacote esse item se comprova.',

  // Catálogo do dataset.
  name: 'Arquivo Parquet da tabela.',
  rows: 'Linhas da tabela.',
  columns: 'Colunas da tabela.',
  bytes: 'Tamanho do Parquet comprimido em zstd.',
  field: 'Campo da base de fontes.',
  type: 'Tipo lógico no dicionário: texto, carimbo, categoria ou inteiro.',
  requirement: 'M obrigatório, C condicional, O opcional.',
  vocabulary: 'Vocabulário controlado que restringe os valores do campo.',
  condition: 'Quando o campo é exigido, no caso dos condicionais.',

  exemplo_identificador: 'Um dos identificadores entre os registros que compartilham o título.',
}

export const dicaDe = (coluna: string | undefined): string | undefined =>
  coluna ? mapa[coluna] : undefined
