import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { z } from 'zod'

import { useAuth } from '@/auth/context'
import { ApiError, apiPost } from '@/lib/api'

const schema = z
  .object({
    currentPassword: z.string().min(1, 'auth.validation.passwordRequired'),
    newPassword: z.string().min(8, 'auth.validation.tooShort'),
    confirmPassword: z.string().min(1, 'auth.validation.passwordRequired'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'auth.validation.mismatch',
  })

type Form = z.infer<typeof schema>

export function ChangePasswordPage() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()
  // O backend valida a senha com as regras do Django; as mensagens já vêm
  // traduzidas de lá, então são exibidas como recebidas.
  const [erros, setErros] = useState<string[]>([])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema) })

  const onSubmit = handleSubmit(async (values) => {
    setErros([])
    try {
      await apiPost('/auth/change-password/', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      })
      await refreshUser()
      void navigate('/', { replace: true })
    } catch (error) {
      if (error instanceof ApiError && error.payload && typeof error.payload === 'object') {
        const payload = error.payload as Record<string, unknown>
        const lista = Object.values(payload).flatMap((item) =>
          Array.isArray(item) ? item.map(String) : [String(item)],
        )
        setErros(lista.length ? lista : [t('common.error')])
      } else {
        setErros([t('common.error')])
      }
    }
  })

  const campos = [
    { name: 'currentPassword', label: 'auth.currentPassword', autoComplete: 'current-password' },
    { name: 'newPassword', label: 'auth.newPassword', autoComplete: 'new-password' },
    { name: 'confirmPassword', label: 'auth.confirmPassword', autoComplete: 'new-password' },
  ] as const

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold">{t('auth.changePassword')}</h1>
        {user?.mustChangePassword ? (
          <p className="mt-1 text-sm text-warn">{t('auth.mustChangePassword')}</p>
        ) : null}
      </header>

      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
        {campos.map((campo) => {
          const erro = errors[campo.name]
          return (
            <label key={campo.name} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t(campo.label)}</span>
              <input
                type="password"
                autoComplete={campo.autoComplete}
                aria-invalid={erro ? true : undefined}
                {...register(campo.name)}
                className={`rounded-md border bg-surface-raised px-3 py-2 text-sm ${
                  erro ? 'border-down' : 'border-border-subtle'
                }`}
              />
              {erro?.message ? (
                <span role="alert" className="text-xs text-down">
                  {t(erro.message)}
                </span>
              ) : null}
            </label>
          )
        })}

        {erros.length ? (
          <ul role="alert" className="flex flex-col gap-1 text-xs text-down">
            {erros.map((mensagem) => (
              <li key={mensagem}>{mensagem}</li>
            ))}
          </ul>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
        >
          {isSubmitting ? t('common.saving') : t('common.save')}
        </button>
      </form>
    </div>
  )
}
