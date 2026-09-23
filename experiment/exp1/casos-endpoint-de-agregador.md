# Fontes cadastradas contra o endpoint de um agregador

**Casos 22, 40, 44 e 638** — e as outras 212 que eles revelaram.

Documento de decisão: reúne a evidência e enuncia as escolhas em aberto. Não
altera a base.

---

## O que estes quatro têm

| id | fonte | instituição | endpoint cadastrado |
|---|---|---|---|
| 22 | Acta Paulista de Enfermagem (Online) | UNIFESP | `www.scielo.br/oai/scielo-oai.php` |
| 40 | Psicologia USP (Online) | USP | `www.scielo.br/oai/scielo-oai.php` |
| 44 | Machado de Assis em Linha | USP | `www.scielo.br/oai/scielo-oai.php` |
| 638 | Biblioteca Digital de Teses e Dissertações do ITA | ITA | `oai.bdtd.ibict.br/request` |

Nenhum é endpoint da fonte. Os três primeiros apontam para o **OAI central do
SciELO**; o quarto, para o **agregador BDTD do IBICT**. A coleta do Oasisbr
passa por um terceiro agregador antes de chegar à origem.

Foi por isso que apareceram na lista de fontes ativas sem plataforma
identificada: perguntar `Identify` a esses endereços não descreve a fonte —
descreveria o SciELO ou o IBICT, se respondesse.

## Não são quatro: são 216

O padrão dos três primeiros se repete em escala. `scielo-oai.php` é **o
endpoint mais compartilhado de toda a base**:

```
old.scielo.br/oai/scielo-oai.php    212 fontes
www.scielo.br/oai/scielo-oai.php      3 fontes   (casos 22, 40, 44)
oai.bdtd.ibict.br/request             1 fonte    (caso 638)
                                    ─────
                                    216 fontes · 9,9% da base · 173 instituições
```

O grupo do SciELO tem assinatura própria e coerente:

```
harvest_scope       SINGLE_SET em 215 de 215
harvest_set_spec    preenchido em 215 — e o valor é o ISSN da revista
                    (1809-4341, 2317-6431, 0001-3765…)
identify_sha256     0 de 215 — nenhuma teve o Identify respondido
platform_product    UNKNOWN em 211
platform_name_raw   "SciELO" em 210
```

É o mecanismo do agregador aparecendo nos dados: cada revista é **um set** do
OAI central do SciELO, identificada pelo ISSN. O Oasisbr não coleta a revista;
coleta um recorte do SciELO.

Isso explica de uma vez três coisas que foram relatadas separadamente:

- os **223 `SINGLE_SET`** ("223 fontes não são coletadas inteiras") — 215 são
  este grupo, e o "set" é o recorte do agregador, não uma coleção da fonte;
- as **212 `TEMPORARILY_UNAVAILABLE`** que dominam as lacunas de `oai_*`;
- o **`platform_name_raw = "SciELO"`** em 210 observações.

## Os três endpoints estão mortos

Testados agora:

```
https://old.scielo.br/oai/scielo-oai.php     sem resposta (falha de conexão)
https://www.scielo.br/oai/scielo-oai.php     502 Bad Gateway
http://oai.bdtd.ibict.br/request             301 → prevs-prod.ibict.br/request → 404
```

O do SciELO saiu do ar; o do IBICT migrou de host e a rota nova não existe.
Nenhum dos 216 cadastros aponta hoje para algo que responda.

A diferença entre `ACTIVE` (3) e `TEMPORARILY_UNAVAILABLE` (212) nesse grupo é
artefato do host: `www.scielo.br` serve o site do SciELO e por isso a sonda de
HTML responde; `old.scielo.br` não resolve. A fonte é a mesma nas duas
situações — a regra "site vivo vence endpoint 404" acertou o que observou e
observou o servidor errado.

## O que está em aberto

O dicionário define `harvest_endpoint_url` como "endpoint efetivamente usado
na coleta". Pelo texto, o cadastro está **certo**: é esse o endereço que o
Oasisbr usa. A consequência é que o campo descreve a coleta e não a fonte, e
que tudo que se derive dele — `Identify`, plataforma, versão — descreve o
agregador.

Três decisões, e elas são independentes.

### 1. `source_status` destas 216

Hoje: 212 `TEMPORARILY_UNAVAILABLE`, 3 `ACTIVE`, pela resposta do agregador.

A alternativa é reconhecer que **não foi a fonte que se mediu**. Uma revista
do SciELO que está no ar não é "temporariamente indisponível" porque o
agregador saiu do ar. `UNKNOWN` seria mais honesto para as 216: situação
indeterminada, porque o que respondeu (ou não) não era ela.

O custo é perder 212 observações da contagem de indisponíveis — que hoje
sustentam a leitura de que há muita fonte fora do ar.

### 2. `platform_product` destas 216

Hoje: 211 `UNKNOWN`. Continuaria assim sob qualquer decisão, porque não há
como sondar a plataforma por um endpoint que não é dela. O que muda é a
**interpretação**: não são fontes sem tecnologia identificável, são fontes que
nunca foram sondadas.

Se a distinção importa para o artigo, ela precisa de coluna, não de código —
`UNKNOWN` está dizendo duas coisas diferentes ao mesmo tempo.

### 3. Buscar o endpoint próprio de cada uma

Revista do SciELO costuma ter OAI próprio na instalação de origem, e a BDTD do
ITA tem endpoint na instituição. Descobri-los exigiria uma busca por fonte —
216 buscas — e daria à base o endpoint da fonte no lugar do endpoint da
coleta.

**Mas isso contraria a definição do campo.** Se for feito, o endereço próprio
precisa de coluna nova (`source_oai_url`, digamos), preservando
`harvest_endpoint_url` como o que o dicionário pede: o que o Oasisbr
efetivamente usa.

## O que não fazer

**Não classificar as 216 como `SCIELO`.** O cadastro do Oasisbr chama 238
fontes de "SciELO" e a medição já rejeitou esse mapeamento: nas 28 que também
têm assinatura inequívoca, o software real era OJS em 28. "SciELO" nomeia o
programa que hospeda e indexa, não o produto que roda.

**Não tratar o `setSpec` destas como recorte temático.** O `SINGLE_SET` aqui
significa "uma revista dentro de um agregador", não "a coleta pega só parte da
fonte". Contá-las junto com os 8 `SINGLE_SET` restantes na mesma estatística
mistura dois fenômenos.

---

## Anexo: o caso 2204, conteúdo hospedado por terceiro

`Art Style (São Paulo. Online)` não estava nesta lista — o endpoint dela é
próprio, `artstyle-editions.org/oai`, e dá 404. Mas o fundo é o mesmo: **o
conteúdo está em outro lugar**. A página da revista aponta os artigos para
`zenodo.org/search?q=Art Style Magazine`.

A diferença é que aqui a hospedagem identifica a tecnologia. O Zenodo roda
InvenioRDM — o repositório oficial é `zenodo/zenodo-rdm`, "powered by
InvenioRDM" — e o CV05 tem o código.

Ficou registrada como classificação manual, a sétima sonda:

```
platform_product            INVENIO_RDM
platform_confidence         MEDIUM
platform_detection_method   MANUAL_TECHNICAL_INSPECTION
evidência   site deposita os artigos no Zenodo (zenodo.org/search?q=Art Style
            Magazine); Zenodo roda InvenioRDM (github.com/zenodo/zenodo-rdm)
```

**`MEDIUM` e não `CONFIRMED`**, por duas razões que valem para qualquer caso
futuro do gênero: a inferência tem dois passos — fonte para Zenodo, Zenodo
para InvenioRDM — e nenhum deles é observação do software pela nossa sonda,
porque o Zenodo devolve 403 ao nosso cliente. Quem inspecionou não viu o
software; viu onde o conteúdo mora e concluiu daí.

A distinção com os 216 casos acima: lá o endpoint **é** de agregador e a
tecnologia continua desconhecida; aqui o endpoint é próprio (embora morto) e
a hospedagem revela a tecnologia. São problemas vizinhos com respostas
diferentes.

---

*Gerado a partir de `base-fontes.csv`, `identify.json`, `sondas.json` e
`cadastro.json`. Os testes de endpoint foram feitos no momento da redação e
podem mudar.*
