import { BrButton } from '@govbr-ds/react-components'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Modal } from '@/components/Modal'
import { nomeDaCategoria } from '@/lib/categorias'
import { ApiError, apiPost } from '@/lib/api'
import { pendingAcknowledgementQuery } from '@/lib/queries'
import type { NotificationItem } from '@/lib/types'

/** Chave do adiamento. Em `sessionStorage`: vale a sessão, não o aparelho. */
const CHAVE_ADIADO = 'harvestboard.avisos-adiados'

/**
 * O aviso que exige visto, numa modal que não se dispensa de passagem.
 *
 * O selo "Exige visto" já existia na lista, mas dependia de alguém abrir a
 * lista. Um aviso desses é o que **não** pode passar batido — origem que mudou
 * de endereço, coleta que vai parar —, e enquanto ele só morava no painel do
 * sino o gestor podia atravessar semanas sem topar com ele.
 *
 * Por isso a modal sobe sozinha, sobre qualquer tela, e sai por dois caminhos
 * nomeados: **Dar visto**, que registra a leitura para todos os gestores do
 * repositório, e **Ler depois**, que a cala até a próxima sessão. Esc, clique
 * fora e o X do topo são retirados (`obrigatorio` no `Modal`) porque os dois
 * caminhos significam coisas diferentes, e um Esc escolheria por quem não
 * escolheu.
 *
 * ## O que "depois" quer dizer
 *
 * O adiamento vive em `sessionStorage`, e é **um só para todos os avisos**: a
 * pessoa que adia está dizendo "agora não", não "este não". Some ao fechar o
 * navegador, então o aviso volta no próximo acesso — que é o ponto de exigir
 * visto. Em `localStorage` ele nunca mais voltaria naquele aparelho, e o aviso
 * viraria um selo silencioso outra vez.
 *
 * ## Um de cada vez
 *
 * Com vários pendentes, a modal mostra o mais antigo e anuncia a posição ("1 de
 * 3"): dar visto avança para o próximo, adiar cala todos. Empilhar os três numa
 * rolagem só faria o visto de um valer pelos outros dois sem terem sido lidos.
 *
 * O visto sai da fila na hora, por `vistos`, em vez de esperar a lista voltar
 * do servidor: a invalidação refaz a consulta em segundo plano e, enquanto ela
 * não chega, o TanStack ainda serve a lista antiga — o aviso recém-confirmado
 * piscaria de volta na tela.
 */
export function PendingAcknowledgementModal({ id = 'pending-acknowledgement' }: { id?: string }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()

  const [adiado, setAdiado] = useState(() => {
    // `sessionStorage` pode lançar (aba anônima, cookies bloqueados). Sem ele o
    // aviso aparece — que é o lado seguro do erro.
    try {
      return sessionStorage.getItem(CHAVE_ADIADO) === 'true'
    } catch {
      return false
    }
  })
  const [vistos, setVistos] = useState<number[]>([])

  const { data } = useQuery({ ...pendingAcknowledgementQuery, enabled: !adiado })

  const marcar = useMutation({
    mutationFn: (notificacaoId: number) =>
      apiPost<NotificationItem>(`/notifications/${notificacaoId}/read/`, {}),
    onSuccess: (_resposta, notificacaoId) => {
      setVistos((anteriores) => [...anteriores, notificacaoId])
      /*
        Mesmas invalidações do painel: as notificações e as duas listas de
        repositório, que carregam a contagem do sino de cada linha.
        `['repositories']` inteiro derrubaria também o índice, de ~960 KB.

        Sem `await`: o `summary` recompõe o painel do gestor contra o Harvester,
        e aguardá-lo manteria os botões travados muito depois de o visto já ter
        sido registrado.
      */
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      void queryClient.invalidateQueries({ queryKey: ['repositories', 'summary'] })
      void queryClient.invalidateQueries({ queryKey: ['repositories', 'index'] })
    },
  })

  /*
   * Os pendentes, do mais antigo para o mais novo.
   *
   * A rota devolve `-created_at`, que é a ordem da "timeline" do Padrão Digital
   * e a certa para uma lista. Numa fila de pendências é o contrário: quem está
   * esperando há mais tempo vai na frente.
   */
  const pendentes = (data?.results ?? [])
    .filter((item) => item.requiresAcknowledgement && !item.read && !vistos.includes(item.id))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))

  const atual = pendentes[0]

  const adiar = () => {
    setAdiado(true)
    try {
      sessionStorage.setItem(CHAVE_ADIADO, 'true')
    } catch {
      // Sem armazenamento, o adiamento vale só enquanto a tela não recarrega.
      // É pior que o combinado, e ainda assim melhor que uma modal presa.
    }
  }

  /*
   * Sem aviso pendente, sem modal — e o erro de consulta cai aqui junto, de
   * propósito. Uma modal obrigatória só tem saída se tiver conteúdo: erro de
   * rede renderizando a moldura vazia prenderia a tela em algo sem ação. A
   * consulta volta sozinha na próxima tentativa, e o sino do cabeçalho segue
   * sendo o caminho normal para a caixa.
   */
  if (adiado || !atual) return null

  const quando = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'short',
    timeStyle: 'short',
  })

  return (
    <Modal
      id={id}
      aberto
      /* Nunca chamado: sem Esc, sem scrim e sem X, o `<dialog>` não tem como
         fechar por fora das ações. Fica por contrato do componente. */
      onFechar={adiar}
      obrigatorio
      titulo={t('notifications.mustAcknowledge.title')}
      /* Só com fila: com um aviso só, "1 aguardando" não informa nada que o
         próprio aviso na tela já não diga. */
      descricao={
        pendentes.length > 1
          ? t('notifications.mustAcknowledge.remaining', { count: pendentes.length })
          : undefined
      }
      acoes={
        <>
          <BrButton id={`${id}-later`} type="button" secondary onClick={adiar}>
            {t('notifications.mustAcknowledge.later')}
          </BrButton>
          <BrButton
            id={`${id}-acknowledge`}
            type="button"
            primary
            disabled={marcar.isPending}
            onClick={() => marcar.mutate(atual.id)}
          >
            {t('notifications.acknowledge')}
          </BrButton>
        </>
      }
    >
      <div id={`${id}-content`} className="d-flex flex-column gap-2">
        <span id={`${id}-head`} className="d-flex flex-wrap align-items-center gap-half">
          <span id={`${id}-category`} className="br-tag text small">
            {nomeDaCategoria(atual.category, i18n.resolvedLanguage)}
          </span>
          {atual.acronym ? (
            <span id={`${id}-acronym`} className="text-down-01 text-gray-70">
              {atual.acronym}
            </span>
          ) : (
            <span id={`${id}-direct`} className="text-down-01 text-gray-70">
              {t('notifications.direct')}
            </span>
          )}
          <span id={`${id}-when`} className="text-down-01 text-gray-70">
            {quando.format(new Date(atual.createdAt))}
          </span>
        </span>

        <h3 id={`${id}-notification-title`} className="text-up-01 text-semi-bold mt-0 mb-0">
          {atual.title}
        </h3>

        <p id={`${id}-message`} className="text-base mb-0" style={{ whiteSpace: 'pre-wrap' }}>
          {atual.message}
        </p>

        {marcar.isError ? (
          <p id={`${id}-warning`} role="alert" className="text-base text-red-vivid-50 mb-0">
            {marcar.error instanceof ApiError ? marcar.error.detail : t('common.error')}
          </p>
        ) : null}

        <p id={`${id}-hint`} className="text-down-01 text-gray-70 mb-0">
          {t('notifications.mustAcknowledge.hint')}
        </p>
      </div>
    </Modal>
  )
}
