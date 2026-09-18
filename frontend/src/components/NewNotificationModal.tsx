import { BrButton, BrInput, BrMessage, BrSelectStandard } from '@govbr-ds/react-components'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Modal } from '@/components/Modal'
import { useDebounced } from '@/hooks/useDebounced'
import { ApiError, apiPost } from '@/lib/api'
import { gestoresQuery, repositorySearchQuery } from '@/lib/queries'
import type { NotificationItem } from '@/lib/types'

const CATEGORIAS = ['COMUNICACAO', 'NOVIDADES', 'COLETA', 'VALIDACAO'] as const

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
  category: z.enum(CATEGORIAS),
})

type Formulario = z.infer<typeof schema>

type Destino = { tipo: 'repositorio'; id: string; acronym: string } | { tipo: 'gestor'; id: string }

/**
 * Criação de notificação, exclusiva do ADMIN.
 *
 * O destino é um dos dois, nunca os dois: ou um repositório — e aí todos os
 * gestores vinculados a ele recebem — ou um recado direto a um gestor. A mesma
 * regra vale no serializer e, por último, numa `CheckConstraint` no banco.
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
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [tipo, setTipo] = useState<'repositorio' | 'gestor'>('repositorio')
  const [gestorId, setGestorId] = useState('')
  const [buscaRepo, setBuscaRepo] = useState('')
  const [repoId, setRepoId] = useState('')
  const buscaAtrasada = useDebounced(buscaRepo)

  const gestores = useQuery({ ...gestoresQuery(''), enabled: aberto && !repositorioFixo })
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
    formState: { errors, isSubmitting },
  } = useForm<Formulario>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', message: '', category: 'COMUNICACAO' },
  })

  /*
    Reabrir não deve trazer de volta o que foi digitado antes.

    Ajuste durante a renderização, e não efeito — o mesmo padrão já usado na
    tela de acessos: o React re-renderiza antes de pintar, sem o ciclo extra que
    um efeito provocaria, e sem a cascata que o `set-state-in-effect` denuncia.
  */
  const [estavaAberto, setEstavaAberto] = useState(aberto)
  if (aberto !== estavaAberto) {
    setEstavaAberto(aberto)
    if (aberto) {
      reset()
      setTipo('repositorio')
      setGestorId('')
      setBuscaRepo('')
      setRepoId('')
    }
  }

  const destino = (): Destino | null => {
    if (repositorioFixo) {
      return { tipo: 'repositorio', id: repositorioFixo.id, acronym: repositorioFixo.acronym }
    }
    if (tipo === 'gestor') return gestorId ? { tipo: 'gestor', id: gestorId } : null
    const escolhido = repositorios.data?.results.find((r) => r.harvesterRepositoryId === repoId)
    return escolhido
      ? {
          tipo: 'repositorio',
          id: escolhido.harvesterRepositoryId,
          acronym: escolhido.acronym ?? '',
        }
      : null
  }

  const criar = useMutation({
    mutationFn: (valores: Formulario) => {
      const alvo = destino()
      if (alvo === null) throw new Error('sem destino')
      return apiPost<NotificationItem>('/notifications/', {
        title: valores.title.trim(),
        message: valores.message.trim(),
        category: valores.category,
        ...(alvo.tipo === 'repositorio'
          ? { harvesterRepositoryId: alvo.id, acronym: alvo.acronym }
          : { recipient: Number(alvo.id) }),
      })
    },
    onSuccess: async () => {
      // Só as chaves que mostram o número. `['repositories']` inteiro derrubaria
      // o índice (~960 KB) e o resumo do gestor, que recompõe o painel contra o
      // Harvester repositório por repositório.
      await queryClient.invalidateQueries({ queryKey: ['notifications'] })
      await queryClient.invalidateQueries({ queryKey: ['repositories', 'summary'] })
      await queryClient.invalidateQueries({ queryKey: ['repositories', 'index'] })
      onFechar()
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
    >
      <form
        id={`${id}-form`}
        noValidate
        className="d-flex flex-column gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit((valores) => criar.mutateAsync(valores).catch(() => undefined))(event)
        }}
      >
        {repositorioFixo ? null : (
          <fieldset id={`${id}-target`} className="mb-0">
            <legend id={`${id}-target-legend`} className="text-down-01 text-semi-bold">
              {t('notifications.new.target')}
            </legend>
            <div id={`${id}-target-options`} className="d-flex flex-wrap gap-3">
              {(['repositorio', 'gestor'] as const).map((opcao) => (
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
                  {t(`notifications.new.target_${opcao}`)}
                </label>
              ))}
            </div>
          </fieldset>
        )}

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
          <BrSelectStandard
            id={`${id}-gestor`}
            label={t('notifications.new.chooseManager')}
            value={gestorId}
            onChange={(evento) => setGestorId(evento.target.value)}
            options={[
              { label: t('notifications.new.chooseManagerEmpty'), value: '' },
              ...(gestores.data?.results ?? []).map((user) => ({
                label: user.username,
                value: String(user.id),
              })),
            ]}
          />
        ) : null}

        <BrSelectStandard
          id={`${id}-category`}
          label={t('notifications.new.category')}
          options={CATEGORIAS.map((categoria) => ({
            label: t(`notifications.categories.${categoria}`),
            value: categoria,
          }))}
          {...register('category')}
        />

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

        <div id={`${id}-actions`} className="d-flex justify-content-end gap-2">
          <BrButton id={`${id}-cancel`} type="button" secondary onClick={onFechar}>
            {t('common.cancel')}
          </BrButton>
          <BrButton
            id={`${id}-submit`}
            type="submit"
            primary
            loading={isSubmitting}
            disabled={isSubmitting || semDestino}
          >
            {t('notifications.new.send')}
          </BrButton>
        </div>
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
