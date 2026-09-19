import { BrButton, BrInput, BrMessage, BrSelectStandard } from '@govbr-ds/react-components'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Modal } from '@/components/Modal'
import { useDebounced } from '@/hooks/useDebounced'
import { ApiError, apiPost } from '@/lib/api'
import { nomeDaCategoria } from '@/lib/categorias'
import {
  gestoresQuery,
  notificationCategoriesQuery,
  notificationTemplatesQuery,
  repositorySearchQuery,
} from '@/lib/queries'
import type { NotificationItem } from '@/lib/types'

// Espelha o `max_length` do serializer. Sem limite dos dois lados, um recado de
// 60 KB estouraria o painel de quem o recebesse.
const MENSAGEM_MAXIMA = 2000

const schema = z.object({
  title: z.string().trim().min(1, 'notifications.validation.titleRequired').max(120),
  message: z
    .string()
    .trim()
    .min(1, 'notifications.validation.messageRequired')
    .max(MENSAGEM_MAXIMA, 'notifications.validation.messageTooLong'),
  category: z.number().int().positive('notifications.validation.categoryRequired'),
})

type Formulario = z.infer<typeof schema>

/** As quatro escolhas de destino, na ordem em que aparecem. */
const ALVOS = ['repositorio', 'gestor', 'todos-repositorios', 'todos-gestores'] as const
type Alvo = (typeof ALVOS)[number]

type Destino =
  | { tipo: 'repositorio'; id: string; acronym: string }
  | { tipo: 'gestor'; ids: string[] }
  /** Alcance amplo, resolvido no servidor — a tela não monta a lista. */
  | { tipo: 'alcance'; scope: 'ALL_MANAGERS' | 'ALL_REPOSITORIES' }

/**
 * Criação de notificação, exclusiva do ADMIN.
 *
 * O destino é um só por notificação: um repositório — e aí todos os gestores
 * vinculados a ele recebem — ou um recado direto a um gestor. A regra vale no
 * serializer e, por último, numa `CheckConstraint` no banco.
 *
 * As duas opções amplas ("todos os gestores", "todos os repositórios") não
 * fogem disso: elas viram N notificações, uma por destino, resolvidas no
 * servidor. A tela manda só o alcance — montar a lista aqui exigiria paginar o
 * acervo inteiro.
 *
 * **"Todos os repositórios" são os que têm gestor vinculado**, não os ~2.181 do
 * acervo: aviso para repositório sem ninguém vinculado nasceria não lido e
 * ficaria assim, acendendo o indicador sem ação possível.
 *
 * Quando o modal é aberto a partir da linha de um repositório, ele já vem
 * escolhido e o seletor de destino não aparece: perguntar de novo o que a tela
 * acabou de dizer é ruído.
 */
export function NewNotificationModal({
  id = 'new-notification-modal',
  aberto,
  onFechar,
  repositorioFixo,
}: {
  id?: string
  aberto: boolean
  onFechar: () => void
  /** Pré-seleciona o repositório e esconde a escolha de destino. */
  repositorioFixo?: { id: string; acronym: string }
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()

  const [tipo, setTipo] = useState<Alvo>('repositorio')
  const [gestores_, setGestores] = useState<string[]>([])
  const [buscaRepo, setBuscaRepo] = useState('')
  const [repoId, setRepoId] = useState('')
  const [exigeVisto, setExigeVisto] = useState(false)
  const [categoriaId, setCategoriaId] = useState<number | null>(null)
  // `enabled` compõe as duas condições: espalhar a consulta e redefinir
  // `enabled: aberto` apagava a guarda dela, e a chamada saía com
  // `?category=null` assim que o modal abria.
  const textos = useQuery({
    ...notificationTemplatesQuery(categoriaId),
    enabled: aberto && categoriaId !== null,
  })
  const disponiveis = (textos.data ?? []).filter((modelo) => modelo.active)
  const buscaAtrasada = useDebounced(buscaRepo)

  const gestores = useQuery({ ...gestoresQuery(''), enabled: aberto && !repositorioFixo })
  const categorias = useQuery({ ...notificationCategoriesQuery, enabled: aberto })
  const ativas = (categorias.data ?? []).filter((categoria) => categoria.active)
  const repositorios = useQuery({
    ...repositorySearchQuery(buscaAtrasada, 1, 20),
    enabled: aberto && !repositorioFixo && tipo === 'repositorio' && buscaAtrasada.length > 0,
  })

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Formulario>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', message: '', category: 0 },
  })

  /*
    Reabrir não deve trazer de volta o que foi digitado antes.

    O estado **deste** componente é ajustado durante a renderização — o padrão
    que a tela de acessos já usa, e que evita o ciclo extra de um efeito.

    O `reset()` do react-hook-form fica de fora disso, num efeito: ele atualiza
    o `Controller` do campo de mensagem, que é outro componente, e mexer no
    estado alheio durante a renderização rende o aviso "Cannot update a
    component while rendering a different component".
  */
  const [estavaAberto, setEstavaAberto] = useState(aberto)
  if (aberto !== estavaAberto) {
    setEstavaAberto(aberto)
    if (aberto) {
      setTipo('repositorio')
      setGestores([])
      setBuscaRepo('')
      setRepoId('')
      setExigeVisto(false)
      setCategoriaId(null)
    }
  }

  useEffect(() => {
    if (aberto) reset()
  }, [aberto, reset])

  const destino = (): Destino | null => {
    if (repositorioFixo) {
      return { tipo: 'repositorio', id: repositorioFixo.id, acronym: repositorioFixo.acronym }
    }
    if (tipo === 'todos-gestores') return { tipo: 'alcance', scope: 'ALL_MANAGERS' }
    if (tipo === 'todos-repositorios') return { tipo: 'alcance', scope: 'ALL_REPOSITORIES' }
    if (tipo === 'gestor') {
      return gestores_.length > 0 ? { tipo: 'gestor', ids: gestores_ } : null
    }
    const escolhido = repositorios.data?.results.find((r) => r.harvesterRepositoryId === repoId)
    return escolhido
      ? {
          tipo: 'repositorio',
          id: escolhido.harvesterRepositoryId,
          acronym: escolhido.acronym ?? '',
        }
      : null
  }

  const criar = useMutation<NotificationItem | { createdCount: number }, unknown, Formulario>({
    mutationFn: (valores: Formulario) => {
      const alvo = destino()
      if (alvo === null) throw new Error('sem destino')
      const comum = {
        title: valores.title.trim(),
        message: valores.message.trim(),
        category: valores.category,
        requiresAcknowledgement: exigeVisto,
      }
      /*
        Um destino vai pela criação unitária; vários vão pelo lote, que cria uma
        notificação por destino. São rotas separadas pelo mesmo motivo do
        `accesses/bulk`: o lote não é transacional, e um destino que falhe não
        deve desfazer os avisos que já chegaram aos outros.
      */
      if (alvo.tipo === 'repositorio') {
        return apiPost<NotificationItem>('/notifications/', {
          ...comum,
          harvesterRepositoryId: alvo.id,
          acronym: alvo.acronym,
        })
      }
      if (alvo.tipo === 'alcance') {
        return apiPost<{ createdCount: number }>('/notifications/bulk/', {
          ...comum,
          scope: alvo.scope,
        })
      }
      if (alvo.ids.length === 1) {
        return apiPost<NotificationItem>('/notifications/', {
          ...comum,
          recipient: Number(alvo.ids[0]),
        })
      }
      return apiPost<{ createdCount: number }>('/notifications/bulk/', {
        ...comum,
        recipients: alvo.ids.map(Number),
      })
    },
    onSuccess: () => {
      onFechar()
      /*
        Fecha primeiro, atualiza depois. As invalidações disparam o refetch do
        resumo do gestor, que recompõe o painel contra o Harvester repositório
        por repositório — medido em ~12 s. Aguardá-las antes de fechar deixava o
        modal preso na tela depois de um envio que já tinha dado certo.
      */
      // Só as chaves que mostram o número: `['repositories']` inteiro
      // derrubaria também o índice, de ~960 KB.
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      void queryClient.invalidateQueries({ queryKey: ['repositories', 'summary'] })
      void queryClient.invalidateQueries({ queryKey: ['repositories', 'index'] })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.payload && typeof error.payload === 'object') {
        const payload = error.payload as Record<string, unknown>
        let atribuido = false
        for (const campo of ['title', 'message', 'category'] as const) {
          const mensagens = payload[campo]
          if (Array.isArray(mensagens) && mensagens.length) {
            setError(campo, { message: String(mensagens[0]) })
            atribuido = true
          }
        }
        if (!atribuido) setError('root', { message: error.detail })
      } else {
        setError('root', { message: t('common.error') })
      }
    },
  })

  /*
    Um só caminho de envio para o `<form>` (tecla Enter) e para o botão do
    rodapé, que a diretriz de Modal manda manter fora do corpo rolável — e
    portanto fora do `<form>`. Ligar os dois pelo atributo `form` não compila:
    o `BrButtonProps` estende `HTMLAttributes`, e não `ButtonHTMLAttributes`,
    então `form` não existe no tipo.
  */
  const enviar = (event?: { preventDefault: () => void }) => {
    event?.preventDefault()
    void handleSubmit((valores) => criar.mutateAsync(valores).catch(() => undefined))()
  }

  const semDestino = destino() === null
  // A chave do zod é a própria mensagem; o erro vindo do DRF já vem em texto.
  const traduzir = (mensagem?: string) =>
    mensagem?.startsWith('notifications.') ? t(mensagem) : mensagem

  return (
    <Modal
      id={id}
      aberto={aberto}
      onFechar={onFechar}
      titulo={t('notifications.new.title')}
      descricao={
        repositorioFixo
          ? t('notifications.new.forRepository', { acronym: repositorioFixo.acronym })
          : t('notifications.new.subtitle')
      }
      /*
        Faixa fixa no rodapé, fora do corpo rolável, como manda a diretriz de
        Modal. O `form={...}` religa o submit, já que os botões saíram de dentro
        do `<form>`.

        O confirmar nasce desativado enquanto não há destino: a diretriz
        recomenda manter a confirmação fora de alcance até os campos
        obrigatórios estarem preenchidos.
      */
      acoes={
        <>
          <BrButton id={`${id}-cancel`} type="button" secondary onClick={onFechar}>
            {t('common.cancel')}
          </BrButton>
          <BrButton
            id={`${id}-submit`}
            type="button"
            onClick={enviar}
            primary
            loading={isSubmitting}
            disabled={isSubmitting || semDestino}
          >
            {t('notifications.new.send')}
          </BrButton>
        </>
      }
    >
      <form id={`${id}-form`} noValidate className="d-flex flex-column gap-2" onSubmit={enviar}>
        {repositorioFixo ? null : (
          <fieldset id={`${id}-target`} className="mb-0">
            <legend id={`${id}-target-legend`} className="text-down-01 text-semi-bold">
              {t('notifications.new.target')}
            </legend>
            <div id={`${id}-target-options`} className="d-flex flex-wrap gap-3">
              {ALVOS.map((opcao) => (
                <label
                  id={`${id}-target-${opcao}`}
                  key={opcao}
                  className="d-inline-flex align-items-center gap-half"
                >
                  <input
                    id={`${id}-target-${opcao}-input`}
                    type="radio"
                    name={`${id}-target`}
                    checked={tipo === opcao}
                    onChange={() => setTipo(opcao)}
                  />
                  {t(`notifications.new.target_${opcao.replace('-', '_')}`)}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {tipo === 'todos-repositorios' || tipo === 'todos-gestores' ? (
          <p id={`${id}-scope-hint`} className="text-down-01 text-gray-70 mb-0">
            {t(
              tipo === 'todos-repositorios'
                ? 'notifications.new.scopeRepositoriesHint'
                : 'notifications.new.scopeManagersHint',
            )}
          </p>
        ) : null}

        {!repositorioFixo && tipo === 'repositorio' ? (
          <>
            <BrInput
              id={`${id}-repo-search`}
              label={t('notifications.new.searchRepository')}
              icon="fas fa-search"
              value={buscaRepo}
              onChange={(evento) => setBuscaRepo(evento.target.value)}
            />
            <BrSelectStandard
              id={`${id}-repo`}
              label={t('notifications.new.chooseRepository')}
              value={repoId}
              onChange={(evento) => setRepoId(evento.target.value)}
              options={[
                { label: t('notifications.new.chooseRepositoryEmpty'), value: '' },
                ...(repositorios.data?.results ?? []).map((repo) => ({
                  label: `${repo.acronym ?? repo.harvesterRepositoryId} · ${repo.name ?? ''}`,
                  value: repo.harvesterRepositoryId,
                })),
              ]}
            />
          </>
        ) : null}

        {!repositorioFixo && tipo === 'gestor' ? (
          <div id={`${id}-gestor-field`} className="d-flex flex-column gap-half">
            <label id={`${id}-gestor-label`} htmlFor={`${id}-gestor`}>
              {t('notifications.new.chooseManagers')}
            </label>
            {/*
              `<select multiple>` cru, como na tela de acessos: o
              `BrSelectStandard` é de escolha única, e o DS não traz um seletor
              múltiplo acessível — o nativo já anuncia a seleção e navega por
              teclado.
            */}
            <select
              id={`${id}-gestor`}
              multiple
              size={5}
              className="w-100"
              value={gestores_}
              onChange={(evento) =>
                setGestores([...evento.target.selectedOptions].map((opcao) => opcao.value))
              }
            >
              {(gestores.data?.results ?? []).map((user) => (
                <option key={user.id} value={String(user.id)}>
                  {user.username}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <BrSelectStandard
          id={`${id}-category`}
          label={t('notifications.new.category')}
          value={categoriaId === null ? '' : String(categoriaId)}
          onChange={(evento) => {
            const valor = evento.target.value
            const escolhida = valor === '' ? null : Number(valor)
            setCategoriaId(escolhida)
            setValue('category', escolhida ?? 0, { shouldValidate: true })
          }}
          status={errors.category ? 'danger' : undefined}
          feedbackText={traduzir(errors.category?.message)}
          options={[
            { label: t('notifications.new.categoryEmpty'), value: '' },
            /* Só as ativas: a desativada segue nomeando o histórico, mas não
               deve aparecer como escolha para um aviso novo. */
            ...ativas.map((categoria) => ({
              label: nomeDaCategoria(categoria, i18n.resolvedLanguage),
              value: String(categoria.id),
            })),
          ]}
        />

        {/*
          Textos padrão da categoria escolhida: preenchem título e mensagem, que
          continuam editáveis — o modelo é ponto de partida, não formulário
          travado.

          Aparece **sempre** que há categoria, mesmo sem nenhum modelo
          cadastrado. Antes só aparecia quando havia algum, e aí o recurso ficava
          invisível justamente para quem ainda não o conhecia; agora o campo
          desativado diz que ele existe e onde cadastrá-lo.

          Sem link para o cadastro: a diretriz de Modal desaconselha o botão que
          "afasta o usuário do foco principal, deixando a tarefa inacabada" — e
          sair daqui perderia o que já foi digitado.
        */}
        {categoriaId !== null ? (
          disponiveis.length > 0 ? (
            <BrSelectStandard
              id={`${id}-template`}
              label={t('notifications.new.template')}
              value=""
              onChange={(evento) => {
                const modelo = disponiveis.find((x) => String(x.id) === evento.target.value)
                if (!modelo) return
                setValue('title', modelo.title, { shouldValidate: true })
                setValue('message', modelo.message, { shouldValidate: true })
              }}
              options={[
                { label: t('notifications.new.templateEmpty'), value: '' },
                ...disponiveis.map((modelo) => ({
                  label: modelo.label,
                  value: String(modelo.id),
                })),
              ]}
            />
          ) : (
            <p id={`${id}-template-none`} className="text-down-01 text-gray-70 mb-0">
              {t('notifications.new.templateNone')}
            </p>
          )
        ) : null}

        {/*
          Aviso que não sai da tela sem confirmação. O visto continua valendo
          para todos os gestores do repositório — o que muda é o gesto: em vez
          de o corpo do item ser clicável, aparece um botão nomeado.
        */}
        <label id={`${id}-requires`} className="d-inline-flex align-items-center gap-half">
          <input
            id={`${id}-requires-input`}
            type="checkbox"
            checked={exigeVisto}
            onChange={(evento) => setExigeVisto(evento.target.checked)}
          />
          {t('notifications.new.requiresAcknowledgement')}
        </label>

        <BrInput
          id={`${id}-title`}
          label={t('notifications.new.titleField')}
          status={errors.title ? 'danger' : undefined}
          feedbackText={traduzir(errors.title?.message)}
          {...register('title')}
        />

        {/*
          Primeiro campo multilinha do projeto, e o único que não pode usar
          `{...register(...)}`: o `BrInput` é `ForwardRefExoticComponent` e
          encaminha a `ref` do react-hook-form, mas o `BrTextarea` é função
          simples e não declara `ref`, `name` nem `onBlur` nas props — o campo
          simplesmente não chegaria ao formulário. Daí o `Controller`, que o
          alimenta por `value`/`onChange`.
        */}
        <Controller
          control={control}
          name="message"
          render={({ field }) => (
            <BrTextareaCampo
              id={`${id}-message`}
              label={t('notifications.new.messageField')}
              value={field.value}
              onChange={field.onChange}
              erro={traduzir(errors.message?.message)}
            />
          )}
        />

        {errors.root ? (
          <BrMessage
            id={`${id}-error`}
            status="danger"
            message={errors.root.message ?? t('common.error')}
          />
        ) : null}
      </form>
    </Modal>
  )
}

/**
 * Campo de texto multilinha sobre as classes `br-textarea` do core.
 *
 * Markup próprio, como em `Modal`, `Tabs` e `Pagination`: o `BrTextarea` do
 * pacote React não declara `rows` nem `maxLength` em `BrTextareaProps`, então
 * passá-los literalmente não compila — e são justamente eles que definem a
 * altura útil e o teto da mensagem.
 */
function BrTextareaCampo({
  id,
  label,
  value,
  onChange,
  erro,
}: {
  id: string
  label: string
  value: string
  onChange: (valor: string) => void
  erro?: string
}) {
  return (
    <div id={id} className={`br-textarea ${erro ? 'danger' : ''}`}>
      <label id={`${id}-label`} htmlFor={`${id}-input`}>
        {label}
      </label>
      <textarea
        id={`${id}-input`}
        rows={6}
        maxLength={MENSAGEM_MAXIMA}
        value={value}
        onChange={(evento) => onChange(evento.target.value)}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${id}-feedback` : undefined}
      />
      {erro ? (
        <span id={`${id}-feedback`} role="alert" className="feedback danger">
          {erro}
        </span>
      ) : null}
    </div>
  )
}
