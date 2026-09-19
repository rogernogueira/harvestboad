import { BrButton } from '@govbr-ds/react-components'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Modal } from '@/components/Modal'
import { ApiError, apiPost } from '@/lib/api'
import { harvestRequestsQuery } from '@/lib/queries'
import type { HarvestRequestItem } from '@/lib/types'

/**
 * Pedido de nova coleta, no cartão do repositório.
 *
 * O controle troca conforme a situação da demanda, em vez de empilhar botão e
 * aviso: sem demanda pendente, é o botão que abre uma; com demanda pendente, é
 * o aviso de que o pedido já está na fila — inclusive para o colega que não foi
 * quem pediu, porque **a demanda é do repositório, não de quem clicou**. Sem
 * isso ele clicaria e receberia o 400 da constraint sem entender.
 *
 * A última resolvida aparece logo abaixo, com o número da coleta ou o motivo da
 * recusa: é o retorno que o gestor esperava, no lugar onde ele pediu.
 */
export function HarvestRequestButton({
  id,
  repositoryId,
  acronym,
}: {
  id: string
  repositoryId: string
  acronym: string
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [aberto, setAberto] = useState(false)
  const [justificativa, setJustificativa] = useState('')

  const demandas = useQuery(harvestRequestsQuery({ repository: repositoryId }))
  const lista = demandas.data?.results ?? []
  const pendente = lista.find((demanda) => demanda.status === 'PENDENTE')
  const ultimaResolvida = lista.find((demanda) => demanda.status !== 'PENDENTE')

  const quando = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'short' })

  const pedir = useMutation({
    mutationFn: () =>
      apiPost<HarvestRequestItem>('/demands/', {
        harvesterRepositoryId: repositoryId,
        acronym,
        note: justificativa.trim(),
      }),
    onSuccess: () => {
      setAberto(false)
      setJustificativa('')
      void queryClient.invalidateQueries({ queryKey: ['demands'] })
    },
  })

  return (
    <div id={id} className="d-flex flex-column gap-half">
      {pendente ? (
        <span id={`${id}-pending`} className="text-down-01 text-gray-70">
          <i className="fas fa-hourglass-half mr-1" aria-hidden="true" />
          {t('demands.pendingSince', {
            username: pendente.requesterUsername,
            date: quando.format(new Date(pendente.createdAt)),
          })}
        </span>
      ) : (
        <BrButton
          id={`${id}-open`}
          type="button"
          secondary
          size="small"
          onClick={() => setAberto(true)}
        >
          {t('demands.request')}
        </BrButton>
      )}

      {ultimaResolvida ? (
        <span id={`${id}-resolved`} className="text-down-01 text-gray-70">
          {ultimaResolvida.status === 'ATENDIDA'
            ? t('demands.lastAttended', { snapshot: ultimaResolvida.snapshotId })
            : t('demands.lastRefused', { reason: ultimaResolvida.reason })}
        </span>
      ) : null}

      <Modal
        id={`${id}-modal`}
        aberto={aberto}
        onFechar={() => setAberto(false)}
        titulo={t('demands.request')}
        descricao={acronym}
        acoes={
          <>
            <BrButton
              id={`${id}-modal-cancel`}
              type="button"
              secondary
              onClick={() => setAberto(false)}
            >
              {t('common.cancel')}
            </BrButton>
            <BrButton
              id={`${id}-modal-submit`}
              type="button"
              primary
              loading={pedir.isPending}
              disabled={pedir.isPending}
              onClick={() => pedir.mutate()}
            >
              {t('demands.send')}
            </BrButton>
          </>
        }
      >
        <p id={`${id}-modal-hint`} className="text-base">
          {t('demands.hint')}
        </p>

        {pedir.isError ? (
          <p id={`${id}-modal-error`} role="alert" className="text-base text-red-vivid-50">
            {pedir.error instanceof ApiError ? pedir.error.detail : t('common.error')}
          </p>
        ) : null}

        {/* Justificativa é opcional: o pedido em si já é o sinal, e exigir texto
            faria o gestor inventar um para conseguir clicar. */}
        <div id={`${id}-modal-note`} className="br-textarea">
          <label id={`${id}-modal-note-label`} htmlFor={`${id}-modal-note-input`}>
            {t('demands.note')}
          </label>
          <textarea
            id={`${id}-modal-note-input`}
            rows={4}
            maxLength={1000}
            value={justificativa}
            onChange={(evento) => setJustificativa(evento.target.value)}
          />
        </div>
      </Modal>
    </div>
  )
}
