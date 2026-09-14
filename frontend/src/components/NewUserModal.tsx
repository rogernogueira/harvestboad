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
  aberto,
  onFechar,
  onCriado,
}: {
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
      aberto={aberto}
      onFechar={onFechar}
      titulo={t('newUser.title')}
      descricao={t('newUser.subtitle')}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit((valores) => criar.mutateAsync(valores).catch(() => undefined))(event)
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {campos.map((campo) => {
            const erro = errors[campo.name]
            return (
              <label key={campo.name} className="flex flex-col gap-1.5">
                <span className="eyebrow">{t(campo.label)}</span>
                <input
                  type={campo.type}
                  autoComplete={campo.autoComplete}
                  aria-invalid={erro ? true : undefined}
                  {...register(campo.name)}
                  className={`border bg-surface px-3 py-2 text-sm ${
                    erro ? 'border-down' : 'border-border-subtle'
                  }`}
                />
                {erro?.message ? (
                  <span role="alert" className="text-xs text-down">
                    {/* Chave de tradução (Zod) ou mensagem já pronta do backend. */}
                    {erro.message.startsWith('newUser.') ? t(erro.message) : erro.message}
                  </span>
                ) : null}
              </label>
            )
          })}
        </div>

        <p className="border-l-2 border-brand bg-brand-soft px-3 py-2 text-xs text-brand-strong">
          {t('newUser.provisionalPassword')}
        </p>

        {errors.root?.message ? (
          <p role="alert" className="text-sm text-down">
            {errors.root.message}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            className="border border-border-subtle px-4 py-2 text-sm transition-colors duration-150 hover:border-brand"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-strong disabled:opacity-50"
          >
            {isSubmitting ? t('newUser.creating') : t('newUser.create')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
