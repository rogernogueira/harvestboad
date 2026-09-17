/**
 * Valor sentinela da origem: não é um valor do metadado, é a ausência dele.
 *
 * Domina a lista na maioria das regras — na coleta 108702 são 5.829 das 5.839
 * ocorrências que violam a regra 117 — e cru não diz isso a quem lê. As telas
 * põem o texto traduzido no lugar e guardam o literal no `title`, para quem for
 * conferir contra a interface do Harvester.
 *
 * Fica aqui, e não no componente, porque duas telas o encontram: as ocorrências
 * agregadas por regra no diagnóstico e as ocorrências de um registro só.
 */
export const SEM_OCORRENCIA = 'no_occurrences_found'
