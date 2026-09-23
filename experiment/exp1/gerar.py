#!/usr/bin/env python
"""Gera as duas bases a partir do que o experimento já apurou.

    .venv/bin/python exp1/gerar.py            # escreve data/base-*.csv
    .venv/bin/python exp1/gerar.py --conferir # gera em memória e só relata

São duas porque o dicionário pede duas: `classification_evidence_id` é chave
estrangeira obrigatória em toda observação, e sem a tabela do outro lado ela
aponta para o nada.

- `base-fontes.csv` — Base 1, uma linha por observação de fonte.
- `base-evidencias.csv` — **uma linha por sinal lido**, não por observação.
  O `Identify` de uma origem traz até três: o `<toolkit>` em que o software se
  declara, a forma do `<sampleIdentifier>` e o `<repositoryName>`. O
  classificador parava no primeiro que decidia, mas guardou os três — então
  cada um vira uma evidência, com o que ele sozinho sustenta.

  É o que torna `MULTIPLE_EVIDENCE` verificável: "duas ou mais evidências
  concordantes" deixa de ser um rótulo que alguém digita e passa a ser uma
  contagem de linhas. Numa base 1:1 o código existiria no vocabulário sem que
  nada pudesse comprová-lo.

  A chave estrangeira da Base 1 aponta para a evidência **decisiva** — a mais
  forte das concordantes —, e `decisive` marca qual é. As demais ficam ao lado,
  disponíveis para quem quiser reclassificar sem voltar às origens.

**A espinha é o índice inteiro**, com 2.183 repositórios, e não o quadro
amostral. O quadro é subconjunto estrito dele — as 1.596 origens que chegaram
a ser indexadas — e entra por junção, trazendo o que só ele tem: `baseUrl`,
classificação tecnológica e a reverificação das origens mudas. As 587 restantes
existem no cadastro e nunca foram classificadas; omiti-las faria a base
descrever só as fontes que deram certo, que é exatamente o viés de
sobrevivência que o CV02 foi desenhado para deixar visível.

O preço é que essas 587 não têm endpoint: o índice não traz o `baseURL` OAI
porque `oaiSource` volta nulo no cadastro, e o endereço só aparece no registro
coletado — que elas não têm. Entram com `harvest_endpoint_url` e `source_url`
vazios, dois campos obrigatórios, e a conferência aponta as duas ausências em
cada uma. É a forma certa de registrar: a fonte existe, o dado falta.

**Os identificadores são determinísticos** (`uuid5` sobre `source_id` e o
carimbo da observação). Regerar não muda um byte, e a chave estrangeira entre
as duas bases sobrevive à regeração. Com `uuid4` cada execução produziria uma
base inteiramente nova, e o diff no git não diria nada.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import pandas as pd

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA))
sys.path.insert(0, str(PASTA.parent))

import base_fontes as bf
from instituicoes import classificar as classificar_instituicoes
from sondas import SOFTWARE_SEM_IDENTIFICACAO, classificar

# As tabelas de reconhecimento vêm do classificador, e não de uma cópia: é o
# que garante que a evidência registrada concorde com a classificação que o
# experimento produziu. Copiá-las criaria duas verdades que divergem na
# primeira correção de regex.
from quadros import DADOS as DADOS_EXPERIMENTO
from quadros import quadro

EVIDENCIAS = bf.DADOS / "base-evidencias.csv"
IDENTIFY = bf.DADOS / "identify.json"
CADASTRO = bf.DADOS / "cadastro.json"
SONDAS = bf.DADOS / "sondas.json"

# Namespace fixo do projeto: é o que torna `uuid5` reprodutível entre máquinas.
# Trocá-lo reemite todos os identificadores das duas bases.
NAMESPACE = uuid.UUID("5f1c7a2e-3b44-5d61-9c0e-2a7b8d4e6f10")

# O Oasisbr é o portal nacional do Ibict, e quase toda fonte dele é
# brasileira — **quase**. O cadastro do Harvester mostra três que não são, e
# supor BR para as 2.183 publicaria país errado em três linhas obrigatórias.
PAIS = "BR"

UFS = frozenset(
    [
        "AC",
        "AL",
        "AP",
        "AM",
        "BA",
        "CE",
        "DF",
        "ES",
        "GO",
        "MA",
        "MT",
        "MS",
        "MG",
        "PA",
        "PB",
        "PR",
        "PE",
        "PI",
        "RJ",
        "RN",
        "RS",
        "RO",
        "RR",
        "SC",
        "SP",
        "SE",
        "TO",
    ]
)

# O `attributes.state` do cadastro é texto livre, e às vezes não é sigla nem
# estado. `BH` é a cidade de um registro cujos dois campos vieram trocados
# (`state='BH'`, `city='Minas Gerais'`).
UF_POR_NOME = {
    "minas gerais": "MG",
    "rio de janeiro": "RJ",
    "rio grande do norte": "RN",
    "bh": "MG",
}

# Fontes não brasileiras, reconhecidas pelo que o cadastro escreveu no lugar
# do estado. São três: o RCAAP português, o NDLTD da Virgínia e a EDICIC
# colombiana.
PAIS_POR_ESTADO = {
    "portugal": "PT",
    "virginia (eua)": "US",
    "barranquilla (colombia)": "CO",
}

# `tipo` do quadro -> produto do CV05. `omp` e `ops` não têm código próprio no
# vocabulário e viram OTHER_IDENTIFIED, o que só é aceitável porque o
# `platform_name_raw` deles vem preenchido pelo `<toolkit>`.
PRODUTO = {
    "ojs": "OJS",
    "dspace": "DSPACE",
    "eprints": "EPRINTS",
    "dataverse": "DATAVERSE",
    "islandora": "FEDORA_ISLANDORA",
    "omp": "OTHER_IDENTIFIED",
    "ops": "OTHER_IDENTIFIED",
}

# `attributes.source_type` do cadastro -> CV04. É a classificação que o próprio
# Oasisbr dá à fonte, e cobre 2.182 das 2.183 — bem melhor que deduzir o tipo
# de fonte a partir da plataforma, que era o que `natureza` fazia (todo OJS
# virava periódico, todo DSpace virava repositório).
#
# Os onze valores do cadastro caem em oito dos nove tipos do CV04; só
# SCIENTIFIC_CONFERENCE não aparece nesta população. O macro (CV03) sai do
# detalhe por `MACRO_POR_DETALHE`, para não haver duas tabelas discordando.
TIPO_DO_CADASTRO = {
    "Revista": "SCIENTIFIC_JOURNAL",
    "Repositório Institucional": "PUBLICATION_REPOSITORY",
    "Repositório de Publicações": "PUBLICATION_REPOSITORY",
    "Repositório Comum": "PUBLICATION_REPOSITORY",
    "Repositório Temático": "PUBLICATION_REPOSITORY",
    "Biblioteca Digital de Teses e Dissertações": "ETD_DIGITAL_LIBRARY",
    "Biblioteca Digital de Monografia": "MONOGRAPH_DIGITAL_LIBRARY",
    "Repositório de Dados de Pesquisa": "RESEARCH_DATA_REPOSITORY",
    "Portal de Livros": "BOOK_PORTAL",
    "Portal Agregador": "AGGREGATOR_PORTAL",
    "Servidor de preprints": "PREPRINT_SERVER",
}


def tipo_de_fonte(bruto: object) -> object:
    """CV04 a partir do `source_type` do cadastro. Valor novo levanta.

    Mesma regra do `state`: um tipo que não está na tabela é ou uma grafia
    nova de um tipo conhecido ou uma categoria nova do Oasisbr, e as duas
    pedem decisão humana em vez de virar `UNKNOWN` silencioso.
    """
    if not isinstance(bruto, str) or not bruto.strip():
        return pd.NA
    if achado := TIPO_DO_CADASTRO.get(bruto.strip()):
        return achado
    raise ValueError(f"`source_type` não reconhecido no cadastro: {bruto!r}")


# `natureza` -> (CV03 macro, CV04 detalhe). Reserva, para o repositório que
# não tem cadastro. O quadro não separa tese de
# publicação: `repositorio` cobre as duas, e mandar tudo para
# PUBLICATION_REPOSITORY subconta ETD_LIBRARY. É limitação da origem, não da
# base — está no README para não passar por classificação.
TIPO_DE_FONTE = {
    "periodico": ("SCIENTIFIC_JOURNAL", "SCIENTIFIC_JOURNAL"),
    "repositorio": ("PUBLICATION_REPOSITORY", "PUBLICATION_REPOSITORY"),
    "dados": ("RESEARCH_DATA_REPOSITORY", "RESEARCH_DATA_REPOSITORY"),
    "livro": ("OTHER_SCIENTIFIC_SOURCE", "BOOK_PORTAL"),
}

# O que cada sinal, sozinho, sustenta: (CV07 método, CV08 confiança).
#
# - `toolkit` é o software se declarando dentro do Identify
#   (`<toolkit><title>Open Journal Systems`). É evidência emitida pelo próprio
#   sistema, que é a definição de CONFIRMED, e por isso entra como
#   OAI_IDENTIFY, o código que o vocabulário aceita como confirmatório.
# - `sampleIdentifier` é a **forma** do identificador, não uma declaração:
#   OAI_DESCRIPTION, teto MEDIUM. `forma-handle` desce a LOW porque é o padrão
#   mais frouxo dos dois, o que gerou 66 indeterminados.
# - `repositoryName` é o nome dizendo "DSpace at IFRS" — inferência indireta.
SINAL = {
    "toolkit": ("toolkit", "OAI_IDENTIFY", "CONFIRMED"),
    "sampleIdentifier": ("sampleIdentifier", "OAI_DESCRIPTION", "MEDIUM"),
    "forma-handle": ("sampleIdentifier", "OAI_DESCRIPTION", "LOW"),
    "repositoryName": ("repositoryName", "OAI_IDENTIFY", "LOW"),
}

# Ordem de força, do mais fraco para o mais forte. Decide qual evidência é a
# decisiva quando várias concordam, e é a mesma ordem em que o classificador
# tentou os sinais — não por acaso: ele parava no primeiro que decidisse.
FORCA = ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CONFIRMED"]

PERFIL = {
    "oai_dc": "OAI_DC",
    "oai_openaire": "OPENAIRE",
    # `mtd-br` é a versão anterior do perfil da BDTD; `mtd2-br` é a atual.
    "mtd-br": "BDTD",
    "imf": "OTHER",
    "xoai": "XOAI",
    "oai_datacite": "DATACITE",
    "mtd2-br": "BDTD",
    "mets": "OTHER",
}

# Desfecho do `Identify` na reverificação -> situação da fonte. A distinção que
# importa: servidor que responde recusando (403, 500, XML quebrado) está vivo e
# volta; `rede` depois de uma segunda tentativa com prazo folgado é fonte que
# não está mais lá; 404 no endpoint diz que o **cadastro** está errado, e não
# diz nada sobre a fonte — daí UNKNOWN, e não INACTIVE.
SITUACAO = {
    "ok": "ACTIVE",
    "rede": "INACTIVE",
    "http-401": "TEMPORARILY_UNAVAILABLE",
    "http-403": "TEMPORARILY_UNAVAILABLE",
    "http-429": "TEMPORARILY_UNAVAILABLE",
    "http-500": "TEMPORARILY_UNAVAILABLE",
    "http-502": "TEMPORARILY_UNAVAILABLE",
    "http-503": "TEMPORARILY_UNAVAILABLE",
    "xml-invalido": "TEMPORARILY_UNAVAILABLE",
    # O portal inteiro está fora: é exatamente o que TEMPORARILY_UNAVAILABLE
    # descreve, e periodicos.unb.br responde por 38 fontes sozinho.
    "portal-em-manutencao": "TEMPORARILY_UNAVAILABLE",
    # A fonte está no ar e o OAI é que está fechado — decisão de acesso, não
    # indisponibilidade. `ACTIVE` é o que o CV02 tem para "fonte operacional";
    # o que está fechado é o protocolo, e isso vai para `notes`.
    "oai-fechado": "ACTIVE",
    # Fomos recusados pelo anti-bot. Diz que o servidor está de pé e não diz
    # nada sobre a fonte responder a um cliente legítimo.
    "anti-bot": "TEMPORARILY_UNAVAILABLE",
    "html-nao-xml": "TEMPORARILY_UNAVAILABLE",
    "oai-error": "TEMPORARILY_UNAVAILABLE",
    "http-404": "UNKNOWN",
}

# Estado da última coleta -> situação, para quem só existe no índice. Coleta
# que terminou válida prova que a origem respondeu a alguém. `..._ERROR` não
# prova o contrário: o erro pode ter sido de metadado, de rede ou nosso, e
# afirmar INACTIVE a partir dele seria matar fonte viva no papel.
SITUACAO_DA_COLETA = {
    "VALID": "ACTIVE",
    "HARVESTING_FINISHED_VALID": "ACTIVE",
    "HARVESTING_FINISHED_ERROR": "UNKNOWN",
    "HARVESTING": "UNKNOWN",
    "SEM_COLETA": "UNKNOWN",
}

RESPONDE = ["responde-aos-dois", "so-Identify", "so-ListIdentifiers"]

# Classificação apurada à mão, por `source_id`. É a sétima sonda, e a única
# que não roda sozinha: entra aqui quem foi inspecionado por alguém e cuja
# tecnologia nenhuma das outras seis alcança.
#
# A justificativa é obrigatória e vai para a base de evidências como o valor
# do sinal — sem ela a linha seria uma afirmação sem rastro, que é o oposto
# do que esta base faz.
CLASSIFICACAO_MANUAL: dict[str, tuple[str, str, str]] = {
    # O site é WordPress: 112 ocorrências de `wp-content`, mais `wp-includes`
    # e `wp-json`. **Não há `<meta generator>`** — a instalação removeu a tag,
    # coisa comum em WordPress —, e por isso a sonda de HTML não viu nada: ela
    # só lê o generator.
    #
    # O Zenodo, que a página lista, é onde a revista **deposita** cópias, não
    # o que serve a fonte. Foi o que classifiquei primeiro, e estava errado:
    # o endpoint coletado era `artstyle-editions.org/oai`, que é da revista,
    # não do Zenodo.
    #
    # `OTHER_IDENTIFIED` porque WordPress não tem código no CV05 — e é
    # justamente o caso que o código existe para cobrir: tecnologia
    # identificada e fora do vocabulário.
    "2204": (
        "OTHER_IDENTIFIED",
        "WordPress",
        (
            "site em WordPress (wp-content, wp-includes, wp-json no HTML; sem "
            "meta generator); o Zenodo que a página lista é destino de "
            "depósito, não a plataforma da fonte"
        ),
    ),
}


def situacao_do_desfecho(desfecho: object) -> str:
    """CV02 a partir do desfecho de uma pergunta à origem.

    O `SITUACAO` cobre os desfechos conhecidos; o resto cai na regra geral, que
    é a mesma lógica: servidor que devolveu **qualquer** código HTTP está de pé
    — inclusive o `http-468` que uma origem inventou. Só `rede` é ausência.
    """
    if not isinstance(desfecho, str) or not desfecho:
        return "UNKNOWN"
    if desfecho in SITUACAO:
        return SITUACAO[desfecho]
    return "TEMPORARILY_UNAVAILABLE" if desfecho.startswith("http-") else "UNKNOWN"


# Caudas de endpoint OAI, da mais específica para a mais genérica. Tirá-las do
# `baseUrl` devolve a página pública da fonte, que é o que `source_url` pede e
# nenhuma das duas origens guarda.
CAUDAS = (
    "/oai/request",
    "/oai/driver",
    "/dspace-oai/request",
    "/cgi/oai2",
    "/oai2",
    "/oai",
)


def _sem_acento(texto: str) -> str:
    decomposto = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in decomposto if not unicodedata.combining(c))


def normalizar_nome(nome: object) -> object:
    """Nome comparável: sem acento, sem caixa, sem espaço repetido.

    Serve para casar a mesma fonte escrita de dois jeitos entre observações —
    o nome bruto fica intacto ao lado, porque é ele que documenta a origem.
    """
    if not isinstance(nome, str) or not nome.strip():
        return pd.NA
    return " ".join(_sem_acento(nome).lower().split())


def pagina_publica(endpoint: object) -> object:
    """A página da fonte, deduzida do endpoint de coleta.

    É dedução, não observação: nenhuma das origens guarda a página pública.
    Quando nenhuma cauda conhecida aparece, o melhor palpite honesto é a raiz
    do host.
    """
    if not isinstance(endpoint, str) or not endpoint.strip():
        return pd.NA
    url = endpoint.strip().rstrip("/")
    for cauda in CAUDAS:
        if url.lower().endswith(cauda):
            return url[: -len(cauda)] or pd.NA
    partes = urlsplit(url)
    return f"{partes.scheme}://{partes.netloc}" if partes.netloc else pd.NA


def quando(arquivo: str) -> pd.Timestamp:
    """O instante em que a apuração daquele arquivo aconteceu.

    Cada JSON do experimento carrega o próprio carimbo, e é ele — não a hora
    de rodar este script — que data a observação. `reclassificadoEm` vence
    `geradoEm` quando existe: o quadro foi reclassificado depois de gerado.
    """
    dados = json.loads((DADOS_EXPERIMENTO / arquivo).read_text())
    for chave in ("reclassificadoEm", "verificadoEm", "geradoEm", "exportadoEm"):
        if dados.get(chave):
            return pd.Timestamp(dados[chave]).tz_convert("UTC")
    raise KeyError(f"{arquivo} não traz carimbo de apuração")


def extrair_evidencias(
    q: pd.DataFrame,
    observacao_id: list[str],
    respostas: pd.DataFrame,
    sondagens: pd.DataFrame,
    endpoint: pd.Series,
    cadastro: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """A base de evidências e a conclusão, pelo pipeline de `sondas.py`.

    Uma linha de evidência por **sinal** observado, de qualquer das cinco
    sondas. A conclusão de cada observação sai do escore (qual plataforma) e
    da força dos sinais (quanta confiança) — duas coisas separadas de
    propósito: mil pontos de inferência indireta continuam sendo inferência
    indireta.
    """
    linhas: list[dict] = []
    conclusoes: list[dict] = []

    for posicao, (_, linha) in enumerate(q.iterrows()):
        observacao = observacao_id[posicao]
        sid = linha["id"]
        entrada = {
            "endpoint": endpoint.iloc[posicao]
            if pd.notna(endpoint.iloc[posicao])
            else "",
            "identify": respostas.loc[sid].to_dict()
            if sid in respostas.index and respostas.loc[sid].get("desfecho") == "ok"
            else {},
            **(
                sondagens.loc[sid].to_dict()
                if sid in sondagens.index
                else {"formatos": None, "sets": None, "html": {}, "api": {}}
            ),
            # A sexta sonda não vai à rede: é o campo `software` do cadastro
            # do Harvester. Declaração de terceiro, com a ressalva registrada
            # em `sondas.SOFTWARE_DO_CADASTRO` e refletida na força do sinal.
            "software": cadastro["software"].get(sid)
            if "software" in cadastro.columns
            else None,
            "manual": CLASSIFICACAO_MANUAL.get(sid),
        }
        # O `sampleIdentifier` continua vindo do quadro: ele não está no
        # `Identify` de toda origem, e foi o classificador quem o guardou.
        if linha.get("sampleIdentifier"):
            entrada["identify"] = {
                **entrada["identify"],
                "sampleIdentifier": linha["sampleIdentifier"],
            }

        veredito = classificar(entrada)
        decisivo = veredito.get("decisivo")
        id_decisiva = None

        for sinal in veredito["sinais"]:
            evidencia = str(
                uuid.uuid5(NAMESPACE, f"evidencia|{observacao}|{sinal['sinal']}")
            )
            if sinal["sinal"] == decisivo and id_decisiva is None:
                id_decisiva = evidencia
            linhas.append(
                {
                    "classification_evidence_id": evidencia,
                    "source_observation_id": observacao,
                    "source_id": sid,
                    "probe": sinal["sonda"],
                    "signal_name": sinal["sinal"],
                    "signal_value_raw": str(sinal["valor"])[:300],
                    "signal_strength": sinal["forca"],
                    "signal_weight": sinal["peso"],
                    "detection_method": sinal["metodo"],
                    "inferred_product": sinal["plataforma"],
                    "decisive": False,
                    "notes": pd.NA,
                }
            )

        if id_decisiva is None:
            # Sem sinal nenhum, a observação ainda precisa de uma evidência
            # para a chave estrangeira resolver. `UNKNOWN` é desfecho legítimo
            # e diferente de `OTHER_IDENTIFIED`: aquele diz que não se
            # identificou a tecnologia, este que ela foi identificada e não
            # tem código no vocabulário.
            id_decisiva = str(uuid.uuid5(NAMESPACE, f"evidencia|{observacao}|nenhuma"))
            linhas.append(
                {
                    "classification_evidence_id": id_decisiva,
                    "source_observation_id": observacao,
                    "source_id": sid,
                    "probe": "nenhuma",
                    "signal_name": "nenhuma",
                    "signal_value_raw": pd.NA,
                    "signal_strength": pd.NA,
                    "signal_weight": 0,
                    "detection_method": "UNKNOWN",
                    "inferred_product": "UNKNOWN",
                    "decisive": False,
                    "notes": "nenhuma sonda produziu sinal",
                }
            )

        discordantes = sorted(
            {
                s["plataforma"]
                for s in veredito["sinais"]
                if s["plataforma"] != veredito["platform_product"]
            }
        )
        # O nome bruto da tecnologia, quando quem decidiu foi uma declaração.
        # É o que `OTHER_IDENTIFIED` exige: sem ele o código perde a única
        # informação que o justificava.
        declaracao = next(
            (
                s["valor"]
                for s in veredito["sinais"]
                if s["sinal"] == decisivo and s["sonda"] in ("identify", "html")
            ),
            pd.NA,
        )
        # O cadastro também nomeia a tecnologia, e o nome que ele traz é bruto
        # tanto quanto o do `<toolkit>` — só que declarado por terceiro. Entra
        # como reserva, com o valor cru e não com a frase que o sinal guarda.
        # A classificação manual traz o nome bruto junto, e ele vale mais que
        # o do cadastro: quem inspecionou viu a tecnologia, quem cadastrou
        # digitou um rótulo.
        if declaracao is pd.NA and isinstance(entrada.get("manual"), tuple):
            declaracao = entrada["manual"][1] or pd.NA
        if declaracao is pd.NA and entrada.get("software"):
            bruto = str(entrada["software"]).strip()
            if bruto.lower() not in SOFTWARE_SEM_IDENTIFICACAO:
                declaracao = bruto
        conclusoes.append(
            {
                "source_observation_id": observacao,
                "classification_evidence_id": id_decisiva,
                "nome_declarado": declaracao,
                "platform_product": veredito["platform_product"],
                "platform_detection_method": veredito["platform_detection_method"],
                "platform_confidence": veredito["platform_confidence"],
                "escore": veredito["escore"],
                "sinais": len(veredito["sinais"]),
                "sondas": len({s["sonda"] for s in veredito["sinais"]}),
                "divergencia": ", ".join(discordantes) or pd.NA,
            }
        )

    evidencias = pd.DataFrame(linhas)
    conclusao = pd.DataFrame(conclusoes)
    decisivas = set(conclusao["classification_evidence_id"])
    evidencias["decisive"] = evidencias["classification_evidence_id"].isin(decisivas)
    divergencias = dict(
        zip(
            conclusao["classification_evidence_id"],
            conclusao["divergencia"],
            strict=True,
        )
    )
    discorda = evidencias["classification_evidence_id"].map(divergencias)
    evidencias["notes"] = evidencias["notes"].fillna(
        discorda.map(
            lambda d: f"outra sonda apontou {d}" if isinstance(d, str) else pd.NA
        )
    )
    return evidencias, conclusao


def vazio_de(q: pd.DataFrame) -> pd.Series:
    return pd.Series(pd.NA, index=q.index, dtype="object")


def localizacao(estado: object) -> tuple[str, object]:
    """`(country_code, subdivision_code)` a partir do `state` do cadastro.

    Estado vazio ou sem cadastro cai em BR sem subdivisão: o Oasisbr é
    nacional, e é a suposição que vale para as 2.116 restantes. Valor que não
    é UF, nem nome de estado, nem país conhecido **levanta** — um `state` novo
    é ou uma UF escrita de um jeito novo ou uma fonte de fora, e as duas
    precisam de decisão humana, não de um BR silencioso.
    """
    if not isinstance(estado, str) or not estado.strip():
        return PAIS, pd.NA
    chave = " ".join(_sem_acento(estado).lower().split())
    if pais := PAIS_POR_ESTADO.get(chave):
        return pais, pd.NA
    sigla = (
        estado.strip().upper()
        if estado.strip().upper() in UFS
        else UF_POR_NOME.get(chave)
    )
    if sigla:
        return PAIS, f"{PAIS}-{sigla}"
    raise ValueError(f"`state` não reconhecido no cadastro: {estado!r}")


def versao_normalizada(bruta: object) -> object:
    """A versão em forma comparável: até três componentes numéricos.

    O `<toolkit><version>` do OJS vem como `2.4.8.1`, quatro componentes, que
    não é SemVer. O dicionário pede SemVer "quando possível", e o possível
    aqui é o prefixo — a versão exata continua inteira em
    `platform_version_raw`, então cortar não perde nada.
    """
    if not isinstance(bruta, str) or not bruta.strip():
        return pd.NA
    achado = re.match(r"\d+(?:\.\d+){0,2}", bruta.strip())
    return achado.group(0) if achado else pd.NA


def carregar_identify() -> pd.DataFrame:
    """As respostas de `Identify`, uma linha por origem perguntada.

    Só as que responderam entram com campo: um `Identify` que deu 403 não
    informa política de exclusão nenhuma, e preencher com vazio seria dizer
    que a origem foi perguntada e não tinha — foi perguntada e recusou.
    """
    if not IDENTIFY.is_file():
        return pd.DataFrame(columns=["id", "desfecho"]).set_index("id")
    dados = json.loads(IDENTIFY.read_text())
    linhas = pd.DataFrame(dados["origens"]).set_index("id")
    linhas.attrs["coletadoEm"] = pd.Timestamp(dados["coletadoEm"]).tz_convert("UTC")
    return linhas


def carregar_sondas() -> pd.DataFrame:
    """O que as quatro sondas de rede trouxeram, uma linha por fonte."""
    if not SONDAS.is_file():
        return pd.DataFrame(
            columns=["id", "formatos", "sets", "html", "api"]
        ).set_index("id")
    dados = json.loads(SONDAS.read_text())
    linhas = pd.DataFrame(dados["sondas"]).set_index("id")
    linhas.attrs["coletadoEm"] = pd.Timestamp(dados["coletadoEm"]).tz_convert("UTC")
    return linhas


def carregar_cadastro() -> pd.DataFrame:
    """O cadastro cru do Harvester, uma linha por repositório."""
    if not CADASTRO.is_file():
        return pd.DataFrame(columns=["id", "desfecho"]).set_index("id")
    dados = json.loads(CADASTRO.read_text())
    linhas = pd.DataFrame(dados["cadastros"]).set_index("id")
    linhas.attrs["coletadoEm"] = pd.Timestamp(dados["coletadoEm"]).tz_convert("UTC")
    return linhas


def escopo_da_coleta(sets: object) -> str:
    """CV10 a partir da lista `sets` do cadastro.

    Lista vazia é afirmação, não ausência: o Harvester coleta a fonte inteira.
    Era o campo que estava `UNKNOWN` nas 2.183 porque nem o índice nem o
    quadro amostral guardavam a configuração de set — ela está no cadastro, e
    o backend simplesmente não a mapeia.
    """
    if not isinstance(sets, list):
        return "UNKNOWN"
    if not sets:
        return "ALL_RECORDS"
    return "SINGLE_SET" if len(sets) == 1 else "MULTIPLE_SETS"


def carregar_origem() -> pd.DataFrame:
    """O índice inteiro com o quadro amostral encaixado ao lado.

    Junção à esquerda pelo id do harvester: as 2.183 do cadastro ficam todas,
    e as 1.596 classificadas ganham as colunas do quadro. `nome` e
    `instituicao` conferem nas duas origens em todas as 1.596, então o índice
    manda nesses campos — é ele quem cobre a base inteira.
    """
    indice = json.loads((DADOS_EXPERIMENTO / "indice-repositorios.json").read_text())
    idx = pd.DataFrame(indice["repositorios"]).rename(
        columns={"harvesterRepositoryId": "id"}
    )
    juntas = idx.merge(quadro(), on="id", how="left", suffixes=("", "_quadro"))
    if len(juntas) != len(idx):
        raise ValueError(
            f"junção duplicou linhas: {len(juntas)} para {len(idx)} do índice"
        )
    return juntas


def montar_bases(
    origem: pd.DataFrame | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Das duas apurações do experimento para as duas bases do dicionário."""
    q = carregar_origem() if origem is None else origem.copy()

    # Uma observação por fonte, datada pela apuração que a produziu: as
    # classificadas pelo quadro, as demais pela exportação do índice. Não é
    # detalhe — são dois momentos diferentes, e a base existe para comparar
    # observações no tempo.
    vazio = vazio_de(q)
    houve_coleta = (
        q["lastSnapshotId"].notna()
        if "lastSnapshotId" in q
        else pd.Series(True, index=q.index)
    )
    cadastro = carregar_cadastro()
    sondagens = carregar_sondas()
    classificada = q["tipo"].notna()
    observado = pd.Series(quando("indice-repositorios.json"), index=q.index)
    observado[classificada] = quando("quadro-amostral.json")

    respostas = carregar_identify()
    # Perguntar `Identify` **é** observar a fonte, e é a apuração mais recente
    # que a linha tem. Manter o carimbo antigo diria que a política de exclusão
    # publicada foi vista em setembro às 17h49, quando foi vista depois. O
    # preço é que os identificadores mudam — são derivados do carimbo —, e
    # esse é o preço certo a pagar.
    perguntada = q["id"].isin(respostas.index)
    if perguntada.any():
        observado[perguntada] = respostas.attrs["coletadoEm"]

    tipo = q["tipo"].astype("object")
    natureza = q["natureza"].astype("object")
    identify = q.get("identify", pd.Series(pd.NA, index=q.index)).astype("object")
    veredito = q.get("veredito", pd.Series(pd.NA, index=q.index)).astype("object")
    tem_base_url = q["tem_base_url"].fillna(False).astype(bool)

    # ---- situação: ter tipo já prova que a origem respondeu; quem não tem
    # depende da reverificação, e quem nunca foi classificada, do estado da
    # última coleta.
    situacao = q["lastSnapshotStatus"].map(SITUACAO_DA_COLETA).fillna("UNKNOWN")
    situacao[tipo.isin([*PRODUTO, "indeterminado"])] = "ACTIVE"
    muda = tipo.eq("origem-muda")
    situacao[muda] = identify[muda].map(SITUACAO).fillna("UNKNOWN")
    situacao[muda & veredito.isin(RESPONDE)] = "ACTIVE"
    situacao[classificada & ~tem_base_url] = "UNKNOWN"
    # A pergunta mais recente manda. Sem isto a base poderia dizer
    # TEMPORARILY_UNAVAILABLE numa linha que carrega um `Identify` fresco.
    desfecho_identify = (
        q["id"].map(respostas["desfecho"]) if len(respostas) else vazio_de(q)
    )
    situacao[perguntada] = desfecho_identify[perguntada].map(situacao_do_desfecho)

    # Site que responde prova que a fonte está de pé, mesmo com o endpoint OAI
    # dando 404 — e são 17 nessa situação. `UNKNOWN` ali dizia "não sei se
    # existe" sobre uma fonte cuja página abriu e cuja API de plataforma
    # respondeu. O 404 não se perde: vai para `notes`, que é onde o dicionário
    # pede observação técnica.
    site_vivo = (
        q["id"].map(sondagens["html"].map(lambda h: (h or {}).get("desfecho") == "ok"))
        if "html" in sondagens.columns
        else pd.Series(False, index=q.index)
    ).fillna(False)
    endpoint_404 = desfecho_identify.eq("http-404")
    ressuscitadas = site_vivo & endpoint_404
    situacao[ressuscitadas] = "ACTIVE"

    # `notes` só ganha linha onde há algo **não óbvio** a dizer. Encher as
    # 2.183 com texto derivável de outras colunas transformaria o campo em
    # ruído; a discrepância entre fonte viva e endpoint morto não está em
    # coluna nenhuma.
    observacao = vazio.copy()
    # OAI fechado: a fonte responde e o protocolo redireciona para login. É
    # decisão de acesso, não indisponibilidade — e é fato que não está em
    # coluna nenhuma, porque `source_status` diz ACTIVE e `harvest_protocol`
    # diz OAI_PMH sem ressalva.
    observacao[desfecho_identify.eq("oai-fechado")] = (
        "endpoint OAI redireciona para a página de login: protocolo fechado, "
        "fonte no ar"
    )
    observacao[ressuscitadas] = (
        "endpoint OAI responde 404, site da fonte responde: "
        "cadastro do endereço desatualizado, fonte no ar"
    )

    # O tipo de fonte vem do cadastro, e a dedução pela plataforma é reserva.
    # A troca importa: `natureza` mandava todo `repositorio` para
    # PUBLICATION_REPOSITORY, o que subcontava ETD_LIBRARY — o cadastro
    # distingue os dois.
    do_cadastro_tipo = (
        q["id"].map(cadastro["source_type"]).map(tipo_de_fonte)
        if "source_type" in cadastro.columns
        else vazio
    )
    reserva = natureza.map(lambda n: TIPO_DE_FONTE.get(n, ("UNKNOWN", "UNKNOWN"))[1])
    # `ops` é servidor de preprints, que o quadro registra como periódico
    # porque a natureza dele não tem esse valor. O CV04 tem.
    reserva[tipo.eq("ops")] = "PREPRINT_SERVER"
    detalhe = do_cadastro_tipo.fillna(reserva)
    macro = detalhe.map(bf.MACRO_POR_DETALHE).fillna("UNKNOWN")

    tem_cadastro = q["id"].isin(cadastro.index)
    sets = q["id"].map(cadastro["sets"]) if "sets" in cadastro.columns else vazio
    escopo = sets.map(escopo_da_coleta).where(tem_cadastro, "UNKNOWN")
    # O `setSpec` só existe quando a coleta é restrita; nos 100% ALL_RECORDS
    # ficaria vazio de qualquer jeito, e vazio aqui quer dizer "não se aplica".
    set_spec = sets.map(
        lambda ss: (
            ", ".join(str(x) for x in ss) if isinstance(ss, list) and ss else pd.NA
        )
    )

    # O endpoint vem do cadastro, e o do quadro é reserva. O campo é definido
    # como "endpoint efetivamente usado na coleta": o cadastro é a
    # configuração de agora, enquanto o do quadro foi lido do `origin` de um
    # registro coletado em algum momento do passado. Nos 1.580 em que os dois
    # existem eles concordam em 1.577; os três restantes são migração que só o
    # cadastro viu — IPEN para uma API nova, UNICAMP e UNIFOR para outro host.
    #
    # É também o que recupera as 597 origens que o índice dava como sem
    # endereço: o exportador procurava `oaiSource`, campo que não existe no
    # cadastro. O nome é `originURL`.
    do_cadastro = (
        q["id"].map(cadastro["originURL"]).replace("", pd.NA)
        if "originURL" in cadastro.columns
        else vazio
    )
    endpoint = do_cadastro.fillna(q.get("baseUrl", vazio))

    onde = (
        q["id"].map(cadastro["state"]).map(localizacao)
        if "state" in cadastro.columns
        else pd.Series([(PAIS, pd.NA)] * len(q), index=q.index)
    )
    pais = onde.map(lambda par: par[0])
    subdivisao = onde.map(lambda par: par[1])
    # Fonte sem `state` no cadastro herda a UF da instituição, quando outra
    # fonte dela tem. É a mesma afirmação que o cadastro faz — o estado é o
    # da instituição, não o do servidor — só que alcançada por irmã.
    por_instituicao = (
        pd.DataFrame({"inst": q["institutionName"], "uf": subdivisao})
        .dropna(subset=["uf"])
        .groupby("inst")["uf"]
        .agg(lambda s: s.mode().iloc[0])
    )
    herdada = q["institutionName"].map(por_instituicao)
    subdivisao = subdivisao.fillna(herdada.where(pais.eq(PAIS)))

    # Sem endpoint não há coleta, e dizer OAI_PMH seria afirmar um protocolo
    # que ninguém exerceu.
    protocolo = pd.Series("UNKNOWN", index=q.index, dtype="object")
    protocolo[endpoint.notna()] = "OAI_PMH"

    # A natureza da instituição sai do nome, por `instituicoes.py`, que grava
    # ao lado a regra ou a URL de cada decisão. Sem esse rastro a inferência
    # viraria dado observado, que é o que a base não pode deixar acontecer.
    tabela_inst = classificar_instituicoes(q["institutionName"]).set_index(
        "institution_name"
    )
    natureza = tabela_inst["institution_type"]

    # Os sete campos do `Identify`, todos da mesma resposta. `respondeu` e não
    # `perguntada`: quem recusou foi perguntado e não informou nada, e
    # preencher com vazio diria que não tinha.
    respondeu = (
        q["id"].map(respostas["desfecho"]).eq("ok")
        if len(respostas)
        else pd.Series(False, index=q.index)
    )

    def do_identify(coluna: str) -> pd.Series:
        if coluna not in respostas.columns:
            return vazio
        valores = q["id"].map(respostas[coluna])
        return valores.where(respondeu & valores.ne("") & valores.notna())

    # A versão vem de três autodeclarações, na ordem em que foram coletadas:
    # o `<toolkit><version>` do Identify, o `<meta generator>` do site
    # ("Open Journal Systems 3.3.0.20") e a API do Dataverse. As duas últimas
    # já estavam coletadas e não eram usadas — só o toolkit alimentava o
    # campo, e 683 fontes ficavam sem versão tendo o número no HTML.
    def do_sondagem(extrai) -> pd.Series:
        if not len(sondagens):
            return vazio
        return q["id"].map(sondagens.apply(extrai, axis=1))

    def _versao_do_gerador(linha) -> object:
        gerador = (linha.get("html") or {}).get("generator") or ""
        achado = re.search(r"\d+(?:\.\d+)+", gerador)
        return achado.group(0) if achado else pd.NA

    versao_bruta = (
        do_identify("toolkitVersion")
        .fillna(do_sondagem(_versao_do_gerador))
        .fillna(
            do_sondagem(
                lambda linha: (linha.get("api") or {}).get("dataverseVersion") or pd.NA
            )
        )
    )

    toolkit = q["toolkit"].replace("", pd.NA) if "toolkit" in q else vazio
    # Mesma razão do endpoint: o campo é "prefixo efetivamente usado na
    # coleta", e o cadastro é a configuração de agora. O do quadro veio do
    # `metadataPrefix` de um registro coletado, e serve de reserva.
    prefixo = (
        q["id"].map(cadastro["metadataPrefix"]).replace("", pd.NA)
        if "metadataPrefix" in cadastro.columns
        else vazio
    ).fillna(q["metadataPrefix"].replace("", pd.NA) if "metadataPrefix" in q else vazio)

    carimbo = observado.dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    observacao_id = [
        str(uuid.uuid5(NAMESPACE, f"observacao|{sid}|{t}"))
        for sid, t in zip(q["id"], carimbo, strict=True)
    ]

    # As evidências vêm primeiro: é delas que a Base 1 tira produto, método,
    # confiança e para onde a chave estrangeira aponta. O pipeline de
    # `sondas.py` roda aqui, sobre o que `coletar_identify.py` e
    # `coletar_sondas.py` já trouxeram da rede.
    evidencias, conclusao = extrair_evidencias(
        q, observacao_id, respostas, sondagens, endpoint, cadastro
    )

    fontes = pd.DataFrame(
        {
            "source_observation_id": observacao_id,
            # O id do harvester é o identificador permanente que temos; a
            # sigla do cadastro (`ABCLIMA-1`) é como o Oasisbr chama a fonte.
            # São coisas distintas, e o dicionário separa as duas justamente
            # porque vão divergir quando a fonte mudar de instalação.
            "source_id": q["id"],
            "oasisbr_source_id": q["acronym"],
            "observed_at": observado,
            "source_name_raw": q["name"],
            "source_name_normalized": q["name"].map(normalizar_nome),
            "institution_name": q["institutionName"],
            # `institutionAcronym` e não `sigla`/`acronym`: a sigla do cadastro
            # nomeia a **fonte** (`ABCLIMA-1`), não a instituição (`ABCLIMA`),
            # e elas diferem em 1.944 das 2.183.
            "institution_acronym": q["institutionAcronym"],
            # Derivado do nome, por `instituicoes.py`, que grava ao lado a
            # regra ou a URL de cada decisão. Sem esse rastro a inferência
            # viraria dado observado.
            "institution_type": q["institutionName"].map(natureza),
            # Dois eixos que não são natureza jurídica e por isso não cabiam
            # no CV01: com ou sem fins lucrativos, e com ou sem qualificação
            # comunitária. Vazio é **não apurado**, não é "não".
            "FinsLucrativos": q["institutionName"].map(tabela_inst["FinsLucrativos"]),
            "Comunitaria": q["institutionName"].map(tabela_inst["Comunitaria"]),
            "country_code": pais,
            "subdivision_code": subdivisao,
            "source_url": endpoint.map(pagina_publica),
            "harvest_endpoint_url": endpoint,
            "source_status": situacao,
            "source_type_macro": macro,
            "source_type_detail": detalhe,
            "platform_name_raw": toolkit.fillna(conclusao["nome_declarado"]),
            "platform_product": conclusao["platform_product"],
            "platform_detection_method": conclusao["platform_detection_method"],
            "platform_confidence": conclusao["platform_confidence"],
            "harvest_protocol": protocolo,
            # Do campo `sets` do cadastro do Harvester, que o backend não
            # mapeia e nenhuma das duas exportações trazia.
            "harvest_scope": escopo,
            "oai_protocol_version": do_identify("protocolVersion"),
            "oai_repository_name": do_identify("repositoryName").fillna(
                q.get("repositoryName", vazio)
            ),
            "oai_earliest_datestamp": do_identify("earliestDatestamp"),
            "oai_deleted_record_policy": do_identify("deletedRecord"),
            "oai_granularity": do_identify("granularity"),
            "platform_version_raw": versao_bruta,
            "platform_version": versao_bruta.map(versao_normalizada),
            "harvest_set_spec": set_spec,
            "identify_sha256": do_identify("sha256"),
            "harvest_metadata_prefix": prefixo,
            "metadata_profile": prefixo.map(PERFIL),
            "notes": observacao,
            # A última coleta, como o índice do Harvester a reporta. É o
            # estado da coleta e não da fonte — e é o que permite cruzar
            # tamanho coletado com plataforma sem voltar ao índice.
            "snapshot_id": q.get("lastSnapshotId", vazio),
            "snapshot_date": q.get("lastSnapshotDate", vazio),
            "snapshot_status": q.get("lastSnapshotStatus", vazio).fillna("SEM_COLETA")
            if "lastSnapshotStatus" in q
            else vazio,
            # O índice reporta 0 para quem nunca coletou, e 0 registros
            # coletados é diferente de coleta que não houve. Sem esta
            # máscara, as 8 sem coleta entrariam na média de tamanho como
            # repositórios vazios.
            "size": q.get("lastSize", vazio).where(houve_coleta),
            "valid_size": q.get("lastValidSize", vazio).where(houve_coleta),
            "transformed_size": q.get("lastTransformedSize", vazio).where(houve_coleta),
            "index_status": q.get("lastIndexStatus", vazio).fillna("SEM_INDICE")
            if "lastIndexStatus" in q
            else vazio,
            "classification_evidence_id": conclusao["classification_evidence_id"],
        }
    )

    # O pipeline pode discordar do `tipo` que o classificador antigo concluiu,
    # e discordar é o ponto: ele tem quatro sondas que o outro não tinha. A
    # divergência vira relatório, não exceção — mas continua sendo olhada,
    # porque o classificador antigo acertava 1.362 casos e uma regressão em
    # massa apareceria aqui antes de virar dado publicado.
    esperado = tipo.map(PRODUTO)
    obtido = conclusao["platform_product"].to_numpy()
    mudou = esperado.notna().to_numpy() & (esperado.to_numpy() != obtido)
    montar_bases.divergencias = pd.DataFrame(
        {
            "source_id": q.loc[mudou, "id"].to_numpy(),
            "antes": esperado.to_numpy()[mudou],
            "agora": obtido[mudou],
        }
    )

    colunas = [
        "classification_evidence_id",
        "source_observation_id",
        "source_id",
        "probe",
        "signal_name",
        "signal_value_raw",
        "signal_strength",
        "signal_weight",
        "detection_method",
        "inferred_product",
        "decisive",
        "notes",
    ]
    return bf.montar(fontes, estrito=True), evidencias[colunas].reset_index(drop=True)


def _relatorio(fontes: pd.DataFrame, evidencias: pd.DataFrame) -> None:
    print(f"\nbase-fontes:     {len(fontes):>5} observações × {fontes.shape[1]} campos")
    print(
        f"base-evidencias: {len(evidencias):>5} evidências × {evidencias.shape[1]} campos"
    )

    resolve = fontes["classification_evidence_id"].isin(
        evidencias.loc[evidencias["decisive"], "classification_evidence_id"]
    )
    print(f"chave estrangeira: {resolve.sum()}/{len(fontes)} apontam para a decisiva")
    por_observacao = (
        evidencias.groupby("source_observation_id").size().value_counts().sort_index()
    )
    print(
        "evidências por observação: "
        + " · ".join(f"{n}→{q}" for n, q in por_observacao.items())
    )
    concordes = (fontes["platform_detection_method"] == "MULTIPLE_EVIDENCE").sum()
    divergem = evidencias["notes"].str.startswith("outra sonda", na=False).sum()
    print(f"MULTIPLE_EVIDENCE: {concordes} | sinais que discordaram: {divergem}")
    print(
        f"classificadas: {(fontes.platform_product != 'UNKNOWN').sum()} | com endpoint: {fontes.harvest_endpoint_url.notna().sum()}"
    )

    for coluna in (
        "platform_analysis_group",
        "source_status",
        "platform_confidence",
        "source_type_detail",
    ):
        contagem = fontes[coluna].value_counts(dropna=False)
        print(f"\n{coluna}:")
        print(contagem[contagem > 0].to_string())

    vazios = fontes.isna().sum()
    vazios = vazios[vazios > 0].sort_values(ascending=False)
    if len(vazios):
        print("\ncampos vazios (o que falta coletar):")
        print(vazios.to_string())

    problemas = bf.conferir(fontes)
    print(f"\nconferência: {len(problemas)} apontamento(s)")
    if len(problemas):
        print(bf.resumo(problemas).to_string(index=False))


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument(
        "--conferir", action="store_true", help="gera em memória e só relata"
    )
    opcoes = argumentos.parse_args()

    fontes, evidencias = montar_bases()
    if not opcoes.conferir:
        bf.gravar(fontes)
        EVIDENCIAS.write_text(evidencias.to_csv(index=False))
        print(f"gravado: {bf.BASE.name}, {EVIDENCIAS.name}")
    _relatorio(fontes, evidencias)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
