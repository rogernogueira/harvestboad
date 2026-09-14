import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { z } from 'zod'

import { useAuth } from '@/auth/context'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { ApiError } from '@/lib/api'

const schema = z.object({
  username: z.string().min(1, 'auth.validation.usernameRequired'),
  password: z.string().min(1, 'auth.validation.passwordRequired'),
})

type LoginForm = z.infer<typeof schema>

export function LoginPage() {
  const { t } = useTranslation()
  const { login, status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [erro, setErro] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(schema) })

  if (status === 'autenticado') return <Navigate to="/" replace />

  const onSubmit = handleSubmit(async (values) => {
    setErro(null)
    try {
      const user = await login(values.username, values.password)
      const destino = user.mustChangePassword
        ? '/trocar-senha'
        : ((location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/')
      void navigate(destino, { replace: true })
    } catch (error) {
      // 401 aqui é credencial errada, não sessão expirada.
      setErro(
        error instanceof ApiError && error.status === 401
          ? t('auth.invalidCredentials')
          : t('common.error'),
      )
    }
  })

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">{t('app.name')}</h1>
            <p className="text-sm text-content-muted">{t('app.tagline')}</p>
          </div>
          <LanguageSwitcher />
        </div>

        <form
          onSubmit={(event) => void onSubmit(event)}
          noValidate
          className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface-raised p-6"
        >
          <h2 className="text-sm font-medium">{t('auth.signIn')}</h2>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm">{t('auth.username')}</span>
            <input
              type="text"
              autoComplete="username"
              autoFocus
              aria-invalid={errors.username ? true : undefined}
              {...register('username')}
              className={`rounded-md border bg-surface px-3 py-2 text-sm ${
                errors.username ? 'border-down' : 'border-border-subtle'
              }`}
            />
            {errors.username?.message ? (
              <span role="alert" className="text-xs text-down">
                {t(errors.username.message)}
              </span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm">{t('auth.password')}</span>
            <input
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? true : undefined}
              {...register('password')}
              className={`rounded-md border bg-surface px-3 py-2 text-sm ${
                errors.password ? 'border-down' : 'border-border-subtle'
              }`}
            />
            {errors.password?.message ? (
              <span role="alert" className="text-xs text-down">
                {t(errors.password.message)}
              </span>
            ) : null}
          </label>

          {erro ? (
            <p role="alert" className="text-sm text-down">
              {erro}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
          </button>
        </form>
      </div>
    </div>
  )
}
