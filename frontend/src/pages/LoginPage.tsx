import { BrButton, BrInput, BrMessage, Icon } from '@govbr-ds/react-components'
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

/*
 * Ícones do Font Awesome 5, que é o que o Padrão Digital de Governo usa.
 *
 * Substituem os seis `path` de SVG desenhados à mão que a tela carregava. O
 * componente `Icon` do design system já emite `aria-hidden`, então os ícones
 * seguem fora da árvore de acessibilidade — o texto ao lado diz o que são.
 *
 * A major 5 não é escolha: o core referencia `"Font Awesome 5 Free"` nos
 * glifos e o mapa de nomes mudou na 6.
 *
 * O `Icon` não aceita `id` nem `className` — as props dele são só `icon`,
 * `size`, `badge` e os atalhos de margem. Por isso ele vai dentro de um `span`,
 * que é quem carrega o `id` da convenção e a classe de cor.
 */
const ICONE_USUARIO = 'fas fa-user'
const ICONE_CADEADO = 'fas fa-lock'
const ICONE_REPOSITORIOS = 'fas fa-database'
const ICONE_COLETAS = 'fas fa-sync-alt'
const ICONE_CAFE = 'fas fa-coffee'

/**
 * Destaque institucional da coluna esquerda.
 *
 * Continua sendo markup próprio, e não `BrCard`: o recurso da faixa colorida no
 * topo — diferenciar blocos sem pintar o fundo, que abafaria o contraste do
 * texto — não existe no cartão do design system, e o `BrCard` também não aceita
 * `id`, que a convenção do projeto exige aqui porque o componente aparece duas
 * vezes na mesma tela. As classes são as do DS (`br-card`, utilitárias de
 * espaçamento), então o visual é o do padrão.
 */
function Destaque({
  id,
  icon,
  faixa,
  cor,
  title,
  description,
}: {
  id: string
  icon: string
  faixa: string
  cor: string
  title: string
  description: string
}) {
  return (
    <div id={id} className="br-card">
      <div
        id={`${id}-stripe`}
        className={faixa}
        style={{ height: 'var(--surface-width-lg)' }}
        aria-hidden="true"
      />
      <div id={`${id}-body`} className="card-content p-3">
        <span id={`${id}-icon`} className={cor}>
          <Icon icon={icon} />
        </span>
        <h3 id={`${id}-title`} className="text-base text-bold mt-2 mb-1">
          {title}
        </h3>
        <p id={`${id}-description`} className="text-down-01 mb-0">
          {description}
        </p>
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
    <div id="login-page" className="d-flex flex-column" style={{ minHeight: '100dvh' }}>
      {/*
        A faixa institucional também aqui: além de manter a identidade desde a
        primeira tela, é onde vive o seletor de idioma, cujo texto é claro e
        precisa do fundo escuro para ter contraste.
      */}
      <div id="login-page-institution-bar" className="bg-blue-warm-vivid-80 text-pure-0">
        <div
          id="login-page-institution-bar-inner"
          className="container-lg d-flex align-items-center justify-content-between py-2"
        >
          <p id="login-page-institution-name" className="eyebrow mb-0">
            {t('app.institution')}
          </p>
          <LanguageSwitcher id="login-page-language-switcher" invertido />
        </div>
      </div>

      <div
        id="login-page-body"
        className="d-flex flex-grow-1 align-items-center justify-content-center p-4"
      >
        {/*
          Largura em `style` porque o design system não tem utilitária de
          largura: `.w-100` é do Bootstrap e não existe no core.
        */}
        <div
          id="login-page-container"
          className="enter-up"
          style={{ width: '100%', maxWidth: '56rem' }}
        >
          {/*
            Marca acima do cartão no celular: a coluna de identidade some nessa
            largura, e a tela não pode abrir direto no campo de usuário sem
            dizer em que sistema se está entrando.
          */}
          <div
            id="login-page-mobile-brand"
            className="d-flex d-lg-none align-items-center gap-3 mb-4"
          >
            {/*
              Monograma, não o logo completo: a 40px a palavra desenhada dentro
              do lockup renderiza com 4px de altura e vira borrão. O nome do
              produto quem diz é o rodapé, e a tela quem nomeia é o h1 ao lado.
            */}
            <img
              id="login-page-mobile-logo"
              src="/iconHB.svg"
              alt="HarvestBoard"
              style={{ height: '2.5rem', width: 'auto' }}
            />
            <div id="login-page-mobile-brand-text">
              <h1 id="login-page-mobile-title" className="text-up-01 text-bold mb-0">
                {t('auth.panelTitle')}
              </h1>
              <p id="login-page-mobile-tagline" className="eyebrow mb-0">
                {t('app.tagline')}
              </p>
            </div>
          </div>

          <div id="login-page-card" className="br-card">
            {/*
              As colunas encostam na borda do cartão, então o gutter do `.row`
              é zerado pela própria variável do design system. `.no-gutters` é
              nome do Bootstrap e não existe no core — sem isso o `.row` sai
              com margem negativa e vaza para fora do cartão.
            */}
            <div
              id="login-page-card-grid"
              className="row"
              style={{ ['--grid-gutter' as string]: '0' }}
            >
              {/* Coluna da marca — só em telas largas. */}
              <div
                id="login-page-brand-column"
                className="col-lg-6 d-none d-lg-flex flex-column justify-content-between bg-blue-warm-vivid-5 p-5"
              >
                <div
                  id="login-page-brand-block"
                  className="d-flex flex-column justify-content-center flex-grow-1"
                >
                  <img
                    id="login-page-logo"
                    src="/logoHB.svg"
                    alt="HarvestBoard"
                    className="align-self-start"
                    style={{ height: '9rem', width: 'auto' }}
                  />
                  {/*
                    Título menor que a marca nominal desenhada no logo: aqui ele
                    nomeia a tela, não o produto. Em pé de igualdade, os dois
                    liam-se como duas manchetes disputando a mesma posição.

                    É o único h1 da aplicação que sobrescreve o tamanho do core
                    (29px) — nas demais telas o h1 é dimensionado por ele. Aqui
                    o logo desenhado logo acima já ocupa o papel de manchete.
                  */}
                  <h1 id="login-page-title" className="text-up-01 text-bold mt-4 mb-1">
                    {t('auth.panelTitle')}
                  </h1>
                  <p id="login-page-tagline" className="text-base mb-0">
                    {t('auth.panelTagline')}
                  </p>
                </div>

                <div id="login-page-highlights" className="d-flex gap-3 mt-4">
                  <Destaque
                    id="login-page-highlight-repositories"
                    icon={ICONE_REPOSITORIOS}
                    faixa="bg-blue-warm-vivid-70"
                    cor="text-blue-warm-vivid-80"
                    title={t('auth.highlights.repositories.title')}
                    description={t('auth.highlights.repositories.description')}
                  />
                  <Destaque
                    id="login-page-highlight-harvests"
                    icon={ICONE_COLETAS}
                    faixa="bg-yellow-vivid-20"
                    cor="text-gold-vivid-60"
                    title={t('auth.highlights.harvests.title')}
                    description={t('auth.highlights.harvests.description')}
                  />
                </div>
              </div>

              {/* Coluna do formulário. */}
              <div
                id="login-page-form-column"
                className="col-lg-6 d-flex flex-column justify-content-center p-4 p-lg-5"
              >
                <div
                  id="login-page-form-container"
                  className="mx-auto"
                  style={{ width: '100%', maxWidth: '24rem' }}
                >
                  <div
                    id="login-page-welcome"
                    className="d-flex align-items-start justify-content-between"
                  >
                    <div id="login-page-welcome-text">
                      {/*
                        Mesmo tamanho e peso do h1 da coluna ao lado. Maior que
                        ele, "Bem-vindo" passava à frente do título da página —
                        e subir o h1 para compensar recriaria a disputa com a
                        marca nominal do logo, que o comentário acima evita.
                      */}
                      <h2 id="login-page-welcome-title" className="text-up-01 text-bold mt-0 mb-1">
                        {t('auth.welcome')}
                      </h2>
                      <p id="login-page-welcome-hint" className="text-base mb-0">
                        {t('auth.credentialsHint')}
                      </p>
                    </div>
                    <span id="login-page-welcome-icon" className="text-blue-warm-vivid-70">
                      <Icon icon={ICONE_CADEADO} />
                    </span>
                  </div>

                  <form id="login-page-form" onSubmit={(event) => void onSubmit(event)} noValidate>
                    {/*
                      O erro de validação vai por `status` + `feedbackText`, que
                      é o mecanismo do design system: ele rende a mensagem com
                      `role="alert"`, o mesmo que o `<span>` manual fazia antes.
                      Não há `BrForm` — a validação continua sendo do
                      react-hook-form, e o BrInput só apresenta o resultado.

                      `register()` funciona direto porque o BrInput repassa a
                      ref e estende InputHTMLAttributes.
                    */}
                    <BrInput
                      id="login-page-username"
                      label={t('auth.username')}
                      icon={ICONE_USUARIO}
                      type="text"
                      autoComplete="username"
                      autoFocus
                      aria-invalid={errors.username ? true : undefined}
                      status={errors.username ? 'danger' : undefined}
                      feedbackText={errors.username?.message && t(errors.username.message)}
                      {...register('username')}
                    />

                    <BrInput
                      id="login-page-password"
                      label={t('auth.password')}
                      icon={ICONE_CADEADO}
                      type="password"
                      autoComplete="current-password"
                      aria-invalid={errors.password ? true : undefined}
                      status={errors.password ? 'danger' : undefined}
                      feedbackText={errors.password?.message && t(errors.password.message)}
                      {...register('password')}
                    />

                    {/*
                      Falha de autenticação, distinta do erro de campo: é o
                      resultado da requisição, não da validação local. O
                      `BrMessage` já emite `role="alert"`, então o aviso continua
                      sendo anunciado por leitor de tela.
                    */}
                    {erro ? (
                      <BrMessage
                        id="login-page-error"
                        status="danger"
                        message={erro}
                        className="mt-3"
                      />
                    ) : null}

                    <BrButton
                      id="login-page-submit"
                      type="submit"
                      primary
                      block
                      loading={isSubmitting}
                      disabled={isSubmitting}
                      className="mt-4"
                    >
                      {isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
                    </BrButton>

                    {/*
                      Acesso federado CAFe. Entra desabilitado: o lugar dele na
                      tela já está definido, mas a integração com a federação
                      ainda não existe. Secundário em vez de primário para não
                      disputar atenção com o botão que de fato funciona.

                      O "em breve" é ligado ao botão por aria-describedby: um
                      botão desabilitado sem explicação deixa a dúvida se é
                      limitação da conta ou funcionalidade que ainda não chegou,
                      e quem usa leitor de tela não veria o texto solto ao lado.

                      A ressalva de contraste que este bloco carregava saiu com a
                      paleta antiga: ela existia porque o azul de marca de então
                      dava 3,9 sobre branco e reprovaria a 14px. O azul do
                      padrão dá 7,33, então o botão secundário do design system
                      passa sem precisar escurecer o rótulo à mão.
                    */}
                    <div id="login-page-cafe" className="mt-2">
                      <BrButton
                        id="login-page-cafe-button"
                        type="button"
                        secondary
                        block
                        disabled
                        icon={ICONE_CAFE}
                        aria-describedby="cafe-em-breve"
                      >
                        {t('auth.cafeAccess')}
                      </BrButton>
                      <p id="cafe-em-breve" className="text-down-01 text-center mt-1 mb-0">
                        {t('auth.cafeSoon')}
                      </p>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>

          <p id="login-page-footer" className="text-down-01 text-center mt-3 mb-0">
            {t('app.footer')}
          </p>
        </div>
      </div>
    </div>
  )
}
