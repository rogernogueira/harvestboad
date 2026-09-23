#!/usr/bin/env python
"""Catálogo de sinais de plataforma e o classificador que os pontua.

Aqui vive a **lógica**, sem rede: quais sinais existem, quanto cada um pesa,
que força tem, e como um conjunto de sinais vira `platform_product`,
`platform_confidence` e `platform_detection_method`. Quem vai à rede é
`coletar_sondas.py`; quem grava as bases é `gerar.py`.

Separar assim é o que permite reprontuar 2.183 fontes sem repetir 10.000
requisições: mudou o peso, roda `gerar.py` de novo sobre as sondas já
coletadas.

## Cinco sondas, na ordem em que valem a pena

1. `Identify` — o software costuma se declarar em `<toolkit>` ou no
   `<description>`. É a evidência mais simples, e já estava coletada.
2. `ListMetadataFormats` — a combinação de formatos é impressão digital.
   `xoai` + `dim` é DSpace; `dataverse_json` + `oai_ddi` é Dataverse.
3. `ListSets` — `com_123456789_1` e `col_...` são comunidade e coleção do
   DSpace; `revista:SECAO` é a estrutura do OJS.
4. O HTML do site — `<meta name="generator">` e o cookie `OJSSID`.
5. As APIs próprias — `/api/info/version` do Dataverse e
   `/server/api/core/sites` do DSpace 7+, que ainda entregam a versão.

**Nenhuma sonda interrompe as outras.** Parar na primeira evidência explícita
seria mais barato e tornaria `HIGH` inalcançável por construção: `HIGH` é
definido por *contar* assinaturas independentes, e não se conta o que não se
foi buscar.

## A confiança não sai do escore

O escore decide **qual** plataforma. A confiança sai da **força** dos sinais,
que é outra coisa: mil pontos de inferência indireta continuam sendo inferência
indireta. As regras são as do desenho:

    CONFIRMED  uma assinatura inequívoca da própria plataforma
    HIGH       duas ou mais assinaturas características, de sondas diferentes
    MEDIUM     uma assinatura característica, não exclusiva
    LOW        só inferência indireta
    UNKNOWN    nada

"De sondas diferentes" é mais estrito do que "dois sinais": `xoai` e `dim` vêm
da mesma resposta de `ListMetadataFormats` e não são observações
independentes — duas leituras do mesmo fato não confirmam uma à outra. Com
`col_` junto, que vem de `ListSets`, aí são duas sondas e vira `HIGH`.

## Os pesos foram medidos

Os pesos dos sinais **circunstanciais** saem do ganho medido por
`validar_sondas.py`: esconde-se a assinatura das 1.672 fontes que declaram a
própria plataforma e pergunta-se ao resto dos sinais o que eles teriam
concluído sozinhos. O ganho é a precisão dividida pela taxa-base, porque
precisão sozinha engana — com 92% do gabarito em OJS, um sinal que diga OJS
acerta quase sempre sem informar nada.

Foi isso que derrubou `rota-index-php-oai` de 20 para 5 e subiu `set-com` de
20 para 29: o primeiro tem ganho 1,1× e o segundo, 13,7×.

Os pesos das **assinaturas continuam como foram desenhados**, e de propósito.
Ganho mede o quanto um sinal circunstancial estreita o campo, e isso depende
da taxa-base da população; a autoridade de uma autodeclaração não depende
disso. Repesá-las amarraria o classificador a esta população.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import base_fontes as bf

# Força de um sinal, do mais fraco para o mais forte. É ela que define a
# confiança; o peso só ordena candidatos.
INDIRETA, CARACTERISTICA, ASSINATURA = "indireta", "caracteristica", "assinatura"


@dataclass(frozen=True)
class Sinal:
    """Um sinal observável, com de onde veio e o que sustenta."""

    nome: str
    sonda: str  # identify | formatos | sets | html | api
    plataforma: str  # código do CV05
    peso: int
    forca: str
    metodo: str  # código do CV07


# O catálogo. `sonda` é o que torna `HIGH` verificável: dois sinais da mesma
# sonda são uma observação só.
SINAIS: tuple[Sinal, ...] = (
    # ---------------------------------------------------------------- DSpace
    Sinal("api-dspace-sites", "api", "DSPACE", 100, ASSINATURA, "PLATFORM_API"),
    Sinal(
        "html-generator-dspace", "html", "DSPACE", 80, ASSINATURA, "HTML_META_GENERATOR"
    ),
    # Achar a palavra "dspace" no corpo da página **não** é autodeclaração: a
    # página pode citar o software em texto corrido. Só o `<meta generator>`
    # é assinatura. A conferência de `base_fontes.py` apontou a incoerência
    # entre as duas regras, e quem estava errado era este catálogo.
    Sinal("html-dspace", "html", "DSPACE", 29, CARACTERISTICA, "HTML_SIGNATURE"),
    Sinal("identify-dspace", "identify", "DSPACE", 80, ASSINATURA, "OAI_IDENTIFY"),
    Sinal(
        "formato-xoai", "formatos", "DSPACE", 29, CARACTERISTICA, "OAI_METADATA_FORMATS"
    ),
    Sinal(
        "formato-dim", "formatos", "DSPACE", 29, CARACTERISTICA, "OAI_METADATA_FORMATS"
    ),
    Sinal(
        "formato-etdms",
        "formatos",
        "DSPACE",
        29,
        CARACTERISTICA,
        "OAI_METADATA_FORMATS",
    ),
    Sinal("set-com", "sets", "DSPACE", 29, CARACTERISTICA, "OAI_SETS"),
    Sinal("set-col", "sets", "DSPACE", 29, CARACTERISTICA, "OAI_SETS"),
    Sinal("rota-oai-request", "rota", "DSPACE", 12, INDIRETA, "URL_PATTERN_ONLY"),
    # O OAI central do SciELO. 215 fontes são colhidas por ele, e o que serve
    # esses registros é a infraestrutura do SciELO — qualquer OJS que a
    # revista também mantenha é irrelevante para o que o Oasisbr colhe.
    #
    # Não confundir com a rejeição do `cadastro-scielo`: lá o cadastro dizia
    # "SciELO" sobre revistas com endpoint **próprio**, e nas 28 verificáveis
    # o software era OJS. Os dois conjuntos não têm uma fonte em comum.
    Sinal("endpoint-scielo", "rota", "SCIELO", 60, CARACTERISTICA, "SERVICE_ENDPOINT"),
    Sinal("forma-handle", "identify", "DSPACE", 12, INDIRETA, "OAI_DESCRIPTION"),
    # ------------------------------------------------------------------- OJS
    Sinal("html-generator-ojs", "html", "OJS", 100, ASSINATURA, "HTML_META_GENERATOR"),
    Sinal("identify-ojs", "identify", "OJS", 80, ASSINATURA, "OAI_IDENTIFY"),
    Sinal("cookie-ojssid", "html", "OJS", 15, CARACTERISTICA, "HTTP_HEADER"),
    Sinal("set-estrutura-ojs", "sets", "OJS", 15, CARACTERISTICA, "OAI_SETS"),
    Sinal(
        "identificador-article",
        "identify",
        "OJS",
        15,
        CARACTERISTICA,
        "OAI_DESCRIPTION",
    ),
    Sinal("rota-index-php-oai", "rota", "OJS", 5, INDIRETA, "URL_PATTERN_ONLY"),
    # ------------------------------------------------------------- Dataverse
    Sinal("api-dataverse-version", "api", "DATAVERSE", 100, ASSINATURA, "PLATFORM_API"),
    Sinal("html-dataverse", "html", "DATAVERSE", 30, CARACTERISTICA, "HTML_SIGNATURE"),
    # Generator que nomeia uma tecnologia fora do CV05. É autodeclaração
    # como qualquer outra e por isso `assinatura` — e é exatamente o que
    # `OTHER_IDENTIFIED` significa: identifiquei e não está no vocabulário,
    # que é diferente de `UNKNOWN`, não identifiquei.
    Sinal(
        "html-generator-outro",
        "html",
        "OTHER_IDENTIFIED",
        70,
        ASSINATURA,
        "HTML_META_GENERATOR",
    ),
    Sinal(
        "identify-dataverse", "identify", "DATAVERSE", 80, ASSINATURA, "OAI_IDENTIFY"
    ),
    Sinal(
        "formato-dataverse-json",
        "formatos",
        "DATAVERSE",
        40,
        CARACTERISTICA,
        "OAI_METADATA_FORMATS",
    ),
    Sinal(
        "formato-oai-ddi",
        "formatos",
        "DATAVERSE",
        30,
        CARACTERISTICA,
        "OAI_METADATA_FORMATS",
    ),
    # ------------------------------------------- as demais do CV05 que existem
    Sinal("identify-eprints", "identify", "EPRINTS", 80, ASSINATURA, "OAI_IDENTIFY"),
    Sinal(
        "identificador-eprints", "identify", "EPRINTS", 20, INDIRETA, "OAI_DESCRIPTION"
    ),
    Sinal("identify-tede2", "identify", "TEDE2", 80, ASSINATURA, "OAI_IDENTIFY"),
    Sinal("identify-tede", "identify", "TEDE_LEGACY", 80, ASSINATURA, "OAI_IDENTIFY"),
    Sinal(
        "identify-omp", "identify", "OTHER_IDENTIFIED", 80, ASSINATURA, "OAI_IDENTIFY"
    ),
    Sinal(
        "identify-ops", "identify", "OTHER_IDENTIFIED", 80, ASSINATURA, "OAI_IDENTIFY"
    ),
    Sinal(
        "identify-islandora",
        "identify",
        "FEDORA_ISLANDORA",
        80,
        ASSINATURA,
        "OAI_IDENTIFY",
    ),
)

# `attributes.software` do cadastro do Harvester -> CV05. "Outros",
# "Proprietário" e vazio **não viram sinal**: dizem que quem cadastrou não
# soube ou não quis especificar, o que não é identificação de tecnologia.
# **`SciELO` foi removido daqui pela medição, não por opinião.** O cadastro diz
# "SciELO" em 238 fontes; das 28 que também têm assinatura inequívoca, o
# software real era OJS em **28**. O valor não nomeia o produto, nomeia o
# programa que hospeda e indexa — e mapeá-lo para o produto SCIELO teria
# publicado 210 observações erradas. Mapeá-lo para OJS também não vale: com
# 92% do gabarito em OJS, o ganho seria 1,1×, quer dizer, nada.
# Valores do cadastro que **não identificam tecnologia nenhuma**: dizem que
# quem preencheu não soube ou não quis especificar. Não viram sinal e também
# não servem de `platform_name_raw` — "Outros" não é nome de software.
SOFTWARE_SEM_IDENTIFICACAO = {"outros", "outro", "proprietario", "proprietário", ""}

SOFTWARE_DO_CADASTRO = {
    "seer/ojs": "OJS",
    "ojs": "OJS",
    "dspace": "DSPACE",
    "dataverse": "DATAVERSE",
    "pergamum": "PERGAMUM",
    "sophia": "SOPHIA",
    "tede": "TEDE_LEGACY",
}

# A **ressalva**, e é ela que define a força deste sinal: o cadastro não
# observou nada. É o que uma pessoa digitou no formulário do Oasisbr quando
# inscreveu a fonte, possivelmente há anos, sem que ninguém conferisse contra
# a origem. Por isso entra como `caracteristica` e nunca como `assinatura`,
# por mais que acerte — e por isso tem teto MEDIUM no CV08, mesmo sendo o
# único sinal de 291 fontes que não respondem a sonda nenhuma.
#
# Para essas 291 ele é a diferença entre `UNKNOWN` e uma hipótese datada e
# rastreável. Não é a diferença entre `UNKNOWN` e conhecimento.
# Os pesos vêm medidos por `validar_sondas.py`, como os demais: o cadastro
# dizendo DSpace tem ganho 13,6× em 120 casos conferidos, e dizendo OJS tem
# ganho 1,1× em 1.378 — quase nada, porque 92% do gabarito é OJS e acertar
# OJS a esmo já acerta quase sempre. Os que não têm amostra ficam no valor
# inicial.
PESO_DO_CADASTRO = {"DSPACE": 29, "OJS": 15}

SINAIS += tuple(
    Sinal(
        f"cadastro-{plataforma.lower()}",
        "cadastro",
        plataforma,
        PESO_DO_CADASTRO.get(plataforma, 25),
        CARACTERISTICA,
        "SOURCE_REGISTRY",
    )
    for plataforma in dict.fromkeys(SOFTWARE_DO_CADASTRO.values())
)

# Sonda 7: a inspeção humana. Não há como automatizar o que ela faz — o site
# da Art Style não declara nada e aponta os artigos para o Zenodo, e só
# alguém lendo a página descobre isso. Entra como `caracteristica`, nunca
# como assinatura: quem inspecionou não viu o software, viu onde o conteúdo
# mora e concluiu daí.
#
# O peso é o teto da faixa característica: mais forte que qualquer sinal
# automático da mesma força, e ainda assim perde de uma autodeclaração.
SINAIS += tuple(
    Sinal(
        f"manual-{plataforma.lower()}",
        "manual",
        plataforma,
        45,
        CARACTERISTICA,
        "MANUAL_TECHNICAL_INSPECTION",
    )
    for plataforma in bf.CV05_PLATFORM_PRODUCT
)

POR_NOME = {sinal.nome: sinal for sinal in SINAIS}

FORCA_ORDEM = {INDIRETA: 1, CARACTERISTICA: 2, ASSINATURA: 3}

# `<toolkit><title>` ou `<description>` dizendo o nome do software. A ordem
# importa: "tede2" precisa ser testado antes de "tede", e "dspace" depois de
# "tede", porque o TEDE2 é DSpace por baixo e se declara com os dois nomes.
DECLARACOES = (
    ("tede2", "identify-tede2"),
    ("tede", "identify-tede"),
    ("open journal systems", "identify-ojs"),
    ("open preprint systems", "identify-ops"),
    ("open monograph press", "identify-omp"),
    ("dataverse", "identify-dataverse"),
    ("islandora", "identify-islandora"),
    ("eprints", "identify-eprints"),
    ("dspace", "identify-dspace"),
)

# Forma da cauda do `sampleIdentifier`. Mais fraca que a declaração, e por isso
# entra como característica ou indireta, nunca como assinatura.
FORMAS_DE_IDENTIFICADOR = (
    (re.compile(r"article/\d+$"), "identificador-article"),
    (re.compile(r"^oai:[^:]+:\d+$"), "identificador-eprints"),
    (re.compile(r":[A-Za-z0-9_.-]+/\d+$"), "forma-handle"),
)

FORMATOS_DE_PLATAFORMA = {
    "xoai": "formato-xoai",
    "dim": "formato-dim",
    "etdms": "formato-etdms",
    "dataverse_json": "formato-dataverse-json",
    "oai_ddi": "formato-oai-ddi",
}


def _minusculo(texto: object) -> str:
    return texto.lower() if isinstance(texto, str) else ""


def sinais_do_identify(resposta: dict) -> list[dict]:
    """Sinais da sonda 1, a partir do `Identify` já coletado.

    Lê o envelope inteiro — `<toolkit>`, `<repositoryName>`, `<description>` —
    e não só o toolkit, porque origem que não preenche o toolkit às vezes
    escreve o nome do software na descrição.
    """
    achados: list[dict] = []
    declarado = " ".join(
        _minusculo(resposta.get(campo))
        for campo in ("toolkitTitle", "repositoryName", "corpo")
    )
    for termo, nome in DECLARACOES:
        if termo in declarado:
            achados.append({"sinal": nome, "valor": termo})
            break

    # O `sampleIdentifier` vem do quadro, onde ausente é `NaN` e não "".
    exemplo = resposta.get("sampleIdentifier")
    exemplo = exemplo.strip() if isinstance(exemplo, str) else ""
    for padrao, nome in FORMAS_DE_IDENTIFICADOR:
        if exemplo and padrao.search(exemplo):
            achados.append({"sinal": nome, "valor": exemplo})
            break
    return achados


def sinais_dos_formatos(prefixos: list[str] | None) -> list[dict]:
    """Sinais da sonda 2. `oai_dc` nunca entra: está em toda origem."""
    if not prefixos:
        return []
    presentes = {p.lower() for p in prefixos}
    return [
        {"sinal": nome, "valor": prefixo}
        for prefixo, nome in FORMATOS_DE_PLATAFORMA.items()
        if prefixo in presentes
    ]


def sinais_dos_sets(sets: list[str] | None) -> list[dict]:
    """Sinais da sonda 3, pela forma do `setSpec`.

    `com_` e `col_` são comunidade e coleção do DSpace. O OJS expõe a revista
    e suas seções como `revista:SECAO`, forma que o DSpace não produz.
    """
    if not sets:
        return []
    achados: list[dict] = []
    if primeiro := next((s for s in sets if s.startswith("com_")), None):
        achados.append({"sinal": "set-com", "valor": primeiro})
    if primeiro := next((s for s in sets if s.startswith("col_")), None):
        achados.append({"sinal": "set-col", "valor": primeiro})
    if primeiro := next(
        (s for s in sets if ":" in s and not s.startswith(("com_", "col_"))), None
    ):
        achados.append({"sinal": "set-estrutura-ojs", "valor": primeiro})
    return achados


# Gerenciadores de conteúdo genéricos. Um `<meta generator>` de WordPress diz
# o software **do site**, não o da fonte: é comum a revista ter página em
# WordPress e o OAI atrás em OJS. Tomá-lo pela plataforma da fonte trocaria
# uma identificação certa por uma errada.
CMS_GENERICO = ("wordpress", "joomla", "drupal", "wix", "blogger", "squarespace")


def sinais_do_html(html: dict) -> list[dict]:
    """Sinais da sonda 4: o `<meta name="generator">`, o cookie e o corpo."""
    achados: list[dict] = []
    gerador = _minusculo(html.get("generator"))
    if "open journal systems" in gerador:
        achados.append({"sinal": "html-generator-ojs", "valor": html["generator"]})
    elif "dspace" in gerador:
        achados.append({"sinal": "html-generator-dspace", "valor": html["generator"]})
    # Nem OJS, nem DSpace, nem CMS genérico, nem nome que o `Identify` já
    # reconheceria: é tecnologia identificada e fora do vocabulário. `MAX` é o
    # Maxwell da PUC-Rio, `GeneXus Java` é plataforma de desenvolvimento — as
    # duas nomeiam o software de verdade, e sem esta regra as fontes delas
    # ficavam `UNKNOWN` tendo a declaração no HTML.
    elif (
        gerador
        and not any(cms in gerador for cms in CMS_GENERICO)
        and not any(termo in gerador for termo, _ in DECLARACOES)
    ):
        achados.append({"sinal": "html-generator-outro", "valor": html["generator"]})

    if "ojssid" in _minusculo(html.get("cookies")):
        achados.append({"sinal": "cookie-ojssid", "valor": "OJSSID"})

    # `marcador` era um termo só; `marcadores` é a lista. Os dois formatos
    # convivem porque a coleta antiga já está em disco.
    marcas = html.get("marcadores")
    if marcas is None:
        marcas = [html["marcador"]] if html.get("marcador") else []
    marcas = {_minusculo(m) for m in marcas}

    if not gerador and "dataverse" in marcas:
        achados.append({"sinal": "html-dataverse", "valor": "dataverse no HTML"})
    elif not gerador and "dspace" in marcas:
        achados.append({"sinal": "html-dspace", "valor": "dspace no HTML"})
    # **WordPress não vira sinal, e a medição é o motivo.** Das 19 fontes cujo
    # HTML traz `wp-content`, só 2 são de fato WordPress: 13 são OJS, 3 são
    # DSpace, 1 é EPrints. Precisão de 11%.
    #
    # A razão é estrutural, não estatística: `source_url` é **deduzido** do
    # endpoint, e cai com frequência na home da instituição, que é onde mora
    # o WordPress. A revista Temiminós tem endpoint
    # `cnecrj.com.br/ojs/index.php/.../oai` — inequivocamente OJS — e o
    # `source_url` aponta para a home da CNEC, em WordPress. Com peso 10 o
    # marcador venceu a rota `/ojs/` de peso 5 e classificou a revista como
    # OTHER_IDENTIFIED.
    #
    # A detecção continua sendo coletada, em `sondas.json`: ela é útil como
    # registro e os outros marcadores do corpo (dspace, eprints, dataverse)
    # valem. Só este não descreve a plataforma da fonte.
    return achados


def sinais_manuais(manual: object) -> list[dict]:
    """Sonda 7: o apurado à mão, como `(plataforma, nome_bruto, justificativa)`."""
    if not isinstance(manual, tuple) or len(manual) != 3:
        return []
    plataforma, _nome, porque = manual
    if plataforma not in bf.CV05_PLATFORM_PRODUCT:
        raise ValueError(
            f"plataforma fora do CV05 na classificação manual: {plataforma!r}"
        )
    return [{"sinal": f"manual-{plataforma.lower()}", "valor": porque}]


def sinais_do_cadastro(software: object) -> list[dict]:
    """Sonda 6: o que o cadastro do agregador diz que a fonte roda.

    Declaração de terceiro — ver a ressalva em `SOFTWARE_DO_CADASTRO`. O valor
    cru vai junto para que quem auditar veja que a evidência é a palavra do
    formulário, e não uma leitura da origem.
    """
    chave = _minusculo(software).strip()
    plataforma = SOFTWARE_DO_CADASTRO.get(chave)
    if not plataforma:
        return []
    return [
        {
            "sinal": f"cadastro-{plataforma.lower()}",
            "valor": f"cadastro declara {software!r}",
        }
    ]


def sinais_da_api(api: dict) -> list[dict]:
    """Sinais da sonda 5, e a versão que elas entregam de brinde."""
    achados: list[dict] = []
    if versao := api.get("dataverseVersion"):
        achados.append({"sinal": "api-dataverse-version", "valor": versao})
    if api.get("dspaceSite"):
        achados.append({"sinal": "api-dspace-sites", "valor": api["dspaceSite"]})
    return achados


# Endpoints de serviço conhecidos: o domínio e a rota identificam quem serve.
SERVICOS = ((("scielo.br/oai/scielo-oai.php",), "endpoint-scielo"),)


def sinais_da_rota(endpoint: object) -> list[dict]:
    """Sinais da sonda 0: a forma da própria URL. A mais fraca de todas."""
    url = _minusculo(endpoint)
    if not url:
        return []
    for rotas, nome in SERVICOS:
        if any(rota in url for rota in rotas):
            return [{"sinal": nome, "valor": endpoint}]
    if "/oai/request" in url or "/server/oai" in url:
        return [{"sinal": "rota-oai-request", "valor": endpoint}]
    if "/index.php/" in url and url.rstrip("/").endswith("oai"):
        return [{"sinal": "rota-index-php-oai", "valor": endpoint}]
    return []


def todos_os_sinais(sonda: dict) -> list[dict]:
    """Os sinais de uma fonte, de todas as sondas, com sonda e força ao lado."""
    achados = [
        *sinais_da_rota(sonda.get("endpoint")),
        *sinais_do_identify(sonda.get("identify") or {}),
        *sinais_dos_formatos(sonda.get("formatos")),
        *sinais_dos_sets(sonda.get("sets")),
        *sinais_do_html(sonda.get("html") or {}),
        *sinais_da_api(sonda.get("api") or {}),
        *sinais_do_cadastro(sonda.get("software")),
        *sinais_manuais(sonda.get("manual")),
    ]
    saida = []
    for achado in achados:
        sinal = POR_NOME[achado["sinal"]]
        saida.append(
            {
                **achado,
                "sonda": sinal.sonda,
                "plataforma": sinal.plataforma,
                "peso": sinal.peso,
                "forca": sinal.forca,
                "metodo": sinal.metodo,
            }
        )
    return saida


def confianca(sinais_da_vencedora: list[dict]) -> str:
    """CV08 pela força dos sinais, não pelo escore.

    `HIGH` exige duas sondas distintas, e não dois sinais: `xoai` e `dim` saem
    da mesma resposta e são uma observação só.
    """
    if any(s["forca"] == ASSINATURA for s in sinais_da_vencedora):
        return "CONFIRMED"
    sondas = {s["sonda"] for s in sinais_da_vencedora if s["forca"] == CARACTERISTICA}
    if len(sondas) >= 2:
        return "HIGH"
    if sondas:
        return "MEDIUM"
    return "LOW" if sinais_da_vencedora else "UNKNOWN"


def classificar(sonda: dict) -> dict:
    """De um conjunto de sondas para produto, confiança, método e evidência.

    `UNKNOWN` é desfecho legítimo e diferente de `OTHER_IDENTIFIED`: o primeiro
    diz que não se identificou a tecnologia, o segundo que se identificou e ela
    não tem código no vocabulário. Forçar o segundo no lugar do primeiro
    inventaria conhecimento.
    """
    sinais = todos_os_sinais(sonda)
    if not sinais:
        return {
            "platform_product": "UNKNOWN",
            "platform_confidence": "UNKNOWN",
            "platform_detection_method": "UNKNOWN",
            "escore": 0,
            "sinais": [],
        }

    escores: dict[str, int] = {}
    for sinal in sinais:
        escores[sinal["plataforma"]] = (
            escores.get(sinal["plataforma"], 0) + sinal["peso"]
        )
    vencedora = max(escores, key=lambda p: (escores[p], p))
    dela = [s for s in sinais if s["plataforma"] == vencedora]

    nivel = confianca(dela)
    # O método é o do sinal mais forte da vencedora; com duas sondas
    # concordantes, o que houve foi concordância, e o CV07 tem código para
    # isso.
    decisivo = max(dela, key=lambda s: (FORCA_ORDEM[s["forca"]], s["peso"]))
    metodo = "MULTIPLE_EVIDENCE" if nivel == "HIGH" else decisivo["metodo"]

    return {
        "platform_product": vencedora,
        "platform_confidence": nivel,
        "platform_detection_method": metodo,
        "escore": escores[vencedora],
        "escores": escores,
        "decisivo": decisivo["sinal"],
        "sinais": sinais,
    }
