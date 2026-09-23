---
titulo: Resposta à revisão metodológica da subseção de dimensões de qualidade
responde_a: metodos-dimensoes.md
data: 2026-09-22
dataset: HB-EVIDENCE-2026-09-20-v1.0.0
---

# Resposta à revisão metodológica

Doze pontos levantados. **Sete exigem correção do texto ou do código**, quatro
são esclarecimentos que faltavam, e um não pôde ser reverificado. Abaixo, cada
um, com o que foi conferido no código ou nos dados.

Resumo do que muda:

| # | ponto | situação |
|---|---|---|
| 1 | datas de congelamento e coleta | esclarecimento |
| 2 | amostra máxima de 2.532 | **texto incorreto** |
| 3 | perda e transformação não definidas | **texto incorreto** |
| 4 | agregação registro → fonte | esclarecimento a incluir |
| 5 | campos multivalorados | **documentado no código** |
| 6 | universo e denominador da duplicação | **corrigido no código** |
| 7 | registros excluídos na duplicação | **texto incorreto** |
| 8 | latência | **texto incorreto** |
| 9 | normalização e consistência como métricas | **resolvido: declaradas descritivas** |
| 10 | "limite superior da qualidade" | **reformulação aceita** |
| 11 | ausência integral do SciELO | causa determinada |
| 12 | desenho da verificação de não-resposta | **número removido do artigo** |

---

## 1. Data de congelamento × data de coleta — *esclarecimento*

São de fato duas datas, e o texto não explicitava a diferença.

**20/09/2026** é a data de referência do conjunto: é contra ela que se calcula
`days_since_last_harvest` e é a ela que se reportam os estados operacionais
(cadastro, último snapshot, situação no índice), todos oriundos da base do
agregador.

**21/09/2026** é a data em que os provedores foram contactados para a coleta de
registros. Essa camada é posterior e independente: ela não consulta o agregador,
mas as origens.

A versão do conjunto leva a data de referência, não a da última coleta, porque é
a data de referência que define o recorte temporal de todas as variáveis
operacionais. Frase a acrescentar em 3.x.1:

> A data de referência do conjunto (20/09/2026) é a do estado operacional
> registrado no agregador, contra a qual se calculam os intervalos temporais. A
> coleta de registros junto aos provedores ocorreu no dia seguinte, 21/09/2026,
> e constitui camada independente.

## 2. Amostra máxima de 2.532 registros — *o texto está incorreto*

A dúvida procede e a hipótese do revisor está certa. **Não houve seguimento de
`resumptionToken`**; o que ocorre é que o tamanho da página é definido pelo
provedor e nem todos usam 100.

Verificado: **11 fontes retornaram mais de 100 registros numa única resposta.**
A maior é a Biblioteca Digital de Teses e Dissertações da FURB, com 2.532
registros em `xoai`, seguida do Repositório do A.C.Camargo Cancer Center, com
1.134. A mediana é exatamente 100 e o mínimo é 1.

O texto dizia "resultando em até 100 registros por fonte", o que é falso.
Substituir por:

> O tamanho da página é definido pelo provedor e não foi negociado. A mediana
> resultante é de 100 registros por fonte; 11 fontes retornaram mais, com máximo
> de 2.532, por servirem páginas maiores.

## 3. Perda e transformação — *o texto está incorreto*

Procedente. Foram anunciadas sete dimensões e operacionalizadas cinco. **Perda e
transformação não pertencem a esta camada**: elas são medidas no nível da coleta,
a partir de `size`, `valid_size` e `transformed_size` do agregador, e não do
registro.

A frase de abertura de 3.x.1 confunde as duas coisas ao listar as sete como se
todas fossem medidas aqui. Correção: anunciar cinco dimensões nesta subseção e
remeter as outras duas à subseção da camada de coleta.

Vale notar que perda e transformação, medidas daquele modo, são grandezas de
volume e não de conteúdo: dizem quantos registros foram rejeitados ou
convertidos, não o que foi perdido em cada um. Essa limitação pertence à outra
subseção, mas convém que o artigo a declare em algum lugar.

## 4. Agregação de registro para fonte — *esclarecimento a incluir*

A suposição do revisor está correta, e a frase faltava.

- **Completude da fonte** = média aritmética do número de elementos Dublin Core
  presentes nos registros vivos da fonte, dividida por quinze.
- **Conformidade da fonte** = média dos quatro critérios, cada um calculado como
  a proporção de registros vivos da fonte que o satisfazem.

As duas formulações de conformidade — média das proporções dos quatro critérios,
ou média das conformidades por registro — são algebricamente idênticas, já que o
denominador é o mesmo em todos. Em ambos os casos o cálculo se apoia apenas nos
registros vivos.

## 5. Campos multivalorados — *lacuna real, e a regra é assimétrica*

Este é o ponto mais importante da revisão, porque expõe uma decisão que existe
no código e nunca foi escrita. **A regra não é uniforme entre os quatro
critérios:**

| critério | regra | efeito |
|---|---|---|
| `dc:type` | **qualquer** valor conforme basta | 1 se ao menos um começa por `info:eu-repo/semantics/` |
| `dc:rights` | **qualquer** valor conforme basta | 1 se ao menos um é `info:eu-repo/semantics/*Access` |
| `dc:language` | **todos** devem conformar | 1 apenas se todos casam ISO 639 |
| `dc:date` | **todos** devem conformar | 1 apenas se todos casam ISO 8601 |

A assimetria tem justificativa, mas ela era implícita e precisa ser declarada:

`dc:type` e `dc:rights` são **aditivos** — o repositório legitimamente emite o
termo controlado *e* um rótulo livre ao lado. Medição própria confirma: em 70,9%
dos registros em que aparece texto livre em `dc:type`, o termo `info:eu-repo`
está presente no mesmo registro. Exigir conformidade de todos os valores
penalizaria justamente o comportamento correto.

`dc:language` e `dc:date` são **enumerativos** — cada valor é uma asserção
independente, e uma data malformada é um defeito, ainda que outras estejam
corretas.

Recomendo incluir a tabela acima no texto. Um revisor que assuma regra uniforme
não reproduzirá os números.

## 6. Universo e denominador da duplicação — *texto incompleto, e há inconsistência*

Duas medidas distintas existem e o texto tratava só de uma.

**Intrafonte** (`duplicate_titles`): número de ocorrências de um hash de título
que já apareceu antes na mesma fonte — isto é, repetições além da primeira, e
não pares. Calculado apenas sobre registros vivos com título de sete palavras ou
mais.

**Entre fontes** (view `v_duplicata`): hashes de título que aparecem em mais de
uma fonte, sob o mesmo corte de sete palavras. O texto omitia essa medida.

**Inconsistência — corrigida em 22/09/2026.** A taxa de duplicação usava
`duplicate_titles / records_sampled`, com numerador restrito a registros vivos e
elegíveis e denominador contando todos os amostrados. O denominador passou a ser
`titles_eligible`: registros vivos com título de sete palavras ou mais.

Ao medir o efeito, verificou-se que a causa principal **não** é a que se supunha.
Registros excluídos contribuem, mas o que mais move o denominador é a guarda de
sete palavras: a mediana cai de 100 para 83 registros elegíveis, e em fontes como
*Comunicação & Educação*, com zero registros excluídos, de 100 para 37 — quase
dois terços da página são rótulos de seção.

Efeito nos números: a taxa mediana de duplicação permanece zero; a média sobe de
0,00303 para 0,00372, cerca de 23%. O caso extremo vai de 0,66 para 0,795. Uma
fonte fica sem título elegível algum e passa a ter taxa indefinida, o que é
correto — não se pode medir duplicação onde não há título comparável. **Nenhuma
conclusão publicada muda**, porque nenhuma delas se apoiava na magnitude dessa
taxa.

## 7. Registros excluídos na duplicação — *o texto está incorreto*

O revisor está certo, e a verificação confirma sem margem: **todos os 10.769
registros marcados como excluídos têm `title_hash` vazio e zero elementos Dublin
Core presentes.** Registro excluído em OAI-PMH traz apenas cabeçalho, sem bloco
de metadados, exatamente como o revisor supôs.

Portanto eles **não participam da duplicação**, e a frase do texto está errada.
Eles são contabilizados apenas para caracterizar a amostra — quantos registros
da página são lápides — e para o achado de que 48 fontes devolveram páginas
integralmente compostas deles.

Redação corrigida:

> Registros marcados como excluídos no cabeçalho OAI (10.769, ou 7,0% da
> amostra) não trazem bloco de metadados e, por isso, foram excluídos de todas as
> medidas de conteúdo. Eles são computados apenas na caracterização da amostra.

## 8. Latência — *o texto está incorreto*

Procedente, e mais grave do que parece: **latência não é medida em lugar nenhum
deste trabalho.** Ela aparecia na frase sobre registros excluídos por resíduo de
uma versão anterior do texto, e deve simplesmente sair.

A razão de não ser medida merece registro, porque é instrutiva. O `datestamp`
do OAI-PMH é a data da última alteração do registro no repositório, não a de
publicação; e `dc:date`, que traz a data de publicação, produz uma medida
espúria quando confrontado com a primeira coleta — mediana de 2.943 dias, que é
a idade do acervo retroativo no momento em que a fonte entrou no agregador, não
atraso de disponibilização. Apenas 35 fontes têm registros publicados após a
própria primeira coleta. Medir latência exigiria coleta por janela temporal.

## 9. Normalização e consistência como métricas — *resolvido*

O revisor identifica corretamente que essas duas não produzem um número por
fonte comparável aos demais. **Decisão tomada em 22/09/2026: elas passam a ser
declaradas explicitamente como análises descritivas**, e não como indicadores.

A subseção 3.x.3 foi reorganizada em dois grupos de estatuto distinto:

**Indicadores** — completude, conformidade e duplicação. Grandezas em escala
0–1, definidas por registro, agregadas por fonte, comparáveis entre fontes e
passíveis de entrar em teste estatístico.

**Análises descritivas** — consistência e normalização. Caracterizam padrões
observados sem produzir índice comparável, e não devem ser lidas como escores.

A razão de não forçar uma fórmula em cada uma é substantiva, não de conveniência:

- **Consistência** produz `off_schema_records`, contagem absoluta de registros
  com elemento alheio ao esquema. Um índice por fonte seria trivial de derivar,
  mas separaria apenas oito casos de mil e quinhentos zeros — o fenômeno é
  integralmente concentrado, com 8 fontes afetadas e 100% dos registros em cada
  uma. A informação útil é *quais* fontes, não *quanto*.
- **Normalização** descreve a distribuição dos valores em campos de vocabulário
  controlado. Uma medida de dispersão — entropia, número de grafias distintas —
  seria calculável, mas a informação que importa é *quais* grafias circulam e em
  quantas fontes. Que o português apareça como `por`, `pt_BR`, `pt` e `Português`
  é um achado acionável; um índice de 0,73 de dispersão não é.

Consequência para o artigo: ao reportar resultados, apenas os três indicadores
admitem comparação entre fontes, ordenação ou teste. As duas descritivas entram
como caracterização, e o texto não deve chamá-las de dimensões medidas no mesmo
sentido das outras.

## 10. "Limite superior da qualidade" — *reformulação aceita*

A crítica é correta e a formulação proposta é melhor. O que os dados sustentam é
que a amostra é enviesada em favor de fontes **operacionalmente acessíveis**;
inferir daí que os metadados ausentes seriam de pior qualidade é um passo não
demonstrado.

Adotar a redação sugerida:

> A amostra é enviesada em favor de fontes operacionalmente acessíveis;
> portanto, as estimativas agregadas de qualidade podem ser otimistas em relação
> ao universo completo.

Acrescento um dado que torna a ressalva ainda mais necessária, e que vai na
direção contrária da intuição: entre as fontes **presentes** na amostra, as que
estão há mais de um ano sem coleta têm completude mediana ligeiramente **maior**
(0,811) que as coletadas no último ano (0,797). A associação entre abandono
operacional e qualidade de metadado, portanto, não só não está demonstrada como
tem sinal contrário no subconjunto observável.

## 11. Ausência integral do SciELO — *causa determinada*

A causa é conhecida e pode ser declarada. Os desfechos das 215 fontes:

- **212 retornaram HTTP 403** ao endpoint `https://old.scielo.br/oai/scielo-oai.php`
- **3 retornaram HTTP 404** ao endpoint `www.scielo.br/oai/scielo-oai.php`

Não é característica da plataforma nem ausência de `oai_dc`: é **endpoint de
agregador desativado e cadastrado no lugar do endpoint próprio de cada
periódico**. As 215 fontes compartilham dois endereços, ambos fora de serviço.
Trata-se de defeito de cadastro, e o mesmo defeito explica a concentração de
falhas de coleta nesse grupo.

Frase sugerida:

> As 215 fontes servidas pela plataforma SciELO estão integralmente ausentes por
> causa determinada: 212 têm cadastrado o endpoint agregador `old.scielo.br`, que
> responde HTTP 403, e 3 apontam para `www.scielo.br`, que responde 404. Nenhuma
> possui endpoint próprio registrado.

## 12. Desenho da verificação de não-resposta — *número removido*

O desenho **está** documentado e pode ser descrito: origens que não responderam
ao verbo `Identify` foram reconsultadas com `ListIdentifiers`, em série e com
prazo folgado, para testar se a não-resposta era da origem ou da pressa do
cliente. A lógica declarada era: quem responde aos dois verbos sofreu falha
transitória; quem responde só ao segundo é mensurável embora não classificável;
quem não responde a nenhum está de fato fora do ar.

O **número** 91/106, porém, não é reverificável. Ele provém de execução anterior
ao congelamento, cuja saída não integra o pacote publicado — o arquivo preservado
registra 142 fontes, recorte distinto. E há indício de que o número vinha sendo
reaproveitado sem lastro: ele aparecia em dois comentários do código atribuído a
populações diferentes, "origens mudas" num e "origens sem cadastro" no outro.

**Decisão: o número foi removido** do texto do artigo e dos dois comentários de
código, em 22/09/2026. Mantém-se o argumento de desenho, que se sustenta sem
ele: sob concorrência alta e prazo curto, tempo esgotado do lado do cliente é
registrado como não-resposta da origem, e entra na análise como se fosse
propriedade da fonte. Quem quiser o número deverá reexecutar `verificar_mudas.py`
e incluir a saída no pacote — o que exige suspender a restrição de não realizar
novas coletas.

## Correções aplicadas no código — 22/09/2026

Os dois defeitos apontados pela revisão foram corrigidos:

1. **Denominador da taxa de duplicação** (ponto 6) — `record_metrics` ganhou a
   coluna `titles_eligible`, e `v_dimensao.taxa_duplicacao` passou a usá-la. O
   efeito medido está descrito no ponto 6.
2. **Regra de multivalorados** (ponto 5) — a assimetria está agora documentada
   em `congelar.py`, junto ao cálculo, com a justificativa e a advertência de
   que assumir regra uniforme não reproduz os números.

O conjunto foi regerado e as somas SHA-256 refletem a nova versão. As fichas de
hipótese foram recalculadas; nenhuma mudou de veredito.
