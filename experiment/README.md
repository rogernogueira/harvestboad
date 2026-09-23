# Experimento: os dois botões do registro

Mede, em repositórios OAI de verdade, se os dois destinos que a tela de um
registro oferece realmente abrem:

- **Página do item** — endereço resolvido por `backend/apps/integrations/oai.py`,
  o mesmo código que a aplicação roda. É o que tem heurística e, portanto, o que
  pode errar de alvo.
- **OAI-PMH** — o `GetRecord` na origem, montado como
  `frontend/src/lib/recordLink.ts:oaiGetRecordUrl` monta. Não tem heurística: ou
  a origem atende, ou não.

Nasceu de `oai:revista.esmat.tjto.jus.br:article/120`, cujo botão "Página do
item" levava a um DOI que nunca foi registrado. A pergunta que o experimento
responde é se aquilo era um caso isolado e se a correção não quebrou o resto.

## Onde rodar

Duas redes são necessárias e só um lugar tem as duas: o container
`harvestboard_api` alcança o Harvester (`200.130.0.61:8090`, que não responde do
shell da máquina) **e** a internet aberta, onde vivem as origens OAI.

O container executa o backend da imagem — o código que atende os usuários. Para
medir a correção sem tocar nele, a árvore corrigida vai para `/app/backend`, que
`ambiente.py` prefere a `/app`:

```bash
tar cf - --exclude=.venv --exclude=__pycache__ -C backend apps config manage.py \
  | docker exec -i harvestboard_api sh -c 'rm -rf /app/backend && mkdir -p /app/backend && tar xf - -C /app/backend'
docker cp experiment harvestboard_api:/app/experiment
```

Sem isso o experimento mede a versão antiga sem avisar — na primeira tentativa
ele parou com `ImportError: cannot import name 'FORMA_NA_ROTA'`, que foi sorte:
o erro apareceu porque a correção adicionou um símbolo novo.

## Como rodar

Do diretório `backend/`, que é onde vive o ambiente:

```bash
uv run python ../experiment/coletar_repositorios.py     # gera repositorios.json
uv run python ../experiment/experimento.py              # gera resultados.json
uv run python ../experiment/relatorio.py --por-plataforma
```

`experimento.py` leva alguns minutos e bate em cem origens reais. Toda pergunta
que o JSON já responda deve ir para `relatorio.py`, que não repete a corrida:
`--ganhos`, `--perdas`, `--enganosos`, `--por-plataforma`, `--repo <busca>`.

## De onde vêm os repositórios

Três fontes, e a escolha muda o que se está medindo.

**`--fonte harvester`** — os repositórios que o HarvestBoard de fato mostra. É o
alvo natural, e **esse caminho ainda não foi exercitado**. Onde ele roda importa:
a porta 8090 não abre do shell da máquina, mas abre de dentro do container
`harvestboard_api` (`200.130.0.61:8090`, responde 401 sem credencial). A conexão
cai de forma intermitente — 1 em 3 tentativas deu `EHOSTUNREACH` num teste de
três —, que é a perda de metade das conexões descrita no CLAUDE.md e a razão de
`apps/integrations/harvester.py` repetir em falha de transporte.

Cuidado ao usá-lo: o `baseURL` **não** está no cadastro do repositório —
`oaiSource` volta `None`. Ele é campo do registro coletado, então o coletor pede
um registro da última coleta e lê o `origin`.

**`--fonte cache`** — o Redis da aplicação. As chaves `oai:link:v1:` guardam o
`baseURL` no próprio nome, o que faz de um cache quente uma lista de endereços
comprovadamente em uso, de graça e sem incomodar ninguém. O tamanho é o que o
uso tiver produzido: no cache desta máquina eram 5 chaves e 2 endereços. Foi por
aqui que apareceu o `baseURL` real da ESMAT.

**`--fonte re3data`** (padrão) — [diretório aberto](https://www.re3data.org) e
sem chave, que publica o `baseURL` OAI de cada repositório registrado. É o que
resta quando as duas de cima não estão ao alcance, e é de onde saíram os 99
repositórios que acompanham a semente.

A população do re3data muda a leitura do resultado: ela é forte em repositório
de dados (DSpace, Dataverse, CKAN) e quase não tem periódico OJS, que é a
maioria do que o HarvestBoard coleta. Por isso a ESMAT entra fixa como semente,
com o endereço que o Harvester tem cadastrado, e o relatório separa por
plataforma.

## As duas réguas

Cada registro é medido duas vezes, para que a comparação não dependa de trocar
de commit no meio da medição:

- **nova** — o endereço que `_resolver` devolve hoje: candidatas do metadado
  conferidas uma a uma, derivação pelo `setSpec` quando nenhuma sobrevive;
- **antiga** — o que a régua anterior teria escolhido, reconstruída inteira em
  `link_antigo()`: primeira candidata na ordem de preferência, devolvida sem
  conferência; sem candidata, derivação sem `setSpec` conferida só pelo status.

A conferência do experimento é própria e independente das duas: abre o
endereço, segue os redirecionamentos e pergunta se o que chegou ainda é a rota
de um item.

### Desfechos

| | |
|---|---|
| `ok` | abriu e continua sendo a rota de um item |
| `fora-da-rota` | respondeu 2xx/3xx, mas o redirecionamento levou para outro lugar — login, capa do periódico, busca |
| `bloqueado` | 401/403/405/429: WAF barrando cliente sem navegador, ou servidor que não implementa HEAD. **Não** é veredito sobre o endereço |
| `http-4xx`, `http-5xx` | a origem negou |
| `rede` | não deu para perguntar (DNS, conexão, TLS, tempo) |
| `sem-link` | a resolução não produziu endereço nenhum |

O número que interessa é **link enganoso**: `fora-da-rota` + `http-4xx` +
`http-5xx`, ou seja, a tela ofereceu um botão e o botão não leva à página do
item. É o desfecho pior de todos — "Endereço não disponível" avisa que não há
para onde ir, enquanto um botão que cai no login faz o usuário concluir que o
registro sumiu do repositório.

## Resultado: 350 repositórios `INDEXED`, dois estratos

350 repositórios sorteados entre os 1.596 do índice com `lastIndexStatus ==
INDEXED`, mais a semente da ESMAT. Mistura real do HarvestBoard: 206 OJS, 24
DSpace, 120 outras. 305 listaram registros, somando **1.033 itens medidos**.

```bash
uv run python ../experiment/exportar_indice.py
python /app/experiment/coletar_repositorios.py --fonte indice --quantidade 350 \
    --saida /app/experiment/data/repositorios-indexed.json      # no container
python /app/experiment/experimento.py \
    --entrada /app/experiment/data/repositorios-indexed.json \
    --saida /app/experiment/data/resultados-v2.json
uv run python ../experiment/analise.py --arquivo data/resultados-v2.json
```

| | antiga | nova |
|---|---|---|
| página do item abre | 74,9% [72,2–77,5] | **86,5% [84,3–88,5]** |
| **links enganosos** | **139** | **1** |
| OAI-PMH abre | — | 98,6% |

**+123 abriram, 3 deixaram** (as 3 com endereço idêntico nas duas réguas e
desfecho `rede` — não são regressão).

### O achado que mudou o estudo: viés de amostragem

Nos 226 repositórios que renderam os dois estratos:

| Estrato | itens | antiga | nova | ganho |
|---|---|---|---|---|
| `primeiros` (mais antigos) | 452 | 70,6% | 83,4% | +12,8 pts |
| `janela` (data sorteada) | 424 | **84,0%** | **91,3%** | **+7,3 pts** |

O `ListIdentifiers` entrega por datestamp crescente, então "os 2 primeiros" são
sempre os registros mais velhos do acervo — e eles são sistematicamente piores.
A primeira corrida deste experimento media só isso, sem saber, e reportava
+15 pontos de ganho. **O ganho real, em registro de data qualquer, é +7,3.**

### O árbitro tem erro medido

A conferência do título da página contra o do metadado dá **96,2% [94,7–97,3]**
de concordância em 871 casos julgados. O erro é permissivo: todas as taxas são
limite superior. Por regra:

| Fonte | concordância |
|---|---|
| `record:ojs` | 98,0% |
| `record:doi` | 96,7% |
| `record:dspace` | 76,2% |
| `record:primeira` | **0,0%** (0 de 5) |

**`record:primeira` não acertou nenhum caso** — entregou home de repositório e
página de fascículo. É o desempate por ordem de documento, usado quando nenhuma
regra reconhece o endereço; vale rever se deve produzir link.

### Outros achados

- **112 trocas `doi → ojs`**, e 103 dos 123 ganhos partiram de `http-4xx`: a
  forma do caso relatado é frequente.
- **61,3% dos 111 sem link** falham com `badArgument`, antes de qualquer escolha
  de URL — a origem recusa o identificador.
- **OAI-PMH abre em 98,6%** sem nenhum erro de endereço, servindo de piso.

## Amostragem estratificada por tipo de repositório

A primeira corrida sorteou 350 repositórios da população inteira, sem estrato.
Isso tem dois problemas, e os dois foram medidos.

### O tipo precisa ser conhecido para toda a população

Estratificar exige saber o estrato de **cada unidade do quadro**, não só das
sorteadas. O rótulo de plataforma que o coletor usava era palpite sobre a forma
da URL e falhava em ~34% dos casos, devolvendo `outra` — que não é um tipo.

`classificar_quadro.py` resolve perguntando ao `Identify` de cada origem, em
três níveis de evidência: `<toolkit><title>` (o software se declara), a forma do
`<sampleIdentifier>` (`article/1` é OJS, `123456789/1234` é DSpace) e o
`<repositoryName>`. Grava `data/quadro-amostral.json` com `tipo`, `natureza` e a
evidência que decidiu — e **retoma de onde parou**, porque a passagem completa
leva dezenas de minutos e atravessa origens instáveis.

```bash
python /app/experiment/classificar_quadro.py            # no container
python /app/experiment/coletar_repositorios.py --fonte quadro \
    --quantidade 500 --alocacao igual --estratificar-por tipo
```

### Alocação: igual, não proporcional

Os desvios por estrato no piloto são quase idênticos (0,380 no DSpace, 0,342 no
OJS, 0,336 nos demais), então a alocação de Neyman coincide com a proporcional e
não há ganho em ponderar por variância. A decisão é outra:

| Alocação | Para quê |
|---|---|
| `proporcional` | estimar o **total** da população |
| `igual` | **comparar tipos**, que é a pergunta ao estratificar por tipo |
| `censo` | estrato pequeno demais para amostrar |

Com alocação proporcional o DSpace ficaria com ~7% da amostra e margem de ±18
pontos. Como a população do estrato é de cerca de 110 repositórios, alcançar ±5
pontos por amostragem exigiria mais repositórios do que existem — **para o
DSpace, o certo é censo**.

### Um registro por repositório

O achado de desenho mais importante: o **ICC** do desfecho entre registros do
mesmo repositório é de 0,47 a 0,78. Se um registro abre, o outro quase
certamente abre.

| registros/repo | deff | registros p/ ±5 pts | repositórios |
|---|---|---|---|
| **1** | 1,00 | **196** | **196** |
| 2 | 1,75 | 343 | 172 |
| 4 | 3,25 | 637 | 160 |
| 8 | 6,25 | 1.225 | 154 |

Pelo custo desta medição, o tamanho ótimo de conglomerado é 0,5 → **1**. Passar
de 1 para 8 registros por repositório economiza 42 repositórios e custa 1.029
registros a mais. Por isso `--itens` passou a ter padrão 1.

### Os intervalos precisam da correção

`analise.py --secao desenho` e `quadros.taxa_por()` aplicam o efeito de desenho:
a proporção é a observada, mas a incerteza passa a refletir que os registros vêm
em conglomerados. Sem isso os intervalos ficam estreitos demais — na corrida v2,
os 1.033 registros valem **485** independentes.

## Análise exploratória

`analise.py` roda sobre qualquer `data/resultados*.json`, sem pandas — a máquina
já tem o ambiente do backend e nada mais, e trazer biblioteca de análise para
contar 600 linhas custaria mais do que a conta vale.

Nove seções, todas com `--secao` repetível: `visao`, `plataforma`, `regras`,
`migracao` (matriz antiga × nova), `dominios`, `tamanho`, `idade`, `oai` e
`achados`. `--csv` despeja as linhas achatadas — uma por registro, com os
atributos do repositório ao lado — para quem quiser levar a outra ferramenta.

As proporções vêm com intervalo de confiança de **Wilson**, não o normal: as
fatias ficam pequenas (uma regra com 3 itens, uma plataforma com 30), e ali o
intervalo normal escapa de [0, 1] e finge precisão que a amostra não tem.

### `quadros.py` — os mesmos dados em pandas

`analise.py` responde as perguntas que já sabemos fazer. `quadros.py` não
responde nenhuma: entrega os dados numa forma em que qualquer pergunta é uma
linha de código, para quando a próxima pergunta ainda não existe.

```bash
uv run --with pandas python ../experiment/quadros.py            # panorama
uv run --with pandas python ../experiment/quadros.py --csv
uv run --with pandas --with pyarrow python ../experiment/quadros.py --parquet
```

Pandas **não** é dependência do projeto, e não deve virar uma: ele serve para
explorar resultado de experimento, não para atender requisição. O
`uv run --with pandas` resolve na hora e não deixa rastro no `pyproject`.

Como biblioteca, que é o uso principal:

```python
import sys; sys.path.insert(0, "../experiment")
from quadros import carregar, taxa_por, migracao, trocas

reg, rep = carregar("../experiment/data/resultados-indexed.json")
taxa_por(reg.query('plataforma == "ojs"'), "nova_regra", minimo=3)
reg.query("nova_engana")[["repo", "nova_fonte", "nova_link"]]
rep.query("not listou").plataforma.value_counts()
```

Dois quadros, porque são duas unidades de observação: `registros` (595 × 51),
uma linha por item medido com os atributos do repositório ao lado; e
`repositorios` (350 × 14), que inclui **os que não listaram nada** — só ele
responde "quantas origens não atenderam", já que essas não aparecem no outro.

Os desfechos são `Categorical` ordenados do melhor para o pior, para que
`sort_values` e o eixo de um gráfico saiam na ordem que significa alguma coisa.
As colunas derivadas (`nova_ok`, `nova_engana`, `ganho`, `perda`,
`trocou_endereco`, `saiu_do_dominio`) já vêm prontas, porque são o vocabulário
de toda pergunta daqui.

Duas armadilhas que o arquivo evita, e que valem para qualquer análise sobre
estes dados: `groupby` descarta grupo nulo por padrão, e aqui **o nulo é um
resultado** — sem tratar, as fatias somavam 509 de 595 sem avisar; e, em dtype
objeto, ausente ≠ ausente é `True`, o que fazia os 69 registros que nenhuma das
réguas resolveu aparecerem como "trocou de endereço".

O primeiro recorte que ele rendeu e o `analise.py` não mostrava: dentro do OJS,
nos registros em que a régua nova escolhe a rota `ojs`, o acerto vai de **57,4%
para 97,5%** — 162 itens. É ali que a correção trabalha.

## Arquivos

| | |
|---|---|
| **`RELATORIO.md`** | **o experimento contado do começo ao fim: pergunta, método, resultados, discussão e conclusão** |
| `ambiente.py` | acha o backend e configura o Django, aqui e no container |
| `classificar_quadro.py` | apura o **tipo** de cada repositório da população, pelo `Identify` |
| `coletar_repositorios.py` | monta `data/repositorios*.json` (índice, re3data, cache ou Harvester) |
| `experimento.py` | roda a medição, grava `data/resultados*.json`, imprime o resumo |
| `relatorio.py` | relê um resultado sem repetir a corrida |
| `analise.py` | análise exploratória em terminal, sem dependência |
| `quadros.py` | os mesmos dados em DataFrames do pandas |
| `exportar_indice.py` | despeja `data/indice-repositorios.json` do cache da aplicação |

Os scripts ficam na raiz e tudo o que eles produzem vai para `data/`: é saída de
corrida, não código, e a separação deixa claro o que dá para apagar e refazer.

## `indice-repositorios.json`

Os 2.183 repositórios do Harvester com cadastro e resumo da última coleta, lidos
da chave `repositories:v1:index` do Redis — a que `warm_repository_index`
preenche e que vale 12 h. O script só **lê**: com cache frio ele avisa e sai, em
vez de disparar sem querer a consulta de ~40 s na origem.

Da exportação de 2026-09-20:

| | |
|---|---|
| repositórios | 2.183 |
| nunca coletados | 8 |
| registros na última coleta | 4.970.249 (4.245.255 válidos) |
| estado da coleta | 1.686 `VALID`, 450 `HARVESTING_FINISHED_ERROR`, 33 `HARVESTING_FINISHED_VALID`, 6 `HARVESTING` |
| estado do índice | 1.596 `INDEXED`, 574 `UNKNOWN`, 5 `FAILED` |
| coletas entre | 2017-12-01 e 2026-09-19 |

**Não serve para alimentar o `experimento.py` direto**: falta o `baseURL` OAI,
que o cadastro não tem. Serve para escolher e descrever repositórios — por
exemplo, sortear uma amostra só entre os 1.596 indexados, que são os que o
HarvestBoard consegue mostrar registro a registro.
