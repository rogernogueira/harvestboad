# Base 1 — observações de fontes

Uma linha por **observação de fonte**, não por fonte: a mesma fonte observada
em duas datas dá duas linhas, com `source_id` igual e `source_observation_id`
diferente. É o que permite ver migração de plataforma e mortalidade de fonte
sem reconstruir nada depois.

São **duas** bases, porque o dicionário pede duas:
`classification_evidence_id` é chave estrangeira obrigatória em toda
observação, e sem a tabela do outro lado ela aponta para o nada.

```
base_fontes.py            o dicionário de dados como código executável
criar.py                  materializa a base vazia e publica o dicionário
gerar.py                  preenche as duas bases com tudo o que foi apurado
instituicoes.py           natureza da instituição (CV01) a partir do nome
sondas.py                 catálogo de sinais de plataforma e o classificador
coletar_sondas.py         roda as quatro sondas de rede contra cada fonte
validar_sondas.py         mede se os pesos acertam, e propõe os corrigidos
coletar_identify.py       pergunta `Identify` a cada origem e guarda a resposta
coletar_cadastro.py       lê o cadastro cru do Harvester (roda no container)
rodar_cadastro.py         copia o anterior para dentro do container e traz o JSON
data/base-fontes.csv      Base 1 — 2.183 observações × 36 campos
data/base-evidencias.csv  um sinal lido por linha — 3.456 × 12
data/instituicoes.csv     natureza de cada instituição (CV01), com a evidência
data/identify.json        a resposta de `Identify` de 2.178 origens perguntadas
data/identify-respostas.json.gz   as respostas cruas, que o SHA-256 fingerprinta
data/cadastro.json        o cadastro cru do Harvester, 2.182 repositórios
data/sondas.json          o que as quatro sondas de rede trouxeram de 2.178 fontes
data/dicionario.csv       um campo por linha: tipo, obrigatoriedade, condição
data/vocabularios.csv     um termo por linha: 98 códigos em 13 vocabulários
```

A base de evidências não veio do dicionário — ele só declara a chave. É
**uma linha por sinal lido**, não por observação: o `Identify` de uma origem
traz até três — o `<toolkit>` em que o software se declara, a forma do
`<sampleIdentifier>` e o `<repositoryName>`. O classificador parava no
primeiro que decidisse, mas guardou os três, então cada um vira uma evidência
com o que ele **sozinho** sustenta.

É o que torna `MULTIPLE_EVIDENCE` verificável: "duas ou mais evidências
concordantes" deixa de ser um rótulo que alguém digita e passa a ser uma
contagem de linhas. Numa base 1:1 o código existiria no vocabulário sem que
nada pudesse comprová-lo — e as colunas de método e confiança seriam cópia do
que a Base 1 já diz.

```
1 evidência   912 observações
2 evidências 1.269
3 evidências     2
```

`decisive` marca a evidência para a qual a chave estrangeira da Base 1 aponta
— a mais forte entre as concordantes. As demais ficam ao lado, disponíveis
para quem quiser reclassificar sem voltar às origens: se amanhã o `<toolkit>`
passar a valer `HIGH` em vez de `CONFIRMED`, é reprocessar esta base.

Os dois últimos são **gerados** de `base_fontes.py`. Editar o CSV à mão é
perder a edição na próxima execução de `criar.py`; a fonte da verdade é o
módulo.

## Uso

O ambiente é o `.venv` de `experiment/`, um nível acima — é lá que vivem
pandas e o Jupyter, e é o interpretador dele que todos os comandos usam. Os
caminhos abaixo são relativos a `experiment/`:

```bash
.venv/bin/python exp1/gerar.py             # gera as duas bases a partir do quadro do experimento
.venv/bin/python exp1/gerar.py --conferir  # gera em memória e só relata

.venv/bin/python exp1/criar.py             # cria o que falta (não sobrescreve base com linhas)
.venv/bin/python exp1/criar.py --conferir  # confere a base existente; sai 1 se houver problema
.venv/bin/python exp1/base_fontes.py       # teste de fumaça, com três observações de exemplo

.venv/bin/ipython                          # exploração
.venv/bin/jupyter lab                      # ou no caderno
```

```python
import sys; sys.path.insert(0, "exp1")
from base_fontes import ler, gravar, montar, conferir, observacao, resumo

base = ler()                                  # data/base-fontes.csv, já retipado
nova = observacao(source_id="OASIS-000126", ...)
base = montar([*base.to_dict("records"), nova])
print(resumo(conferir(base)))
gravar(base)
```

## Por que as coisas estão como estão

**`category` engole erro de digitação.** `astype(CategoricalDtype([...]))`
transforma todo valor fora do vocabulário em `NaN`, calado: `ACTIVO` some sem
aviso e a contagem por situação fecha errado. Por isso `montar()` confere antes
de tipar e levanta exceção — `estrito=False` desliga, para quando o objetivo é
justamente inspecionar o lixo.

**`NaN` não significa desconhecido.** Campo obrigatório de vocabulário sem
valor vira `UNKNOWN`; `NaN` fica reservado para *não se aplica* — condicional
cuja condição não valeu. Misturar os dois apaga a diferença entre "não sei" e
"não cabe", que é exatamente a que o CV02 precisa preservar para analisar viés
de sobrevivência.

**`platform_analysis_group` é derivado, nunca digitado.** É o campo que entra
nas hipóteses; preenchido à mão, uma fonte `TEDE2` fora do estrato `DSPACE`
passaria sem nada acusar. Sai de `platform_product` em `normalizar()`, e
`conferir()` denuncia divergência. A regra SEER → OJS mora no mesmo lugar: o
nome bruto fica em `platform_name_raw` e nenhum software é duplicado.

**`platform_confidence` é o único vocabulário ordenado**, declarado do mais
fraco para o mais forte. É o que faz `base.platform_confidence >= "HIGH"`
funcionar como filtro de análise de sensibilidade em vez de exigir lista de
códigos em toda consulta. Os outros doze são nominais — ordená-los inventaria
hierarquia onde não há.

**CSV e não parquet**, mesmo com `pyarrow` instalado. Esta base é preenchida e
revista à mão e vive no git: o CSV dá diff legível e abre em planilha. O que
ele perde — vocabulário, fuso, a ordenação de `platform_confidence` — `ler()`
devolve ao repassar por `montar()`, então a escolha custa tempo de leitura, não
informação: texto não é a base.

Para exportar, `gravar(base, "exp1/data/base-fontes.parquet")` preserva os três
sem precisar de `montar()`. A conta de tamanho só fecha com volume, porém: com
três observações são 27 KB de parquet contra 655 B de CSV, porque os 13
dicionários de vocabulário e as 36 colunas de esquema dominam o arquivo. A
relação se inverte na casa dos milhares de linhas — que é onde esta base vai
chegar.

## De onde veio cada campo

**A espinha é o índice inteiro** — `indice-repositorios.json`, 2.183
repositórios do cadastro —, e não o quadro amostral. O quadro é subconjunto
estrito dele (as 1.596 que chegaram a ser indexadas) e entra por junção à
esquerda, trazendo o que só ele tem: `baseUrl`, classificação tecnológica e a
reverificação das origens mudas. `nome` e `instituicao` conferem nas duas
origens em todas as 1.596, então o índice manda nesses campos — é ele quem
cobre a base inteira.

Ficar só nas 1.596 faria a base descrever apenas as fontes que deram certo,
que é exatamente o viés de sobrevivência que o CV02 foi desenhado para deixar
visível.

| Campo da base | Vem de | Como |
|---|---|---|
| `source_id` | `harvesterRepositoryId` | o identificador permanente que temos |
| `oasisbr_source_id` | `acronym` | como o Oasisbr chama a fonte: `ABCLIMA-1` |
| `institution_acronym` | `institutionAcronym` | **não** `acronym`: aquele nomeia a fonte, este a instituição, e diferem em 1.944 das 2.183 |
| `observed_at` | carimbo do JSON de origem | `reclassificadoEm` para as 1.596, `exportadoEm` para as 587 — são dois momentos diferentes |
| `platform_product` | `tipo` | `omp`/`ops` viram `OTHER_IDENTIFIED` — e têm `platform_name_raw` |
| `platform_detection_method`, `platform_confidence` | `evidencia` | ver a tabela abaixo |
| `source_type_macro`, `source_type_detail` | `natureza` | `ops` é corrigido para `PREPRINT_SERVER` |
| `source_status` | `tipo`, reverificação, `lastSnapshotStatus` | ter tipo já prova que a origem respondeu; sem tipo, vale a última coleta |
| `source_url` | `baseUrl` | **deduzido**: tira a cauda OAI do endpoint |
| `metadata_profile` | `metadataPrefix` | `mtd2-br` → `BDTD`, `xoai` → `XOAI` |

Cada sinal, sozinho, sustenta isto — e as tabelas de reconhecimento são
importadas de `classificar_quadro.py`, não copiadas, para que a evidência
registrada não possa divergir da classificação que o experimento produziu:

| Regra | Elemento | CV07 | CV08 | Por quê |
|---|---|---|---|---|
| `toolkit` | `<toolkit>` | `OAI_IDENTIFY` | `CONFIRMED` | o software se declara: `Open Journal Systems` |
| `sampleIdentifier` | `<sampleIdentifier>` | `OAI_DESCRIPTION` | `MEDIUM` | a forma do identificador, não uma declaração |
| `forma-handle` | `<sampleIdentifier>` | `OAI_DESCRIPTION` | `LOW` | o padrão mais frouxo dos dois — gerou 66 indeterminados |
| `repositoryName` | `<repositoryName>` | `OAI_IDENTIFY` | `LOW` | o nome dizendo "DSpace at IFRS": inferência indireta |
| `nenhuma` | — | `UNKNOWN` | `UNKNOWN` | nenhum sinal conclusivo; existe para a chave resolver |

A conclusão da Base 1 sai daí por três regras, nesta ordem: **a mais forte
manda**; **concordância promove** — dois sinais independentes apontando o
mesmo produto valem `MULTIPLE_EVIDENCE`/`HIGH`, a não ser que um já seja
`CONFIRMED`, que é mais forte e não se perde por companhia; **discordância
não promove e fica registrada**, em `notes` da evidência decisiva.

Deu 13 observações com `MULTIPLE_EVIDENCE` e 5 com sinais discordantes. O
produto derivado das evidências é conferido contra o `tipo` do classificador
em toda linha — divergir ali significa que uma das duas leituras está errada,
e o gerador para em vez de publicar as duas.

**Os identificadores são determinísticos** (`uuid5` sobre `source_id` e o
carimbo). Regerar não muda um byte, e a chave estrangeira entre as duas bases
sobrevive à regeração — com `uuid4` cada execução produziria uma base
inteiramente nova e o diff no git não diria nada.

## O que ainda é suposição

O dicionário marca 14 campos como condicionais sem dizer a condição. Elas estão
em `CONDICOES`, explícitas e num lugar só:

| Campo | Exigido quando |
|---|---|
| `oasisbr_source_id` | `source_status` não é `REMOVED_FROM_OASISBR` nem `UNKNOWN` |
| `platform_name_raw` | `platform_product` é `OTHER_IDENTIFIED` ou `CUSTOM` |
| `oai_*`, `harvest_metadata_prefix`, `metadata_profile` | `harvest_protocol == 'OAI_PMH'` **e** a fonte respondeu ao `Identify` |

A segunda metade da última regra não veio do dicionário: cobrar
`earliest_datestamp` de fonte `TEMPORARILY_UNAVAILABLE` é cobrar do dado o que
faltou na origem.

`MACRO_POR_DETALHE` enquadra os nove tipos CV04 nos quatro macros CV03. Cinco
deles — monografias, conferência, portal agregador, portal de livros e
preprints — caem em `OTHER_SCIENTIFIC_SOURCE`, o valor operacional criado
justamente para não forçá-los numa das quatro categorias oficiais.

## O que a geração não pôde preencher

**29 apontamentos**, de 6.755 antes das duas coletas. Oito origens respondem
`Identify` sem `repositoryName`; duas respondem com o envelope vazio; cinco
repositórios não têm endereço em lugar nenhum; uma não tem cadastro. E dois
são defeito do cadastro de origem — `institution_acronym` trazendo "Instituto
Brasileiro de Direito Civil" e "Universidade Federal de Sergipe" por extenso,
estourando o `VARCHAR(30)`. A base os registra em vez de escondê-los.

Os campos que continuam parcialmente vazios são todos a mesma coisa vista de
ângulos diferentes: **506 origens não responderam** (403, rede, XML quebrado),
e sem resposta não há `Identify`. São 513 linhas sem os quatro campos do
protocolo, 511 sem hash, 683 sem versão de plataforma.

Sobra **uma** lacuna de 100%, e é a única que não tem conserto: `notes` é
texto livre, e não há o que dizer.

Duas limitações que nenhuma verificação aponta, porque a base está coerente —
só não está completa:

- **291 observações seguem com plataforma `UNKNOWN`** — quase todas origens
  que não respondem a sonda nenhuma. O cadastro traz `attributes.software`
  ("SEER/OJS"), que é evidência nova e caberia na base de evidências como um
  sinal a mais.

## `institution_type`: derivado do nome, com o rastro ao lado

O campo estava `UNKNOWN` nas 2.183. `instituicoes.py` o deriva do nome da
instituição e grava `data/instituicoes.csv`, uma linha por instituição
distinta (755), com **por qual caminho** cada decisão saiu:

| método | instituições | observações | o que significa |
|---|---|---|---|
| `padrao` | 717 | 1.977 | o nome diz; a `evidencia` é o padrão que casou |
| `web` | 24 | 192 | o nome não resolve; a `evidencia` é a fonte consultada |
| `conhecimento` | 14 | 14 | enquadramento de cadastro, **sem** busca — marcado para não se confundir com o anterior |

Resultado: `FEDERAL_UNIVERSITY` 690, `PRIVATE_UNIVERSITY` 461,
`STATE_UNIVERSITY` 397, `SCIENTIFIC_SOCIETY` 320, `GOVERNMENT_AGENCY` 82,
`OTHER` 79, `RESEARCH_INSTITUTE` 61, `FEDERAL_INSTITUTE` 57, `PUBLISHER` 19,
`MUNICIPAL_UNIVERSITY` 13, `LIBRARY` 4. Nenhum `UNKNOWN`.

**A ordem das regras é o ponto perigoso.** `universidade` sozinho cai em
`PRIVATE_UNIVERSITY`, porque a universidade pública brasileira em regra carrega
"Federal", "Estadual", "do Estado" ou "Municipal" no nome. As que não carregam
estão em `EXCECOES`, e foram conferidas uma a uma: a USP é autarquia
**estadual**, a UnB é federal, a FURB e a UNITAU são **municipais**, a URCA, a
UPE e a UNITINS são estaduais, a UNILAB é federal. Sem essas onze exceções,
309 observações de universidade pública sairiam como privadas.

O `metodo` existe para que ninguém trate as três coisas como a mesma. Um
`padrao` é palpite sobre o nome; um `web` foi conferido; um `conhecimento` é
enquadramento que ninguém verificou. Misturá-los apagaria justamente a
distinção que torna a inferência publicável.

## `harvest_scope` e os campos do `Identify`

Os dois pedidos caíram em duas coletas diferentes, porque as respostas estão
em dois lugares que nem sempre se alcançam do mesmo shell.

**O `Identify`, nas origens.** `coletar_identify.py` pergunta a cada endpoint e
guarda os sete campos que saem da mesma resposta — `protocolVersion`,
`earliestDatestamp`, `deletedRecord`, `granularity`, `repositoryName`, a versão
do `<toolkit>` e o SHA-256. De 2.178 endereços, 1.672 responderam. Os valores
vieram 100% conformes ao vocabulário, sem nenhuma correção: `deletedRecord` só
com `persistent`, `transient` e `no`; `granularity` só com os dois literais do
protocolo.

As respostas cruas ficam em `identify-respostas.json.gz` (141 KB). Sem elas o
`identify_sha256` seria hash de bytes que ninguém guardou, e o dicionário fala
em "hash da resposta **preservada**". O hash muda a cada pergunta, porque o
envelope traz `<responseDate>`: ele identifica **aquela** resposta, não um
conteúdo estável da origem.

**O escopo, no cadastro do Harvester.** `coletar_cadastro.py` roda dentro do
`harvestboard_api`, que é quem alcança `200.130.0.61:8090`. O campo `sets` do
cadastro responde direto o que o CV10 pergunta:

```
ALL_RECORDS     1.959      SINGLE_SET  219
MULTIPLE_SETS       4      UNKNOWN       1
```

**223 fontes não são coletadas inteiras** — a pergunta que o dicionário marcava
como cientificamente relevante, respondida. Os `setSpec` são ISSNs, padrão
SciELO.

### Três efeitos que a coleta impôs

- **`observed_at` mudou** para as origens perguntadas. Perguntar `Identify`
  **é** observar a fonte, e é a apuração mais recente que a linha tem. Manter o
  carimbo antigo diria que a política de exclusão publicada foi vista às 17h49,
  quando foi vista às 20h01. Os identificadores derivam do carimbo e mudaram
  junto — determinísticos como sempre.
- **`source_status` é recalculado pela pergunta mais recente.** Sem isso a base
  poderia dizer `TEMPORARILY_UNAVAILABLE` numa linha carregando um `Identify`
  fresco. `UNKNOWN` caiu de 489 para 40.
- **O endpoint passou a vir do cadastro.** Ver abaixo.

### O `oaiSource` que não existe

`repository_detail` lê `network.get("oaiSource")` — campo que **não existe** no
cadastro do Harvester. O nome é `originURL`. Foi por isso que o índice saiu sem
endereço e o experimento teve de garimpar o `origin` de dentro de um registro
coletado, e é por isso que 602 fontes constavam sem endpoint.

Com o nome certo, 597 delas têm endereço. `harvest_endpoint_url` passou a vir
do cadastro, com o `baseUrl` do quadro como reserva: o campo é definido como
"endpoint efetivamente usado na coleta", e o cadastro é a configuração de
agora, enquanto o do quadro veio de um registro coletado no passado. Onde os
dois existem, concordam em 1.577 de 1.580 — os três restantes são migração que
só o cadastro viu.

O mesmo vale para `harvest_metadata_prefix`, pela mesma razão e com a mesma
reserva.

```
harvest_endpoint_url ausente   602 → 5
conferência                  6.755 → 29
```

## `subdivision_code`, e os três que não são brasileiros

O `attributes.state` do cadastro preencheu `subdivision_code` em 2.113 das
2.183 — `BR-SP` 496, `BR-RS` 239, `BR-RJ` 224, `BR-MG` 182. O campo estava
vazio por inteiro.

Mas o mesmo campo desmentiu uma suposição que eu tinha escrito no gerador:
**"toda fonte do Oasisbr é brasileira"**. Três não são, e `country_code` era
obrigatório e estava errado nelas:

| fonte | era | é |
|---|---|---|
| Repositórios Científicos de Acesso Aberto de Portugal (RCAAP) | `BR` | `PT` |
| Networked Digital Library of Theses and Dissertations (NDLTD) | `BR` | `US` |
| Revista EDICIC (Barranquilla, Colômbia) | `BR` | `CO` |

O texto do `state` é livre e nem sempre é sigla: quatro registros escrevem o
estado por extenso, e um tem os campos trocados — `state='BH'` com
`city='Minas Gerais'`, onde BH é a cidade. Todos entram por tabela, com o
motivo ao lado.

**Valor de `state` não reconhecido levanta exceção** em vez de virar `BR`. Um
`state` novo é ou uma UF escrita de um jeito novo ou uma fonte de fora, e as
duas precisam de decisão humana — não de um `BR` silencioso, que é exatamente
como as três acima passaram despercebidas na primeira geração.

## O pipeline de detecção de plataforma

Cinco sondas por fonte, e **nenhuma interrompe as outras**:

| # | sonda | o que produz |
|---|---|---|
| 1 | `Identify` | `<toolkit>`, `<repositoryName>` e o `<description>` inteiro |
| 2 | `ListMetadataFormats` | `xoai`+`dim` é DSpace, `dataverse_json`+`oai_ddi` é Dataverse |
| 3 | `ListSets` | `com_`/`col_` é DSpace, `revista:SECAO` é OJS |
| 4 | HTML do site | `<meta name="generator">`, cookie `OJSSID`, marcador no corpo |
| 5 | APIs próprias | `/api/info/version` e `/server/api/core/sites`, que ainda dão a versão |

Parar na primeira evidência explícita seria mais barato e tornaria `HIGH`
inalcançável por construção: `HIGH` é *contar* assinaturas independentes, e não
se conta o que não se foi buscar.

### A confiança não sai do escore

O escore decide **qual** plataforma; a confiança sai da **força** dos sinais.
São coisas diferentes — mil pontos de inferência indireta continuam sendo
inferência indireta.

```
CONFIRMED  uma assinatura inequívoca da própria plataforma
HIGH       duas ou mais assinaturas características, de sondas diferentes
MEDIUM     uma assinatura característica, não exclusiva
LOW        só inferência indireta
UNKNOWN    nada
```

**"De sondas diferentes" é mais estrito do que "dois sinais".** `xoai` e `dim`
saem da mesma resposta de `ListMetadataFormats`: duas leituras do mesmo fato
não confirmam uma à outra. Com `col_` junto, que vem de `ListSets`, aí são
duas sondas e vira `HIGH`.

### Os pesos foram medidos

`validar_sondas.py` esconde a assinatura das 1.672 fontes que declaram a
própria plataforma e pergunta ao resto dos sinais — formatos, `setSpec`, rota,
forma do identificador — **o que eles teriam concluído sozinhos**. É validação
e não autoavaliação: o que é medido é disjunto do que dá o gabarito.

```
acerto dos sinais circunstanciais sozinhos: 99,4%  (10 erros em 1.668)
HIGH 99,8% (1.374)   LOW 98,0% (50)   MEDIUM 97,5% (244)
```

**Precisão sozinha engana, e por pouco não enganou aqui.** 92% do gabarito é
OJS: um sinal que diga OJS acerta quase sempre sem informar nada. O que mede
informação é o **ganho** — precisão dividida pela taxa-base:

| sinal | precisão | ganho | peso antes → depois |
|---|---|---|---|
| `identificador-article` | 1,000 | 1,1× | 30 → 15 |
| `set-estrutura-ojs` | 0,996 | 1,1× | 30 → 15 |
| `rota-index-php-oai` | 0,997 | 1,1× | 20 → 5 |
| `set-com` | 0,970 | 13,7× | 20 → 29 |
| `formato-xoai` | 0,971 | 13,7× | 40 → 29 |
| `html-dspace` | 1,000 | 14,1× | 30 → 29 |

Doze pesos circunstanciais foram repesados por ganho. **As assinaturas não
foram**, e de propósito: ganho depende da taxa-base da população, e a
autoridade de uma autodeclaração não. Repesá-las faria uma API do DSpace
vencer um `<meta generator>` do OJS num empate — o contrário do que o desenho
quer — e amarraria o classificador a esta população.

**O repeso mudou zero classificações**, e isso também é resultado: os pesos só
decidem quando dois sinais discordam, e eles discordam em 19 das 2.183. A
correção vale para uma população futura onde o conflito seja comum, não para
esta.

### Os dez erros são todos da mesma natureza

```
OTHER_IDENTIFIED → OJS      6      OMP e OPS são software do PKP
TEDE_LEGACY → DSPACE        3      TEDE roda sobre DSpace
TEDE2 → DSPACE              1
```

Nenhum erro é aleatório: são todos **substrato no lugar do produto**. Os sinais
circunstanciais enxergam a base técnica — a rota do PKP, o handle do DSpace — e
não a camada de cima, que só a autodeclaração revela. É a diferença entre um
classificador que erra e um que acerta o que consegue ver.

Isso também explica a inversão `MEDIUM` < `LOW`: `MEDIUM` é dominado por
`set-estrutura-ojs` (217 dos 244 casos), onde caem os seis OMP/OPS, enquanto
`LOW` é quase só rota de DSpace, que nesta população não tem irmão confundível.
Com 50 casos contra 244 e meio ponto de diferença, a inversão está dentro do
ruído de qualquer forma.

### O limite desta validação

O gabarito só existe onde **há** assinatura. Origem que não declara nada pode
ser sistematicamente diferente das que declaram, e a medida vale para as 1.672,
não para as 291 sem sinal nenhum. Nenhuma das duas coisas se resolve com mais
dados desta mesma coleta.

### Resultado

```
                antes   depois
classificadas   1.362    1.892
UNKNOWN           821      291
evidências      3.456    8.576

CONFIRMED 1.677 · LOW 181 · HIGH 27 · MEDIUM 7 · UNKNOWN 291
OJS 1.678 · DSPACE 199 · DATAVERSE 6 · OTHER_IDENTIFIED 6 · EPRINTS 2 · TEDE_LEGACY 1
```

**Zero divergências contra o classificador antigo.** O pipeline concorda com
as 1.362 que ele já tinha e acrescenta 530 — ganho sem regressão. As 291 que
sobram são, em 260 casos, origens que não respondem: `UNKNOWN` ali é a
resposta certa, e é diferente de `OTHER_IDENTIFIED`, que significa tecnologia
identificada e fora do vocabulário.

### Duas correções que a conferência impôs

**`CV07` ganhou dois códigos.** O vocabulário não previa evidência vinda de
outro verbo do OAI-PMH que não o `Identify`. `OAI_METADATA_FORMATS` e
`OAI_SETS` são **extensão nossa**, com teto `MEDIUM` cada: um repositório pode
expor `xoai` sem ser DSpace. Enfiá-los em `OAI_DESCRIPTION` descreveria errado
de onde a evidência veio. Remover os dois volta ao vocabulário original.

**Achar "dspace" no corpo do HTML não é autodeclaração.** O catálogo marcava
esse sinal como assinatura, e a conferência apontou 14 linhas `CONFIRMED` com
método que o CV08 não aceita como confirmatório. Quem estava errado era o
catálogo: só o `<meta generator>` é assinatura; o texto da página é
característico. Foi essa verificação, escrita antes do pipeline existir, que
pegou a incoerência entre as duas regras.

## O tipo de fonte passou a vir do cadastro

`source_type_macro` e `source_type_detail` eram deduzidos da **plataforma**:
todo OJS virava periódico, todo DSpace virava repositório. Era proxy, e proxy
errado — `repositorio` cobria tese e publicação ao mesmo tempo, e por isso
`ETD_LIBRARY` aparecia com zero.

O cadastro do Harvester traz `attributes.source_type`, que é a classificação
que o **próprio Oasisbr** dá à fonte. Os onze valores dele caem em oito dos
nove tipos do CV04 — só `SCIENTIFIC_CONFERENCE` não aparece nesta população:

| cadastro | CV04 | n |
|---|---|---|
| Revista | `SCIENTIFIC_JOURNAL` | 1.931 |
| Repositório Institucional / de Publicações / Comum / Temático | `PUBLICATION_REPOSITORY` | 158 |
| Biblioteca Digital de Teses e Dissertações | `ETD_DIGITAL_LIBRARY` | 61 |
| Repositório de Dados de Pesquisa | `RESEARCH_DATA_REPOSITORY` | 17 |
| Portal de Livros | `BOOK_PORTAL` | 7 |
| Biblioteca Digital de Monografia | `MONOGRAPH_DIGITAL_LIBRARY` | 6 |
| Portal Agregador | `AGGREGATOR_PORTAL` | 1 |
| Servidor de preprints | `PREPRINT_SERVER` | 1 |

O macro sai do detalhe por `MACRO_POR_DETALHE`, para não haver duas tabelas
discordando. `source_type` novo **levanta exceção**, mesma regra do `state`.

**851 linhas mudaram**: 820 saíram de `UNKNOWN` e **31 eram classificação
errada** — 21 repositórios de publicação que são bibliotecas de teses, 3 que
são de monografias, 2 de dados, 1 portal agregador, 1 portal de livros. O
subcontagem de `ETD_LIBRARY` era real e agora tem 61.

Três linhas discordam no sentido inverso: um Open Monograph Press registrado
como revista, outro como repositório, e um Open Preprint Systems registrado
como repositório institucional. O cadastro manda no **tipo de fonte** e a
sonda manda na **plataforma** — são perguntas diferentes, e guardar as duas
deixa a discordância visível em vez de escondida.

Sobra **uma** observação sem tipo: a única dos 2.183 que não tem cadastro.

## Privada é um código só, com dois eixos ao lado

`COMMUNITY_UNIVERSITY` foi criada e depois **desfeita**: o CV01 voltou aos 12
termos e as distinções viraram dois campos booleanos, porque não são natureza
jurídica. Uma privada pode ser com ou sem fins lucrativos; uma sem fins pode ou
não ter qualificação comunitária. Enfiar os três num vocabulário só obrigaria a
escolher qual deles a coluna conta.

```
institution_type      FinsLucrativos  Comunitaria
PRIVATE_UNIVERSITY    S               (vazio)     46 observações
PRIVATE_UNIVERSITY    N               (vazio)    275
PRIVATE_UNIVERSITY    N               S           ICES
MUNICIPAL_UNIVERSITY  (vazio)         S           FURB, UNIFEBE
STATE_UNIVERSITY      (vazio)         S           UDESC
```

As três últimas linhas são o motivo da mudança: **FURB, UNIFEBE e UDESC são
públicas e comunitárias ao mesmo tempo.** Com a qualificação virada código do
CV01, elas tinham de escolher um dos dois e a informação se perdia; com eixo
próprio, a base diz as duas coisas. Foram 24 instituições e 137 observações que
ganharam a marca, três delas públicas.

**Vazio é "não apurado", não é "não".** Não há `UNKNOWN` no CV14 de propósito:
`FinsLucrativos` só existe onde a instituição casou com um recorte do e-MEC
(322 das 2.183), e `Comunitaria` só onde ela está nas listas ICES de RS e SC.
Marcar `N` no resto afirmaria uma apuração que não houve.

Os nomes `FinsLucrativos` e `Comunitaria` destoam do snake_case inglês das
outras 36 colunas, que veio do dicionário original. Estes dois são extensão
nossa e foram escritos como você os pediu.

## A verificação contra o e-MEC

`verificar_emec.py` lê **todo** CSV de `data/` cujo cabeçalho seja do e-MEC,
junta os recortes e confere as 755 instituições. Hoje são quatro, 3.327
instituições, e **251 casamentos com zero divergências**, cobrindo
1.471 das 2.183 observações (67%) — depois de onze correções que o cruzamento
encontrou:

| instituição | era | virou | fonte |
|---|---|---|---|
| Centro Universitário de Brusque (UNIFEBE) | comunitária | `MUNICIPAL` | Fundação Pública Municipal |
| Faculdade de Medicina do ABC (FMABC) | `PRIVATE` | `MUNICIPAL` | Fundação Pública Municipal |
| Faculdade de Direito de Franca (FDF) | `PRIVATE` | `MUNICIPAL` | Pública Municipal |
| Faculdade de Filosofia… de Mandaguari (FAFIMAN) | `PRIVATE` | `MUNICIPAL` | Pública Municipal |
| Instituto Nacional de Telecomunicações (INATEL) | `RESEARCH_INSTITUTE` | `PRIVATE` | IES privada |
| Instituto de Educação Superior de Brasília (IESB) | `OTHER` | `PRIVATE` | IES privada |

| Faculdade de Medicina de São José do Rio Preto (FAMERP) | `PRIVATE` | `STATE` | Pública Estadual |
| Faculdades de Tecnologia do Estado de São Paulo (Fatec) | `PRIVATE` | `STATE` | Pública Estadual |
| Faculdade de Tecnologia de Osasco (FATEC) | `PRIVATE` | `STATE` | Pública Estadual |
| Faculdade de Tecnologia da Zona Sul (FATEC Zona Sul) | `PRIVATE` | `STATE` | Pública Estadual |
| Academia Militar das Agulhas Negras (AMAN) | `SCIENTIFIC_SOCIETY` | `GOVERNMENT_AGENCY` | Pública Federal |

Elas caem em três famílias, e cada família é um padrão de nome falhando:

- **"Instituto"** levou INATEL e IESB para centro de pesquisa; são faculdades.
- **"Faculdade"** levou FAMERP e as três FATECs para privada; são do estado de
  São Paulo (as FATECs pertencem ao Centro Paula Souza, autarquia estadual).
- **"Academia"** levou a AMAN para sociedade científica; é academia militar,
  órgão do Exército.

Nenhuma dessas seria encontrada lendo a tabela de regras: o padrão é
defensável e o nome é que engana. É o que o cruzamento externo compra.

### Uma regra de casamento só, e o motivo

`sigla+UF`, **mais** pelo menos um termo distintivo em comum. O casamento por
termos do nome foi tentado e descartado: rendia oito pares a mais e dois deles
errados.

```
UFMG  → Centro Universitário de Minas Gerais        (só "minas gerais")
USP   → Faculdade Evangélica de São Paulo           (só "são paulo")
UFJF  → Centro Universitário Universo Juiz de Fora  (só "juiz de fora")
SBMAC → Escola de Matemática Aplicada da FGV        (só "matemática aplicada")
```

Com a UF já travada, o que sobra de comum entre nomes distintos é quase sempre
o nome da cidade ou da área, e não dá para enumerar as duas coisas. 25% de erro
contra 0% do `sigla+UF` não compensa oito pares. O termo em comum exigido é o
que impede a Fundação Carlos Chagas de casar com a Faculdade Cristã da Cidade,
as duas "FCC" em São Paulo.

### O recorte que quase sumiu

O arquivo de privadas com fins lucrativos veio em **Mac OS Roman com
terminador CR** — `0x97` é "ó" ali, e `\r` sozinho quebra o leitor em C do
pandas. A primeira versão do carregador fazia `except UnicodeDecodeError:
continue`, tratando falha de decodificação como "não é do e-MEC": teria
descartado 2.028 instituições em silêncio, e o relatório diria "2 recortes"
com ar de normalidade.

Agora são duas decisões separadas: **é do e-MEC?** decidido nos bytes do
cabeçalho, antes de qualquer parse; **abriu?** quatro codificações em ordem,
com o relatório dizendo qual funcionou. Cabeçalho do e-MEC que não abre em
nenhuma interrompe o script em vez de sumir.

### O esperado sai de três colunas, não de uma

`Categoria Administrativa` dá a esfera; `Natureza Jurídica` desempata quando a
categoria mente (há municipal dentro do recorte de privadas); e
`Organização Acadêmica` dá o **tipo**.

A terceira foi acrescentada porque `Pública Federal` **não implica
universidade**: a Fiocruz, a ENAP, a Academia Nacional de Polícia e o CDTN são
"Escola de Governo" no e-MEC, e exigir `FEDERAL_UNIVERSITY` delas acusava sete
divergências que não existiam. Com a coluna certa, `Escola de Governo` espera
`GOVERNMENT_AGENCY` ou `RESEARCH_INSTITUTE`, e as sete sumiram sem afrouxar
nada.

O balde de `Faculdade` continua largo de propósito — no e-MEC ele cobre unidade
de universidade, escola militar e instituto de pesquisa ao mesmo tempo. Largo,
mas não inútil: foi ele que pegou as quatro faculdades estaduais classificadas
como privadas.

### O que a verificação não diz

504 das 755 não casaram, e **isso não é evidência de nada**. São, em boa parte,
o que nem é instituição de ensino: sociedades científicas, editoras, órgãos de
governo, hospitais — coisas que o e-MEC não cadastra. Para essas, o cruzamento
não tem o que dizer, e a classificação continua apoiada no padrão de nome.

## A rodada das lacunas

Quatro preenchimentos, e o terceiro expôs uma regra errada.

**`metadata_profile`** (3 vazios): faltavam três prefixos na tabela —
`oai_openaire` → `OPENAIRE`, `mtd-br` → `BDTD` (é a versão anterior do perfil
da BDTD, e `mtd2-br` é a atual) e `imf` → `OTHER`.

**`subdivision_code`** (70 → 35): fonte sem `state` no cadastro herda a UF da
instituição, quando outra fonte dela tem. É a mesma afirmação que o cadastro
faz — o estado é o da instituição, não o do servidor —, só que alcançada por
irmã. As 35 restantes são 32 brasileiras sem estado em lugar nenhum e as 3
estrangeiras, para as quais `BR-xx` não se aplica.

**`source_status`** (40 → 23 `UNKNOWN`): as 40 indeterminadas eram todas
`http-404` no endpoint OAI. Mas **17 têm site no ar**, e 8 delas respondem à
API da própria plataforma. `UNKNOWN` ali dizia "não sei se existe" sobre uma
fonte cuja página abriu. O 404 é do endereço que temos em cadastro, não da
fonte — e essa distinção é o que o CV02 deveria capturar.

**`notes`** deixou de ser o único campo 100% vazio: as 17 ganharam a
observação técnica que explica a mudança.

```
endpoint OAI responde 404, site da fonte responde:
cadastro do endereço desatualizado, fonte no ar
```

`notes` só recebe linha onde há algo **não óbvio** a dizer. Encher as 2.183 com
texto derivável de outras colunas transformaria o campo em ruído.

### A regra que isso derrubou

Declarar as 17 ativas fez a conferência saltar de 29 para 113: a base passou a
cobrar os campos do `Identify` delas, que não existem porque o endpoint dá 404.

A condição estava errada desde o começo. Ela era **"a fonte está ativa"**,
aproximação que funcionava enquanto ativa e respondendo fossem a mesma coisa.
A condição de verdade é **"o `Identify` respondeu"**, e o sinal disso está na
própria base: `identify_sha256` só existe onde a resposta foi preservada.

```python
alvo &= cru["identify_sha256"].notna()   # antes: ~source_status.isin(SEM_IDENTIFY)
```

A conferência voltou a 28 — um a menos que antes, porque o `metadata_profile`
também foi resolvido. E a checagem ficou mais forte, não mais fraca: agora ela
pega linha que **tem** o hash e mesmo assim não tem o campo, que são as 8
origens respondendo sem `repositoryName`.

## A sexta sonda, e o que a medição fez com ela

O cadastro do Harvester traz `attributes.software` — "SEER/OJS", "DSpace",
"SciELO". É a única evidência disponível para as origens que não respondem a
sonda nenhuma, e entrou com a ressalva escrita no código:

> O cadastro não observou nada. É o que uma pessoa digitou no formulário do
> Oasisbr quando inscreveu a fonte, possivelmente há anos, sem que ninguém
> conferisse contra a origem.

Por isso `caracteristica` e nunca `assinatura`, e por isso `SOURCE_REGISTRY`
entrou no CV07 com teto `MEDIUM` — terceira extensão nossa ao vocabulário, e a
mais fraca das três. Para as fontes mudas ele é a diferença entre `UNKNOWN` e
uma hipótese datada e rastreável; **não** é a diferença entre `UNKNOWN` e
conhecimento.

### A ressalva não era retórica

Na primeira rodada o sinal derrubou `UNKNOWN` de 291 para 25, e fez aparecer
uma plataforma nova: `SCIELO`, 210 observações. Aí a validação mediu:

```
cadastro-scielo    28 casos com gabarito    precisão 0,000
```

**Zero.** Nas 28 fontes que o cadastro chama de SciELO e que também têm
assinatura inequívoca, o software real era OJS em todas as 28. O valor não
nomeia o produto — nomeia o programa que hospeda e indexa. Mapeá-lo para
`SCIELO` teria publicado 210 observações erradas com ar de ganho.

Mapeá-lo para OJS também não vale: com 92% do gabarito em OJS, o ganho seria
1,1×, quer dizer, nada. `scielo` saiu da tabela, e as 210 voltaram a `UNKNOWN`.

### O que sobrou, medido

```
cadastro-dspace     120 casos   precisão 0,967   ganho 13,6×   peso 29
cadastro-ojs      1.378 casos   precisão 0,999   ganho  1,1×   peso 15
cadastro-dataverse    4 casos   precisão 1,000   ganho  333×   peso 25 (amostra pequena)
```

O par precisão/ganho volta a separar o que informa do que só repete a
taxa-base: `cadastro-ojs` quase nunca erra e quase nada acrescenta.

```
platform_product UNKNOWN   291 → 235
platform_confidence        CONFIRMED 1.677 · MEDIUM 220 · HIGH 29 · LOW 22
```

Das 220 `MEDIUM`, **215 foram decididas pelo cadastro** — e 184 delas são
fontes fora do ar, que era exatamente o alvo. As 235 que seguem `UNKNOWN` não
têm nem isso: o cadastro delas diz "Outros", "Proprietário" ou nada, o que não
é identificação de tecnologia e por isso não vira sinal.

## Segunda rodada das lacunas

Dois campos, e os dois preenchidos com dado que já estava coletado e parado.

**`platform_version`** (683 → 570): só o `<toolkit><version>` do `Identify`
alimentava o campo. Mas o `<meta generator>` carrega o número —
"Open Journal Systems 3.3.0.20", "DSpace 6.3" — e havia 1.575 deles em
`sondas.json`, além da versão que a API do Dataverse devolve. Três
autodeclarações, encadeadas na ordem em que foram coletadas, recuperaram 113.

```
3.3.0  899    3.2.1  47    6.3  16
3.4.0  283    2.4.8  36    …
3.5.0  232
```

Das 570 que seguem sem versão, 340 são fontes fora do ar e 126 respondem sem
declarar versão em lugar nenhum.

**`platform_name_raw`** (578 → 48): o nome bruto passou a aceitar também o que
o cadastro declara, que é tão bruto quanto o do `<toolkit>` — só que dito por
terceiro. O valor cru entra como está, inclusive `SciELO`, e é isso que o campo
pede: `platform_name_raw` guarda o que foi encontrado, `platform_product`
guarda o que se concluiu. Nas 210 fontes que o cadastro chama de SciELO as duas
colunas divergem de propósito, e a divergência é o registro de que a medição
recusou aquele mapeamento.

**`Outros`, `outro` e `Proprietário` ficaram de fora.** Se não servem como
sinal — porque dizem que quem preencheu não soube especificar — também não
servem de nome de tecnologia. Eram 44 observações que teriam entrado como se
fossem software.

## As pendências de `institution_type`

O campo está 100% preenchido desde que `instituicoes.py` existe, mas
preenchido não é conferido. A pergunta útil é **quantas observações têm
verificação externa**, e ela expôs dois defeitos do casador.

**Instituição sem sigla nunca casava.** São 105 das 755, e para elas o
casamento por sigla é impossível por construção. O casamento por termos,
descartado antes por gerar falso positivo, também não servia: "Universidade
Estadual do Ceará" reduz a `{estadual}` depois da lista de parada — o nome do
estado está lá justamente para não contar — e casaria com a da Paraíba.

A regra nova compara o **nome inteiro** normalizado, não os termos. Nome
idêntico é nome idêntico, e não tem como produzir o falso positivo que o
jaccard produzia. Recuperou 13, entre elas a Universidade Estadual do Ceará,
a do Rio Grande do Sul e o Colégio Pedro II.

**UF ausente no e-MEC bloqueava o casamento.** A UNEB tem 36 linhas no recorte,
uma por campus, e **nenhuma traz UF**. O casador exigia UF igual e desistia.

Mas não é preciso escolher o campus: a verificação quer o enquadramento, não a
linha. Quando todas as candidatas concordam no enquadramento esperado, a
resposta é a mesma qualquer que seja a escolhida — e quando discordam, não
casa. Recuperou 5, incluindo a UNEB (12 observações) e a Escola Superior de
Guerra.

```
269 de 755 instituições conferidas · 1.512 de 2.183 observações (69%)
zero divergências
```

### As 12 públicas que sobram não são pendência

```
IOUSP · ESALQ-USP · Escola de Minas · UEMAnet · FMABC   unidades de outra IES
Centro Paula Souza                                      mantenedora, não IES
3 Institutos Federais + 1 CEFET + UNIFAL + UFSCAR-DTO   variação de sigla
```

São 16 observações. As cinco primeiras são **unidades** — o e-MEC cadastra a
instituição-mãe, não o instituto oceanográfico dela. As últimas seis são
grafia de sigla, em nomes que já se identificam sozinhos: "Instituto Federal
de Educação, Ciência e Tecnologia de X" não deixa dúvida sobre ser
`FEDERAL_INSTITUTE`.

### O que continua sem verificação externa, e por quê

486 instituições e 671 observações — e a maior parte **o e-MEC não cadastra**:
sociedades científicas (234), órgãos de governo (59), editoras (18),
hospitais e outros (62). Para essas o cruzamento não tem o que dizer, e a
classificação segue apoiada no padrão de nome. Restam 67 privadas que deveriam
estar nos recortes e não casaram — resíduo de grafia, e o alvo natural da
próxima passada se você quiser fechar o número.

### O nome inteiro vale mesmo quando há sigla

A regra de nome exato só rodava para quem **não tinha** sigla — e sigla é
justamente o que mais varia entre os dois cadastros. A PUC de Goiás é `PUC-GO`
para nós e `PUC GOIÁS` no e-MEC; a Mackenzie é `UPM` e `MACKENZIE`; a Anhembi
Morumbi é `ANHEMBI` e `UAM`. Em todas o nome completo é o mesmo.

Soltar a regra recuperou 20 instituições, e ela continua recusando o que deve:
"Faculdade Santo Agostinho" não é "Centro Universitário Santo Agostinho", nem
"Universidade Vale do Rio Verde" é "Faculdade Verde Norte" — pares que o
jaccard dava como 1,00 porque "faculdade" e "universidade" estão na lista de
parada. **Exigir o nome inteiro separa os dois casos sem precisar de limiar**,
que foi o que nenhuma versão do casamento por termos conseguiu.

```
289 de 755 instituições · 1.549 de 2.183 observações (71%) · zero divergências
```

### `Razão Social` responde outra pergunta

Foi a última chave tentada, e o resultado do teste é que ela **não serve para
verificar o tipo**. A `Razão Social` do e-MEC é o nome legal da
**mantenedora**, e casar por ela diz que a entidade *mantém* uma IES, não que
ela *é* uma:

```
Associação Paulista de Medicina  →  mantém "Faculdade da Associação Médica Paulista"
Instituto Chico Mendes (ICMBio)  →  mantém "ACADEBio" (Escola de Governo)
Fundação Cesgranrio              →  mantém "Faculdade Cesgranrio"
```

A APM continua sendo sociedade científica e o ICMBio continua sendo órgão de
governo, e é por isso que o periódico deles está na base. Usar a chave para
corrigir `institution_type` seria erro de categoria disfarçado de ganho de
cobertura — pressionaria três correções erradas em nove casamentos.

A chave entrou mesmo assim, como **informação e não veredito**: as nove linhas
ficam no CSV com `como = "razão social (mantenedora)"` e `confere` vazio. O
fato de uma entidade manter uma IES é dado útil; só não é resposta a esta
pergunta.

## A lacuna de `platform_detection_method`

Eram 235 `UNKNOWN`, e a pergunta útil era **quantas delas ainda respondem**:
221 são fontes fora do ar, e sobre elas nenhuma sonda tem o que dizer. As 14
`ACTIVE` é que valiam inspeção, e renderam um sinal e uma rejeição.

**Generator não reconhecido vira `OTHER_IDENTIFIED`.** A regra só olhava para
"Open Journal Systems" e "DSpace" e descartava o resto — mesmo sendo
autodeclaração. `MAX` é o Maxwell da PUC-Rio, `GeneXus Java 16_0_9-140712` é
plataforma de desenvolvimento: as duas nomeiam o software de verdade, e as
fontes ficavam `UNKNOWN` com a declaração no HTML. É exatamente o que
`OTHER_IDENTIFIED` significa — identifiquei e não está no vocabulário —, e o
que o separa de `UNKNOWN`.

**Com uma trava:** CMS genérico não conta. Uma fonte tem
`<meta generator> WordPress 7.1.1` e OAI de OJS atrás — é o software do
*site*, não o da fonte, e tomá-lo pela plataforma trocaria uma identificação
certa por uma errada. WordPress, Joomla, Drupal e semelhantes estão numa lista
de exclusão.

**`mtd2-br` foi medido e rejeitado.** Parecia impressão digital de sistema de
teses brasileiro, mas são 6 fontes e das 4 identificadas **uma é SophiA**, não
DSpace. Amostra pequena e precisão ruim: não virou sinal.

```
platform_detection_method UNKNOWN   235 → 232
OTHER_IDENTIFIED                       6 →   9
```

Três observações. O ganho é pequeno porque a lacuna real não é de regra — é de
origem que não responde.

## `xml-invalido` escondia quatro coisas

A pergunta era se as 78 origens com `xml-invalido` eram defeito do parser.
**Não eram** — todas devolviam HTML de verdade. Mas o rótulo único juntava
quatro fenômenos com consequências diferentes, e 78 fontes vinham de **30
hosts**, um deles respondendo por metade:

```
39  portal-em-manutencao   periodicos.unb.br inteiro
30  html-nao-xml           endereço não serve OAI; o portal devolve a home
 7  oai-fechado            302 para /login — o OAI foi desabilitado
 3  anti-bot               Cloudflare recusando o nosso cliente
```

O caso que importa é `oai-fechado`: a revista responde 302 para
`/index.php/gepep/login`. **Ela existe e funciona** — fechado está o
protocolo. Chamá-la de "temporariamente indisponível" é erro de leitura, do
mesmo tipo do 404 corrigido antes, e agora ela é `ACTIVE` com a ressalva em
`notes`:

```
endpoint OAI redireciona para a página de login: protocolo fechado, fonte no ar
```

Os outros três continuam `TEMPORARILY_UNAVAILABLE`, mas por razões que a base
agora distingue — e `anti-bot` registra que o problema é nosso cliente, não a
origem.

O coletor também passou a guardar a **URL final** dos desfechos que falham.
Era o que faltava para diagnosticar isto sem re-sondar: antes só havia o
content-type, que dizia `text/html` e nada mais.

```
source_status   ACTIVE 1.690 → 1.716   (7 oai-fechado + 19 origens que voltaram)
oai_repository_name vazio   516 → 498
```

## `SCIELO` como produto e como estrato

215 fontes são colhidas do OAI central do SciELO, e o que serve esses
registros é a infraestrutura do SciELO — qualquer OJS que a revista também
mantenha é irrelevante para o que o Oasisbr colhe. Elas passaram a
`platform_product = SCIELO`, e `platform_product UNKNOWN` caiu de **231 para
20**.

**Isso não contradiz a rejeição do `cadastro-scielo`.** Conferi antes de
implementar, e os dois conjuntos são disjuntos, sem uma fonte em comum:

```
215 no endpoint agregador  →  0 com assinatura inequívoca (nunca sondadas)
 28 da medição             →  0 no endpoint agregador (têm endpoint próprio)
```

A precisão 0,000 falava de revistas **indexadas** pelo SciELO rodando OJS
próprio. As 215 são outra coisa: o SciELO é quem serve.

### Um código novo no CV07

`URL_PATTERN_ONLY` não servia. Ele é inferir plataforma pela **forma** do
endereço — `/index.php/` *sugere* OJS —, e por isso tem teto `LOW`. Aqui é
outra coisa: `scielo.br/oai/scielo-oai.php` não sugere SciELO, **é** o OAI do
SciELO, reconhecido pelo domínio e pela rota próprios dele.

`SERVICE_ENDPOINT`, teto `MEDIUM`. Não `CONFIRMED`: sabemos de onde o registro
vem, mas o endpoint está morto e nunca o vimos servir, e `CONFIRMED` pede
evidência **emitida** pelo sistema.

### E um estrato novo no CV06

Com `SCIELO` dentro de `OTHER`, o estrato "Outros" virava "SciELO mais 23" —
215 observações contra 23, e quase 18× o Dataverse, que já tinha estrato
próprio. A hipótese sobre taxa de erro por plataforma compararia um estrato
mascarado com os demais.

```
OJS 1.709 · SCIELO 215 · DSPACE 204 · OTHER 23 · UNKNOWN 20 · DATAVERSE 12
```

`OTHER` voltou a ser o que o vocabulário diz que é: resíduo — 10
`OTHER_IDENTIFIED`, 7 Pergamum, 4 SophiA, 2 EPrints.

## A última coleta, em sete campos

O índice do Harvester reporta o estado da última coleta de cada fonte, e isso
não estava na base. São sete campos novos — 38 para **45** —, ligados pelo
`source_id` que já existia:

```
snapshot_id · snapshot_date · snapshot_status
size · valid_size · transformed_size
index_status
```

`CV15` e `CV16` guardam os estados **como o Harvester os emite**
(`HARVESTING_FINISHED_ERROR`, `INDEXED`), e não uma tradução nossa — mesma
razão pela qual CV11 e CV12 ficaram com os literais minúsculos do OAI-PMH.
Uniformizá-los quebraria a comparação direta com a origem.

```
snapshot_status   VALID 1.686 · HARVESTING_FINISHED_ERROR 450 · …_VALID 33
                  SEM_COLETA 8 · HARVESTING 6
index_status      INDEXED 1.596 · UNKNOWN 574 · SEM_INDICE 8 · FAILED 5

4.970.249 registros coletados · 4.245.255 válidos · 4.829.817 transformados
mediana 425 por fonte · maior 1.035.627
```

Os totais batem com o `resumo` do próprio índice, o que serve de conferência
da leitura.

### Zero coletado não é coleta que não houve

O índice reporta `lastSize: 0` para as 8 fontes que nunca foram coletadas —
o mesmo valor de um repositório que respondeu e estava vazio. Sem máscara,
elas entrariam na média de tamanho como repositórios vazios.

Os três tamanhos ficam **nulos** quando não houve coleta, e o
`snapshot_status` diz `SEM_COLETA`. É a mesma distinção que a base mantém em
todo lugar: vazio é "não se aplica", e nunca um valor que finge medição.

Os contadores são `Int64` e não `int64` pelo mesmo motivo — um tipo que não
admite nulo obrigaria a escolher entre zero e ausente.
