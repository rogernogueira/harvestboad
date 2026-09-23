#!/usr/bin/env python
"""Base 1 — uma linha por **observação de fonte**, no pandas.

O dicionário de dados vive aqui, em código executável: os vocabulários
controlados (CV01…CV13), o tipo de cada campo, a obrigatoriedade e as regras
que ligam um campo a outro. Serve para três coisas:

    from base_fontes import vazia, montar, conferir, dicionario

    base = vazia()                       # quadro vazio, já com os dtypes certos
    base = montar(linhas)                # list[dict] | DataFrame -> quadro tipado
    problemas = conferir(linhas)         # o que está errado, antes de tipar
    dicionario()                         # o próprio dicionário, como DataFrame

A unidade de observação é a **observação**, não a fonte: a mesma fonte
observada em duas datas dá duas linhas, com `source_id` igual e
`source_observation_id` diferente. É o que permite ver migração de plataforma e
mortalidade de fonte sem reconstruir nada.

Três decisões de pandas que valem mais que o resto do arquivo:

- **`category` engole erro de digitação.** `Series.astype(CategoricalDtype([...]))`
  transforma todo valor fora do vocabulário em NaN, calado. Por isso `montar`
  só tipa depois de `conferir`, e levanta exceção se achar valor estranho —
  `estrito=False` desliga, e aí o valor vira NaN mesmo.
- **NaN não significa desconhecido.** Todo vocabulário tem `UNKNOWN`, e os
  campos obrigatórios são preenchidos com ele. NaN fica reservado para
  *não se aplica* (campo condicional cuja condição não valeu) — são coisas
  diferentes e misturá-las apaga a diferença entre "não sei" e "não cabe".
- **CSV perde o tipo; parquet não.** Ler CSV devolve tudo como texto, com
  vocabulário e carimbo de tempo desfeitos. Por isso `ler()` sempre passa o que
  leu por `montar()`.

Como script, monta um exemplo, tipa, confere e imprime — é o teste de fumaça:

    .venv/bin/python exp1/base_fontes.py
"""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

import pandas as pd

PASTA = Path(__file__).resolve().parent
DADOS = PASTA / "data"

# A base é um arquivo, não uma abstração: `ler()` e `gravar()` sem argumento
# falam deste. CSV e não parquet, mesmo com `pyarrow` disponível: esta base é
# preenchida e revista à mão e vive no git, onde o CSV dá diff legível e abre
# em planilha. O que o CSV perde — vocabulário, fuso — `ler()` devolve ao
# repassar por `montar()`, então a escolha custa tempo de leitura, não
# informação. Parquet continua valendo para exportar (`gravar(base, "...parquet")`),
# e aí preserva tudo sem retipar.
BASE = DADOS / "base-fontes.csv"


# --------------------------------------------------------- vocabulários (CV01…CV13)

# Código -> significado. O significado não é enfeite: é o que `dicionario()`
# publica junto com a base, para que ninguém precise do texto original para
# entender uma coluna.

CV01_INSTITUTION_TYPE = {
    "FEDERAL_UNIVERSITY": "Universidade federal",
    "STATE_UNIVERSITY": "Universidade estadual",
    "MUNICIPAL_UNIVERSITY": "Universidade municipal",
    "PRIVATE_UNIVERSITY": "Universidade/instituição privada",
    "FEDERAL_INSTITUTE": "Instituto Federal/CEFET",
    "RESEARCH_INSTITUTE": "Instituto ou centro de pesquisa",
    "GOVERNMENT_AGENCY": "Órgão ou entidade governamental",
    "SCIENTIFIC_SOCIETY": "Sociedade/associação científica",
    "PUBLISHER": "Editora",
    "LIBRARY": "Biblioteca não enquadrada acima",
    "OTHER": "Outra natureza conhecida",
    "UNKNOWN": "Não foi possível determinar",
}

CV02_SOURCE_STATUS = {
    "ACTIVE": "Fonte operacional",
    "TEMPORARILY_UNAVAILABLE": "Temporariamente indisponível",
    "INACTIVE": "Fonte não operacional",
    "REMOVED_FROM_OASISBR": "Removida/descredenciada",
    "MIGRATED": "Fonte substituída por outra instalação",
    "UNKNOWN": "Situação indeterminada",
}

CV03_SOURCE_TYPE_MACRO = {
    "SCIENTIFIC_JOURNAL": "Revista científica",
    "PUBLICATION_REPOSITORY": "Repositório de publicações",
    "RESEARCH_DATA_REPOSITORY": "Repositório de dados de pesquisa",
    "ETD_LIBRARY": "Biblioteca digital de teses e dissertações",
    "OTHER_SCIENTIFIC_SOURCE": "Fonte científica fora dos quatro macrogrupos",
    "UNKNOWN": "Não classificada",
}

CV04_SOURCE_TYPE_DETAIL = {
    "MONOGRAPH_DIGITAL_LIBRARY": "Biblioteca digital de monografias",
    "ETD_DIGITAL_LIBRARY": "Biblioteca digital de teses e dissertações",
    "SCIENTIFIC_CONFERENCE": "Conferência científica",
    "AGGREGATOR_PORTAL": "Portal agregador",
    "BOOK_PORTAL": "Portal de livros",
    "RESEARCH_DATA_REPOSITORY": "Repositório de dados de pesquisa",
    "PUBLICATION_REPOSITORY": "Repositório de publicações",
    "SCIENTIFIC_JOURNAL": "Revista científica",
    "PREPRINT_SERVER": "Servidor de preprints",
    "UNKNOWN": "Ainda não classificada",
}

CV05_PLATFORM_PRODUCT = {
    "DSPACE": "DSpace",
    "TEDE2": "TEDE2 baseado em DSpace",
    "TEDE_LEGACY": "TEDE anterior ao TEDE2",
    "OJS": "Open Journal Systems",
    "DATAVERSE": "Dataverse",
    "SCIELO": "Plataforma/ecossistema SciELO",
    "PERGAMUM": "Pergamum",
    "SOPHIA": "SophiA",
    "OMEKA": "Omeka",
    "EPRINTS": "EPrints",
    "INVENIO_RDM": "InvenioRDM",
    "FEDORA_ISLANDORA": "Fedora/Islandora",
    "CKAN": "CKAN",
    "CUSTOM": "Sistema desenvolvido especificamente pela instituição",
    "OTHER_IDENTIFIED": "Produto identificado, fora do vocabulário",
    "UNKNOWN": "Não foi possível identificar",
}

CV06_PLATFORM_ANALYSIS_GROUP = {
    "DSPACE": "DSpace e TEDE2",
    "OJS": "OJS e instalações historicamente identificadas como SEER",
    "DATAVERSE": "Dataverse",
    # Estrato próprio, acrescentado depois de medir: são 215 observações
    # colhidas do OAI central do SciELO, quase 18× o Dataverse, que já tinha
    # estrato. Sem separá-las, "Outros" deixava de ser resíduo e passava a
    # medir sobretudo o SciELO — e a hipótese sobre taxa de erro por
    # plataforma compararia um estrato mascarado com os demais.
    "SCIELO": "SciELO",
    "OTHER": "Demais tecnologias conhecidas",
    "UNKNOWN": "Tecnologia não identificada",
}

CV07_PLATFORM_DETECTION_METHOD = {
    "PLATFORM_API": "Informação retornada por API da plataforma",
    "OAI_IDENTIFY": "Evidência no Identify",
    "OAI_DESCRIPTION": "Informação no elemento description",
    "HTML_META_GENERATOR": '<meta name="generator">',
    "HTTP_HEADER": "Cabeçalhos HTTP",
    "HTML_SIGNATURE": "Elementos inequívocos da interface",
    "OFFICIAL_DOCUMENTATION": "Documentação oficial da instituição",
    "SOURCE_CODE_SIGNATURE": "Assinatura técnica no código",
    "MANUAL_TECHNICAL_INSPECTION": "Inspeção técnica manual",
    # Os dois códigos abaixo são **extensão nossa** ao CV07 do dicionário, que
    # não previa evidência vinda de outro verbo do OAI-PMH que não o
    # `Identify`. `ListMetadataFormats` e `ListSets` são impressão digital de
    # plataforma, e enfiá-los em OAI_DESCRIPTION descreveria errado de onde a
    # evidência veio — que é justamente o que esta base existe para não fazer.
    # Remover os dois é voltar ao vocabulário original.
    # Terceira **extensão nossa** ao CV07, e a mais fraca das três: é o que
    # quem cadastrou a fonte no Oasisbr digitou no campo de software. Não é
    # observação da origem nem documentação da instituição — é declaração de
    # terceiro, que pode estar desatualizada e ninguém conferiu.
    # Quarta extensão nossa ao CV07. Diferente de URL_PATTERN_ONLY, que é
    # inferir plataforma pela **forma** do endereço (`/index.php/` sugere
    # OJS): aqui o endpoint é o serviço, reconhecido pelo domínio e pela rota
    # próprios dele. `scielo.br/oai/scielo-oai.php` não sugere SciELO — é o
    # OAI do SciELO.
    "SERVICE_ENDPOINT": "Endpoint de um serviço conhecido, pelo domínio e rota",
    "SOURCE_REGISTRY": "Declaração de software no cadastro do agregador",
    "OAI_METADATA_FORMATS": "Conjunto de prefixos em ListMetadataFormats",
    "OAI_SETS": "Forma dos setSpec em ListSets",
    "MULTIPLE_EVIDENCE": "Duas ou mais evidências concordantes",
    "URL_PATTERN_ONLY": "Inferência somente pela URL",
    "UNKNOWN": "Sem evidência suficiente",
}

# Único vocabulário **ordenado**, e declarado do mais fraco para o mais forte:
# é o que faz `base.platform_confidence >= "HIGH"` funcionar como filtro de
# análise de sensibilidade, em vez de exigir uma lista de códigos em toda
# consulta.
CV08_PLATFORM_CONFIDENCE = {
    "UNKNOWN": "Sem classificação confiável",
    "LOW": "Inferência indireta",
    "MEDIUM": "Uma evidência técnica forte",
    "HIGH": "Duas ou mais evidências técnicas independentes concordantes",
    "CONFIRMED": "Evidência explícita do próprio sistema ou documentação oficial",
}

CV09_HARVEST_PROTOCOL = {
    "OAI_PMH": "OAI-PMH",
    "REST_API": "API REST",
    "OTHER_API": "Outra API estruturada",
    "STATIC_XML": "XML disponibilizado estaticamente",
    "CUSTOM": "Integração específica",
    "OTHER": "Outro protocolo",
    "UNKNOWN": "Não determinado",
}

CV10_HARVEST_SCOPE = {
    "ALL_RECORDS": "Todos os registros expostos",
    "SINGLE_SET": "Um setSpec específico",
    "MULTIPLE_SETS": "Vários sets definidos",
    "CUSTOM_FILTER": "Outro critério de filtragem",
    "UNKNOWN": "Não conhecido",
}

# Os três valores oficiais do OAI-PMH, em minúsculas como o protocolo os emite.
# Não são vocabulário nosso: uniformizá-los para MAIÚSCULAS quebraria a
# comparação direta com a resposta do `Identify`.
CV11_OAI_DELETED_RECORD_POLICY = {
    "no": "Não mantém informação sobre exclusões",
    "transient": "Mantém temporariamente",
    "persistent": "Mantém permanentemente",
}

# Idem: são os dois literais do protocolo, não códigos.
CV12_OAI_GRANULARITY = {
    "YYYY-MM-DD": "Granularidade de dia",
    "YYYY-MM-DDThh:mm:ssZ": "Granularidade de segundo",
}

CV13_METADATA_PROFILE = {
    "OAI_DC": "OAI Dublin Core",
    "XOAI": "XOAI/DSpace",
    "DATACITE": "DataCite Metadata Schema",
    "OPENAIRE": "Perfil OpenAIRE",
    "DRIVER": "DRIVER",
    "BDTD": "Perfil utilizado pela BDTD",
    "CUSTOM": "Perfil específico",
    "OTHER": "Outro padrão reconhecido",
    "UNKNOWN": "Não determinado",
}

# Dois eixos que não são natureza da instituição e por isso não cabiam no
# CV01: uma privada pode ser com ou sem fins lucrativos, e uma sem fins pode
# ou não ter qualificação comunitária. Enfiar os três num vocabulário só
# obrigaria a escolher qual deles a coluna conta.
#
# Não há `UNKNOWN` aqui de propósito: o campo é opcional, e vazio quer dizer
# **não apurado**, que é o estado de toda instituição que não casou com
# nenhum recorte do e-MEC. `UNKNOWN` diria que foi apurado e não se soube.
# Estados da coleta e do índice, **como o Harvester os emite**. Não são
# vocabulário nosso: são os valores que o software devolve, e uniformizá-los
# quebraria a comparação direta com a origem — mesma razão pela qual CV11 e
# CV12 ficaram em minúsculas e com os literais do OAI-PMH.
CV15_SNAPSHOT_STATUS = {
    "VALID": "Coleta concluída e válida",
    "HARVESTING_FINISHED_VALID": "Coleta terminada com resultado válido",
    "HARVESTING_FINISHED_ERROR": "Coleta terminada com erro",
    "HARVESTING": "Coleta em andamento",
    "SEM_COLETA": "Nunca houve coleta",
}

CV16_INDEX_STATUS = {
    "INDEXED": "Indexado",
    "FAILED": "Indexação falhou",
    "SEM_INDICE": "Nunca indexado",
    "UNKNOWN": "Estado do índice não informado",
}

CV14_SIM_NAO = {
    "S": "Sim",
    "N": "Não",
}

VOCABULARIOS = {
    "institution_type": ("CV01", CV01_INSTITUTION_TYPE),
    "source_status": ("CV02", CV02_SOURCE_STATUS),
    "source_type_macro": ("CV03", CV03_SOURCE_TYPE_MACRO),
    "source_type_detail": ("CV04", CV04_SOURCE_TYPE_DETAIL),
    "platform_product": ("CV05", CV05_PLATFORM_PRODUCT),
    "platform_analysis_group": ("CV06", CV06_PLATFORM_ANALYSIS_GROUP),
    "platform_detection_method": ("CV07", CV07_PLATFORM_DETECTION_METHOD),
    "platform_confidence": ("CV08", CV08_PLATFORM_CONFIDENCE),
    "harvest_protocol": ("CV09", CV09_HARVEST_PROTOCOL),
    "harvest_scope": ("CV10", CV10_HARVEST_SCOPE),
    "oai_deleted_record_policy": ("CV11", CV11_OAI_DELETED_RECORD_POLICY),
    "oai_granularity": ("CV12", CV12_OAI_GRANULARITY),
    "metadata_profile": ("CV13", CV13_METADATA_PROFILE),
    "snapshot_status": ("CV15", CV15_SNAPSHOT_STATUS),
    "index_status": ("CV16", CV16_INDEX_STATUS),
    "FinsLucrativos": ("CV14", CV14_SIM_NAO),
    "Comunitaria": ("CV14", CV14_SIM_NAO),
}

ORDENADOS = {"platform_confidence"}


# ------------------------------------------------------------------ derivações

# CV05 -> CV06. O grupo de análise é **derivado**, nunca digitado: é ele que
# entra nas hipóteses, e deixá-lo à mão criaria uma fonte TEDE2 fora do estrato
# DSpace sem que nada acusasse. `montar` recalcula e `conferir` denuncia
# divergência.
GRUPO_DE_ANALISE = {
    "DSPACE": "DSPACE",
    "TEDE2": "DSPACE",
    "TEDE_LEGACY": "DSPACE",
    "OJS": "OJS",
    "DATAVERSE": "DATAVERSE",
    "SCIELO": "SCIELO",
    "UNKNOWN": "UNKNOWN",
}

# Nome encontrado na origem -> produto normalizado. SEER não vira plataforma:
# é o nome antigo do OJS no Brasil, e criá-la duplicaria um software só. O nome
# bruto continua em `platform_name_raw`, então nada se perde.
PRODUTO_POR_APELIDO = {
    "seer": "OJS",
    "sistema eletrônico de editoração de revistas": "OJS",
    "sistema eletronico de editoracao de revistas": "OJS",
    "open journal systems": "OJS",
    "ojs": "OJS",
    "dspace": "DSPACE",
    "tede": "TEDE_LEGACY",
    "tede2": "TEDE2",
    "dataverse": "DATAVERSE",
}

# CV04 -> CV03. Um detalhe implica um macro; a recíproca não vale (o macro é
# mais largo). Serve para `conferir` achar a linha em que os dois discordam.
MACRO_POR_DETALHE = {
    "MONOGRAPH_DIGITAL_LIBRARY": "OTHER_SCIENTIFIC_SOURCE",
    "ETD_DIGITAL_LIBRARY": "ETD_LIBRARY",
    "SCIENTIFIC_CONFERENCE": "OTHER_SCIENTIFIC_SOURCE",
    "AGGREGATOR_PORTAL": "OTHER_SCIENTIFIC_SOURCE",
    "BOOK_PORTAL": "OTHER_SCIENTIFIC_SOURCE",
    "RESEARCH_DATA_REPOSITORY": "RESEARCH_DATA_REPOSITORY",
    "PUBLICATION_REPOSITORY": "PUBLICATION_REPOSITORY",
    "SCIENTIFIC_JOURNAL": "SCIENTIFIC_JOURNAL",
    "PREPRINT_SERVER": "OTHER_SCIENTIFIC_SOURCE",
    "UNKNOWN": "UNKNOWN",
}

# Método de detecção -> teto de confiança. Sem isto, CV08 vira opinião: a
# regra escrita no dicionário ("evitar URL_PATTERN_ONLY como evidência forte")
# só é regra se algo recusar a combinação.
TETO_DE_CONFIANCA = {
    "URL_PATTERN_ONLY": "LOW",
    # Prefixo e setSpec são característicos, não exclusivos: um repositório
    # pode expor `xoai` sem ser DSpace. Sozinhos não passam de MEDIUM, e é a
    # concordância entre sondas que promove — nunca o volume de sinais.
    "OAI_METADATA_FORMATS": "MEDIUM",
    "OAI_SETS": "MEDIUM",
    # Declaração de terceiro não confirma nada sozinha, e não deve poder
    # empurrar uma fonte para além de MEDIUM nem quando é o único sinal.
    "SOURCE_REGISTRY": "MEDIUM",
    # Teto MEDIUM e não CONFIRMED: sabemos de onde o registro vem, mas o
    # endpoint está morto e nunca o vimos servir. CONFIRMED pede evidência
    # **emitida** pelo sistema, e não houve emissão nenhuma.
    "SERVICE_ENDPOINT": "MEDIUM",
    "UNKNOWN": "UNKNOWN",
    "OAI_DESCRIPTION": "MEDIUM",
    "HTML_SIGNATURE": "MEDIUM",
    "HTTP_HEADER": "MEDIUM",
    "MANUAL_TECHNICAL_INSPECTION": "MEDIUM",
}

# Só evidência emitida pelo próprio sistema (ou documentação oficial) sustenta
# CONFIRMED; concordância de fontes independentes sustenta HIGH.
CONFIRMA = {
    "PLATFORM_API",
    "OAI_IDENTIFY",
    "HTML_META_GENERATOR",
    "SOURCE_CODE_SIGNATURE",
    "OFFICIAL_DOCUMENTATION",
}

FORCA = list(CV08_PLATFORM_CONFIDENCE)  # do mais fraco para o mais forte


# --------------------------------------------------------------------- campos

# (nome, dtype, obrigatoriedade). `categoria` sai de VOCABULARIOS; `carimbo` é
# datetime com fuso; o resto é texto. A ordem desta lista é a ordem das colunas
# da base — vale para CSV, parquet e para a leitura humana.
CAMPOS: list[tuple[str, str, str]] = [
    ("source_observation_id", "texto", "M"),
    ("source_id", "texto", "M"),
    ("oasisbr_source_id", "texto", "C"),
    ("observed_at", "carimbo", "M"),
    ("source_name_raw", "texto", "M"),
    ("source_name_normalized", "texto", "M"),
    ("institution_name", "texto", "M"),
    ("institution_acronym", "texto", "O"),
    ("institution_type", "categoria", "O"),
    # Os nomes vêm como você os escreveu. Destoam do snake_case inglês das
    # outras 36 colunas, que veio do dicionário original — estes dois são
    # extensão nossa, e renomeá-los por estética seria trocar a sua escolha
    # pela minha. Diga se prefere `for_profit`/`community` e eu troco.
    ("FinsLucrativos", "categoria", "O"),
    ("Comunitaria", "categoria", "O"),
    ("country_code", "texto", "M"),
    ("subdivision_code", "texto", "O"),
    ("source_url", "texto", "M"),
    ("harvest_endpoint_url", "texto", "M"),
    ("source_status", "categoria", "M"),
    ("source_type_macro", "categoria", "M"),
    ("source_type_detail", "categoria", "M"),
    ("platform_name_raw", "texto", "C"),
    ("platform_product", "categoria", "M"),
    ("platform_analysis_group", "categoria", "M"),
    ("platform_version_raw", "texto", "O"),
    ("platform_version", "texto", "O"),
    ("platform_detection_method", "categoria", "M"),
    ("platform_confidence", "categoria", "M"),
    ("harvest_protocol", "categoria", "M"),
    ("harvest_scope", "categoria", "M"),
    ("oai_protocol_version", "texto", "C"),
    ("oai_repository_name", "texto", "C"),
    ("oai_earliest_datestamp", "carimbo", "C"),
    ("oai_deleted_record_policy", "categoria", "C"),
    ("oai_granularity", "categoria", "C"),
    ("harvest_metadata_prefix", "texto", "C"),
    ("metadata_profile", "categoria", "C"),
    ("harvest_set_spec", "texto", "O"),
    # A última coleta do Harvester, como o índice a reporta. Descrevem o
    # **estado da coleta**, não a fonte — e por isso ficam juntos e depois do
    # bloco de coleta. `source_id` já existe e é a chave que os liga.
    ("snapshot_id", "texto", "C"),
    ("snapshot_date", "carimbo", "C"),
    ("snapshot_status", "categoria", "C"),
    ("size", "inteiro", "C"),
    ("valid_size", "inteiro", "C"),
    ("transformed_size", "inteiro", "C"),
    ("index_status", "categoria", "C"),
    ("classification_evidence_id", "texto", "M"),
    ("identify_sha256", "texto", "O"),
    ("notes", "texto", "O"),
]

COLUNAS = [nome for nome, _, _ in CAMPOS]
TIPO = {nome: tipo for nome, tipo, _ in CAMPOS}
OBRIGATORIEDADE = {nome: obr for nome, _, obr in CAMPOS}

# O dicionário marca 14 campos como condicionais sem dizer a condição. Aqui ela
# fica explícita e executável — se a regra de coleta mudar, muda neste ponto e
# `conferir` acompanha. `None` na chave da condição quer dizer "sempre".
CONDICOES: dict[str, tuple[str, str]] = {
    "snapshot_id": ("snapshot_status != 'SEM_COLETA'", "houve coleta"),
    "snapshot_date": ("snapshot_status != 'SEM_COLETA'", "houve coleta"),
    "snapshot_status": ("source_id == source_id", "a fonte está no índice"),
    "size": ("snapshot_status != 'SEM_COLETA'", "houve coleta"),
    "valid_size": ("snapshot_status != 'SEM_COLETA'", "houve coleta"),
    "transformed_size": ("snapshot_status != 'SEM_COLETA'", "houve coleta"),
    "index_status": ("source_id == source_id", "a fonte está no índice"),
    # Fonte que nunca esteve (ou não está mais) no Oasisbr não tem ID de lá.
    "oasisbr_source_id": (
        "source_status not in ['REMOVED_FROM_OASISBR', 'UNKNOWN']",
        "fonte corrente do Oasisbr",
    ),
    # A regra do dicionário: OTHER_IDENTIFIED sem o nome bruto perde a única
    # informação que justificava o código.
    "platform_name_raw": (
        "platform_product in ['OTHER_IDENTIFIED', 'CUSTOM']",
        "produto fora do vocabulário",
    ),
    # Os cinco campos do Identify, e os dois da coleta, só existem sob OAI-PMH.
    "oai_protocol_version": ("harvest_protocol == 'OAI_PMH'", "o Identify respondeu"),
    "oai_repository_name": ("harvest_protocol == 'OAI_PMH'", "o Identify respondeu"),
    "oai_earliest_datestamp": ("harvest_protocol == 'OAI_PMH'", "o Identify respondeu"),
    "oai_deleted_record_policy": (
        "harvest_protocol == 'OAI_PMH'",
        "o Identify respondeu",
    ),
    "oai_granularity": ("harvest_protocol == 'OAI_PMH'", "o Identify respondeu"),
    "harvest_metadata_prefix": ("harvest_protocol == 'OAI_PMH'", "coleta por OAI-PMH"),
    "metadata_profile": ("harvest_protocol == 'OAI_PMH'", "coleta por OAI-PMH"),
}

# Campos condicionais ao Identify que uma fonte fora do ar não tem como
# preencher: exigi-los dela seria cobrar do dado o que faltou na origem.
SEM_IDENTIFY = [
    "TEMPORARILY_UNAVAILABLE",
    "INACTIVE",
    "REMOVED_FROM_OASISBR",
    "UNKNOWN",
]

FORMATOS = {
    "source_observation_id": (
        re.compile(r"(?i)^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$"),
        "UUID",
    ),
    "classification_evidence_id": (
        re.compile(r"(?i)^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$"),
        "UUID",
    ),
    "country_code": (re.compile(r"^[A-Z]{2}$"), "ISO 3166-1 alpha-2"),
    "subdivision_code": (re.compile(r"^[A-Z]{2}-[A-Z0-9]{1,3}$"), "ISO 3166-2"),
    "identify_sha256": (re.compile(r"(?i)^[0-9a-f]{64}$"), "SHA-256 em hexadecimal"),
    "source_url": (re.compile(r"^https?://\S+$"), "URI http(s)"),
    "harvest_endpoint_url": (re.compile(r"^https?://\S+$"), "URI http(s)"),
}

TAMANHOS = {  # VARCHAR(n) do dicionário; TEXT e CHAR ficam de fora
    "source_id": 20,
    "FinsLucrativos": 1,
    "Comunitaria": 1,
    "oasisbr_source_id": 100,
    "institution_acronym": 30,
    "institution_type": 40,
    "subdivision_code": 10,
    "source_status": 30,
    "source_type_macro": 50,
    "source_type_detail": 60,
    "platform_product": 40,
    "platform_analysis_group": 20,
    "platform_version_raw": 100,
    "platform_version": 30,
    "platform_detection_method": 50,
    "platform_confidence": 20,
    "harvest_protocol": 30,
    "harvest_scope": 30,
    "oai_protocol_version": 10,
    "oai_deleted_record_policy": 20,
    "oai_granularity": 30,
    "harvest_metadata_prefix": 100,
    "snapshot_id": 20,
    "snapshot_status": 30,
    "index_status": 20,
    "metadata_profile": 30,
}


def dtype(nome: str):
    """O dtype do pandas de um campo do dicionário."""
    tipo = TIPO[nome]
    if tipo == "categoria":
        codigos = list(VOCABULARIOS[nome][1])
        return pd.CategoricalDtype(codigos, ordered=nome in ORDENADOS)
    if tipo == "inteiro":
        # `Int64` e não `int64`: contagem ausente é ausente, e 0 é zero
        # registro coletado. Um tipo que não admite nulo confundiria os dois.
        return "Int64"
    if tipo == "carimbo":
        # Microssegundo, e não nanossegundo: `earliest_datestamp` de origem
        # antiga chega a 1900 e além, faixa que o ns não cobre.
        return "datetime64[us, UTC]"
    return "str"


DTYPES = {nome: dtype(nome) for nome in COLUNAS}


def dicionario() -> pd.DataFrame:
    """O próprio dicionário de dados, como quadro — uma linha por campo."""
    linhas = []
    for nome, tipo, obrigatoriedade in CAMPOS:
        cv, termos = VOCABULARIOS.get(nome, (None, None))
        linhas.append(
            {
                "campo": nome,
                "tipo": tipo,
                "dtype": str(DTYPES[nome])
                if tipo != "categoria"
                else f"category[{cv}]",
                "obrigatoriedade": obrigatoriedade,
                "vocabulario": cv,
                "termos": len(termos) if termos else pd.NA,
                "condicao": CONDICOES.get(nome, (pd.NA,))[0],
                "tamanho": TAMANHOS.get(nome, pd.NA),
            }
        )
    return pd.DataFrame(linhas).astype({"termos": "Int64", "tamanho": "Int64"})


def termos(campo: str | None = None) -> pd.DataFrame:
    """Os vocabulários controlados como quadro — um ou todos."""
    alvos = [campo] if campo else list(VOCABULARIOS)
    linhas = [
        {
            "campo": nome,
            "vocabulario": VOCABULARIOS[nome][0],
            "codigo": codigo,
            "significado": significado,
            "ordem": i,
        }
        for nome in alvos
        for i, (codigo, significado) in enumerate(VOCABULARIOS[nome][1].items())
    ]
    return pd.DataFrame(linhas)


# ------------------------------------------------------------------ construção


def vazia() -> pd.DataFrame:
    """Quadro sem nenhuma linha, e já com todos os dtypes.

    Existe porque `pd.DataFrame(columns=COLUNAS)` devolve tudo como `object`:
    a primeira concatenação define o tipo pelo que chegou, e a base nasce com
    `observed_at` em texto sem ninguém perceber.
    """
    return pd.DataFrame({nome: pd.Series(dtype=DTYPES[nome]) for nome in COLUNAS})


def _texto(serie: pd.Series) -> pd.Series:
    """Texto limpo: sem espaço nas bordas, e vazio vira ausente."""
    limpo = serie.astype("str").str.strip()
    return limpo.mask(limpo.isin(["", "None", "nan", "NaN", "<NA>"]))


def normalizar(linhas: pd.DataFrame) -> pd.DataFrame:
    """Aplica as regras do dicionário que **derivam** valor, antes de tipar.

    Três, e todas repetíveis sem efeito colateral (rodar duas vezes dá o mesmo):

    - `platform_name_raw` conhecido resolve `platform_product` quando ele não
      veio — é a regra SEER -> OJS, e as irmãs dela;
    - `platform_analysis_group` sai de `platform_product`, sempre;
    - campo obrigatório de vocabulário sem valor vira `UNKNOWN`, nunca NaN.
    """
    linhas = linhas.copy()

    bruto = _texto(linhas["platform_name_raw"]).str.lower().str.strip()
    apelido = bruto.map(PRODUTO_POR_APELIDO)
    produto = _texto(linhas["platform_product"]).str.upper()
    linhas["platform_product"] = produto.fillna(apelido).fillna("UNKNOWN")

    linhas["platform_analysis_group"] = (
        linhas["platform_product"].map(GRUPO_DE_ANALISE).fillna("OTHER")
    )

    for nome in COLUNAS:
        if TIPO[nome] != "categoria" or OBRIGATORIEDADE[nome] != "M":
            continue
        if "UNKNOWN" in VOCABULARIOS[nome][1]:
            linhas[nome] = _texto(linhas[nome]).fillna("UNKNOWN")
    return linhas


def montar(dados, estrito: bool = True, normaliza: bool = True) -> pd.DataFrame:
    """`list[dict]` ou DataFrame -> a base tipada, na ordem canônica.

    Com `estrito=True` (o padrão), valor fora do vocabulário levanta exceção em
    vez de virar NaN calado — é a diferença entre descobrir o erro de digitação
    agora e descobri-lo quando a contagem por plataforma não fechar.
    """
    linhas = (
        pd.DataFrame(dados) if not isinstance(dados, pd.DataFrame) else dados.copy()
    )

    for nome in COLUNAS:  # campo ausente é campo vazio, não erro
        if nome not in linhas:
            linhas[nome] = pd.NA
    extras = [c for c in linhas.columns if c not in COLUNAS]

    for nome in COLUNAS:
        if TIPO[nome] == "texto":
            linhas[nome] = _texto(linhas[nome])
    if normaliza:
        linhas = normalizar(linhas)

    if estrito:
        problemas = conferir(linhas, tipar=False)
        graves = problemas[problemas["problema"] == "fora do vocabulário"]
        if not graves.empty:
            amostra = graves.head(10).to_string(index=False)
            raise ValueError(
                f"{len(graves)} valor(es) fora do vocabulário; `astype('category')` "
                f"os transformaria em NaN sem avisar:\n{amostra}"
            )

    for nome in COLUNAS:
        if TIPO[nome] == "inteiro":
            linhas[nome] = pd.to_numeric(linhas[nome], errors="coerce").astype("Int64")
        elif TIPO[nome] == "carimbo":
            linhas[nome] = pd.to_datetime(
                linhas[nome], errors="coerce", utc=True, format="ISO8601"
            ).astype(DTYPES[nome])
        elif TIPO[nome] == "categoria":
            linhas[nome] = _texto(linhas[nome]).astype(DTYPES[nome])

    return linhas[COLUNAS + extras].reset_index(drop=True)


# ------------------------------------------------------------------ conferência


def _aplicavel(linhas: pd.DataFrame, condicao: str) -> pd.Series:
    """A condição de um campo condicional, avaliada linha a linha."""
    try:
        alvo = linhas.eval(condicao)
    except pd.errors.UndefinedVariableError, KeyError, TypeError, ValueError:
        # Coluna ausente ou tipo impróprio: não há como cobrar o condicional,
        # e a falta da coluna já vira achado próprio em `conferir`.
        return pd.Series(False, index=linhas.index)
    return alvo.fillna(False).astype(bool)


def conferir(dados, tipar: bool = True) -> pd.DataFrame:
    """O que está errado na base — uma linha por problema encontrado.

    Devolve quadro em vez de levantar exceção porque num quadro de 1.500 fontes
    o interessante é o padrão dos erros, não o primeiro deles:

        problemas.groupby(["campo", "problema"]).size().sort_values()

    Sete verificações: obrigatório ausente, condicional ausente, valor fora do
    vocabulário, formato (UUID, ISO 3166, SHA-256, URI), tamanho de VARCHAR,
    carimbo impossível de ler, e as coerências entre campos (macro × detalhe,
    produto × grupo, confiança × método, subdivisão × país, duplicidade de
    observação).
    """
    linhas = (
        pd.DataFrame(dados) if not isinstance(dados, pd.DataFrame) else dados.copy()
    )
    if tipar:
        linhas = montar(linhas, estrito=False)
    for nome in COLUNAS:
        if nome not in linhas:
            linhas[nome] = pd.NA

    # Categoria já tipada volta a texto: comparar com o vocabulário exige ver o
    # valor, e num `Categorical` o valor inválido já virou NaN.
    cru = pd.DataFrame(
        {
            nome: (
                linhas[nome].astype("object").astype("str").where(linhas[nome].notna())
                if not isinstance(linhas[nome].dtype, pd.DatetimeTZDtype)
                else linhas[nome]
            )
            for nome in COLUNAS
        },
        index=linhas.index,
    )

    achados: list[pd.DataFrame] = []

    def anotar(mascara: pd.Series, campo: str, problema: str, detalhe) -> None:
        mascara = mascara.fillna(False)
        if not mascara.any():
            return
        achados.append(
            pd.DataFrame(
                {
                    "linha": linhas.index[mascara],
                    "source_observation_id": cru.loc[mascara, "source_observation_id"],
                    "campo": campo,
                    "problema": problema,
                    "valor": cru.loc[mascara, campo].astype("str")
                    if campo in cru
                    else pd.NA,
                    "detalhe": detalhe,
                }
            )
        )

    for nome in COLUNAS:
        ausente = cru[nome].isna()

        if OBRIGATORIEDADE[nome] == "M":
            anotar(ausente, nome, "obrigatório ausente", "M no dicionário")
        elif OBRIGATORIEDADE[nome] == "C" and nome in CONDICOES:
            condicao, porque = CONDICOES[nome]
            alvo = _aplicavel(cru, condicao)
            if nome.startswith("oai_"):
                # A condição de ter os campos do `Identify` é o `Identify`
                # **ter respondido** — não a fonte estar ativa. Eram
                # aproximações parecidas até aparecerem 17 fontes com site no
                # ar e endpoint dando 404: ativas, e sem Identify nenhum para
                # copiar. O sinal de que a resposta existiu está na própria
                # base, no hash dela.
                alvo &= cru["identify_sha256"].notna()
            elif nome in ("harvest_metadata_prefix", "metadata_profile"):
                # Estes dois vêm do cadastro do Harvester, e não da origem:
                # existem mesmo quando a origem não responde.
                alvo &= ~cru["source_status"].isin(SEM_IDENTIFY)
            anotar(ausente & alvo, nome, "condicional ausente", porque)

        if nome in VOCABULARIOS:
            codigos = VOCABULARIOS[nome][1]
            anotar(
                ~ausente & ~cru[nome].isin(codigos),
                nome,
                "fora do vocabulário",
                VOCABULARIOS[nome][0],
            )

        if nome in FORMATOS:
            padrao, esperado = FORMATOS[nome]
            anotar(
                ~ausente & ~cru[nome].str.fullmatch(padrao, na=False),
                nome,
                "formato inválido",
                esperado,
            )

        if nome in TAMANHOS:
            limite = TAMANHOS[nome]
            anotar(
                ~ausente & (cru[nome].str.len() > limite),
                nome,
                "excede o tamanho",
                f"VARCHAR({limite})",
            )

        if TIPO[nome] == "carimbo":
            original = (
                pd.DataFrame(dados).get(nome)
                if not isinstance(dados, pd.DataFrame)
                else dados.get(nome)
            )
            if original is not None:
                veio = pd.Series(original).reset_index(drop=True).notna()
                virou = linhas[nome].reset_index(drop=True).notna()
                anotar(
                    (veio & ~virou).set_axis(linhas.index),
                    nome,
                    "carimbo ilegível",
                    "esperado ISO 8601",
                )

    # ---- coerências entre campos

    esperado_macro = cru["source_type_detail"].map(MACRO_POR_DETALHE)
    anotar(
        esperado_macro.notna()
        & cru["source_type_macro"].notna()
        & (cru["source_type_macro"] != esperado_macro)
        & (cru["source_type_macro"] != "OTHER_SCIENTIFIC_SOURCE"),
        "source_type_macro",
        "incoerente com o detalhe",
        "CV04 implica um CV03",
    )

    esperado_grupo = cru["platform_product"].map(GRUPO_DE_ANALISE).fillna("OTHER")
    anotar(
        cru["platform_product"].notna()
        & (cru["platform_analysis_group"] != esperado_grupo),
        "platform_analysis_group",
        "incoerente com o produto",
        "CV06 é derivado de CV05",
    )

    forca = cru["platform_confidence"].map({c: i for i, c in enumerate(FORCA)})
    teto = (
        cru["platform_detection_method"]
        .map(TETO_DE_CONFIANCA)
        .map({c: i for i, c in enumerate(FORCA)})
    )
    anotar(
        forca.notna() & teto.notna() & (forca > teto),
        "platform_confidence",
        "acima do que o método sustenta",
        "CV07 limita CV08",
    )
    anotar(
        (cru["platform_confidence"] == "CONFIRMED")
        & ~cru["platform_detection_method"].isin(CONFIRMA),
        "platform_confidence",
        "acima do que o método sustenta",
        "CONFIRMED exige evidência do próprio sistema",
    )
    anotar(
        (cru["platform_confidence"] == "HIGH")
        & (cru["platform_detection_method"] != "MULTIPLE_EVIDENCE"),
        "platform_confidence",
        "acima do que o método sustenta",
        "HIGH exige MULTIPLE_EVIDENCE",
    )

    anotar(
        cru["subdivision_code"].notna()
        & cru["country_code"].notna()
        # `str.startswith` não aceita Series; a comparação é entre colunas.
        & (cru["subdivision_code"].str[:2] != cru["country_code"]),
        "subdivision_code",
        "incoerente com o país",
        "ISO 3166-2 começa pelo código do país",
    )

    anotar(
        cru["source_observation_id"].duplicated(keep=False)
        & cru["source_observation_id"].notna(),
        "source_observation_id",
        "duplicado",
        "a chave da observação",
    )
    par = cru[["source_id", "observed_at"]].astype("str")
    anotar(
        par.duplicated(keep=False)
        & cru["source_id"].notna()
        & cru["observed_at"].notna(),
        "source_id",
        "duas observações no mesmo instante",
        "source_id + observed_at deveria ser único",
    )

    if not achados:
        return pd.DataFrame(
            columns=[
                "linha",
                "source_observation_id",
                "campo",
                "problema",
                "valor",
                "detalhe",
            ]
        )
    return (
        pd.concat(achados, ignore_index=True)
        .sort_values(["linha", "campo"])
        .reset_index(drop=True)
    )


def resumo(problemas: pd.DataFrame) -> pd.DataFrame:
    """Os problemas agrupados — por onde começar a corrigir."""
    if problemas.empty:
        return problemas
    return (
        problemas.groupby(["campo", "problema"], observed=True)
        .agg(quantas=("linha", "size"), exemplo=("valor", "first"))
        .sort_values("quantas", ascending=False)
        .reset_index()
    )


def lacunas(base: pd.DataFrame) -> pd.DataFrame:
    """Quanto de cada campo não informa nada — um campo por linha.

    Soma as duas formas de ausência, que a base mantém separadas de propósito
    e que juntas medem a mesma coisa:

    - **vazio** (`NaN`) — não se aplica, ou não foi coletado;
    - **`UNKNOWN`** — foi observado e não se soube dizer.

    Um campo pode estar 100% preenchido e 0% informativo: `institution_type`
    tem valor nas 2.183 observações e o valor é `UNKNOWN` em todas. Contar só
    `isna()` diria que não há lacuna ali, que é exatamente o erro que a regra
    de nunca usar `NaN` para desconhecido poderia induzir.

    `distintos` conta os valores que sobram depois de tirar os dois — é o que
    mede se o campo discrimina alguma coisa. Campo com um valor distinto só é
    constante, e não separa nada numa análise.
    """
    total = len(base)
    linhas = []
    for campo in COLUNAS:
        serie = base[campo].astype("object")
        vazio = int(serie.isna().sum())
        desconhecido = int((serie == "UNKNOWN").sum())
        informa = serie.dropna()
        linhas.append(
            {
                "campo": campo,
                "obrigatoriedade": OBRIGATORIEDADE[campo],
                "vazio": vazio,
                "desconhecido": desconhecido,
                "sem_informacao": vazio + desconhecido,
                "proporcao": round((vazio + desconhecido) / total, 3) if total else 0.0,
                "distintos": int(informa[informa != "UNKNOWN"].nunique()),
            }
        )
    return (
        pd.DataFrame(linhas)
        .sort_values(["sem_informacao", "campo"], ascending=[False, True])
        .reset_index(drop=True)
    )


# ------------------------------------------------------------------- gravar/ler


def gravar(base: pd.DataFrame, caminho: str | Path | None = None) -> Path:
    """Grava em parquet (preserva vocabulário e fuso) ou CSV (não preserva)."""
    caminho = Path(caminho or BASE)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    if caminho.suffix == ".parquet":
        base.to_parquet(caminho, index=False)
    elif caminho.suffix == ".csv":
        base.to_csv(caminho, index=False)
    elif caminho.suffix == ".json":
        caminho.write_text(
            base.to_json(
                orient="records", date_format="iso", indent=2, force_ascii=False
            )
        )
    else:
        raise ValueError(f"formato não suportado: {caminho.suffix}")
    return caminho


def ler(caminho: str | Path | None = None) -> pd.DataFrame:
    """Lê e **retipa**: CSV e JSON voltam como texto, e texto não é a base."""
    caminho = Path(caminho or BASE)
    if caminho.suffix == ".parquet":
        return montar(pd.read_parquet(caminho), estrito=False, normaliza=False)
    if caminho.suffix == ".csv":
        bruto = pd.read_csv(caminho, dtype="str", keep_default_na=True)
    elif caminho.suffix == ".json":
        bruto = pd.DataFrame(json.loads(caminho.read_text()))
    else:
        raise ValueError(f"formato não suportado: {caminho.suffix}")
    return montar(bruto, estrito=False, normaliza=False)


def observacao(**campos) -> dict:
    """Uma observação com o que toda linha tem: chave e carimbo."""
    linha = {nome: None for nome in COLUNAS}
    linha["source_observation_id"] = str(uuid.uuid4())
    linha["observed_at"] = pd.Timestamp.now(tz="UTC").isoformat()
    linha.update(campos)
    return linha


# ----------------------------------------------------------------------- teste


def exemplo() -> list[dict]:
    """Três observações: uma correta, uma com o erro clássico, uma incompleta."""
    return [
        observacao(
            source_id="OASIS-000123",
            oasisbr_source_id="oai:repositorio.ufto.edu.br",
            observed_at="2026-09-20T12:00:00Z",
            source_name_raw="Repositório Institucional da UFT",
            source_name_normalized="repositorio institucional da uft",
            institution_name="Universidade Federal do Tocantins",
            institution_acronym="UFT",
            institution_type="FEDERAL_UNIVERSITY",
            country_code="BR",
            subdivision_code="BR-TO",
            source_url="https://repositorio.uft.edu.br/",
            harvest_endpoint_url="https://repositorio.uft.edu.br/oai/request",
            source_status="ACTIVE",
            source_type_macro="ETD_LIBRARY",
            source_type_detail="ETD_DIGITAL_LIBRARY",
            platform_name_raw="TEDE2",  # produto e grupo saem daqui
            platform_version_raw="DSpace 6.3",
            platform_version="6.3",
            platform_detection_method="HTML_META_GENERATOR",
            platform_confidence="CONFIRMED",
            harvest_protocol="OAI_PMH",
            harvest_scope="ALL_RECORDS",
            oai_protocol_version="2.0",
            oai_repository_name="Repositório Institucional da UFT",
            oai_earliest_datestamp="2009-03-01T00:00:00Z",
            oai_deleted_record_policy="transient",
            oai_granularity="YYYY-MM-DDThh:mm:ssZ",
            harvest_metadata_prefix="oai_dc",
            metadata_profile="OAI_DC",
            classification_evidence_id=str(uuid.uuid4()),
        ),
        observacao(
            source_id="OASIS-000124",
            oasisbr_source_id="oai:revista.esmat.tjto.jus.br",
            observed_at="2026-09-20T12:05:00Z",
            source_name_raw="Revista ESMAT",
            source_name_normalized="revista esmat",
            institution_name="Escola Superior da Magistratura Tocantinense",
            institution_acronym="ESMAT",
            institution_type="GOVERNMENT_AGENCY",
            country_code="BR",
            subdivision_code="BR-TO",
            source_url="https://revista.esmat.tjto.jus.br/",
            harvest_endpoint_url="https://revista.esmat.tjto.jus.br/index.php/esmat/oai",
            source_status="ACTIVE",
            source_type_macro="SCIENTIFIC_JOURNAL",
            source_type_detail="SCIENTIFIC_JOURNAL",
            platform_name_raw="SEER",  # vira OJS, sem perder o nome bruto
            platform_detection_method="URL_PATTERN_ONLY",
            platform_confidence="HIGH",  # erro: o método não sustenta
            harvest_protocol="OAI_PMH",
            harvest_scope="SINGLE_SET",
            harvest_set_spec="esmat",
            oai_protocol_version="2.0",
            oai_repository_name="Revista ESMAT",
            oai_earliest_datestamp="2013-01-01",
            oai_deleted_record_policy="no",
            oai_granularity="YYYY-MM-DD",
            harvest_metadata_prefix="oai_dc",
            metadata_profile="OAI_DC",
            classification_evidence_id="evidencia-2",  # erro: não é UUID
        ),
        observacao(
            source_id="OASIS-000125",
            observed_at="2026-09-20T12:10:00Z",
            source_name_raw="Biblioteca Digital de Monografias (fora do ar)",
            source_name_normalized="biblioteca digital de monografias",
            institution_name="Instituição não identificada",
            country_code="BR",
            source_url="https://exemplo.invalido/",
            harvest_endpoint_url="https://exemplo.invalido/oai",
            source_status="TEMPORARILY_UNAVAILABLE",
            source_type_macro="UNKNOWN",
            source_type_detail="UNKNOWN",
            platform_detection_method="UNKNOWN",
            platform_confidence="UNKNOWN",
            harvest_protocol="OAI_PMH",
            harvest_scope="UNKNOWN",
            classification_evidence_id=str(uuid.uuid4()),
        ),
    ]


def main() -> int:
    pd.set_option("display.width", 120)
    pd.set_option("display.max_columns", 40)

    linhas = exemplo()
    problemas = conferir(linhas)
    base = montar(linhas, estrito=False)

    print(f"dicionário: {len(CAMPOS)} campos, {len(VOCABULARIOS)} vocabulários")
    print(dicionario().head(8).to_string(index=False), "\n")
    print(f"base: {base.shape[0]} observações × {base.shape[1]} campos")
    print(
        base[
            [
                "source_id",
                "platform_name_raw",
                "platform_product",
                "platform_analysis_group",
                "platform_confidence",
            ]
        ].to_string(index=False),
        "\n",
    )
    print("dtypes de amostra:")
    print(
        base.dtypes.loc[
            ["observed_at", "platform_product", "platform_confidence", "notes"]
        ],
        "\n",
    )
    print(f"conferência: {len(problemas)} problema(s)")
    print(
        resumo(problemas).to_string(index=False) if len(problemas) else "nada a apontar"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
