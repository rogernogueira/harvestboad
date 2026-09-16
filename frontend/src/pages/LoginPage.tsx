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

const CAMPO_CLASSES = 'border bg-surface px-3 py-2.5 text-sm transition-colors duration-150'

/**
 * Ícones decorativos da tela.
 *
 * Inline e locais: são adornos de rótulo, não elementos reutilizados em outras
 * telas, e o sprite de `icons.svg` guarda só as marcas externas. Todos ficam
 * fora da árvore de acessibilidade — o texto ao lado já diz o que são.
 */
function Icone({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={path} />
    </svg>
  )
}

const ICONE_USUARIO = 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'
const ICONE_CADEADO =
  'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z'
const ICONE_SETA = 'M13 7l5 5-5 5M18 12H6'
const ICONE_REPOSITORIOS =
  'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7m-16 5c0 1.7 3.6 3 8 3s8-1.3 8-3'
const ICONE_COLETAS = 'M4 4v5h5M20 20v-5h-5M20 9a8 8 0 00-13.7-3.7L4 7m0 8a8 8 0 0013.7 3.7L20 17'
const ICONE_CAFE =
  'M4 6h13v8a5 5 0 01-5 5H9a5 5 0 01-5-5zM17 8h1.5a3.5 3.5 0 010 7H17M3 21h15'

/**
 * Destaque institucional da coluna esquerda.
 *
 * Repete o recurso do `StatCard`: faixa colorida no topo para diferenciar
 * blocos sem pintar o fundo, que abafaria o contraste do texto.
 */
function Destaque({
  icon,
  faixa,
  cor,
  title,
  description,
}: {
  icon: string
  faixa: string
  cor: string
  title: string
  description: string
}) {
  return (
    <div className="panel overflow-hidden bg-surface">
      <div className={`h-1 ${faixa}`} aria-hidden="true" />
      <div className="p-4">
        <Icone path={icon} className={`h-5 w-5 ${cor}`} />
        <h3 className="mt-2.5 font-heading text-sm font-bold">{title}</h3>
        <p className="mt-1 text-xs text-content-muted">{description}</p>
      </div>
    </div>
  )
}

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
    <div className="flex min-h-dvh flex-col bg-surface-muted">
      {/*
        A faixa institucional também aqui: além de manter a identidade desde a
        primeira tela, é onde vive o seletor de idioma, cujo texto é claro e
        precisa do fundo escuro para ter contraste.
      */}
      <div className="bg-brand-strong text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-1.5">
          <p className="eyebrow !text-white/85">{t('app.institution')}</p>
          <LanguageSwitcher />
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="enter-up w-full max-w-4xl">
          {/*
            Marca acima do cartão no celular: a coluna de identidade some nessa
            largura, e a tela não pode abrir direto no campo de usuário sem
            dizer em que sistema se está entrando.
          */}
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            {/*
              Monograma, não o logo completo: a 40px a palavra desenhada dentro
              do lockup renderiza com 4px de altura e vira borrão. O nome do
              produto quem diz é o rodapé, e a tela quem nomeia é o h1 ao lado.
            */}
            <img src="/iconHB.svg" alt="HarvestBoard" className="h-10 w-auto" />
            <div className="leading-tight">
              <h1 className="font-heading text-lg font-bold tracking-tight">
                {t('auth.panelTitle')}
              </h1>
              <p className="eyebrow mt-0.5">{t('app.tagline')}</p>
            </div>
          </div>

          <div className="panel overflow-hidden">
            <div className="grid lg:grid-cols-2">
              {/* Coluna da marca — só em telas largas. */}
              <div className="hidden flex-col justify-between gap-8 border-r border-border-subtle bg-brand-soft p-10 lg:flex">
                <div className="flex flex-1 flex-col justify-center">
                  <img src="/logoHB.svg" alt="HarvestBoard" className="h-36 w-auto self-start" />
                  {/*
                    Título menor que a marca nominal desenhada no logo: aqui ele
                    nomeia a tela, não o produto. Em pé de igualdade, os dois
                    liam-se como duas manchetes disputando a mesma posição.
                  */}
                  <h1 className="mt-8 font-heading text-lg font-bold tracking-tight">
                    {t('auth.panelTitle')}
                  </h1>
                  <p className="mt-1.5 text-sm text-content-muted">{t('auth.panelTagline')}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Destaque
                    icon={ICONE_REPOSITORIOS}
                    faixa="bg-brand"
                    cor="text-brand-strong"
                    title={t('auth.highlights.repositories.title')}
                    description={t('auth.highlights.repositories.description')}
                  />
                  <Destaque
                    icon={ICONE_COLETAS}
                    faixa="bg-gold"
                    cor="text-gold-strong"
                    title={t('auth.highlights.harvests.title')}
                    description={t('auth.highlights.harvests.description')}
                  />
                </div>
              </div>

              {/* Coluna do formulário. */}
              <div className="flex flex-col justify-center p-8 lg:p-10">
                <div className="mx-auto w-full max-w-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      {/*
                        Mesmo tamanho e peso do h1 da coluna ao lado. Maior que
                        ele, "Bem-vindo" passava à frente do título da página —
                        e subir o h1 para compensar recriaria a disputa com a
                        marca nominal do logo, que o comentário acima evita.
                      */}
                      <h2 className="font-heading text-lg font-bold tracking-tight">
                        {t('auth.welcome')}
                      </h2>
                      <p className="mt-1 text-sm text-content-muted">{t('auth.credentialsHint')}</p>
                    </div>
                    <Icone path={ICONE_CADEADO} className="mt-1 h-5 w-5 shrink-0 text-brand" />
                  </div>

                  <form
                    onSubmit={(event) => void onSubmit(event)}
                    noValidate
                    className="mt-6 flex flex-col gap-4"
                  >
                    <label className="flex flex-col gap-1.5">
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        <Icone path={ICONE_USUARIO} className="h-4 w-4 text-content-muted" />
                        {t('auth.username')}
                      </span>
                      <input
                        type="text"
                        autoComplete="username"
                        autoFocus
                        aria-invalid={errors.username ? true : undefined}
                        {...register('username')}
                        className={`${CAMPO_CLASSES} ${
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
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        <Icone path={ICONE_CADEADO} className="h-4 w-4 text-content-muted" />
                        {t('auth.password')}
                      </span>
                      <input
                        type="password"
                        autoComplete="current-password"
                        aria-invalid={errors.password ? true : undefined}
                        {...register('password')}
                        className={`${CAMPO_CLASSES} ${
                          errors.password ? 'border-down' : 'border-border-subtle'
                        }`}
                      />
                      {errors.password?.message ? (
                        <span role="alert" className="text-xs text-down">
                          {t(errors.password.message)}
                        </span>
                      ) : null}
                    </label>

                    {/*
                      A borda à esquerda é o mesmo recurso da navegação: marca o
                      bloco sem depender só da cor do texto, que sozinha não
                      distingue o aviso para quem não percebe o vermelho.
                    */}
                    {erro ? (
                      <p
                        role="alert"
                        className="border-l-2 border-down bg-down-soft px-3 py-2 text-sm text-down"
                      >
                        {erro}
                      </p>
                    ) : null}

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="mt-1 flex items-center justify-center gap-2 bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-strong disabled:opacity-60"
                    >
                      {isSubmitting ? (
                        t('auth.signingIn')
                      ) : (
                        <>
                          {t('auth.signIn')}
                          <Icone path={ICONE_SETA} className="h-4 w-4" />
                        </>
                      )}
                    </button>

                    {/*
                      Acesso federado CAFe. Entra desabilitado: o lugar dele na
                      tela já está definido, mas a integração com a federação
                      ainda não existe. Contorno em vez de preenchido para não
                      disputar atenção com o botão que de fato funciona.
                    */}
                    {/*
                      O "em breve" é ligado ao botão por aria-describedby: um
                      botão desabilitado sem explicação deixa a dúvida se é
                      limitação da conta ou funcionalidade que ainda não chegou,
                      e quem usa leitor de tela não veria o texto solto ao lado.
                    */}
                    <div className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        disabled
                        aria-describedby="cafe-em-breve"
                        className="flex items-center justify-center gap-2 border border-brand px-4 py-2.5 text-sm font-semibold text-brand transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Icone path={ICONE_CAFE} className="h-4 w-4" />
                        {t('auth.cafeAccess')}
                      </button>
                      <p id="cafe-em-breve" className="text-center text-xs text-content-muted">
                        {t('auth.cafeSoon')}
                      </p>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-content-muted">{t('app.footer')}</p>
        </div>
      </div>
    </div>
  )
}
