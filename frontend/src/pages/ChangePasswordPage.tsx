import { BrButton, BrInput, BrMessage } from '@govbr-ds/react-components'
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
    <div id="change-password-page" className="mx-auto" style={{ maxWidth: '28rem' }}>
      <header id="change-password-header" className="mb-3">
        <h1 id="change-password-title" className="mt-0 mb-1">
          {t('auth.changePassword')}
        </h1>
        {user?.mustChangePassword ? (
          <BrMessage
            id="change-password-required-hint"
            status="warning"
            message={t('auth.mustChangePassword')}
          />
        ) : null}
      </header>

      <form id="change-password-form" onSubmit={(event) => void onSubmit(event)} noValidate>
        {campos.map((campo) => {
          const erro = errors[campo.name]
          return (
            <BrInput
              id={`change-password-field-${campo.name}`}
              key={campo.name}
              label={t(campo.label)}
              type="password"
              autoComplete={campo.autoComplete}
              aria-invalid={erro ? true : undefined}
              status={erro ? 'danger' : undefined}
              feedbackText={erro?.message && t(erro.message)}
              {...register(campo.name)}
            />
          )
        })}

        {/*
          Erros vindos do backend, distintos da validação local: são as regras
          de senha do Django, que chegam já traduzidas e podem ser mais de uma.
          O `BrMessage` emite `role="alert"` por conta própria.
        */}
        {erros.length ? (
          <BrMessage
            id="change-password-errors"
            status="danger"
            className="mt-3"
            message={
              <ul id="change-password-errors-list" className="mb-0">
                {erros.map((mensagem, indice) => (
                  <li id={`change-password-error-${indice}`} key={mensagem}>
                    {mensagem}
                  </li>
                ))}
              </ul>
            }
          />
        ) : null}

        <BrButton
          id="change-password-submit"
          type="submit"
          primary
          block
          loading={isSubmitting}
          disabled={isSubmitting}
          className="mt-4"
        >
          {isSubmitting ? t('common.saving') : t('common.save')}
        </BrButton>
      </form>
    </div>
  )
}
