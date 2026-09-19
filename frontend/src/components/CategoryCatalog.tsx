import { BrButton, BrInput } from '@govbr-ds/react-components'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { nomeDaCategoria } from '@/lib/categorias'
import { ApiError, apiDelete, apiPatch, apiPost } from '@/lib/api'
import { notificationCategoriesQuery, notificationTemplatesQuery } from '@/lib/queries'
import type { NotificationCategoryItem } from '@/lib/types'

/**
 * Cadastro de categorias e dos textos padrão de cada uma.
 *
 * Categoria **não se exclui quando já foi usada**: o `PROTECT` do modelo recusa,
 * porque apagá-la levaria junto a informação de avisos que alguém já leu. A
 * saída é desativar — some do formulário de envio e continua nomeando o
 * histórico. A exclusão fica disponível só para a categoria que nasceu por
 * engano e nunca saiu.
 *
 * O nome vem em três idiomas porque o selo é texto de interface; só o pt-BR é
 * obrigatório, e os outros dois caem nele quando vazios.
 */
export function CategoryCatalog({ id = 'category-catalog' }: { id?: string }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [aviso, setAviso] = useState<string | null>(null)
  const [selecionada, setSelecionada] = useState<number | null>(null)

  const categorias = useQuery(notificationCategoriesQuery)

  const invalidar = async () => {
    setAviso(null)
    await queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }
  const aoFalhar = (erro: unknown) =>
    setAviso(erro instanceof ApiError ? erro.detail : t('common.error'))

  const salvar = useMutation({
    mutationFn: (dados: Record<string, unknown>) => apiPost('/notifications/categories/', dados),
    onSuccess: invalidar,
    onError: aoFalhar,
  })

  const alternar = useMutation({
    mutationFn: (categoria: NotificationCategoryItem) =>
      // Só a bandeira: o PATCH não exige o registro inteiro.
      apiPatch(`/notifications/categories/${categoria.id}/`, { active: !categoria.active }),
    onSuccess: invalidar,
    onError: aoFalhar,
  })

  const excluir = useMutation({
    mutationFn: (categoriaId: number) => apiDelete(`/notifications/categories/${categoriaId}/`),
    onSuccess: invalidar,
    onError: aoFalhar,
  })

  if (categorias.isPending) return <Loading id={`${id}-loading`} />
  if (categorias.isError)
    return (
      <ErrorState
        id={`${id}-error`}
        error={categorias.error}
        onRetry={() => void categorias.refetch()}
      />
    )

  return (
    <div id={id} className="d-flex flex-column gap-4">
      {aviso ? (
        <p id={`${id}-warning`} role="alert" className="text-base text-red-vivid-50 mb-0">
          {aviso}
        </p>
      ) : null}

      <NovaCategoria
        id={`${id}-new`}
        ocupado={salvar.isPending}
        onSalvar={(dados) => salvar.mutate(dados)}
      />

      {categorias.data.length === 0 ? (
        <Empty id={`${id}-empty`} label={t('notifications.catalog.none')} />
      ) : (
        <ul id={`${id}-list`} className="plain-list d-flex flex-column gap-2">
          {categorias.data.map((categoria) => (
            <li id={`${id}-item-${categoria.id}`} key={categoria.id} className="br-item p-3">
              <div
                id={`${id}-item-${categoria.id}-head`}
                className="d-flex flex-wrap align-items-center justify-content-between gap-2"
              >
                <span id={`${id}-item-${categoria.id}-names`}>
                  <span
                    id={`${id}-item-${categoria.id}-name`}
                    className="text-semi-bold mr-1"
                    style={{ opacity: categoria.active ? 1 : 0.6 }}
                  >
                    {nomeDaCategoria(categoria, i18n.resolvedLanguage)}
                  </span>
                  <span
                    id={`${id}-item-${categoria.id}-slug`}
                    className="text-down-01 text-gray-70"
                  >
                    {categoria.slug}
                  </span>
                  {!categoria.active ? (
                    <span
                      id={`${id}-item-${categoria.id}-inactive`}
                      className="br-tag text small ml-1"
                    >
                      {t('notifications.catalog.inactive')}
                    </span>
                  ) : null}
                </span>

                <span id={`${id}-item-${categoria.id}-actions`} className="d-flex flex-wrap gap-2">
                  <BrButton
                    id={`${id}-item-${categoria.id}-templates`}
                    type="button"
                    secondary
                    size="small"
                    onClick={() =>
                      setSelecionada(selecionada === categoria.id ? null : categoria.id)
                    }
                  >
                    {t('notifications.catalog.templates')}
                  </BrButton>
                  <BrButton
                    id={`${id}-item-${categoria.id}-toggle`}
                    type="button"
                    secondary
                    size="small"
                    disabled={alternar.isPending}
                    onClick={() => alternar.mutate(categoria)}
                  >
                    {t(
                      categoria.active
                        ? 'notifications.catalog.deactivate'
                        : 'notifications.catalog.activate',
                    )}
                  </BrButton>
                  <button
                    id={`${id}-item-${categoria.id}-delete`}
                    type="button"
                    disabled={excluir.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          t('notifications.catalog.confirmDelete', {
                            name: nomeDaCategoria(categoria, i18n.resolvedLanguage),
                          }),
                        )
                      )
                        excluir.mutate(categoria.id)
                    }}
                    title={t('notifications.catalog.delete')}
                    aria-label={t('notifications.catalog.deleteOne', {
                      name: nomeDaCategoria(categoria, i18n.resolvedLanguage),
                    })}
                    className="br-button circle small"
                  >
                    <i className="fas fa-trash-alt" aria-hidden="true" />
                  </button>
                </span>
              </div>

              <p
                id={`${id}-item-${categoria.id}-translations`}
                className="text-down-01 text-gray-70 mb-0 mt-1"
              >
                {`pt-BR: ${categoria.namePtBr} · es: ${categoria.nameEs || '—'} · en: ${
                  categoria.nameEn || '—'
                }`}
              </p>

              {selecionada === categoria.id ? (
                <Textos id={`${id}-item-${categoria.id}-texts`} categoria={categoria} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Formulário de categoria nova. Só o nome em pt-BR é obrigatório. */
function NovaCategoria({
  id,
  ocupado,
  onSalvar,
}: {
  id: string
  ocupado: boolean
  onSalvar: (dados: Record<string, unknown>) => void
}) {
  const { t } = useTranslation()
  const [campos, setCampos] = useState({ slug: '', namePtBr: '', nameEs: '', nameEn: '' })
  const preenchido = campos.slug.trim() !== '' && campos.namePtBr.trim() !== ''

  const trocar = (chave: keyof typeof campos) => (evento: { target: { value: string } }) =>
    setCampos((atual) => ({ ...atual, [chave]: evento.target.value }))

  return (
    <div id={id} className="br-card p-3">
      <h3 id={`${id}-title`} className="text-base text-bold mt-0 mb-2">
        {t('notifications.catalog.newTitle')}
      </h3>
      <div id={`${id}-fields`} className="row">
        {(
          [
            ['slug', 'notifications.catalog.slug'],
            ['namePtBr', 'notifications.catalog.namePtBr'],
            ['nameEs', 'notifications.catalog.nameEs'],
            ['nameEn', 'notifications.catalog.nameEn'],
          ] as const
        ).map(([chave, rotulo]) => (
          <div id={`${id}-field-${chave}`} key={chave} className="col-sm-6 col-lg-3">
            <BrInput
              id={`${id}-field-${chave}-input`}
              label={t(rotulo)}
              value={campos[chave]}
              onChange={trocar(chave)}
            />
          </div>
        ))}
      </div>
      <div id={`${id}-actions`} className="d-flex justify-content-end mt-2">
        <BrButton
          id={`${id}-submit`}
          type="button"
          primary
          disabled={!preenchido || ocupado}
          onClick={() => {
            onSalvar({
              slug: campos.slug.trim(),
              namePtBr: campos.namePtBr.trim(),
              nameEs: campos.nameEs.trim(),
              nameEn: campos.nameEn.trim(),
            })
            setCampos({ slug: '', namePtBr: '', nameEs: '', nameEn: '' })
          }}
        >
          {t('notifications.catalog.add')}
        </BrButton>
      </div>
    </div>
  )
}

/** Textos padrão de uma categoria, com cadastro e exclusão. */
function Textos({ id, categoria }: { id: string; categoria: NotificationCategoryItem }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [campos, setCampos] = useState({ label: '', title: '', message: '' })
  const [aviso, setAviso] = useState<string | null>(null)

  const textos = useQuery(notificationTemplatesQuery(categoria.id))

  const recarregar = async () => {
    setAviso(null)
    await queryClient.invalidateQueries({ queryKey: ['notifications', 'templates'] })
  }
  const aoFalhar = (erro: unknown) =>
    setAviso(erro instanceof ApiError ? erro.detail : t('common.error'))

  const criar = useMutation({
    mutationFn: () =>
      apiPost('/notifications/templates/', {
        category: categoria.id,
        label: campos.label.trim(),
        title: campos.title.trim(),
        message: campos.message.trim(),
      }),
    onSuccess: async () => {
      setCampos({ label: '', title: '', message: '' })
      await recarregar()
    },
    onError: aoFalhar,
  })

  const excluir = useMutation({
    mutationFn: (templateId: number) => apiDelete(`/notifications/templates/${templateId}/`),
    onSuccess: recarregar,
    onError: aoFalhar,
  })

  const preenchido =
    campos.label.trim() !== '' && campos.title.trim() !== '' && campos.message.trim() !== ''

  return (
    <div id={id} className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
      {aviso ? (
        <p id={`${id}-warning`} role="alert" className="text-base text-red-vivid-50">
          {aviso}
        </p>
      ) : null}

      {textos.isPending ? <Loading id={`${id}-loading`} /> : null}

      {textos.data && textos.data.length > 0 ? (
        <ul id={`${id}-list`} className="plain-list d-flex flex-column gap-1 mb-3">
          {textos.data.map((modelo) => (
            <li
              id={`${id}-item-${modelo.id}`}
              key={modelo.id}
              className="d-flex align-items-start justify-content-between gap-2"
            >
              <span id={`${id}-item-${modelo.id}-text`}>
                <span id={`${id}-item-${modelo.id}-label`} className="text-semi-bold">
                  {modelo.label}
                </span>
                <span
                  id={`${id}-item-${modelo.id}-title`}
                  className="d-block text-down-01 text-gray-70"
                >
                  {modelo.title}
                </span>
              </span>
              <button
                id={`${id}-item-${modelo.id}-delete`}
                type="button"
                onClick={() => excluir.mutate(modelo.id)}
                disabled={excluir.isPending}
                title={t('notifications.catalog.deleteTemplate')}
                aria-label={t('notifications.catalog.deleteTemplateOne', { label: modelo.label })}
                className="br-button circle small"
              >
                <i className="fas fa-trash-alt" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : textos.data ? (
        <p id={`${id}-empty`} className="text-down-01 text-gray-70">
          {t('notifications.catalog.noTemplates')}
        </p>
      ) : null}

      <div id={`${id}-form`} className="d-flex flex-column gap-2">
        <BrInput
          id={`${id}-label`}
          label={t('notifications.catalog.templateLabel')}
          value={campos.label}
          onChange={(evento) => setCampos((a) => ({ ...a, label: evento.target.value }))}
        />
        <BrInput
          id={`${id}-title`}
          label={t('notifications.new.titleField')}
          value={campos.title}
          onChange={(evento) => setCampos((a) => ({ ...a, title: evento.target.value }))}
        />
        <div id={`${id}-message`} className="br-textarea">
          <label id={`${id}-message-label`} htmlFor={`${id}-message-input`}>
            {t('notifications.new.messageField')}
          </label>
          <textarea
            id={`${id}-message-input`}
            rows={4}
            maxLength={2000}
            value={campos.message}
            onChange={(evento) => setCampos((a) => ({ ...a, message: evento.target.value }))}
          />
        </div>
        <div id={`${id}-actions`} className="d-flex justify-content-end">
          <BrButton
            id={`${id}-submit`}
            type="button"
            secondary
            disabled={!preenchido || criar.isPending}
            onClick={() => criar.mutate()}
          >
            {t('notifications.catalog.addTemplate')}
          </BrButton>
        </div>
      </div>
    </div>
  )
}
