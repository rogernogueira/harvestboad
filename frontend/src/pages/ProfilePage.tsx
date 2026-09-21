import { BrButton, BrInput, BrMessage } from '@govbr-ds/react-components'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { z } from 'zod'

import { useAuth } from '@/auth/context'
import { PageHeader } from '@/components/PageHeader'
import { ApiError, apiPatch, apiPost } from '@/lib/api'
import { CHAVE_DO_PERFIL } from '@/lib/profiles'
import type { User } from '@/lib/types'

/*
  Limites iguais aos do modelo (`apps/accounts/models.py`): validar aqui evita
  a ida ao servidor, mas quem decide continua sendo ele — o backend recusa o
  que passar por cima disso.
*/
const cadastroSchema = z.object({
  first_name: z.string().max(150),
  last_name: z.string().max(150),
  email: z.email('profile.validation.emailInvalid'),
  phone: z.string().max(32, 'profile.validation.phoneTooLong'),
  institution: z.string().max(200, 'profile.validation.institutionTooLong'),
  // Vazio é resposta válida — o setor é opcional —, então a checagem de
  // formato só vale para quem digitou alguma coisa.
  departmentEmail: z
    .string()
    .refine((valor) => valor === '' || z.email().safeParse(valor).success, {
      message: 'profile.validation.emailInvalid',
    }),
})

const senhaSchema = z
  .object({
    currentPassword: z.string().min(1, 'auth.validation.passwordRequired'),
    newPassword: z.string().min(8, 'auth.validation.tooShort'),
    confirmPassword: z.string().min(1, 'auth.validation.passwordRequired'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'auth.validation.mismatch',
  })

type FormularioCadastro = z.infer<typeof cadastroSchema>
type FormularioSenha = z.infer<typeof senhaSchema>

/**
 * Perfil da conta: o cadastro do próprio usuário e a troca de senha.
 *
 * As duas metades são formulários independentes de propósito — atualizar o
 * telefone não deve exigir digitar a senha atual, e trocar a senha não deve
 * reenviar o cadastro. Só a segunda encerra a obrigação de trocar a senha, e é
 * por isso que ela continua sendo o destino do desvio em `ProtectedRoute`.
 */
export function ProfilePage() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()

  const [salvo, setSalvo] = useState(false)
  // O backend valida a senha com as regras do Django; as mensagens já vêm
  // traduzidas de lá, então são exibidas como recebidas.
  const [errosDeSenha, setErrosDeSenha] = useState<string[]>([])

  const cadastro = useForm<FormularioCadastro>({
    resolver: zodResolver(cadastroSchema),
    // O usuário já está carregado quando a tela abre: `ProtectedRoute` só
    // libera a aplicação depois do `/auth/me/`.
    defaultValues: {
      first_name: user?.first_name ?? '',
      last_name: user?.last_name ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? '',
      institution: user?.institution ?? '',
      departmentEmail: user?.departmentEmail ?? '',
    },
  })

  const senha = useForm<FormularioSenha>({ resolver: zodResolver(senhaSchema) })

  const salvarCadastro = cadastro.handleSubmit(async (valores) => {
    setSalvo(false)
    try {
      const atualizado = await apiPatch<User>('/auth/me/', {
        first_name: valores.first_name.trim(),
        last_name: valores.last_name.trim(),
        email: valores.email.trim(),
        phone: valores.phone.trim(),
        institution: valores.institution.trim(),
        departmentEmail: valores.departmentEmail.trim(),
      })
      await refreshUser()
      // Reaproveita o que voltou: o backend apara e normaliza, e o formulário
      // precisa refletir o que ficou gravado, não o que foi digitado.
      cadastro.reset({
        first_name: atualizado.first_name,
        last_name: atualizado.last_name,
        email: atualizado.email,
        phone: atualizado.phone,
        institution: atualizado.institution,
        departmentEmail: atualizado.departmentEmail,
      })
      setSalvo(true)
    } catch (error) {
      // Erro de e-mail volta por campo — o pessoal, repetido; o do setor,
      // malformado. O resto vai para a faixa de erro do bloco.
      if (error instanceof ApiError && error.payload && typeof error.payload === 'object') {
        const payload = error.payload as Record<string, unknown>
        let atribuido = false
        for (const campo of ['email', 'departmentEmail'] as const) {
          const mensagens = payload[campo]
          if (Array.isArray(mensagens) && mensagens.length) {
            cadastro.setError(campo, { message: String(mensagens[0]) })
            atribuido = true
          }
        }
        if (!atribuido) {
          cadastro.setError('root', { message: error.detail })
        }
      } else {
        cadastro.setError('root', { message: t('common.error') })
      }
    }
  })

  const trocarSenha = senha.handleSubmit(async (valores) => {
    setErrosDeSenha([])
    try {
      await apiPost('/auth/change-password/', {
        currentPassword: valores.currentPassword,
        newPassword: valores.newPassword,
      })
      await refreshUser()
      void navigate('/', { replace: true })
    } catch (error) {
      if (error instanceof ApiError && error.payload && typeof error.payload === 'object') {
        const payload = error.payload as Record<string, unknown>
        const lista = Object.values(payload).flatMap((item) =>
          Array.isArray(item) ? item.map(String) : [String(item)],
        )
        setErrosDeSenha(lista.length ? lista : [t('common.error')])
      } else {
        setErrosDeSenha([t('common.error')])
      }
    }
  })

  const camposDeCadastro = [
    { name: 'first_name', label: 'profile.firstName', type: 'text', autoComplete: 'given-name' },
    { name: 'last_name', label: 'profile.lastName', type: 'text', autoComplete: 'family-name' },
    { name: 'email', label: 'profile.email', type: 'email', autoComplete: 'email' },
    { name: 'phone', label: 'profile.phone', type: 'tel', autoComplete: 'tel' },
    {
      name: 'institution',
      label: 'profile.institution',
      type: 'text',
      autoComplete: 'organization',
    },
    // `autoComplete` desligado: é o endereço do setor, não o da pessoa, e o
    // navegador ofereceria o e-mail pessoal dela.
    {
      name: 'departmentEmail',
      label: 'profile.departmentEmail',
      type: 'email',
      autoComplete: 'off',
    },
  ] as const

  const camposDeSenha = [
    { name: 'currentPassword', label: 'auth.currentPassword', autoComplete: 'current-password' },
    { name: 'newPassword', label: 'auth.newPassword', autoComplete: 'new-password' },
    { name: 'confirmPassword', label: 'auth.confirmPassword', autoComplete: 'new-password' },
  ] as const

  return (
    <div id="profile-page" className="mx-auto" style={{ maxWidth: '44rem' }}>
      <PageHeader
        id="profile-page-header"
        eyebrow={t('profile.eyebrow')}
        title={t('profile.title')}
        description={t('profile.subtitle')}
      />

      {user?.mustChangePassword ? (
        <BrMessage
          id="profile-page-required-hint"
          status="warning"
          className="mb-4"
          message={t('auth.mustChangePassword')}
        />
      ) : null}

      <section id="profile-page-account" className="br-card p-3 mb-4">
        <h2 id="profile-page-account-title" className="text-up-01 text-bold mt-0 mb-1">
          {t('profile.account')}
        </h2>
        <p id="profile-page-account-hint" className="text-base text-gray-70 mt-0 mb-3">
          {t('profile.accountHint')}
        </p>

        {/*
          Identidade da conta: mostrada porque é cadastro do gestor como
          qualquer outro dado desta tela, mas fora do formulário — usuário e
          perfil são decididos na administração, e `PATCH /auth/me/` os ignora.
          `readOnly` em vez de `disabled` para o valor continuar copiável e no
          fluxo de leitura de quem usa leitor de tela.
        */}
        <div id="profile-page-identity" className="row mb-2">
          <div id="profile-page-identity-username" className="col-sm-6">
            <BrInput
              id="profile-page-identity-username-input"
              label={t('profile.username')}
              type="text"
              value={user?.username ?? ''}
              readOnly
              aria-describedby="profile-page-identity-username-hint"
              onChange={() => undefined}
            />
            <p
              id="profile-page-identity-username-hint"
              className="text-down-01 text-gray-70 mt-n2 mb-3"
            >
              {t('profile.usernameFixed')}
            </p>
          </div>
          <div id="profile-page-identity-profile" className="col-sm-6">
            <BrInput
              id="profile-page-identity-profile-input"
              label={t('profile.profileLabel')}
              type="text"
              value={user ? t(CHAVE_DO_PERFIL[user.profile]) : ''}
              readOnly
              onChange={() => undefined}
            />
          </div>
        </div>

        <form
          id="profile-page-account-form"
          noValidate
          onSubmit={(event) => void salvarCadastro(event)}
        >
          <div id="profile-page-account-fields" className="row">
            {camposDeCadastro.map((campo) => {
              const erro = cadastro.formState.errors[campo.name]
              return (
                <div id={`profile-page-field-${campo.name}`} key={campo.name} className="col-sm-6">
                  <BrInput
                    id={`profile-page-field-${campo.name}-input`}
                    label={t(campo.label)}
                    type={campo.type}
                    autoComplete={campo.autoComplete}
                    aria-invalid={erro ? true : undefined}
                    status={erro ? 'danger' : undefined}
                    feedbackText={
                      // Chave de tradução (Zod) ou mensagem já pronta do backend.
                      erro?.message
                        ? erro.message.startsWith('profile.')
                          ? t(erro.message)
                          : erro.message
                        : undefined
                    }
                    {...cadastro.register(campo.name)}
                  />
                </div>
              )
            })}
          </div>

          {cadastro.formState.errors.root?.message ? (
            <BrMessage
              id="profile-page-account-error"
              status="danger"
              className="mt-3"
              message={cadastro.formState.errors.root.message}
            />
          ) : null}

          {salvo ? (
            <BrMessage
              id="profile-page-account-saved"
              status="success"
              className="mt-3"
              message={t('profile.saved')}
            />
          ) : null}

          <BrButton
            id="profile-page-account-submit"
            type="submit"
            primary
            className="mt-3"
            loading={cadastro.formState.isSubmitting}
            disabled={cadastro.formState.isSubmitting}
          >
            {cadastro.formState.isSubmitting ? t('common.saving') : t('profile.save')}
          </BrButton>
        </form>
      </section>

      <section id="profile-page-password" className="br-card p-3">
        <h2 id="profile-page-password-title" className="text-up-01 text-bold mt-0 mb-1">
          {t('auth.changePassword')}
        </h2>
        <p id="profile-page-password-hint" className="text-base text-gray-70 mt-0 mb-3">
          {t('profile.passwordHint')}
        </p>

        <form
          id="profile-page-password-form"
          noValidate
          onSubmit={(event) => void trocarSenha(event)}
        >
          {/*
            Campo de usuário oculto, repetido aqui porque o visível está no
            outro formulário: sem ele o navegador não sabe de qual conta é a
            senha nova, guarda a credencial sem nome e avisa no console
            ("Password forms should have (optionally hidden) username fields").
          */}
          <input
            id="profile-page-password-username"
            type="text"
            name="username"
            autoComplete="username"
            value={user?.username ?? ''}
            readOnly
            hidden
          />

          {camposDeSenha.map((campo) => {
            const erro = senha.formState.errors[campo.name]
            return (
              <BrInput
                id={`profile-page-password-field-${campo.name}`}
                key={campo.name}
                label={t(campo.label)}
                type="password"
                autoComplete={campo.autoComplete}
                aria-invalid={erro ? true : undefined}
                status={erro ? 'danger' : undefined}
                feedbackText={erro?.message && t(erro.message)}
                {...senha.register(campo.name)}
              />
            )
          })}

          {/*
            Erros vindos do backend, distintos da validação local: são as regras
            de senha do Django, que chegam já traduzidas e podem ser mais de uma.
            O `BrMessage` emite `role="alert"` por conta própria.
          */}
          {errosDeSenha.length ? (
            <BrMessage
              id="profile-page-password-errors"
              status="danger"
              className="mt-3"
              message={
                <ul id="profile-page-password-errors-list" className="mb-0">
                  {errosDeSenha.map((mensagem, indice) => (
                    <li id={`profile-page-password-error-${indice}`} key={mensagem}>
                      {mensagem}
                    </li>
                  ))}
                </ul>
              }
            />
          ) : null}

          <BrButton
            id="profile-page-password-submit"
            type="submit"
            primary
            className="mt-3"
            loading={senha.formState.isSubmitting}
            disabled={senha.formState.isSubmitting}
          >
            {senha.formState.isSubmitting ? t('common.saving') : t('auth.changePassword')}
          </BrButton>
        </form>
      </section>
    </div>
  )
}
