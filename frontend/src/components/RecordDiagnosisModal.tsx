import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Tag, ValidityBadge } from '@/components/Badges'
import { Empty, ErrorState, Loading } from '@/components/Feedback'
import { Modal } from '@/components/Modal'
import { RecordLinkButton } from '@/components/RecordLinkButton'
import { Tabs } from '@/components/Tabs'
import { ApiError } from '@/lib/api'
import { SEM_OCORRENCIA } from '@/lib/occurrences'
import { recordXmlQuery, rulesQuery } from '@/lib/queries'
import { indentarXml } from '@/lib/xml'
import type { RecordItem, Rule } from '@/lib/types'

/**
 * XML transformado do registro.
 *
 * Componente separado de propósito: as `Tabs` montam só o painel ativo, então a
 * consulta — uma ida ao Harvester por registro — só acontece quando alguém abre
 * esta aba.
 */
function AbaXml({
  id,
  snapshotId,
  identifier,
}: {
  id: string
  snapshotId: string
  identifier: string
}) {
  const { t } = useTranslation()
  const xml = useQuery(recordXmlQuery(snapshotId, identifier))
  const formatado = useMemo(() => (xml.data ? indentarXml(xml.data) : ''), [xml.data])

  if (xml.isPending) return <Loading id={`${id}-loading`} />

  if (xml.isError)
    // O Harvester responde 200 com uma mensagem de texto quando o relatório de
    // diagnóstico está desatualizado; o backend traduz isso em 404. Não é erro
    // do usuário nem falha de rede, e não há o que tentar de novo.
    return xml.error instanceof ApiError && xml.error.status === 404 ? (
      <p id={`${id}-unavailable`} className="text-gray-70 mb-0">
        {t('record.xmlUnavailable')}
      </p>
    ) : (
      <ErrorState id={`${id}-error`} error={xml.error} onRetry={() => void xml.refetch()} />
    )

  return (
    <pre
      id={`${id}-content`}
      className="text-down-01 mb-0"
      /*
       * A indentação é do conteúdo, a quebra é da caixa: um `<field>` com o
       * resumo inteiro dá mais de 3.500 caracteres numa linha, e sem `pre-wrap`
       * o documento todo passa a exigir rolagem horizontal por causa dele. O
       * `anywhere` cobre o valor longo sem espaço, que nem assim quebraria.
       */
      style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
    >
      <code id={`${id}-code`}>{formatado}</code>
    </pre>
  )
}

/**
 * Detalhes da validação de um registro, em duas abas.
 *
 * É o "Detalles de validación" da interface do Harvester, e como lá **a aba de
 * validação não custa requisição nenhuma**: a listagem de registros já traz,
 * em cada linha, `validRulesID`/`invalidRulesID` e as ocorrências indexadas por
 * regra. O que falta é só o nome, a obrigatoriedade e o quantificador de cada
 * regra, que vêm do diagnóstico da coleta — a mesma consulta que a tela de
 * diagnóstico já deixou em cache.
 *
 * As duas listas de regra não particionam o conjunto: uma regra pode constar
 * como atendida e ainda ter ocorrências inválidas registradas (é o caso das
 * condicionais), por isso cada bloco mostra as duas listas de ocorrências, como
 * a origem faz.
 */
export function RecordDiagnosisModal({
  id,
  aberto,
  onFechar,
  snapshotId,
  registro,
}: {
  id?: string
  aberto: boolean
  onFechar: () => void
  snapshotId: string
  registro: RecordItem
}) {
  const { t } = useTranslation()
  const [aba, setAba] = useState('validacao')
  const idBase = id ?? `record-diagnosis-modal-${registro.id}`

  const regras = useQuery({ ...rulesQuery(snapshotId), enabled: aberto })

  /** Os ids de regra chegam como string no registro e como número na regra. */
  const regraPorId = useMemo(() => {
    const mapa = new Map<string, Rule>()
    for (const regra of regras.data?.results ?? []) mapa.set(String(regra.ruleId), regra)
    return mapa
  }, [regras.data])

  const ocorrencias = (mapa: Record<string, string[]> | null | undefined, ruleId: string) =>
    mapa?.[ruleId] ?? []

  const linha = (id: string, valor: string, atende: boolean) => {
    const ausente = valor === SEM_OCORRENCIA
    return (
      <li id={id} key={id} className="d-flex py-1" style={{ gap: 'var(--spacing-scale-base)' }}>
        {/*
          O ícone distingue a ocorrência que atende da que viola, e o texto
          escondido diz o mesmo a quem usa leitor de tela — a forma e a cor não
          podem ser o único sinal.
        */}
        <span id={`${id}-marker`} className="flex-shrink-0">
          <i
            className={atende ? 'fas fa-check' : 'fas fa-exclamation-triangle'}
            style={{ color: atende ? 'var(--color-ok)' : 'var(--color-down)' }}
            aria-hidden="true"
          />
          <span className="sr-only">
            {atende ? t('recordDiagnosis.occurrenceValid') : t('recordDiagnosis.occurrenceInvalid')}
          </span>
        </span>
        <span
          id={`${id}-value`}
          className="text-down-01"
          title={ausente ? SEM_OCORRENCIA : undefined}
          style={{
            minWidth: 0,
            overflowWrap: 'anywhere',
            fontStyle: ausente ? 'italic' : undefined,
            color: ausente ? 'var(--color-content-muted)' : undefined,
          }}
        >
          {ausente ? t('diagnosis.occurrences.missing') : valor}
        </span>
      </li>
    )
  }

  const bloco = (ruleId: string, atende: boolean) => {
    const regra = regraPorId.get(ruleId)
    const idBloco = `${idBase}-rule-${ruleId}`
    const obrigatoria = regra?.mandatory ?? false
    /*
     * Regra descumprida e não obrigatória é atenção, não erro — a mesma
     * distinção que a origem faz (`alert-danger` contra `alert-warning`).
     */
    const tom = atende ? 'ok' : obrigatoria ? 'down' : 'warn'

    return (
      <section
        id={idBloco}
        key={ruleId}
        className="mb-2 p-3"
        style={{
          /*
           * O estado vem da barra lateral e da ficha, nunca do texto: sobre o
           * pastel da própria família as cores de estado dão 4,02 (sucesso) e
           * 3,69 (erro) como texto pequeno, abaixo dos 4,5 exigidos. O texto
           * fica na cor de Leitura, sobre a superfície alternativa.
           */
          background: 'var(--color-surface-muted)',
          borderInlineStart: `4px solid var(--color-${tom})`,
        }}
      >
        <div
          id={`${idBloco}-header`}
          className="d-flex flex-wrap align-items-baseline justify-content-between mb-1"
          style={{ gap: 'var(--spacing-scale-base)' }}
        >
          <h4 id={`${idBloco}-name`} className="text-down-01 text-bold mt-0 mb-0">
            <span id={`${idBloco}-id`} className="text-gray-70 mr-1">
              {ruleId}
            </span>
            {regra?.name ?? t('recordDiagnosis.unknownRule')}
          </h4>
          <Tag id={`${idBloco}-state`} tone={tom}>
            {atende ? t('recordDiagnosis.passes') : t('recordDiagnosis.fails')}
          </Tag>
        </div>

        {/*
          Obrigatoriedade e quantificador são atributos da regra, não estado
          deste registro — vão como texto na linha de metadado, e não em ficha
          colorida: em ficha, "Obrigatória" ao lado de "Atende" leria como um
          segundo estado, um deles em tom de alerta.
        */}
        <p id={`${idBloco}-meta`} className="text-down-02 text-gray-70 mt-0 mb-1">
          {obrigatoria ? t('recordDiagnosis.mandatory') : t('recordDiagnosis.optional')}
          {regra?.quantifier
            ? ` · ${t('recordDiagnosis.quantifier', { value: regra.quantifier })}`
            : ''}
        </p>

        <ul id={`${idBloco}-occurrences`} className="plain-list">
          {ocorrencias(registro.invalidOccurrencesByRuleID, ruleId).map((valor, indice) =>
            linha(`${idBloco}-invalid-${indice}`, valor, false),
          )}
          {ocorrencias(registro.validOccurrencesByRuleID, ruleId).map((valor, indice) =>
            linha(`${idBloco}-valid-${indice}`, valor, true),
          )}
        </ul>
      </section>
    )
  }

  /** Violações primeiro, e entre elas as obrigatórias — é o que se corrige antes. */
  const violadas = [...(registro.invalidRulesID ?? [])].sort((a, b) => {
    const pa = regraPorId.get(a)?.mandatory ? 0 : 1
    const pb = regraPorId.get(b)?.mandatory ? 0 : 1
    return pa - pb
  })
  const atendidas = registro.validRulesID ?? []

  /*
   * Os blocos esperam as regras, em vez de aparecerem antes delas.
   *
   * O registro traz os ids e as ocorrências, mas obrigatoriedade, nome e
   * quantificador vêm do diagnóstico da coleta. Renderizar antes disso não é só
   * incompleto, é errado: sem a regra em mão a obrigatoriedade sai como
   * "Opcional" e o tom cai para atenção — a regra 116 da coleta 108702, que é
   * obrigatória, apareceu assim em produção enquanto a consulta corria.
   */
  const validacao = regras.isPending ? (
    <Loading id={`${idBase}-rules-loading`} />
  ) : regras.isError ? (
    <ErrorState
      id={`${idBase}-rules-error`}
      error={regras.error}
      onRetry={() => void regras.refetch()}
    />
  ) : violadas.length === 0 && atendidas.length === 0 ? (
    <Empty id={`${idBase}-validation-empty`} label={t('recordDiagnosis.none')} />
  ) : (
    <div id={`${idBase}-validation`}>
      {violadas.map((ruleId) => bloco(ruleId, false))}
      {atendidas.map((ruleId) => bloco(ruleId, true))}
    </div>
  )

  return (
    <Modal
      id={idBase}
      aberto={aberto}
      onFechar={onFechar}
      tamanho="largo"
      titulo={t('recordDiagnosis.title')}
      descricao={registro.identifier}
    >
      <div
        id={`${idBase}-summary`}
        className="d-flex flex-wrap align-items-center mb-2"
        style={{ gap: 'var(--spacing-scale-2x)' }}
      >
        <ValidityBadge id={`${idBase}-validity`} valid={registro.isValid} />
        {/* Duas contagens, cada uma com sua flexão — `count` é uma por chamada. */}
        <span id={`${idBase}-counts`} className="text-down-01 text-gray-70">
          {`${t('recordDiagnosis.failsCount', { count: violadas.length })} · ${t(
            'recordDiagnosis.passesCount',
            { count: atendidas.length },
          )}`}
        </span>
        {/*
          O mesmo botão da página do registro. Aqui ele raramente custa
          requisição: o endereço costuma vir das ocorrências de `dc:identifier`
          que a própria linha da listagem carrega, e é só quando nenhuma delas é
          URL que a resolução no OAI-PMH da origem entra.
        */}
        <RecordLinkButton id={`${idBase}-link`} record={registro} />
      </div>

      <Tabs
        id={`${idBase}-tabs`}
        ativa={aba}
        onTrocar={setAba}
        abas={[
          {
            chave: 'validacao',
            rotulo: t('recordDiagnosis.tabs.validation'),
            conteudo: validacao,
          },
          {
            chave: 'xml',
            rotulo: t('recordDiagnosis.tabs.xml'),
            conteudo: (
              <AbaXml
                id={`${idBase}-xml`}
                snapshotId={snapshotId}
                identifier={registro.identifier}
              />
            ),
          },
        ]}
      />
    </Modal>
  )
}
