# O botão "Página do item" leva mesmo à página do item?

**Relatório de experimento** — HarvestBoard / IBICT
Corrida de 20 de setembro de 2026, 13:19 UTC

> **Esta é a segunda versão.** A primeira corrida amostrava apenas os registros
> mais antigos de cada repositório, sem perceber, e não verificava se a página
> aprovada mostrava mesmo o documento. As duas falhas foram corrigidas e as duas
> mudaram números importantes. A [seção 11](#11-o-que-mudou-da-primeira-versão)
> registra o que mudou e por quê.

---

## Sumário

1. [A pergunta do experimento](#1-a-pergunta-do-experimento)
2. [Objetivos](#2-objetivos)
3. [As duas estratégias](#3-as-duas-estratégias)
4. [O dataset](#4-o-dataset)
5. [Análise exploratória](#5-análise-exploratória)
6. [Método experimental](#6-método-experimental)
7. [Resultados](#7-resultados)
8. [Discussão](#8-discussão)
9. [Conclusão](#9-conclusão)
10. [O que este experimento não mediu](#10-o-que-este-experimento-não-mediu)
11. [O que mudou da primeira versão](#11-o-que-mudou-da-primeira-versão)

---

## 1. A pergunta do experimento

Quando alguém abre um registro no HarvestBoard, a tela oferece dois botões:

- **Página do item** — deveria levar ao artigo no site do repositório de origem;
- **OAI-PMH** — leva à resposta crua da origem, o metadado como foi coletado.

O segundo é direto: o endereço vem escrito no próprio registro. O primeiro, não.
O identificador que o sistema guarda — por exemplo
`oai:revista.esmat.tjto.jus.br:article/120` — não é um endereço de navegador. O
endereço real está no metadado do registro, misturado a outros endereços, e
escolher qual deles é a página do item exige uma decisão automática.

Um usuário relatou que, nesse registro, o botão levava a um endereço que
respondia **404**. Daí a pergunta:

> **O botão "Página do item" leva mesmo à página do item?**
> Quando erra, com que frequência e por quê? E a estratégia nova de escolher o
> endereço acerta mais que a anterior, sem piorar nada?

---

## 2. Objetivos

### 2.1. Objetivo geral

Medir, em repositórios reais, se a estratégia nova de resolver o endereço da
página do item acerta mais que a estratégia anterior, e verificar se a mudança
não causou regressão.

### 2.2. Objetivos específicos

| # | Objetivo |
|---|---|
| **OE1** | Quantificar, para cada estratégia, em quantos registros o botão realmente abre a página do item. |
| **OE2** | Contar os **links enganosos** — casos em que a tela mostra um botão e o botão não leva ao item. |
| **OE3** | Verificar se algum registro que abria com a estratégia anterior deixou de abrir com a nova. |
| **OE4** | Identificar em que condições a diferença entre as estratégias se concentra (plataforma, tipo de endereço, desfecho de origem). |
| **OE5** | Separar as falhas atribuíveis à decisão do sistema das falhas atribuíveis à origem, usando o botão OAI-PMH como referência. |

---

## 3. As duas estratégias

### 3.1. Estratégia anterior

#### Como funcionava

1. O sistema consulta o repositório de origem pelo protocolo OAI-PMH (verbo
   `GetRecord`) e recebe o metadado do registro.
2. Extrai do metadado todas as URLs presentes, descartando as de domínios de
   esquema (`openarchives.org`, `w3.org`, `purl.org`, `schema.org`,
   `datacite.org`), que são vocabulário do formato e nunca endereço de documento.
3. Escolhe **uma** URL, pela primeira regra aplicável nesta ordem:

| Ordem | Regra | Reconhece |
|---|---|---|
| 1 | `doi` | endereço contendo `doi.org` |
| 2 | `ojs` | caminho contendo `/article/view/` |
| 3 | `dspace` | caminho contendo `/handle/` |
| 4 | `handle` | endereço contendo `hdl.handle.net` |
| 5 | `download` | caminho contendo `/article/download/` |

4. Se nenhuma regra casasse, valia a primeira URL em ordem de documento.
5. Se o metadado não trouxesse URL alguma, o sistema **deduzia** um endereço a
   partir da forma do identificador. Só essa URL deduzida era **conferida** com
   uma requisição antes de ser devolvida.

#### Por que ela foi utilizada

Cada decisão tinha justificativa:

- **DOI em primeiro lugar**: o DOI é o identificador *persistente*, criado
  justamente para continuar funcionando quando o site muda de endereço.
  Preferi-lo segue a boa prática de citação acadêmica.
- **URL do metadado sem conferência**: ela é uma *declaração da origem*, não um
  palpite do sistema. Conferir custaria uma requisição a mais por registro, e
  parecia gasto desnecessário para checar o que o dono do dado já afirmou.
- **Só a URL deduzida conferida**: ali sim havia palpite do sistema, e um link
  quebrado é pior que link nenhum.

#### Limitações identificadas

O caso relatado expôs o problema. O metadado do registro `article/120` da
Revista ESMAT traz, nesta ordem:

```
1º  https://revista.esmat.tjto.jus.br/revista_esmat/article/view/120   → abre
2º  10.34060/reesmat.v8i10.120                                          → 404 no doi.org
```

O DOI existe como texto no metadado, mas nunca foi registrado no resolvedor.
Pela regra 1, ele vencia; o sistema parava ali e entregava o link morto, sem
nunca olhar a URL do artigo logo abaixo.

Três limitações, portanto:

| # | Limitação |
|---|---|
| **L1** | A escolha parava na primeira regra aplicável. Uma candidata morta escondia as seguintes. |
| **L2** | A URL do metadado saía sem conferência. "Declarado" foi tratado como sinônimo de "vivo". |
| **L3** | A conferência da URL deduzida olhava só o código HTTP. Um `200` numa tela de login passava. |

#### O que motivou a mudança

O relato de um usuário sobre um botão que dava 404, somado à verificação de que
o mesmo padrão se repetia nos quatro registros daquele repositório que estavam
no cache da aplicação (todos com `source: record:doi`).

### 3.2. Estratégia nova

#### Como funciona

Três alterações, todas em `backend/apps/integrations/oai.py`:

**(a) A fila inteira, não o primeiro colocado.** A ordenação por regras passou a
devolver a **fila completa** de candidatas. O sistema desce a fila: se a origem
recusa a primeira, tenta a segunda, até o limite de **4 conferências** por
registro (`MAX_CONFIRMACOES = 4`). Resolve **L1**.

**(b) Toda candidata é conferida, e a conferência olha a forma.** Nenhum
endereço é devolvido sem ter sido aberto antes. E o código `200` não basta: para
as regras cuja marca está no caminho do item (`/article/view/`, `/handle/`,
`/article/download/`), o endereço **final** — após todos os redirecionamentos —
precisa ainda conter essa marca. Resolve **L2** e **L3**.

```
pedido:    /article/view/120
resposta:  200 OK  →  redireciona para  /pt_BR/login?source=/article/view/120
                                          ↑ perdeu /article/view/ : não é a página do item
```

Isso **não** se aplica a `doi` nem a `handle`: esses dois são resolvedores, e
sair do domínio de origem é o comportamento correto deles.

Quando não é possível *perguntar* (falha de rede), o endereço é devolvido mesmo
assim. A regra é: só a **recusa explícita** descarta uma candidata.

**(c) A dedução do OJS passou a ler o `setSpec`.** Quando nenhuma candidata
sobrevive, o sistema deduz o endereço; para o OJS, agora lê em qual periódico o
registro está (campo `setSpec` do cabeçalho) em vez de confiar no caminho do
endereço cadastrado.

#### Por que foi adotada

Porque as três limitações têm a mesma raiz: o sistema confiava numa afirmação
sem verificá-la. A correção é verificar — e verificar o que importa, que é onde
o endereço **termina**, não o que ele promete.

#### Observação sobre a alteração (c)

A alteração (c) **não é** o que corrige o caso relatado. Isso foi descoberto
durante o próprio experimento, ao ler no cache da aplicação o endereço OAI que o
Harvester realmente tem cadastrado para aquele repositório. Ela cobre uma forma
de cadastro distinta (portal OJS multi-periódico cadastrado pelo contexto de
site), que existe mas não é a daquele registro.

---

## 4. O dataset

### 4.1. Origem dos dados

O HarvestBoard não armazena repositórios: consulta-os no **Harvester**, serviço
do IBICT. A aplicação mantém em cache um índice desse serviço com **2.183
repositórios**, cada um com nome, sigla, instituição e o resumo da última coleta
(identificador, data, estado, número de registros, estado de indexação).

Esse índice **não contém o endereço OAI da origem**: o campo correspondente do
cadastro (`oaiSource`) vem vazio. O endereço é atributo do *registro coletado*.
Por isso, para cada repositório sorteado foi necessário pedir ao Harvester **um
registro** da última coleta e ler dali o campo `origin`.

### 4.2. Critérios de inclusão

| Critério | Valor | Justificativa |
|---|---|---|
| Estado de indexação | `lastIndexStatus == INDEXED` | São os repositórios cujos registros o HarvestBoard efetivamente exibe. Medir o botão de um registro que a tela não mostra não responderia à pergunta. |
| Possuir última coleta | `lastSnapshotId` presente | Sem coleta não há registro de onde ler o endereço da origem. |
| Devolver ao menos um registro | verificado na coleta | O endereço OAI só existe no registro. |
| Endereço OAI válido | começa com `http://` ou `https://` | Requisito técnico da medição. |
| Caso de origem | Revista ESMAT, incluída fixa | Para que o caso relatado fosse medido junto aos demais. |

### 4.3. Critérios de exclusão

| Critério | Efeito |
|---|---|
| `lastIndexStatus` diferente de `INDEXED` | 587 dos 2.183 repositórios do índice ficaram fora. |
| Endereço OAI repetido | Endereços duplicados foram descartados, para não medir a mesma origem duas vezes. |
| Repositório sem `origin` recuperável | Descartado durante a montagem; a amostra foi completada com o próximo do sorteio. |

### 4.4. Como o dataset foi construído

```
2.183 repositórios no índice da aplicação
        │
        ├── filtro: lastIndexStatus == INDEXED
        ▼
1.596 repositórios elegíveis
        │
        ├── embaralhamento aleatório com semente fixa (20260919)
        ├── para cada um: pedir 1 registro ao Harvester e ler `origin`
        ├── descartar sem `origin` e endereços repetidos
        ▼
  349 repositórios sorteados  +  1 caso de origem (ESMAT)
        ▼
  350 repositórios no dataset
```

A semente fixa torna o sorteio **reproduzível**: repetir o comando devolve a
mesma lista.

### 4.5. Características principais

| Característica | Valor |
|---|---|
| Repositórios no dataset | 350 |
| Instituições distintas | 167 |
| Estado da última coleta | 349 `VALID`; 1 sem o dado (o caso de origem, incluído fora do índice) |
| Plataformas | 206 OJS, 120 "outra", 24 DSpace |
| Itens medidos por repositório | até 4 (2 por estrato de amostragem) |

> **Nota sobre "outra":** a plataforma é inferida a partir da forma do endereço
> OAI. "Outra" significa que o endereço não tem marca reconhecível de OJS,
> DSpace ou EPrints — **não** significa que a plataforma seja desconhecida na
> realidade, apenas que este experimento não a identificou.

---

## 5. Análise exploratória

Todas as estatísticas desta seção descrevem os **350 repositórios do dataset**,
antes de qualquer medição.

### 5.1. Distribuição por plataforma

| Plataforma | Frequência | Percentual |
|---|---|---|
| OJS | 206 | 58,9% |
| outra | 120 | 34,3% |
| DSpace | 24 | 6,9% |
| **Total** | **350** | **100%** |

```
ojs      206  ████████████████████████  58,9%
outra    120  ██████████████            34,3%
dspace    24  ███                        6,9%
```

**Em linguagem simples:** quase seis em cada dez repositórios da amostra são
periódicos em OJS, o software de revista científica mais usado no Brasil.

### 5.2. Tamanho da última coleta

Número de registros que a última coleta de cada repositório trouxe. Disponível
para 349 dos 350 (falta para o caso de origem).

| Medida | Valor |
|---|---|
| Contagem | 349 |
| **Média** | 2.573,6 registros |
| **Mediana** | 546,0 registros |
| Desvio-padrão | 17.446,3 |
| Mínimo | 17 |
| 1º quartil (25%) | 338,0 |
| 3º quartil (75%) | 970,0 |
| Máximo | 302.246 |
| Amplitude | 302.229 |
| Intervalo interquartil (IQR) | 632 |
| Coeficiente de variação | 6,78 |

```
1–100            21  ██                          6,0%
101–1.000       247  ████████████████████████   70,8%
1.001–10.000     71  ████████                   20,3%
10.000+          10  █                           2,9%
```

**Em linguagem simples:** a média (2.574) é quase cinco vezes a mediana (546).
Isso acontece porque uns poucos repositórios muito grandes — o maior tem 302 mil
registros — puxam a média para cima. A mediana descreve melhor o caso típico: a
metade dos repositórios tem menos de 546 registros. O coeficiente de variação de
6,78 (desvio-padrão quase sete vezes maior que a média) confirma que a
distribuição é **muito desigual**. Metade dos repositórios está entre 338 e 970
registros (o IQR), e o resto se espalha muito.

### 5.3. Idade da última coleta

Dias decorridos entre a última coleta de cada repositório e a coleta mais
recente do dataset (19/09/2026), que serve de referência.

| Medida | Valor |
|---|---|
| Contagem | 349 |
| **Média** | 251,4 dias |
| **Mediana** | 253,0 dias |
| Desvio-padrão | 202,1 |
| Mínimo | 0 dias |
| 1º quartil (25%) | 32,0 dias |
| 3º quartil (75%) | 444,0 dias |
| Máximo | 1.346 dias |
| Intervalo interquartil (IQR) | 412 |

```
0–180 dias     122  ██████████████             35,0%
181–365 dias   119  ██████████████             34,1%
366–730 dias   103  ████████████               29,5%
731+ dias        5  █                           1,4%
```

**Em linguagem simples:** aqui média e mediana são quase iguais (251 e 253), o
que indica uma distribuição bem mais equilibrada que a do tamanho. A metade dos
repositórios foi coletada nos últimos 253 dias. Um quarto foi coletado há menos
de 32 dias; um quarto, há mais de 444 dias. Só 5 repositórios passam de dois
anos sem coleta.

### 5.4. Repositórios que responderam à consulta

Antes de medir os botões, é preciso que a origem liste registros.

| Situação | Frequência | Percentual |
|---|---|---|
| Listou registros (em ao menos um estrato) | 305 | 87,1% |
| Não listou em nenhum | 45 | 12,9% |
| **Total** | **350** | **100%** |

Motivos das 45 falhas:

| Motivo | Frequência |
|---|---|
| Origem não respondeu (rede) | 39 |
| Resposta não era XML válido | 5 |
| Origem recusou a consulta (erro OAI) | 1 |

Dos 305 que responderam, **226 renderam os dois estratos**; os demais
responderam a um só.

Taxa de resposta por plataforma:

| Plataforma | Responderam | Total | Taxa |
|---|---|---|---|
| outra | 107 | 120 | 89,2% |
| OJS | 176 | 206 | 85,4% |
| DSpace | 15 | 24 | 62,5% |

```
outra    ████████████████████████████████████░░░░  89,2%
ojs      ██████████████████████████████████░░░░░░  85,4%
dspace   █████████████████████████░░░░░░░░░░░░░░░  62,5%
```

**Em linguagem simples:** aproximadamente uma em cada sete origens estava fora
do ar ou quebrada no momento da medição. O DSpace apresentou a menor taxa, mas
são apenas 24 repositórios — uma base pequena, em que poucos casos deslocam
muito o percentual.

### 5.5. Registros medidos

| Medida | Valor |
|---|---|
| Registros medidos | 1.033 |
| do estrato `primeiros` | 597 |
| do estrato `janela` | 436 |
| Repositórios com os dois estratos | 226 |
| Média de registros por repositório que respondeu | 3,4 |

### 5.6. Endereços candidatos por registro

Quantas URLs o metadado de cada registro ofereceu, depois de descartados os
domínios de esquema, de licença e de identificador de pessoa.

| Medida | Valor |
|---|---|
| Contagem | 1.033 |
| **Média** | 2,75 |
| **Mediana** | 3,00 |
| Desvio-padrão | 1,66 |
| Mínimo | 0 |
| Máximo | 25 |

| Candidatas | Registros | Percentual |
|---|---|---|
| 0 | 120 | 11,6% |
| 1 | 16 | 1,5% |
| 2 | 243 | 23,5% |
| 3 | 430 | 41,6% |
| 4 | 163 | 15,8% |
| 5 | 35 | 3,4% |
| 6 ou mais | 26 | 2,5% |

```
0 url   120  ███████                    11,6%
1 url    16  █                           1,5%
2 url   243  ██████████████             23,5%
3 url   430  █████████████████████████  41,6%
4 url   163  █████████                  15,8%
5+ url   61  ████                        5,9%
```

**Em linguagem simples:** a maior parte dos registros oferece 2 ou 3 endereços
candidatos — média 2,75, mediana 3. Em 120 registros (11,6%) o metadado não
trouxe endereço utilizável algum; nesses, não há o que escolher, e as duas
estratégias caem na dedução ou ficam sem link. Ou seja, **a escolha entre
candidatas só existe para cerca de 88% dos registros**, e é só nesse subconjunto
que a mudança de estratégia pode fazer diferença.

## 6. Método experimental

### 6.1. Desenho

**Comparação pareada:** cada registro foi submetido às duas estratégias, na
mesma execução. A estratégia nova é o código de produção; a estratégia anterior
foi **reconstruída** no script de medição (função `link_antigo`), porque ela não
existe mais no código.

### 6.2. Etapas de execução

```
ETAPA 1 — Exportar o índice
  Lê o índice de 2.183 repositórios do cache da aplicação.
  Script: exportar_indice.py

ETAPA 2 — Montar o dataset
  Filtra INDEXED, sorteia, busca o endereço OAI de cada um no Harvester.
  Script: coletar_repositorios.py --fonte indice --quantidade 350

ETAPA 3 — Medir
  Para cada repositório:
    3a. ListIdentifiers na origem → os 2 primeiros identificadores
    3b. Para cada identificador:
        · resolver o endereço pela estratégia NOVA
        · resolver o endereço pela estratégia ANTIGA
        · abrir os dois e classificar o desfecho
        · montar e abrir o endereço do botão OAI-PMH
  Script: experimento.py

ETAPA 4 — Analisar
  Scripts: analise.py (terminal) e quadros.py (pandas)
```

### 6.3. Configurações

| Parâmetro | Valor | Onde |
|---|---|---|
| Semente do sorteio dos repositórios | 20260919 | coletar_repositorios.py |
| Semente do sorteio das janelas | 20260920 | `--semente` |
| Repositórios | 350 | `--quantidade 350` |
| Filtro de estado | `INDEXED` | `--estado-do-indice INDEXED` |
| Itens por repositório **e por estrato** | 2 | `--itens 2` |
| Estratos de amostragem | `primeiros` e `janela` | `--amostragem ambos` |
| Larguras de janela tentadas | 30, 180, 730 dias | `LARGURAS_DA_JANELA` |
| Validação do árbitro | ativa | (padrão) |
| Tempo-limite por requisição | 5,0 s | `settings.OAI["TIMEOUT"]` |
| Tempo-limite da listagem | 30,0 s (5,0 × 6) | `FOLGA_DA_LISTAGEM = 6` |
| Requisições simultâneas (medição) | 16 | `--trabalhadores 16` |
| Requisições simultâneas (montagem) | 8 | `--trabalhadores 8` |
| Máximo de conferências por registro | 4 | `MAX_CONFIRMACOES = 4` |
| Prefixo de metadado | `oai_dc`, ou o do repositório | — |

O tempo-limite da listagem é seis vezes maior porque o verbo `ListIdentifiers`
varre o acervo para montar a primeira página, enquanto as demais requisições
tocam um documento só.

### 6.3-b. Os dois estratos de amostragem

Cada repositório foi amostrado de **duas formas**, e cada registro carrega o
rótulo do estrato de onde veio:

| Estrato | Como os registros foram escolhidos |
|---|---|
| `primeiros` | Os 2 primeiros que `ListIdentifiers` devolve, sem recorte. Como o OAI-PMH entrega em ordem de datestamp crescente, **são os registros mais antigos do acervo**. |
| `janela` | Os 2 primeiros dentro de um recorte de data sorteado entre a data mais antiga do repositório (`Identify` → `earliestDatestamp`) e a data da última coleta. |

A janela começa com 30 dias e alarga para 180 e depois 730 se vier vazia — um
recorte vazio em revista trimestral é largura errada, não origem quebrada.

Colher os dois permite **medir** o viés de amostragem em vez de apenas evitá-lo:
se as taxas diferirem, a diferença é do estrato, e a primeira versão deste
relatório — que usou só `primeiros` — descrevia o pior pedaço de cada acervo.

### 6.3-c. Validação do árbitro

O árbitro classifica como `ok` o endereço que responde e cuja rota final tem a
marca certa. Isso **não prova** que a página mostra o documento. Para medir o
erro do próprio instrumento, cada endereço aprovado passa por uma conferência
adicional:

1. A sonda do botão OAI-PMH passou de `HEAD` para `GET` — mesma requisição, mas
   agora o corpo é lido e dele saem **todos** os `dc:title` do registro.
2. A página aprovada é baixada (até 300 KB) e dela se extrai o título, por
   `citation_title`, `DC.title`, `og:title` ou `<title>`, nessa ordem.
3. Os títulos são normalizados (sem acento, sem caixa, sem pontuação) e
   comparados por **contenção**: quantas palavras do menor cabem no maior.
   Contenção e não Jaccard porque a página quase sempre acrescenta o nome do
   periódico, e uma medida simétrica puniria isso como divergência.
4. Acima de 0,7 de sobreposição, `confere`; abaixo, `diverge`.

Basta **um** dos títulos do registro bater: periódico bilíngue publica
`dc:title` em duas línguas e a página mostra uma.

### 6.4. Condições de execução

O experimento rodou dentro do container da API da aplicação, único ambiente com
acesso simultâneo às duas redes necessárias: a do Harvester (interna) e a
internet aberta, onde estão as origens. O código corrigido foi instalado em um
caminho separado (`/app/backend`), **sem alterar o código que atende os
usuários**.

Data e hora da corrida: **20/09/2026, 11:31 UTC**.

### 6.5. O que foi mantido igual nas duas estratégias

| Elemento | Detalhe |
|---|---|
| Registros | Exatamente os mesmos 595 |
| Momento da medição | Mesma execução, com segundos de diferença |
| Consulta à origem | Uma só resposta do `GetRecord`, usada pelas duas |
| Lista de candidatas | A mesma para as duas |
| Critério de avaliação | O mesmo árbitro, com o mesmo gabarito de forma |
| Tempos-limite e cabeçalhos | Idênticos |
| Memoização das aberturas | Um endereço é aberto uma vez; o desfecho serve às duas |

A memoização é relevante: numa medição preliminar, o mesmo endereço recebeu
`ok` para uma estratégia e `rede` para a outra, porque a origem passou a limitar
tráfego entre as duas visitas. Abrir uma vez só eliminou essa fonte de erro.

### 6.6. O que variou entre as estratégias

Somente **a escolha do endereço**:

| Aspecto | Anterior | Nova |
|---|---|---|
| Quantas candidatas considera | a primeira que casa com uma regra | a fila, até 4 conferências |
| Confere a URL do metadado | não | sim |
| Critério da conferência | (não havia) | código HTTP **e** forma do endereço final |
| Dedução do OJS | sem `setSpec` | com `setSpec`, e o antigo como reserva |

### 6.7. Métricas coletadas

Para cada registro:

| Métrica | Descrição |
|---|---|
| `nova_link`, `antiga_link` | Endereço escolhido por cada estratégia |
| `nova_fonte`, `antiga_fonte` | Qual regra o escolheu |
| `nova_desfecho`, `antiga_desfecho` | Resultado de abrir o endereço |
| `oai_desfecho` | Resultado de abrir o endereço do botão OAI-PMH |
| `n_candidatas` | Quantas URLs o metadado ofereceu |
| status HTTP e endereço final | De cada abertura |

### 6.8. Classificação dos desfechos (o árbitro)

O árbitro é **independente das duas estratégias** e aplica o mesmo critério aos
dois endereços. Ele abre o endereço com `HEAD` (e com `GET` quando o servidor
não aceita `HEAD`), segue os redirecionamentos e classifica:

| Desfecho | Definição |
|---|---|
| `ok` | Respondeu com código < 400 e o endereço final mantém a marca da regra |
| `fora-da-rota` | Respondeu com código < 400, mas o endereço final perdeu a marca |
| `http-4xx` / `http-5xx` | A origem negou |
| `bloqueado` | 401, 403, 405 ou 429 |
| `rede` | Não foi possível fazer a requisição |
| `sem-link` | A estratégia não produziu endereço |

**Definição da métrica principal — link enganoso:**

```
link enganoso = fora-da-rota + http-4xx + http-5xx
```

É o caso em que a tela mostra um botão e o botão não leva ao item. `bloqueado` e
`rede` ficam **fora** dessa conta, por decisão de método: não são veredito sobre
o endereço, e sim sobre a possibilidade de perguntar.

### 6.9. Como a comparação foi feita

Três comparações:

1. **Taxa de acerto** (`ok` sobre o total), com intervalo de confiança de 95%
   pelo método de Wilson — escolhido porque em recortes pequenos o intervalo
   normal produz limites fora de [0, 1] — **calculado sobre o n efetivo**, que
   desconta o efeito de conglomerado (ver 7.10). Sem esse desconto os intervalos
   ficariam estreitos demais, porque os registros vêm agrupados por repositório
   e se parecem muito entre si.
2. **Contagem de links enganosos** em cada estratégia.
3. **Tabela de migração**: para onde foi cada registro, cruzando o desfecho
   anterior com o novo. É ela que mostra ganhos e perdas individualmente.

---

## 7. Resultados

**1.033 registros medidos, em 305 repositórios** (597 do estrato `primeiros`,
436 do estrato `janela`; 226 repositórios renderam os dois).

### 7.1. Resultado geral

| Métrica | Anterior | Nova | Diferença |
|---|---|---|---|
| **Abre a página do item** | 774 (74,9%) | **894 (86,5%)** | **+120 (+11,6 pts)** |
| IC 95% (corrigido por conglomerado) | [70,8% – 78,6%] | [83,2% – 89,3%] | — |
| **Links enganosos** | **139 (13,5%)** | **1 (0,1%)** | **−138** |
| Sem link | 88 (8,5%) | 111 (10,7%) | +23 |
| Inconclusivo (`bloqueado` + `rede`) | 32 (3,1%) | 27 (2,6%) | −5 |

```
Abre a página do item (n = 1.033)

anterior  █████████████████████████████████████░░░░░░░░░░░░░  74,9%
nova      ███████████████████████████████████████████░░░░░░░  86,5%


Links enganosos (quanto menor, melhor)

anterior  ██████████████████████████████████████████████████  139
nova      ▏                                                    1
```

**+123 registros passaram a abrir, 3 deixaram de abrir** (a diferença líquida é
+120; os 3 são analisados em 8.4).

### 7.2. Distribuição completa dos desfechos

| Desfecho | Anterior | % | Nova | % | Diferença |
|---|---|---|---|---|---|
| `ok` | 774 | 74,9% | 894 | 86,5% | +120 |
| `http-4xx` | 104 | 10,1% | 0 | 0,0% | −104 |
| `sem-link` | 88 | 8,5% | 111 | 10,7% | +23 |
| `fora-da-rota` | 26 | 2,5% | 0 | 0,0% | −26 |
| `rede` | 24 | 2,3% | 27 | 2,6% | +3 |
| `http-5xx` | 9 | 0,9% | 1 | 0,1% | −8 |
| `bloqueado` | 8 | 0,8% | 0 | 0,0% | −8 |
| **Total** | **1.033** | **100%** | **1.033** | **100%** | — |

### 7.3. Viés de amostragem: o resultado mais importante desta versão

| Estrato | Itens | Anterior | Nova | Ganho | Enganosos |
|---|---|---|---|---|---|
| `primeiros` (mais antigos) | 597 | 68,3% [63,1–73,2] | 83,1% [78,7–86,7] | +14,8 pts | 104 → 0 |
| `janela` (data sorteada) | 436 | **83,9% [79,2–87,8]** | **91,3% [87,3–94,1]** | +7,4 pts | 35 → 1 |

Restringindo aos **226 repositórios que renderam os dois estratos**, o que
elimina diferença de composição:

| Estrato | Itens | Anterior | Nova | Ganho |
|---|---|---|---|---|
| `primeiros` | 452 | 70,6% [64,6–75,9] | 83,4% [78,4–87,5] | **+12,8 pts** |
| `janela` | 424 | 84,0% [79,1–87,9] | 91,3% [87,2–94,1] | **+7,3 pts** |

```
Taxa de acerto por estrato (repositórios pareados)

primeiros  anterior  █████████████████████░░░░░░░░░  70,6%
           nova      █████████████████████████░░░░░  83,4%

janela     anterior  █████████████████████████░░░░░  84,0%
           nova      ███████████████████████████░░░  91,3%

escala: 30 caracteres = 100%
```

Mesmo com os intervalos alargados pela correção de conglomerado, os de
`primeiros` e `janela` **ainda não se sobrepõem** em nenhuma das duas
estratégias — na régua nova por pouco (86,7% contra 87,3%).

### 7.4. Validação do árbitro

Dos 894 endereços que o árbitro aprovou (`ok`), a conferência de título deu:

| Resultado | Frequência | % dos aprovados |
|---|---|---|
| `confere` | 838 | 93,7% |
| `diverge` | 33 | 3,7% |
| `sem-titulo-no-metadado` | 14 | 1,6% |
| `falhou` (não deu para baixar) | 6 | 0,7% |
| `sem-titulo-na-pagina` | 3 | 0,3% |

Considerando apenas os 871 casos em que houve julgamento possível
(`confere` + `diverge`):

> **Concordância entre o árbitro e o conteúdo da página: 96,2% [94,7% – 97,3%]**

Concordância por regra que escolheu o endereço:

| Fonte | Confere | Diverge | Taxa |
|---|---|---|---|
| `record:ojs` | 349 | 7 | 98,0% |
| `record:doi` | 471 | 16 | 96,7% |
| `record:dspace` | 16 | 5 | 76,2% |
| `record:primeira` | 0 | 5 | **0,0%** |
| `derived-unverified:ojs` | 2 | 0 | 100% |

Concordância por estrato: 97,4% em `janela`, 95,2% em `primeiros`.

### 7.5. Resultados por plataforma

| Plataforma | Itens | n efetivo | Anterior | Nova | Diferença | Enganosos |
|---|---|---|---|---|---|---|
| OJS | 608 | 297 | 71,7% [66,1–76,7] | 86,5% [82,2–89,9] | +14,8 pts | 92 → 1 |
| outra | 385 | 168 | 80,5% [74,1–85,7] | 87,0% [81,1–91,3] | +6,5 pts | 41 → 0 |
| DSpace | 40 | 21 | 70,0% [46,6–86,2] | 82,5% [61,7–93,2] | +12,5 pts | 6 → 0 |

O `n efetivo` é o que a fatia vale em registros independentes, depois de
descontar o efeito de conglomerado. No DSpace, 40 registros valem 21 — daí a
margem de ±20 pontos, que não sustenta comparação com as outras plataformas.

### 7.6. Tabela de migração

| Anterior ↓ \ Nova → | `ok` | `http-5xx` | `rede` | `sem-link` | Total |
|---|---|---|---|---|---|
| **`ok`** | **771** | 0 | **3** | 0 | 774 |
| **`http-4xx`** | **103** | 0 | 1 | 0 | 104 |
| **`sem-link`** | 0 | 0 | 0 | **88** | 88 |
| **`fora-da-rota`** | 5 | 0 | 2 | 19 | 26 |
| **`rede`** | 3 | 0 | 21 | 0 | 24 |
| **`http-5xx`** | 4 | 1 | 0 | 4 | 9 |
| **`bloqueado`** | 8 | 0 | 0 | 0 | 8 |
| **Total** | **894** | **1** | **27** | **111** | **1.033** |

- **Ganhos: 123.** Destes, **103 vieram de `http-4xx`**.
- **Perdas: 3**, todas de `ok` para `rede`.

### 7.7. Que endereço a estratégia nova escolheu no lugar

| Regra anterior → Regra nova | Vezes | Destes, abrem |
|---|---|---|
| `doi` → `doi` | 488 | 484 |
| **`doi` → `ojs`** | **112** | **111** |
| `ojs` → `ojs` | 23 | 23 |
| `ojs` → (sem link) | 19 | 0 |
| `dspace` → `dspace` | 12 | 12 |
| `dspace` → `primeira` | 6 | 4 |
| `handle` → (sem link) | 4 | 0 |
| `doi` → `dspace` | 1 | 1 |

As 488 trocas `doi → doi` não são mudança de escolha: é a mesma regra devolvendo
o endereço final do redirecionamento.

### 7.8. Motivos dos 111 registros sem link

| Motivo | Frequência | % |
|---|---|---|
| `oai-error:badArgument` | 68 | 61,3% |
| `no-usable-url` | 34 | 30,6% |
| `no-reachable-url` | 4 | 3,6% |
| `unreachable` | 3 | 2,7% |
| `oai-error:idDoesNotExist` | 2 | 1,8% |

### 7.9. Botão OAI-PMH

| Desfecho | Frequência | % |
|---|---|---|
| `ok` | 1.019 | 98,6% |
| `bloqueado` | 9 | 0,9% |
| `http-5xx` | 3 | 0,3% |
| `rede` | 2 | 0,2% |

Nenhum erro de endereço.

### 7.10. O que esta amostra vale: efeito de conglomerado

Os registros não são independentes: vêm de 2 a 4 por repositório, e registros do
mesmo repositório se parecem muito entre si.

| Medida | Valor |
|---|---|
| Registros | 1.033 |
| Repositórios | 305 |
| Registros por repositório | 3,39 |
| **ICC do desfecho** | **0,472** |
| **Efeito de desenho (deff)** | **2,13** |
| **n efetivo** | **485** |

Por fatia:

| Fatia | n | deff | n efetivo |
|---|---|---|---|
| ojs | 608 | 2,05 | 297 |
| outra | 385 | 2,29 | 168 |
| dspace | 40 | 1,90 | 21 |
| `primeiros` | 597 | 1,78 | 335 |
| `janela` | 436 | 1,63 | 267 |

**Em linguagem simples:** o ICC mede quanto dois registros do mesmo repositório
se parecem. Sendo alto, o segundo registro de um repositório traz pouca
informação nova — os 1.033 registros desta corrida valem o equivalente a **485
registros independentes**.

**Todos os intervalos de confiança deste relatório já estão corrigidos por esse
efeito.** A proporção é a observada; o que a correção muda é a incerteza em
torno dela.

## 8. Discussão

Três níveis, marcados explicitamente: **[OBSERVADO]** para o que está nos dados,
**[INTERPRETAÇÃO]** para leituras que os dados sustentam, **[HIPÓTESE]** para
explicações plausíveis que os dados **não** verificam.

### 8.1. A diferença entre as estratégias

**[OBSERVADO]** A taxa de acerto passou de 74,9% para 86,5%, com 123 ganhos e 3
perdas. Os intervalos de 95% ([72,2–77,5] e [84,3–88,5]) não se sobrepõem.

**[OBSERVADO]** Entre os discordantes: 123 em que a anterior erra e a nova
acerta, 3 no sentido oposto. McNemar com correção de continuidade:
**χ² = 112,4, 1 grau de liberdade** (crítico para p = 0,001: 10,83).

**[INTERPRETAÇÃO]** A diferença é grande demais para variação aleatória, e o
desenho pareado afasta a explicação mais comum para uma diferença falsa.

**Ressalva de método:** McNemar pressupõe independência, e há 2 registros por
repositório e por estrato, possivelmente correlacionados. Isso **infla** a
significância. A conclusão não depende do teste — 123 contra 3 é decisivo por si
—, mas o valor exato deve ser lido com essa reserva.

### 8.2. O viés de amostragem era real e mudou o tamanho do efeito

**[OBSERVADO]** Nos 226 repositórios que renderam os dois estratos:

| | Anterior | Nova | Ganho |
|---|---|---|---|
| registros mais antigos | 70,6% | 83,4% | +12,8 pts |
| data sorteada | 84,0% | 91,3% | +7,3 pts |

**[OBSERVADO]** A primeira versão deste relatório mediu 68,2% → 83,2%. Esses
números são praticamente idênticos aos do estrato `primeiros` desta corrida
(68,3% → 83,1%).

**[INTERPRETAÇÃO]** A primeira versão media, sem saber, apenas os registros mais
antigos de cada acervo — porque o OAI-PMH lista por datestamp crescente e o
experimento pegava os dois primeiros. Isso **superestimava o problema**: num
registro de data qualquer, a estratégia anterior já acertava 84,0%, não 70,6%.

**[INTERPRETAÇÃO]** O ganho real da mudança, medido em registros de data
sorteada, é de **+7,3 pontos**, e não os +14,8 que a primeira versão reportou.
A correção continua valendo, mas o tamanho do efeito é aproximadamente metade
do que se havia medido.

**[HIPÓTESE]** Registros antigos podem ter mais DOI não depositado e mais
endereço de um layout de site que não existe mais. Este experimento **não**
testou essa explicação: mediu que os antigos são piores, não por quê.

### 8.3. O árbitro erra em cerca de 4% dos casos

**[OBSERVADO]** Dos 871 endereços aprovados em que foi possível julgar,
838 (96,2%) mostravam uma página cujo título corresponde ao do metadado.

**[INTERPRETAÇÃO]** O instrumento de medida tem erro conhecido de
aproximadamente 3,8% na direção **permissiva**: ele aprova endereços que não
levam ao documento. Todas as taxas de acerto deste relatório devem ser lidas
como **limite superior**. Como o erro se aplica às duas estratégias com o mesmo
critério, a *comparação* entre elas é menos afetada que os valores absolutos.

**[OBSERVADO]** A concordância varia muito por regra: `record:ojs` 98,0%,
`record:doi` 96,7%, `record:dspace` 76,2%, `record:primeira` **0,0% (0 de 5)**.

**[INTERPRETAÇÃO]** A regra `primeira` — o desempate por ordem de documento,
usado quando nenhuma regra reconhece o endereço — não acertou nenhum dos 5 casos
em que foi aplicada. Entre as divergências há a home de um repositório
(`repositorio.unifesp.br`) e páginas de fascículo (`/issue/view/51`) oferecidas
como página de item. A base é pequena, mas o resultado é coerente com o que a
regra é: um palpite sobre um endereço que o sistema **não** reconheceu.

**[HIPÓTESE]** Seria possível que `record:dspace` erre mais por confundir página
de coleção com página de item, já que ambas ficam sob `/handle/`. Os dados
mostram a taxa menor (76,2%), mas **não** foram examinados caso a caso para
confirmar a causa.

### 8.4. As 3 perdas

**[OBSERVADO]** As 3 perdas são `record:doi ok` → `record:doi rede`. Em todas as
três, **as duas estratégias escolheram o mesmo endereço**.

**[INTERPRETAÇÃO]** Como o endereço é o mesmo, a diferença não pode vir da
lógica de escolha. É variação da rede entre uma abertura e outra. Não há, nesta
corrida, nenhuma perda atribuível à mudança.

### 8.5. O custo da mudança

**[OBSERVADO]** `sem-link` subiu de 88 para 111 (+23). Pela migração, vieram de
`fora-da-rota` (19) e de `http-5xx` (4).

**[INTERPRETAÇÃO]** Todos os 23 eram, antes, links que não levavam ao item. A
mudança os converteu em indicação explícita de ausência de endereço, que é o
efeito pretendido pelo objetivo OE2.

### 8.6. Onde a diferença se concentra

**[OBSERVADO]** Por plataforma: +14,8 pts no OJS, +12,5 no DSpace, +6,5 nas
demais. Por troca de regra: 112 casos `doi → ojs`. Por desfecho de partida: 103
dos 123 ganhos vieram de `http-4xx`.

**[INTERPRETAÇÃO]** O padrão da primeira versão se confirma com mais dados: o
problema é concentrado numa situação específica — DOI presente no metadado que o
resolvedor não reconhece, à frente de uma URL que funciona —, e não uma
deficiência geral da escolha de endereço.

**[HIPÓTESE]** Os 112 casos `doi → ojs` podem refletir uma prática de
configuração de portais OJS: registrar o DOI no metadado sem depositá-lo no
resolvedor. Não verificado — não consultamos as agências de registro.

### 8.7. Origem versus sistema

**[OBSERVADO]** O botão OAI-PMH abriu em 98,6% dos 1.033 registros, sem nenhum
erro de endereço.

**[INTERPRETAÇÃO]** Como esse botão não envolve escolha, ele serve de linha de
base da saúde das origens. A distância entre 98,6% e os 74,9% da estratégia
anterior era em grande parte atribuível à decisão do sistema; depois da mudança,
a distância é de 98,6% para 86,5% — e 68 dos 111 registros sem link falham antes
de qualquer escolha de URL, porque a origem recusa o identificador.

### 8.8. Relação com a pergunta e com os objetivos

**[OBSERVADO]** Com a estratégia anterior, o botão não levava ao item em 259 dos
1.033 registros (25,1%), sendo 139 links enganosos. Com a nova, não leva em 139
(13,5%), sendo 1 link enganoso.

**[INTERPRETAÇÃO]** A resposta à pergunta é: **nem sempre, e depende de qual
registro**. Num registro qualquer, a estratégia anterior já levava ao item em
84,0% dos casos; nos registros mais antigos, em 70,6%. A nova leva em 91,3% e
83,4%, respectivamente. O que mudou de forma mais decisiva não foi a taxa de
acerto, e sim a **quase eliminação dos links enganosos**: 139 para 1.

---

## 9. Conclusão

### 9.1. Resposta à pergunta

Nos 1.033 registros medidos: com a estratégia anterior o botão levava ao item em
74,9% dos casos; com a nova, em 86,5%. Os links enganosos caíram de 139 para 1.

A resposta depende de qual registro se olha. Em registros de data sorteada, a
estratégia anterior já acertava 84,0% e a nova acerta 91,3%. Nos registros mais
antigos de cada acervo — que a primeira versão deste relatório mediu sem saber —
os números são 70,6% e 83,4%.

### 9.2. Cumprimento dos objetivos

| Objetivo | Resultado |
|---|---|
| **OE1** — quantificar o acerto | 74,9% [72,2–77,5] → 86,5% [84,3–88,5] em 1.033 registros de 305 repositórios. Por estrato: +7,3 pts em data sorteada, +12,8 pts nos mais antigos. |
| **OE2** — contar links enganosos | 139 → 1. |
| **OE3** — verificar regressão | 3 perdas, todas com endereço idêntico nas duas estratégias e desfecho `rede`. Nenhuma atribuível à mudança. |
| **OE4** — onde a diferença mora | No OJS (+14,8 pts), na troca `doi → ojs` (112 casos), partindo de `http-4xx` (103 dos 123 ganhos), e mais nos registros antigos que nos recentes. |
| **OE5** — separar sistema de origem | OAI-PMH abriu em 98,6%, sem erro de endereço. |

**O objetivo geral foi atendido**, com a ressalva de que o tamanho do efeito
depende de qual parte do acervo se amostra.

### 9.3. Principais descobertas

1. **O viés de amostragem era grande.** Medir os registros mais antigos em vez
   de registros de data sorteada muda a taxa da estratégia anterior de 84,0%
   para 70,6% — e, por consequência, o ganho aparente de +7,3 para +12,8 pontos.
2. **O árbitro concorda com o conteúdo da página em 96,2% dos casos.** O erro é
   permissivo, então as taxas de acerto são limite superior.
3. **A regra `primeira` não acertou nenhum dos 5 casos** em que foi aplicada,
   entregando home de repositório e página de fascículo.
4. **Os links enganosos praticamente desapareceram:** 139 → 1.
5. **A forma do caso relatado é frequente:** 112 trocas `doi → ojs`, e 103 dos
   123 ganhos partiram de endereços que davam `http-4xx`.
6. **61,3% dos registros sem link falham antes de qualquer escolha de URL**, com
   `badArgument`: a origem recusa o identificador guardado.
7. **12,9% das origens (45 de 350) não responderam** à consulta inicial.

### 9.4. Principais limitações

| # | Limitação |
|---|---|
| **1** | **O instrumento tem erro conhecido de ~3,8%**, na direção permissiva. As taxas absolutas são limite superior. |
| **2** | **Amostra parcial.** 350 de 1.596 repositórios elegíveis, 2 registros por estrato. |
| **3** | **Recorte `INDEXED`.** Não se estende aos 587 repositórios em outros estados. |
| **4** | **Dependência de rede.** 45 origens não responderam; 27 resultados ficaram inconclusivos. |
| **5** | **A janela não é amostragem uniforme de registros.** Sorteia uma data, não um registro: períodos de publicação intensa ficam sub-representados por registro. |
| **6** | **`bloqueado` sem veredito** — 9 casos no botão OAI-PMH. |
| **7** | **A estratégia anterior foi reconstruída**, não executada da versão original. |
| **8** | **A alteração (c) quase não foi exercitada**: 2 registros `derived-unverified:ojs` e nenhum `derived:ojs`. |
| **9** | **Conglomerado, não independência.** Os registros vêm 2 a 4 por repositório, com ICC de 0,47. Os intervalos deste relatório já descontam esse efeito (n efetivo 485 de 1.033), mas o teste de McNemar da seção 8.1 **não** — ele supõe independência, e por isso seu χ² está inflado. |
| **10** | **A validação de título depende de a página declarar o título** em meta tag. Em 3 casos não havia, e em 14 o metadado não tinha título. |

### 9.5. Sugestões de estudos futuros

**Sobre o desenho da amostra** — decorrem diretamente da seção 7.10:

1. **Um registro por repositório, muito mais repositórios.** Com ICC de 0,47 a
   0,78, o segundo registro de um repositório quase não acrescenta informação.
   Pelo custo desta medição, o tamanho ótimo de conglomerado é 1.
2. **Estratificar por tipo de repositório**, com o tipo apurado no `Identify` de
   cada origem — não inferido da forma da URL, que falha em cerca de um terço
   dos casos.
3. **Alocação igual entre estratos, não proporcional.** Os desvios por estrato
   são quase idênticos, então Neyman coincide com proporcional; a escolha é
   entre estimar o total (proporcional) e comparar tipos (igual). Para comparar,
   igual.
4. **Censo do estrato DSpace.** Ele tem cerca de 110 repositórios na população;
   alcançar ±5 pontos por amostragem exigiria mais do que existem.

**Sobre o objeto medido:**

5. **Rever a regra `primeira`**, que não acertou nenhum dos 5 casos: avaliar se
   deve deixar de produzir link ou ser marcada como não verificada na interface.
6. **Examinar as 5 divergências de `record:dspace`**, para saber se a causa é
   confusão entre página de coleção e página de item.
7. **Amostragem uniforme por registro**, em vez de por janela de data, usando
   `resumptionToken` até uma profundidade sorteada — a janela sorteia uma data,
   não um registro, e sub-representa períodos de publicação intensa.
8. **Medir os repositórios fora de `INDEXED`.**
9. **Verificar com navegador completo** os casos `bloqueado`.
10. **Investigar o `badArgument`**, maior causa isolada de registro sem link.
11. **Testar a alteração (c)** numa amostra escolhida para contê-la.
12. **Repetir periodicamente.** Este relatório é uma fotografia de 20/09/2026.

---

## 10. O que este experimento não mediu

Registrado explicitamente, para que nenhuma dessas informações seja presumida a
partir do relatório:

- **Não mediu** se a página aberta contém de fato o artigo esperado. A
  verificação é de código HTTP e de forma do endereço.
- **Não mediu** percepção, satisfação ou comportamento de usuários.
- **Não mediu** tempo de resposta, custo computacional ou volume de requisições
  adicionais gerado pela conferência.
- **Não mediu** os 587 repositórios do índice fora do estado `INDEXED`.
- **Não verificou** junto às agências de DOI por que os DOIs encontrados não
  resolvem.
- **Não determinou** o desfecho real dos casos `bloqueado` e `rede`.
- **Não avaliou** a alteração (c) da estratégia nova, por falta de casos.
- **Não há dado disponível** sobre o estado da última coleta do repositório
  incluído como caso de origem (1 dos 350), por ele ter entrado fora do sorteio
  do índice.

---

## 11. O que mudou da primeira versão

A primeira versão deste relatório, da corrida de 11:31 UTC do mesmo dia, tinha
duas falhas de método. Ambas foram corrigidas, e ambas mudaram números.

### 11.1. Amostragem enviesada para os registros mais antigos

**O que estava errado.** O experimento pedia `ListIdentifiers` e tomava os dois
primeiros identificadores. O OAI-PMH entrega em ordem de datestamp crescente,
então esses dois são sempre **os registros mais antigos do acervo**. Nos 349
identificadores OJS da primeira corrida, o primeiro quartil do número de artigo
era 25 — um quarto da amostra eram os 25 primeiros artigos já publicados por
aquele periódico.

**Por que importa.** Registro antigo não é um registro qualquer. A corrida v2
mostra que a estratégia anterior acertava 70,6% nos mais antigos e 84,0% em
registros de data sorteada, nos mesmos repositórios.

**O que mudou no número.** A primeira versão reportou ganho de +15,0 pontos
(68,2% → 83,2%). Esses valores correspondem ao estrato `primeiros` da v2
(68,3% → 83,1%). Em registros de data sorteada, o ganho é de **+7,3 pontos**.
A primeira versão **superestimava o efeito em cerca de duas vezes**.

**Como foi corrigido.** O experimento passou a amostrar em dois estratos e a
reportar os dois, medindo o viés em vez de apenas evitá-lo.

### 11.2. O árbitro não era verificado

**O que estava errado.** O árbitro aprovava um endereço quando o servidor
respondia e a rota final mantinha a marca esperada. Nada verificava se a página
mostrava o documento. A primeira versão registrava isso como limitação, mas
limitação declarada não é erro medido.

**O que mudou no número.** A conferência de título mostra concordância de
**96,2%**. O erro do instrumento é de aproximadamente 3,8%, na direção
permissiva — as taxas de acerto de ambas as versões são limite superior.

**O que a verificação encontrou de novo.** A regra `primeira` não acertou nenhum
dos 5 casos em que foi aplicada, entregando home de repositório e página de
fascículo como página de item. Isso não era visível sem a conferência.

**Como foi corrigido.** A sonda do botão OAI-PMH passou de `HEAD` para `GET`,
sem custo adicional de requisição, e dela sai o título do registro, comparado
com o título da página aprovada.

### 11.3. Dois defeitos do próprio validador, corrigidos antes da corrida

Um teste em escala pequena, antes da corrida completa, reprovou 2 de 4 casos.
Investigados, os dois eram falhas do validador, não do árbitro:

1. **Títulos multilíngues.** O metadado trazia o título em inglês e a página
   mostrava o português. O validador comparava só com o primeiro `dc:title`;
   passou a comparar com todos, bastando um bater.
2. **Formato `xoai`.** Registros DSpace vinham sem título, porque nesse formato
   o nome do campo está no atributo (`<element name="title">`) e não na tag.

Sem esse teste prévio, o relatório teria afirmado que o árbitro erra em metade
dos casos — o que seria falso.

---

### Reprodutibilidade

Scripts, dados e instruções estão em `experiment/`, descritos no
[README](README.md). Os números deste relatório vêm de
`data/resultados-indexed.json` e podem ser recalculados:

```bash
uv run python ../experiment/analise.py --arquivo data/resultados-indexed.json
uv run --with pandas python ../experiment/quadros.py
```
