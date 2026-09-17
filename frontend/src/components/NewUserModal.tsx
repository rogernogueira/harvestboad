import { BrButton, BrInput, BrMessage } from '@govbr-ds/react-components'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Modal } from '@/components/Modal'
import { ApiError, apiPost } from '@/lib/api'
import type { User } from '@/lib/types'

const schema = z
  .object({
    username: z.string().min(1, 'newUser.validation.usernameRequired'),
    email: z.email('newUser.validation.emailInvalid'),
    first_name: z.string(),
    last_name: z.string(),
    password: z.string().min(8, 'newUser.validation.tooShort'),
    confirmPassword: z.string().min(1, 'newUser.validation.passwordRequired'),
  })
  .refine((dados) => dados.password === dados.confirmPassword, {
    path: ['confirmPassword'],
    message: 'newUser.validation.mismatch',
  })

type Formulario = z.infer<typeof schema>

/**
 * Cadastro de uma conta de gestor, sem sair da tela de acessos.
 *
 * A senha é provisória por construção: o backend cria a conta com troca
 * obrigatória, então quem entrar pela primeira vez precisa definir a própria.
 */
export function NewUserModal({
  id = 'new-user-modal',
  aberto,
  onFechar,
  onCriado,
}: {
  id?: string
  aberto: boolean
  onFechar: () => void
  /** Recebe a conta criada para que a tela já possa selecioná-la. */
  onCriado: (user: User) => void
}) {
  const { t } = useTranslation()

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Formulario>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: '',
      email: '',
      first_name: '',
      last_name: '',
      password: '',
      confirmPassword: '',
    },
  })

  // Reabrir o modal não deve trazer de volta o que foi digitado antes.
  useEffect(() => {
    if (aberto) reset()
  }, [aberto, reset])

  const criar = useMutation({
    mutationFn: (valores: Formulario) =>
      apiPost<User>('/accounts/users/', {
        username: valores.username.trim(),
        email: valores.email.trim(),
        first_name: valores.first_name.trim(),
        last_name: valores.last_name.trim(),
        profile: 'GESTOR',
        password: valores.password,
      }),
    onSuccess: (user) => {
      onCriado(user)
      onFechar()
    },
    onError: (error) => {
      // O backend valida usuário duplicado, e-mail repetido e força da senha;
      // as mensagens vêm por campo e já traduzidas.
      if (error instanceof ApiError && error.payload && typeof error.payload === 'object') {
        const payload = error.payload as Record<string, unknown>
        let atribuido = false
        for (const campo of ['username', 'email', 'password'] as const) {
          const mensagens = payload[campo]
          if (Array.isArray(mensagens) && mensagens.length) {
            setError(campo, { message: String(mensagens[0]) })
            atribuido = true
          }
        }
        if (!atribuido) {
          setError('root', { message: error.detail })
        }
      } else {
        setError('root', { message: t('common.error') })
      }
    },
  })

  const campos = [
    { name: 'username', label: 'newUser.username', type: 'text', autoComplete: 'off' },
    { name: 'email', label: 'newUser.email', type: 'email', autoComplete: 'off' },
    { name: 'first_name', label: 'newUser.firstName', type: 'text', autoComplete: 'off' },
    { name: 'last_name', label: 'newUser.lastName', type: 'text', autoComplete: 'off' },
    {
      name: 'password',
      label: 'newUser.password',
      type: 'password',
      autoComplete: 'new-password',
    },
    {
      name: 'confirmPassword',
      label: 'newUser.confirmPassword',
      type: 'password',
      autoComplete: 'new-password',
    },
  ] as const

  return (
    <Modal
      id={id}
      aberto={aberto}
      onFechar={onFechar}
      titulo={t('newUser.title')}
      descricao={t('newUser.subtitle')}
    >
      <form
        id={`${id}-form`}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit((valores) => criar.mutateAsync(valores).catch(() => undefined))(event)
        }}
      >
        <div id={`${id}-fields`} className="row">
          {campos.map((campo) => {
            const erro = errors[campo.name]
            return (
              <div id={`${id}-field-${campo.name}`} key={campo.name} className="col-sm-6">
                <BrInput
                  id={`${id}-field-${campo.name}-input`}
                  label={t(campo.label)}
                  type={campo.type}
                  autoComplete={campo.autoComplete}
                  aria-invalid={erro ? true : undefined}
                  status={erro ? 'danger' : undefined}
                  feedbackText={
                    // Chave de tradução (Zod) ou mensagem já pronta do backend.
                    erro?.message
                      ? erro.message.startsWith('newUser.')
                        ? t(erro.message)
                        : erro.message
                      : undefined
                  }
                  {...register(campo.name)}
                />
              </div>
            )
          })}
        </div>

        <BrMessage
          id={`${id}-provisional-hint`}
          status="info"
          message={t('newUser.provisionalPassword')}
          className="mt-2"
        />

        {errors.root?.message ? (
          <BrMessage
            id={`${id}-error`}
            status="danger"
            message={errors.root.message}
            className="mt-2"
          />
        ) : null}

        <div
          id={`${id}-actions`}
          className="d-flex justify-content-end mt-3"
          style={{ gap: 'var(--spacing-scale-base)' }}
        >
          <BrButton id={`${id}-cancel`} type="button" secondary onClick={onFechar}>
            {t('common.cancel')}
          </BrButton>
          <BrButton
            id={`${id}-submit`}
            type="submit"
            primary
            loading={isSubmitting}
            disabled={isSubmitting}
          >
            {isSubmitting ? t('newUser.creating') : t('newUser.create')}
          </BrButton>
        </div>
      </form>
    </Modal>
  )
}
