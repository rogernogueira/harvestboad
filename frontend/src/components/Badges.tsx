import { BrTag } from '@govbr-ds/react-components'
import { useTranslation } from 'react-i18next'

import { harvestTone } from '@/lib/harvestStatus'

/**
 * Rótulos curtos para os estados de coleta.
 *
 * A origem devolve valores como `HARVESTING_FINISHED_ERROR` — 25 caracteres sem
 * espaço, que numa coluna estreita não quebram e transbordam a célula, gerando
 * barra de rolagem na tabela inteira. A interface do próprio Harvester faz a
 * mesma redução (o filtro `ShortenStatus` dela).
 *
 * O valor bruto continua acessível no `title`.
 */
const ROTULOS: Record<string, string> = {
  VALID: 'harvestStatus.valid',
  HARVESTING: 'harvestStatus.running',
  HARVESTING_FINISHED_VALID: 'harvestStatus.finishedValid',
  HARVESTING_FINISHED_ERROR: 'harvestStatus.finishedError',
  HARVESTING_STOPPED: 'harvestStatus.stopped',
  HARVESTING_ERROR: 'harvestStatus.error',
  INDEXED: 'harvestStatus.indexed',
}

const CORES = {
  ok: 'success',
  warn: 'warning',
  down: 'danger',
} as const

/*
 * Correção de contraste no tom de atenção.
 *
 * Aqui o design system reprova no critério dele mesmo. O `.br-tag` pinta o
 * texto de branco (`--color-dark`) sobre a cor do estado; o padrão adota AA,
 * que exige 4,5:1 para texto normal. Medido sobre cada cor de Alerta:
 *
 *   sucesso #168821 → 4,59   erro #e52207 → 4,60   alerta #ffcd07 → **1,50**
 *
 * O amarelo reprova por larga margem. O texto passa então para `--gray-80`, a
 * cor principal da função Leitura, que sobre aquele amarelo dá 8,42.
 *
 * Vai em `style` porque é exceção de um tom só — virar regra global
 * sobrescreveria as tags de atenção de qualquer tela futura sem que se veja
 * o porquê aqui.
 */
const CORRECAO_DE_TEXTO = {
  ok: undefined,
  warn: { color: 'var(--gray-80)' },
  down: undefined,
} as const

/**
 * Marcador de estado.
 *
 * Usa o `BrTag` do design system no tipo `text`, e não no tipo `status`: este
 * último renderiza um círculo sem rótulo (`border-radius: 50%`, `padding: 0`),
 * o que faria da cor o único sinal do estado. Aqui o texto sempre nomeia o
 * estado, e a cor só reforça.
 *
 * O `span` externo existe porque o `BrTag` não aceita `id` nem `title`: o `id`
 * é exigência da convenção do projeto — o componente se repete uma vez por
 * linha de tabela — e o `title` carrega o valor bruto vindo da origem.
 */
export function Tag({
  id = 'tag',
  tone,
  title,
  size = 'small',
  children,
}: {
  id?: string
  tone: keyof typeof CORES
  title?: string
  /** `medium` para quando a ficha está no lugar de um número em destaque. */
  size?: 'small' | 'medium' | 'large'
  children: string
}) {
  return (
    <span id={id} title={title} className="d-inline-flex">
      {/* O texto vai por `value`: o BrTag não recebe filhos. */}
      <BrTag
        type="text"
        size={size}
        color={CORES[tone]}
        value={children}
        style={CORRECAO_DE_TEXTO[tone]}
      />
    </span>
  )
}

export function HarvestStatusBadge({
  id = 'harvest-status-badge',
  status,
}: {
  id?: string
  status: string
}) {
  const { t } = useTranslation()
  const chave = ROTULOS[status.toUpperCase()]

  return (
    <Tag id={id} tone={harvestTone(status)} title={status}>
      {chave ? t(chave) : status}
    </Tag>
  )
}

export function ValidityBadge({
  id = 'validity-badge',
  valid,
}: {
  id?: string
  valid: boolean | null | undefined
}) {
  const { t } = useTranslation()
  if (valid === null || valid === undefined)
    return (
      <span id={id} className="text-gray-70">
        —
      </span>
    )
  return (
    <Tag id={id} tone={valid ? 'ok' : 'down'}>
      {valid ? t('records.valid') : t('records.invalid')}
    </Tag>
  )
}
