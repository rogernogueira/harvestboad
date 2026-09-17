import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { Modal } from '@/components/Modal'
import { countActiveFilters, type RecordFilters } from '@/lib/filters'
import { occurrencesQuery } from '@/lib/queries'
import type { Occurrence } from '@/lib/types'

/**
 * Ocorrências de uma regra, agrupadas por valor.
 *
 * É o `openRuleOccrStats` da interface do Harvester: a tabela de regras responde
 * "quantos registros violam", e esta lista responde "com quais valores" — que é
 * o que orienta a correção no repositório de origem.
 *
 * Só consulta quando aberto. São dezenas de regras por coleta e cada uma custa
 * uma ida à origem; buscar todas de antemão pagaria por dados que quase ninguém
 * abre.
 *
 * Os filtros da tela seguem junto, como na origem: a rota
 * `/public/diagnoseValidationOcurrences/{coleta}/{regra}/{fq}` aceita o mesmo
 * recorte da listagem de registros. Sem isso as contagens seriam as da coleta
 * inteira e discordariam do número em que o usuário clicou.
 */
export function RuleOccurrencesModal({
  id,
  aberto,
  onFechar,
  snapshotId,
  ruleId,
  nome,
  filtros,
}: {
  id?: string
  aberto: boolean
  onFechar: () => void
  snapshotId: string
  ruleId: string
  nome: string
  filtros: RecordFilters
}) {
  const { t, i18n } = useTranslation()
  const { data, isPending, isError, error, refetch } = useQuery({
    ...occurrencesQuery(snapshotId, ruleId, filtros),
    enabled: aberto && snapshotId.length > 0 && ruleId.length > 0,
  })

  const idBase = id ?? `rule-occurrences-modal-${ruleId}`
  const numero = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage),
    [i18n.resolvedLanguage],
  )

  /** Diz ao leitor se os números são os da tela ou os da coleta inteira. */
  const filtrado = countActiveFilters(filtros) > 0

  /** A origem devolve na ordem que quiser; quem lê quer o valor mais comum no topo. */
  const ordenar = (itens: Occurrence[]) =>
    [...itens].sort((a, b) => (b.count ?? 0) - (a.count ?? 0))

  const lista = (chave: 'valid' | 'invalid', itens: Occurrence[], total: number) => (
    <section id={`${idBase}-${chave}`} className="mb-4">
      <div
        id={`${idBase}-${chave}-header`}
        className="d-flex align-items-baseline justify-content-between mb-1"
      >
        <h3 id={`${idBase}-${chave}-title`} className="text-down-01 text-bold mt-0 mb-0">
          {t(`diagnosis.occurrences.${chave}`)}
        </h3>
        {/*
          Cor de estado como texto pequeno só se sustenta sobre o branco da
          superfície principal, onde sucesso dá 4,59 e erro 4,60 — acima dos
          4,5 exigidos. Sobre o pastel da mesma família seriam 4,02 e 3,69, e
          aí quem coloriria seria a função Leitura.
        */}
        <span
          id={`${idBase}-${chave}-total`}
          className="text-down-01"
          style={{ color: chave === 'valid' ? 'var(--color-ok)' : 'var(--color-down)' }}
        >
          {t('diagnosis.occurrences.total', { total: numero.format(total) })}
        </span>
      </div>

      {itens.length === 0 ? (
        <Empty id={`${idBase}-${chave}-empty`} label={t('diagnosis.occurrences.none')} />
      ) : (
        <ul id={`${idBase}-${chave}-list`} className="plain-list">
          {ordenar(itens).map((ocorrencia, indice) => (
            <li
              id={`${idBase}-${chave}-item-${indice}`}
              key={`${ocorrencia.value ?? ''}-${indice}`}
              className="d-flex align-items-baseline justify-content-between py-1"
              style={{
                gap: 'var(--spacing-scale-2x)',
                borderTop: indice > 0 ? '1px solid var(--border-color)' : undefined,
              }}
            >
              {/*
                O valor vem cru da origem (nome de campo, mensagem de erro, às
                vezes o conteúdo do metadado inteiro) e não tem limite de
                tamanho — sem a quebra, um valor longo estoura o modal.
              */}
              <span
                id={`${idBase}-${chave}-item-${indice}-value`}
                className="text-down-01"
                style={{ minWidth: 0, overflowWrap: 'anywhere' }}
              >
                {ocorrencia.value ?? '—'}
              </span>
              <span
                id={`${idBase}-${chave}-item-${indice}-count`}
                className="text-down-01 text-semi-bold"
                style={{ whiteSpace: 'nowrap' }}
              >
                {numero.format(ocorrencia.count ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  return (
    <Modal
      id={idBase}
      aberto={aberto}
      onFechar={onFechar}
      titulo={t('diagnosis.occurrences.title', { rule: ruleId })}
      descricao={nome}
    >
      {isPending ? <Loading id={`${idBase}-loading`} /> : null}
      {isError ? (
        <ErrorState id={`${idBase}-error`} error={error} onRetry={() => void refetch()} />
      ) : null}

      {data ? (
        <>
          {lista('invalid', data.invalid, data.invalidTotal)}
          {lista('valid', data.valid, data.validTotal)}
          <p id={`${idBase}-scope`} className="text-down-02 text-gray-70 mt-0 mb-0">
            {filtrado ? t('diagnosis.occurrences.filtered') : t('diagnosis.occurrences.whole')}
          </p>
        </>
      ) : null}
    </Modal>
  )
}
