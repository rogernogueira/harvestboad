#!/usr/bin/env python
"""Congela a Base 1 num dataset científico imutável, em Parquet.

**Este script não escreve `hypotheses.json`.** Quem o escreve é `analisar.py`,
que calcula as fichas em vez de descrevê-las. Os dois escreviam o mesmo arquivo
até 2026-09-21, e como congelar.py roda primeiro no fluxo normal, rodá-lo de
novo apagava as fichas calculadas sem aviso. A ordem é: congelar, depois
analisar.

    .venv/bin/python exp1/congelar.py

"Congelado" aqui é literal: o conteúdo é função pura dos arquivos de coleta em
`data/`, sem relógio nem aleatoriedade, e `checksums.sha256` prova isso. Rodar
duas vezes sobre as mesmas entradas dá byte a byte o mesmo resultado — é o
invariante que permite citar uma versão do dataset e alguém reproduzi-la.

Daí duas escolhas que parecem preciosismo e não são:

- `observed_at` e `geradoEm` **não** entram nos Parquet. Um carimbo de execução
  muda o hash a cada rodada e destrói a reprodutibilidade; a data que importa é
  a da coleta, que vive em `provenance.json`.
- As métricas derivadas (`harvest_metrics`) são materializadas aqui, não
  calculadas no navegador. Sequência de falha e persistência são as definições
  que sustentam H6; deixá-las numa view SQL editável convidaria a mudar a
  definição sem mudar o número publicado.
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
import re
import shutil
import unicodedata
import sys
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA))

import base_fontes as bf  # noqa: E402
from coletar_registros import DUBLIN_CORE  # noqa: E402
from dicas import TABELAS as DICAS_TABELAS, dica  # noqa: E402
import sondas as sd  # noqa: E402

RAIZ = PASTA / "evidence" / "public"
DADOS = RAIZ / "data"
META = RAIZ / "metadata"

# 1.1.0 troca a amostra de registros pela coleta de 2026-09-22
# (`registros-v2.json.gz`): mesmas tabelas e colunas, conteúdo diferente em
# records, record_values e record_metrics. A 1.0.0 não é reescrita com outro
# conteúdo sob o mesmo id — é o que mantém citável o que já foi citado.
#
# 1.2.0 acrescenta `record_harvest`, o desfecho do ListRecords em cada uma das
# 2.183 fontes, da mesma coleta. As nove tabelas da 1.1.0 saem byte a byte
# iguais; o id muda porque o pacote citado deixa de ser o mesmo.
#
# 1.3.0 acrescenta `metadata_rules` e `record_metadata`: as 15 regras de
# metadado OpenAIRE aplicadas a cada registro vivo da mesma amostra. As dez
# tabelas da 1.2.0 saem byte a byte iguais.
#
# 1.4.0 acrescenta `record_metadata_values`: cada valor lido por cada regra, e
# se ele passa. As doze tabelas da 1.3.0 saem byte a byte iguais.
VERSAO = "1.4.0"
REFERENCIA = pd.Timestamp("2026-09-20", tz="UTC")
DATASET_ID = f"HB-EVIDENCE-{REFERENCIA:%Y-%m-%d}-v{VERSAO}"

# Constante, não `now()`: um carimbo de execução mudaria o arquivo a cada rodada
# e derrubaria o invariante de regeneração byte-idêntica. A data que descreve o
# dataset é a do congelamento da versão, não a da última vez que alguém o rodou.
EXPORTADO_EM = "2026-09-23T18:00:00Z"

# Fixo pelo mesmo motivo que EXPORTADO_EM: ler `git rev-parse` em tempo de
# execução faria o arquivo mudar a cada commit sem que o dado mudasse.
GIT_COMMIT = "8a6d013ac7f447bcaa18c59731b25c4eb816ff5f"

# Parquet sem compressão por dicionário adaptativo e sem estatísticas de página
# variáveis: são as duas fontes de não-determinismo do escritor do Arrow.
GRAVAR = dict(compression="zstd", compression_level=9, write_statistics=True)


def _gravar(tabela: pa.Table, nome: str, copia_txt: bool = True, **opcoes) -> Path:
    destino = DADOS / f"{nome}.parquet"
    pq.write_table(tabela, destino, **GRAVAR, **opcoes)
    # Cópia base64 ao lado. O visualizador que hospeda o painel serve uma lista
    # fechada de tipos e Parquet não está nela; o .txt carrega os mesmos bytes e
    # o navegador os devolve ao DuckDB. O binário continua sendo o canônico —
    # é dele que sai o checksum.
    #
    # `copia_txt=False` para a tabela que o navegador nunca lê inteira — ele
    # busca a partição por fonte —: a cópia base64 dela só ocuparia disco.
    if copia_txt:
        destino.with_suffix(".parquet.txt").write_text(
            base64.b64encode(destino.read_bytes()).decode("ascii")
        )
    return destino


# ---------------------------------------------------------------- repositories

CAMPOS_REPO = [
    "source_id",
    "oasisbr_source_id",
    "source_name_raw",
    "source_name_normalized",
    "institution_name",
    "institution_acronym",
    "institution_type",
    "FinsLucrativos",
    "Comunitaria",
    "country_code",
    "subdivision_code",
    "source_url",
    "harvest_endpoint_url",
    "source_status",
    "source_type_macro",
    "source_type_detail",
    "platform_name_raw",
    "platform_product",
    "platform_analysis_group",
    "platform_version",
    "platform_detection_method",
    "platform_confidence",
    "harvest_protocol",
    "harvest_scope",
    "oai_protocol_version",
    "oai_repository_name",
    "oai_earliest_datestamp",
    "oai_deleted_record_policy",
    "oai_granularity",
    "harvest_metadata_prefix",
    "metadata_profile",
    "identify_sha256",
]


def repositorios(base: pd.DataFrame) -> pa.Table:
    """Identidade e classificação de cada fonte — sem nenhuma métrica."""
    cadastro = json.loads((bf.DADOS / "cadastro.json").read_text())["cadastros"]
    extra = pd.DataFrame(
        [
            {
                "source_id": c["id"],
                "schedule_cron": c.get("scheduleCronExpression"),
                "published": c.get("published"),
                "city": c.get("city"),
                "metadata_store_schema": c.get("metadataStoreSchema"),
                "issn": c.get("issn") or None,
            }
            for c in cadastro
        ]
    ).set_index("source_id")

    r = base[CAMPOS_REPO].copy()
    r = r.rename(columns={"FinsLucrativos": "fins_lucrativos", "Comunitaria": "comunitaria"})
    r = r.join(extra, on="source_id")
    return pa.Table.from_pandas(r.sort_values("source_id", key=_ordem), preserve_index=False)


def _ordem(serie: pd.Series) -> pd.Series:
    """Ordena id textual como número — '2' antes de '10', para o hash ser estável."""
    return pd.to_numeric(serie, errors="coerce").fillna(1 << 62)


# ------------------------------------------------------------------- snapshots


def snapshots() -> pd.DataFrame:
    """Histórico completo de coletas, uma linha por snapshot."""
    bruto = json.loads((bf.DADOS / "historico.json").read_text())["repositorios"]
    linhas = []
    for h in bruto:
        if h["desfecho"] != "ok":
            continue
        # A API devolve da mais recente para a mais antiga; `ordem` preserva isso
        # explicitamente para que nenhuma consulta dependa da ordem das linhas.
        for i, c in enumerate(h["coletas"]):
            linhas.append(
                {
                    "source_id": h["id"],
                    "snapshot_id": c["snapshotId"],
                    "ordem": i,
                    "status": c["status"],
                    "index_status": c["indexStatus"],
                    "start_time": c["startTime"],
                    "end_time": c["endTime"],
                    "size": c["size"],
                    "valid_size": c["validSize"],
                    "transformed_size": c["transformedSize"],
                    "deleted": c["deleted"],
                }
            )
    s = pd.DataFrame(linhas)
    for col in ("start_time", "end_time"):
        s[col] = pd.to_datetime(s[col], utc=True, errors="coerce")
    s["duration_seconds"] = (s.end_time - s.start_time).dt.total_seconds()
    s["is_failure"] = s.status == "HARVESTING_FINISHED_ERROR"
    s["validity_rate"] = (s.valid_size / s["size"].replace(0, pd.NA)).astype("Float64")
    return s.sort_values(["source_id", "ordem"], key=lambda c: _ordem(c) if c.name == "source_id" else c)


# --------------------------------------------------------------- harvest metrics


def metricas(base: pd.DataFrame, snaps: pd.DataFrame) -> pd.DataFrame:
    """Métricas derivadas por fonte. As definições de H6 moram aqui."""
    por_fonte = snaps.groupby("source_id", sort=False)

    def maior_sequencia(falhas: pd.Series) -> int:
        atual = melhor = 0
        for f in falhas:
            atual = atual + 1 if f else 0
            melhor = max(melhor, atual)
        return melhor

    def sequencia_atual(falhas: pd.Series) -> int:
        n = 0
        for f in falhas:  # já ordenado da mais recente para a mais antiga
            if not f:
                break
            n += 1
        return n

    m = pd.DataFrame(
        {
            "snapshot_count": por_fonte.size(),
            "failure_count": por_fonte.is_failure.sum(),
            "current_failure_streak": por_fonte.is_failure.apply(sequencia_atual),
            "max_failure_streak": por_fonte.is_failure.apply(maior_sequencia),
            "first_harvest": por_fonte.start_time.min(),
            "last_harvest": por_fonte.start_time.max(),
        }
    )
    m["failure_rate"] = (m.failure_count / m.snapshot_count).astype("Float64")
    m["never_failed"] = m.failure_count == 0
    m["always_failed"] = m.failure_count == m.snapshot_count

    # Persistente: ou está falhando agora há três coletas, ou falha na metade
    # das vezes num histórico que já dá para julgar. As duas condições pegam
    # fenômenos diferentes — a quebra recente e a instabilidade crônica.
    m["persistent"] = (m.current_failure_streak >= 3) | (
        (m.failure_rate >= 0.5) & (m.snapshot_count >= 4)
    )

    ultima = base.set_index("source_id")
    m = m.join(
        pd.DataFrame(
            {
                "latest_snapshot_id": ultima.snapshot_id,
                "latest_snapshot_status": ultima.snapshot_status,
                "latest_index_status": ultima.index_status,
                "latest_snapshot_date": ultima.snapshot_date,
                "latest_size": ultima["size"],
                "latest_valid_size": ultima.valid_size,
                "latest_transformed_size": ultima.transformed_size,
            }
        ),
        how="outer",
    )
    m["days_since_last_harvest"] = (REFERENCIA - m.latest_snapshot_date).dt.days
    # Taxa só existe onde houve registro: size 0 não é 0% de validade, é ausência
    # de medida. Dividir mesmo assim produziria 460 zeros falsos no histograma.
    denominador = m.latest_size.replace(0, pd.NA)
    m["validity_rate"] = (m.latest_valid_size / denominador).astype("Float64")
    m["transformation_rate"] = (m.latest_transformed_size / denominador).astype("Float64")
    m.index.name = "source_id"
    return m.reset_index().sort_values("source_id", key=_ordem)


# ------------------------------------------------------------------- platforms


def plataformas() -> pa.Table:
    """Catálogo de sinais: peso ordena candidatas, força decide a confiança."""
    linhas = [
        {
            "signal_name": s.nome,
            "probe": s.sonda,
            "platform": s.plataforma,
            "weight": s.peso,
            "strength": s.forca,
            "detection_method": s.metodo,
        }
        for s in sd.SINAIS
    ]
    p = pd.DataFrame(linhas).drop_duplicates("signal_name").sort_values("signal_name")
    return pa.Table.from_pandas(p, preserve_index=False)


# -------------------------------------------------------------------- metadata


def _sha256(caminho: Path) -> str:
    h = hashlib.sha256()
    h.update(caminho.read_bytes())
    return h.hexdigest()


def escrever_json(nome: str, conteudo: object) -> Path:
    destino = META / nome
    destino.write_text(json.dumps(conteudo, ensure_ascii=False, indent=2, sort_keys=False) + "\n")
    return destino


def codebook() -> list[dict]:
    d = pd.read_csv(bf.DADOS / "dicionario.csv")
    return [
        {
            "field": r.campo,
            "type": r.tipo,
            "dtype": r.dtype,
            "requirement": r.obrigatoriedade,
            "vocabulary": None if pd.isna(r.vocabulario) else r.vocabulario,
            "condition": None if pd.isna(r.condicao) else r.condicao,
            "max_length": None if pd.isna(r.tamanho) else int(r.tamanho),
        }
        for r in d.itertuples()
    ]


def vocabularios() -> dict:
    v = pd.read_csv(bf.DADOS / "vocabularios.csv")
    saida: dict[str, dict] = {}
    for (campo, vocab), grupo in v.groupby(["campo", "vocabulario"], sort=True):
        saida[vocab] = {
            "field": campo,
            "terms": [
                {"code": r.codigo, "label": r.significado}
                for r in grupo.sort_values("ordem").itertuples()
            ],
        }
    return saida


# ------------------------------------------------------------------ registros

# Vocabulários que o perfil DRIVER/OpenAIRE exige, e que são o que separa
# "campo presente" de "campo conforme". Um `dc:type` preenchido com "Artigo"
# está completo e não conforme — a distinção é a razão de existir da coleta
# de registros.
EUREPO_TIPO = "info:eu-repo/semantics/"
EUREPO_ACESSO = tuple(
    f"info:eu-repo/semantics/{t}Access"
    for t in ("open", "embargoed", "restricted", "closed")
)
ISO_DATA = re.compile(r"^\d{4}(-\d{2}(-\d{2}([T ]\d{2}:\d{2}(:\d{2})?Z?)?)?)?$")
ISO_IDIOMA = re.compile(r"^[a-z]{2,3}([_-][A-Za-z]{2,4})?$")

# Só os campos de vocabulário controlado vão para a tabela longa. Título e
# resumo não entram por valor: são texto livre, ocupam quase todo o arquivo e
# nenhuma dimensão os lê por extenso — para duplicação basta o hash do título.
CAMPOS_LONGOS = ("type", "language", "rights", "format", "date")

# Abaixo disto o título é rótulo de seção ("Editorial", "Expediente",
# "Sumário"), e repetição dele não é duplicação de documento. Sete palavras
# deixa passar título curto de artigo e barra a seção — medido na amostra.
TITULO_MINIMO = 7


def _normalizar(texto: str) -> str:
    """Forma canônica para comparar títulos: sem acento, sem pontuação, sem caixa."""
    sem_acento = unicodedata.normalize("NFKD", texto)
    sem_acento = "".join(c for c in sem_acento if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", sem_acento.lower()).strip()


def registros() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Uma linha por registro, mais a tabela longa dos campos controlados."""
    # A v2 (até 200 registros vivos e 12 páginas por origem) e não a primeira
    # coleta, de uma página só: dobra a amostra e tira de `http-403` as origens
    # que só recusavam o agente. A primeira fica em `registros.json.gz`, que é o
    # que a 1.0.0 lia.
    caminho = bf.DADOS / "registros-v2.json.gz"
    if not caminho.is_file():
        return pd.DataFrame(), pd.DataFrame()

    with gzip.open(caminho, "rt", encoding="utf-8") as arquivo:
        bruto = json.load(arquivo)

    linhas, longos = [], []
    for origem in bruto["origens"]:
        if origem["desfecho"] != "ok":
            continue
        for r in origem["registros"]:
            campos = r.get("campos", {})
            titulo = (campos.get("title") or [""])[0]
            tipos = campos.get("type", [])
            direitos = campos.get("rights", [])
            idiomas = campos.get("language", [])
            datas = campos.get("date", [])

            # Regra para campo multivalorado — assimétrica de propósito.
            #
            #   dc:type e dc:rights  →  QUALQUER valor conforme basta
            #   dc:language e dc:date →  TODOS os valores devem conformar
            #
            # Não é descuido. `type` e `rights` são **aditivos**: o repositório
            # legitimamente emite o termo controlado e um rótulo livre ao lado
            # — em 72,4% dos registros (70,9% na 1.0.0) com texto livre em dc:type o termo
            # info:eu-repo está presente no mesmo registro. Exigir conformidade
            # de todos os valores reprovaria justamente quem faz certo.
            #
            # `language` e `date` são **enumerativos**: cada valor é uma
            # asserção independente, e uma data malformada é um defeito ainda
            # que as outras estejam corretas.
            #
            # Quem assumir regra uniforme não reproduz os números publicados.
            linha = {
                "source_id": origem["id"],
                "oai_identifier": r.get("identifier", ""),
                "datestamp": r.get("datestamp", ""),
                "deleted": bool(r.get("deleted")),
                "n_sets": len(r.get("sets", [])),
                "has_driver_set": any(
                    s.lower() == "driver" for s in r.get("sets", [])
                ),
                "n_fora_esquema": len(r.get("foraDoEsquema", [])),
                "campos_presentes": sum(1 for c in DUBLIN_CORE if campos.get(c)),
                # Hash do título normalizado: é o que permite achar o mesmo
                # documento em duas fontes sem carregar o texto.
                "title_hash": (
                    hashlib.sha1(_normalizar(titulo).encode()).hexdigest()[:16]
                    if titulo
                    else ""
                ),
                # Quantas palavras tem o título normalizado.
                #
                # Sem isso a duplicação mede a coisa errada: "Editorial"
                # aparece em 578 revistas e "Apresentação" em 315, porque toda
                # revista tem um — e cada número tem o seu, o que também infla
                # a contagem dentro da mesma fonte. Título curto é nome de
                # seção, não documento. `TITULO_MINIMO` separa os dois.
                "title_words": len(_normalizar(titulo).split()),
                "first_identifier": (campos.get("identifier") or [""])[0],
                # Conformidade: presente é uma coisa, conforme é outra.
                "type_eurepo": any(t.startswith(EUREPO_TIPO) for t in tipos),
                "rights_eurepo": any(d in EUREPO_ACESSO for d in direitos),
                "language_iso": bool(idiomas) and all(
                    ISO_IDIOMA.match(i) for i in idiomas
                ),
                "date_iso": bool(datas) and all(ISO_DATA.match(d) for d in datas),
                # Granularidade do carimbo: o Identify declara uma, o registro
                # entrega outra em parte das fontes. É normalização medida no
                # que a origem faz, não no que ela promete.
                "datestamp_granularity": (
                    "datetime" if "T" in r.get("datestamp", "") else "date"
                ),
            }
            for c in DUBLIN_CORE:
                linha[f"n_{c}"] = len(campos.get(c, []))
            linhas.append(linha)

            for c in CAMPOS_LONGOS:
                for i, valor in enumerate(campos.get(c, [])):
                    longos.append(
                        {
                            "source_id": origem["id"],
                            "oai_identifier": r.get("identifier", ""),
                            "field": c,
                            "ordinal": i,
                            "value": valor[:200],
                        }
                    )

    reg = pd.DataFrame(linhas).sort_values(
        ["source_id", "oai_identifier"], key=lambda c: _ordem(c) if c.name == "source_id" else c
    )
    val = pd.DataFrame(longos).sort_values(
        ["source_id", "oai_identifier", "field", "ordinal"],
        key=lambda c: _ordem(c) if c.name == "source_id" else c,
    )
    return reg, val


def metricas_de_registro(reg: pd.DataFrame) -> pd.DataFrame:
    """Agregado por fonte: é o que o painel cruza com o resto da Base 1."""
    if reg.empty:
        return pd.DataFrame()
    vivos = reg[~reg.deleted]
    por_fonte = vivos.groupby("source_id", sort=False)
    m = pd.DataFrame(
        {
            "records_sampled": reg.groupby("source_id", sort=False).size(),
            "records_deleted": reg.groupby("source_id", sort=False).deleted.sum(),
            "fields_mean": por_fonte.campos_presentes.mean(),
            "type_eurepo_rate": por_fonte.type_eurepo.mean(),
            "rights_eurepo_rate": por_fonte.rights_eurepo.mean(),
            "language_iso_rate": por_fonte.language_iso.mean(),
            "date_iso_rate": por_fonte.date_iso.mean(),
            "driver_set_rate": por_fonte.has_driver_set.mean(),
            "off_schema_records": por_fonte.apply(
                lambda g: int((g.n_fora_esquema > 0).sum())
            ),
            # Registros que podem entrar na conta de duplicação: vivos, com
            # título, e com título longo o bastante para não ser rótulo de
            # seção. É o denominador correto da taxa.
            #
            # `records_sampled` estava errado por duas razões, e a segunda é a
            # que mais pesa: ele contava registros excluídos, que não têm
            # título nenhum, **e** contava os títulos curtos que a guarda de
            # sete palavras exclui do numerador. A mediana cai de 100 para 83
            # — em fontes como "Comunicação & Educação", com zero excluídos,
            # de 100 para 37, porque quase dois terços da página são seções.
            "titles_eligible": por_fonte.apply(
                lambda g: int(
                    ((g.title_hash != "") & (g.title_words >= TITULO_MINIMO)).sum()
                )
            ),
            # Duplicação interna: mesmo título normalizado mais de uma vez
            # dentro da própria fonte.
            "duplicate_titles": por_fonte.apply(
                lambda g: int(
                    g.loc[
                        (g.title_hash != "") & (g.title_words >= TITULO_MINIMO),
                        "title_hash",
                    ]
                    .duplicated()
                    .sum()
                )
            ),
            # Contado à parte porque é fenômeno diferente, e interessante: a
            # fonte publica várias seções com o mesmo rótulo.
            "section_titles": por_fonte.apply(
                lambda g: int((g.title_words.between(1, TITULO_MINIMO - 1)).sum())
            ),
        }
    )
    for c in DUBLIN_CORE:
        m[f"has_{c}_rate"] = por_fonte[f"n_{c}"].apply(lambda s: float((s > 0).mean()))
    m.index.name = "source_id"
    return m.reset_index().sort_values("source_id", key=_ordem)


# -------------------------------------------------------------- record_harvest

# Hosts de agregador que o cadastro põe no lugar do endpoint próprio da revista.
# Estão desativados, e é isso — não a plataforma — que decide a reação.
AGREGADORES_DESATIVADOS = {"old.scielo.br", "www.scielo.br"}


def _reacao(desfecho: str, host: str | None) -> str:
    """Agrupa os ~20 desfechos crus em nove reações legíveis.

    **Levanta com desfecho desconhecido.** Uma recoleta que produza um desfecho
    novo cairia calada numa categoria errada; aqui ela para o congelamento.

    O agregador desativado vem antes de tudo porque a SciELO se espalha por três
    desfechos — 403 nas primeiras, disjuntor nas seguintes, 404 em www — com
    uma causa só. Classificada pelo desfecho, pareceria problema de 215 fontes
    em vez de um defeito de cadastro.
    """
    if desfecho == "ok":
        return "respondeu"
    if host in AGREGADORES_DESATIVADOS:
        return "agregador-desativado"
    if desfecho == "rede":
        return "sem-resposta"
    if desfecho == "xml-invalido":
        return "nao-oai"
    if desfecho == "disjuntor":
        return "disjuntor"
    if desfecho.startswith("oai-") or desfecho in ("vazio", "so-excluidos"):
        return "oai-sem-registro"
    if desfecho in ("http-400", "http-401", "http-403", "http-468"):
        return "recusou"
    if desfecho in ("http-404", "http-410"):
        return "endereco-inexistente"
    if re.fullmatch(r"http-5\d\d", desfecho):
        return "erro-servidor"
    raise SystemExit(f"desfecho sem reação em congelar._reacao: {desfecho!r}")


def desfechos_de_coleta(base: pd.DataFrame) -> pd.DataFrame:
    """Como cada fonte reagiu ao ListRecords, inclusive as que não responderam.

    As outras tabelas de registro só veem as origens com desfecho `ok`; esta é a
    única que conta as 610 que ficaram de fora, e o porquê de cada uma. Tem uma
    linha por fonte do cadastro: as 5 sem endpoint entram como `sem-endpoint`,
    para que a soma feche nas 2.183 sem ninguém precisar fazer JOIN para saber.
    """
    caminho = bf.DADOS / "registros-v2.json.gz"
    if not caminho.is_file():
        return pd.DataFrame()
    with gzip.open(caminho, "rt", encoding="utf-8") as arquivo:
        origens = {o["id"]: o for o in json.load(arquivo)["origens"]}

    linhas = []
    for source_id in base.source_id:
        o = origens.get(source_id)
        if o is None:
            linhas.append({"source_id": source_id, "outcome": "sem-endpoint",
                           "reaction": "sem-endpoint", "attempts": 0,
                           "records_harvested": 0})
            continue
        host = urlparse(o["baseUrl"]).hostname
        faixa = o.get("faixaDatestamp") or [None, None]
        linhas.append(
            {
                "source_id": source_id,
                "requested_url": o["baseUrl"],
                "endpoint_host": host,
                "outcome": o["desfecho"],
                "outcome_detail": o["detalhe"] or None,
                "breaker_cause": o.get("herdado"),
                "reaction": _reacao(o["desfecho"], host),
                "attempts": o["tentativas"],
                "tls_verified": o.get("tlsVerificado"),
                "browser_agent": bool(o.get("agenteNavegador")),
                "pages": o.get("paginas"),
                "live_records": o.get("vivos"),
                "records_harvested": len(o.get("registros", [])),
                "has_more": o.get("temMais"),
                "datestamp_min": faixa[0],
                "datestamp_max": faixa[1],
            }
        )
    colunas = ["source_id", "requested_url", "endpoint_host", "outcome", "outcome_detail",
               "breaker_cause", "reaction", "attempts", "tls_verified", "browser_agent",
               "pages", "live_records", "records_harvested", "has_more",
               "datestamp_min", "datestamp_max"]
    d = pd.DataFrame(linhas, columns=colunas)
    for c in ("pages", "live_records"):
        d[c] = d[c].astype("Int64")
    for c in ("tls_verified", "browser_agent", "has_more"):
        d[c] = d[c].astype("boolean")
    d["browser_agent"] = d.browser_agent.fillna(False)
    return d.sort_values("source_id", key=_ordem)

# ------------------------------------------------------------- record_metadata
#
# As 15 regras de metadado OpenAIRE, com os ids e quantificadores do relatório
# do validador que serviu de modelo (103–119, sem 111 e 113).
#
# O validador lê o formato próprio do DSpace (xoai), com campos qualificados;
# a amostra é `oai_dc`, onde eles colapsam. Três regras dependem disso, e
# `fidelity` diz o quanto cada uma alcança — em vez de fingir que todas medem a
# mesma coisa:
#
#   exata            o elemento existe em oai_dc e a regra é a do validador
#   aproximada       description.abstract → dc:description; contributor.advisor1
#                    → dc:contributor, que também leva coautor e financiador
#   nao-verificavel  description.resumo não tem destino em oai_dc: sai do
#                    DSpace pelo mesmo dc:description que o abstract, e não há
#                    como separar os dois pelo valor
#
# Regra que não se aplica ao registro — data de liberação sem embargo,
# orientador em quem não é TCC, tese ou dissertação — **atende**, como no
# validador; `applicable` guarda a distinção para quem quiser contar à parte.

EU_REPO = "info:eu-repo/semantics/"
TIPOS_OPENAIRE = frozenset(EU_REPO + t for t in (
    "article", "bachelorThesis", "masterThesis", "doctoralThesis", "book",
    "bookPart", "review", "conferenceObject", "lecture", "workingPaper",
    "preprint", "report", "annotation", "contributionToPeriodical", "patent",
    "other",
))
VERSOES_OPENAIRE = frozenset(EU_REPO + v for v in (
    "draft", "submittedVersion", "acceptedVersion", "publishedVersion", "updatedVersion",
))
ACESSOS_OPENAIRE = frozenset(EU_REPO + a for a in (
    "openAccess", "embargoedAccess", "restrictedAccess", "closedAccess",
))
TIPOS_TRABALHO_ACADEMICO = frozenset(
    EU_REPO + t for t in ("bachelorThesis", "masterThesis", "doctoralThesis")
)
# Os tipos de topo registrados na IANA. Um mime type é tipo/subtipo, e o que
# reprova na prática não é subtipo exótico, é valor que nem tem a barra:
# "1-13", "Digital (DA)".
MIME_TOPO = ("application", "audio", "font", "image", "message", "model",
             "multipart", "text", "video")
RE_MIME = re.compile(rf"^(?:{'|'.join(MIME_TOPO)})/[a-z0-9][a-z0-9!#$&^_.+-]*$", re.I)
# Mesma expressão de `v_vocabulario` em views-registros.sql: a data que
# reprova aqui é a mesma que aparece como não conforme na aba Dimensões.
RE_ISO8601 = re.compile(r"^\d{4}(-\d{2}(-\d{2}([T ]\d{2}:\d{2}(:\d{2})?Z?)?)?)?$")
RE_EMBARGO = re.compile(r"^info:eu-repo/date/embargoEnd/\d{4}-\d{2}-\d{2}$")
AMOSTRA_INVALIDA = 80


def _iso639_3() -> frozenset[str]:
    linhas = (bf.DADOS / "iso-639-3.txt").read_text().splitlines()
    return frozenset(l.strip() for l in linhas if l.strip() and not l.startswith("#"))


def _tem_conteudo(v: str) -> bool:
    return bool(v.strip())


def _url_valida(v: str) -> bool:
    u = urlparse(v.strip())
    return u.scheme in ("http", "https") and "." in (u.hostname or "")


def _academico(tipos: list[str]) -> bool:
    """TCC, tese ou dissertação, pelo termo eu-repo ou pelo rótulo livre."""
    for t in tipos:
        if t in TIPOS_TRABALHO_ACADEMICO:
            return True
        n = _normalizar(t)
        if re.search(r"\b(tcc|tese|dissertacao|thesis|dissertation)\b", n) or "trabalho de conclusao" in n:
            return True
    return False


REGRAS_METADADO = [
    # (id, nome, descrição, obrigatória, quantificador, elemento, fidelidade)
    (103, "Data de liberação do recurso",
     "Data a partir da qual o documento estará em acesso aberto. Só se aplica quando dc:rights é embargoedAccess.",
     False, "ONE_OR_MORE", "dc:date", "exata"),
    (104, "Título", "O elemento dc:title tem conteúdo.", True, "ONE_OR_MORE", "dc:title", "exata"),
    (105, "Versão da publicação",
     "Há uma ocorrência da versão segundo o vocabulário OpenAIRE (info:eu-repo/semantics/*Version, draft).",
     False, "ONE_ONLY", "dc:type", "exata"),
    (106, "Tipo segundo OpenAire", "Há uma ocorrência do vocabulário de tipos OpenAIRE (info:eu-repo/semantics/<tipo>).",
     True, "ONE_OR_MORE", "dc:type", "exata"),
    (107, "Idioma do documento segundo ISO 639-3", "Ao menos uma ocorrência cumpre a norma ISO 639-3.",
     True, "ONE_OR_MORE", "dc:language", "exata"),
    (108, "Data de publicação", "Ao menos uma data válida segundo a norma ISO 8601.",
     True, "ONE_OR_MORE", "dc:date", "exata"),
    (109, "Assunto", "O elemento dc:subject tem conteúdo.", False, "ONE_OR_MORE", "dc:subject", "exata"),
    (110, "Abstract", "O elemento dc:description.abstract tem conteúdo.",
     False, "ONE_OR_MORE", "dc:description", "aproximada"),
    (112, "Nível de acesso", "O nível de acesso é uma opção válida do vocabulário controlado OpenAIRE.",
     True, "ONE_ONLY", "dc:rights", "exata"),
    (114, "Orientador",
     "Se dc:type é TCC, tese ou dissertação, dc:contributor.advisor1 é obrigatório.",
     False, "ONE_OR_MORE", "dc:contributor", "aproximada"),
    (115, "Creador (autor)", "Existe ao menos uma ocorrência de dc:creator.",
     True, "ONE_OR_MORE", "dc:creator", "exata"),
    (116, "URL Válida", "Ao menos uma ocorrência de dc:identifier aponta para uma URL válida.",
     True, "ONE_OR_MORE", "dc:identifier", "exata"),
    (117, "Formato", "dc:format contém uma ocorrência segundo o vocabulário de mime types.",
     False, "ONE_OR_MORE", "dc:format", "exata"),
    (118, "Tipo do documento", "dc:type tem conteúdo.", True, "ONE_OR_MORE", "dc:type", "exata"),
    (119, "Resumo", "O campo dc:description.resumo tem conteúdo.",
     False, "ONE_OR_MORE", "dc:description.resumo", "nao-verificavel"),
]

# Como cada fidelidade se explica, uma frase por regra que não é exata.
NOTA_FIDELIDADE = {
    110: "Em oai_dc o abstract sai como dc:description, junto com qualquer outra descrição; conta como abstract toda dc:description com conteúdo.",
    114: "Em oai_dc o orientador sai como dc:contributor, que também leva coautor e financiador; a regra aceita qualquer dc:contributor com conteúdo.",
    119: "description.resumo não tem elemento próprio em oai_dc: sai no mesmo dc:description que o abstract, e o valor não diz qual dos dois é. Status nao-verificavel em todos os registros.",
}


def regras_de_metadado() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "rule_id": i, "rule_name": nome, "description": desc, "required": obrig,
                "quantifier": quant, "oai_dc_element": elem, "fidelity": fid,
                "fidelity_note": NOTA_FIDELIDADE.get(i),
            }
            for i, nome, desc, obrig, quant, elem, fid in REGRAS_METADADO
        ]
    ).astype({"rule_id": "int16"})


# Corte de cada valor em record_metadata_values. O relatório mostra o começo do
# valor, como o validador de referência, e value_length diz quanto havia.
# Com 100 caracteres a tabela fica em ~50 MB; sem corte, os resumos sozinhos
# passariam disso.
VALOR_MAXIMO = 100


def avaliar_metadados(valores: dict[str, list] | None = None) -> pd.DataFrame:
    """Uma linha por registro vivo × regra: se atende, e com quantas ocorrências.

    O registro excluído fica de fora pelo mesmo motivo das outras medidas de
    conteúdo: vem só com cabeçalho. E o identificador que a paginação repetiu
    na mesma fonte (359 casos) entra uma vez, na primeira ocorrência — sem isso
    a chave (source_id, oai_identifier, rule_id) não seria única.
    """
    caminho = bf.DADOS / "registros-v2.json.gz"
    if not caminho.is_file():
        return pd.DataFrame()
    with gzip.open(caminho, "rt", encoding="utf-8") as arquivo:
        origens = json.load(arquivo)["origens"]
    iso = _iso639_3()

    colunas: dict[str, list] = {c: [] for c in (
        "source_id", "oai_identifier", "rule_id", "applicable", "status",
        "occurrences", "valid_occurrences", "invalid_sample",
    )}

    def gravar(sid, oai, regra, aplica, lidos, valido, quant="ONE_OR_MORE"):
        validos = [v for v in lidos if valido(v)] if aplica else []
        invalidos = [v for v in lidos if not valido(v)] if aplica else []
        # Os valores de cada ocorrência, para quem pediu: só onde a regra se
        # aplica, que é onde houve veredito para mostrar.
        if valores is not None and aplica:
            for i, v in enumerate(lidos):
                valores["source_id"].append(sid)
                valores["oai_identifier"].append(oai)
                valores["rule_id"].append(regra)
                valores["ordinal"].append(i)
                valores["value"].append(v.strip()[:VALOR_MAXIMO])
                valores["value_length"].append(len(v.strip()))
                valores["valid"].append(bool(valido(v)))
        if not aplica:
            status = "atende"
        elif quant == "ONE_ONLY":
            status = "atende" if len(validos) == 1 else "viola"
        else:
            status = "atende" if validos else "viola"
        colunas["source_id"].append(sid)
        colunas["oai_identifier"].append(oai)
        colunas["rule_id"].append(regra)
        colunas["applicable"].append(aplica)
        colunas["status"].append(status)
        colunas["occurrences"].append(len(lidos))
        # Nulo quando a regra não se aplica: nada foi avaliado, e "0 válidas"
        # leria como falha num registro que atende.
        colunas["valid_occurrences"].append(len(validos) if aplica else None)
        amostra = invalidos[0].strip()[:AMOSTRA_INVALIDA] if invalidos else None
        colunas["invalid_sample"].append(amostra)

    for origem in origens:
        if origem["desfecho"] != "ok":
            continue
        sid = origem["id"]
        vistos: set[str] = set()
        for r in origem["registros"]:
            if r.get("deleted") or r["identifier"] in vistos:
                continue
            vistos.add(r["identifier"])
            oai = r["identifier"]
            c = r.get("campos", {})
            g = lambda campo: c.get(campo, [])  # noqa: E731
            tipos, direitos, datas = g("type"), g("rights"), g("date")

            embargo = f"{EU_REPO}embargoedAccess" in (d.strip() for d in direitos)
            gravar(sid, oai, 103, embargo, datas, lambda v: bool(RE_EMBARGO.match(v.strip())))
            gravar(sid, oai, 104, True, g("title"), _tem_conteudo)
            gravar(sid, oai, 105, True, tipos, lambda v: v.strip() in VERSOES_OPENAIRE, "ONE_ONLY")
            gravar(sid, oai, 106, True, tipos, lambda v: v.strip() in TIPOS_OPENAIRE)
            gravar(sid, oai, 107, True, g("language"), lambda v: v.strip() in iso)
            gravar(sid, oai, 108, True, datas, lambda v: bool(RE_ISO8601.match(v.strip())))
            gravar(sid, oai, 109, True, g("subject"), _tem_conteudo)
            gravar(sid, oai, 110, True, g("description"), _tem_conteudo)
            gravar(sid, oai, 112, True, direitos, lambda v: v.strip() in ACESSOS_OPENAIRE, "ONE_ONLY")
            gravar(sid, oai, 114, _academico(tipos), g("contributor"), _tem_conteudo)
            gravar(sid, oai, 115, True, g("creator"), _tem_conteudo)
            gravar(sid, oai, 116, True, g("identifier"), _url_valida)
            gravar(sid, oai, 117, True, g("format"), lambda v: bool(RE_MIME.match(v.strip())))
            gravar(sid, oai, 118, True, tipos, _tem_conteudo)
            # 119 não tem o que ler: a linha existe para a conta fechar em 15
            # por registro, com o status que diz por que não há resposta.
            colunas["source_id"].append(sid)
            colunas["oai_identifier"].append(oai)
            colunas["rule_id"].append(119)
            colunas["applicable"].append(True)
            colunas["status"].append("nao-verificavel")
            colunas["occurrences"].append(None)
            colunas["valid_occurrences"].append(None)
            colunas["invalid_sample"].append(None)

    d = pd.DataFrame(colunas).astype(
        {"rule_id": "int16", "occurrences": "Int16", "valid_occurrences": "Int16"}
    )
    return d.sort_values(
        ["source_id", "oai_identifier", "rule_id"],
        key=lambda s: _ordem(s) if s.name == "source_id" else s,
        kind="stable",
    )


COLUNAS_VALORES = ("source_id", "oai_identifier", "rule_id", "ordinal", "value", "value_length", "valid")

# Partição de record_metadata_values para o painel: um arquivo por fonte.
PASTA_VALORES = DADOS / "valores"


def valores_de_metadado(valores: dict[str, list]) -> pd.DataFrame:
    """Uma linha por valor lido por regra: o que o relatório do registro mostra."""
    d = pd.DataFrame(valores).astype(
        {"rule_id": "int16", "ordinal": "int16", "value_length": "int32"}
    )
    return d.sort_values(
        ["source_id", "oai_identifier", "rule_id", "ordinal"],
        key=lambda s: _ordem(s) if s.name == "source_id" else s,
        kind="stable",
    )


def particionar_valores(d: pd.DataFrame) -> int:
    """Cópia de serviço de record_metadata_values, um Parquet por fonte.

    A tabela inteira tem 55 MB e o painel só precisa da fonte de um relatório
    por vez; com a partição, abrir um relatório custa um arquivo de ~35 KB.
    É cópia derivada, como os .txt em base64 — o canônico e o que tem checksum
    é record_metadata_values.parquet —, e é refeita do zero a cada execução
    para não sobrar partição de fonte que saiu da amostra.

    Tentou-se antes ler o arquivo inteiro por intervalo HTTP; o DuckDB 1.32 no
    navegador não mandou a sonda de `Range` e baixava os 55 MB.
    """
    if PASTA_VALORES.exists():
        shutil.rmtree(PASTA_VALORES)
    PASTA_VALORES.mkdir(parents=True)
    n = 0
    for sid, g in d.groupby("source_id", sort=False):
        pq.write_table(
            pa.Table.from_pandas(g, preserve_index=False), PASTA_VALORES / f"{sid}.parquet", **GRAVAR
        )
        n += 1
    return n


# --------------------------------------------------------------- proveniência

PROVENIENCIA = {
    # Origem e extração no formato pedido. Os valores são os reais: o cache Redis
    # do backend existe (TTLs em config/settings.py) mas é **contornado** aqui de
    # propósito — `repository_harvests` corta o histórico em 20 por página sem
    # avisar, então a coleta usa o cliente cru com 500 por página.
    "source": {
        "type": "Harvester do Oasisbr (REST)",
        "client": "apps.integrations.harvester.HarvesterClient",
        "executed_in": "container harvestboard_api",
        "cache": "ignorado (cliente cru, não apps.harvests.services)",
        "page_size": 500,
        "producer": "coletar_historico.py / coletar_cadastro.py",
    },
    "extraction": {
        "exported_at": EXPORTADO_EM,
        "script": "congelar.py",
        "script_version": VERSAO,
        "git_commit": GIT_COMMIT,
        "engine": f"pandas {pd.__version__} · pyarrow {pa.__version__}",
    },
    "collected_at": {
        "harvester_registry": "2026-09-21",
        "harvester_history": "2026-09-21",
        "oai_identify": "2026-09-20",
        "oai_records": "2026-09-22",
        "platform_probes": "2026-09-21",
        "emec_crosscheck": "2026-09-20",
    },
    "sources": [
        {
            "name": "Harvester do Oasisbr",
            "kind": "API REST",
            "provides": "cadastro das fontes, histórico de coletas, diagnóstico",
            "note": (
                "repository_detail expõe o endpoint em originURL, não em oaiSource; e "
                "repository_harvests trunca o histórico em 20 por página (padrão do Spring "
                "Data REST) — ambos contornados na coleta."
            ),
        },
        {
            "name": "Endpoints OAI-PMH das próprias fontes",
            "kind": "OAI-PMH",
            "provides": "Identify, ListMetadataFormats, ListSets, ListRecords (oai_dc)",
        },
        {
            "name": "Páginas HTML das fontes",
            "kind": "HTTP",
            "provides": "meta generator, cookies, marcadores e rota final",
        },
        {
            "name": "Exportações do e-MEC",
            "kind": "CSV",
            "provides": "conferência de natureza jurídica das instituições de ensino",
            "note": "289 instituições casadas por sigla+UF com token distintivo, 0 divergências.",
        },
    ],
    "pipeline": [
        {"step": "coleta", "scripts": [
            "coletar_repositorios.py", "coletar_cadastro.py", "coletar_historico.py",
            "coletar_identify.py", "coletar_sondas.py", "coletar_registros.py",
        ]},
        {"step": "classificação", "scripts": ["sondas.py", "instituicoes.py", "verificar_emec.py"]},
        {"step": "montagem", "scripts": ["base_fontes.py", "gerar.py"]},
        {"step": "congelamento", "scripts": ["congelar.py"]},
    ],
    "limitations": [
        "oaiSource ausente no cadastro: repository_detail expõe o endpoint em originURL "
        "— 597 endpoints só foram recuperados depois de corrigir o campo lido.",
        "baseURL OAI de parte das fontes foi recuperado dos registros já coletados, não "
        "declarado pelo cadastro.",
        "repository_harvests trunca o histórico em 20 por página; a série completa exigiu "
        "o cliente cru com 500 por página.",
        "Desenho observacional: plataforma, tipo de fonte e operador responsável andam "
        "juntos e nenhum teste desta base os separa.",
        "size, valid_size e transformed_size são resultados da coleta, não propriedades "
        "declaradas pela fonte.",
        "216 fontes estão cadastradas contra endpoints de agregador desativados "
        "(212 old.scielo.br, 3 www.scielo.br, 1 BDTD).",
        "Todas as 2.183 fontes compartilham o cron * 0 0 29 2 * (29 de fevereiro): ele dispara "
        "só em ano bissexto — 358 fontes varridas em 2020-02-29, 3 em 2024-02-29 — e no "
        "intervalo as coletas são lotes manuais.",
        "ListRecords: 251 das 2.178 origens com endpoint não foram pedidas — o disjuntor "
        "por host abriu depois de falhas seguidas no mesmo servidor; o desfecho delas é "
        "disjuntor, não falha da fonte.",
        "index_status UNKNOWN em 574 fontes é ausência de informação do Harvester, não "
        "falha de indexação.",
    ],
    "reproducibility": {
        "invariant": "byte-identical regeneration from the same inputs",
        "verify": "python exp1/congelar.py && sha256sum -c metadata/checksums.sha256",
    },
}


def hints(escritos: list[Path]) -> dict:
    """Dica de cada coluna de cada tabela, para o painel e para quem baixa.

    **Levanta se alguma coluna ficar sem dica.** É o que faz "todos os campos
    de todas as tabelas" continuar verdadeiro depois que alguém acrescentar uma
    coluna — sem isso, a promessa se desfaz em silêncio na primeira mudança.
    """
    saida: dict[str, dict] = {}
    faltando: list[str] = []
    for caminho in escritos:
        nome = caminho.stem
        colunas = {}
        for coluna in pq.read_schema(caminho).names:
            texto = dica(nome, coluna)
            if not texto:
                faltando.append(f"{nome}.{coluna}")
            colunas[coluna] = texto
        saida[nome] = {"descricao": DICAS_TABELAS.get(nome, ""), "colunas": colunas}
    if faltando:
        raise SystemExit(
            f"{len(faltando)} coluna(s) sem dica em dicas.py: " + ", ".join(faltando)
        )
    return saida


def main() -> int:
    DADOS.mkdir(parents=True, exist_ok=True)
    META.mkdir(parents=True, exist_ok=True)

    base = bf.ler()
    snaps = snapshots()
    met = metricas(base, snaps)

    escritos = []
    escritos.append(_gravar(repositorios(base), "repositories"))
    escritos.append(_gravar(pa.Table.from_pandas(snaps, preserve_index=False), "snapshots"))
    escritos.append(_gravar(plataformas(), "platforms"))
    escritos.append(
        _gravar(
            pa.Table.from_pandas(
                pd.read_csv(
                    bf.DADOS / "base-evidencias.csv", dtype={"source_id": str}
                ).sort_values("classification_evidence_id"),
                preserve_index=False,
            ),
            "platform_evidence",
        )
    )
    escritos.append(_gravar(pa.Table.from_pandas(met, preserve_index=False), "harvest_metrics"))

    # A tabela larga que o painel consulta na maioria das telas. É redundante de
    # propósito: poupa cinco JOINs por consulta num motor que roda no navegador.
    resumo = (
        pa.Table.from_pandas(base[CAMPOS_REPO], preserve_index=False)
        .to_pandas()
        .rename(columns={"FinsLucrativos": "fins_lucrativos", "Comunitaria": "comunitaria"})
        .merge(met, on="source_id", how="left")
        .sort_values("source_id", key=_ordem)
    )
    escritos.append(_gravar(pa.Table.from_pandas(resumo, preserve_index=False), "repository_summary"))

    reg, val = registros()
    if not reg.empty:
        escritos.append(_gravar(pa.Table.from_pandas(reg, preserve_index=False), "records"))
        escritos.append(_gravar(pa.Table.from_pandas(val, preserve_index=False), "record_values"))
        escritos.append(
            _gravar(
                pa.Table.from_pandas(metricas_de_registro(reg), preserve_index=False),
                "record_metrics",
            )
        )
        escritos.append(
            _gravar(
                pa.Table.from_pandas(desfechos_de_coleta(base), preserve_index=False),
                "record_harvest",
            )
        )
        escritos.append(
            _gravar(pa.Table.from_pandas(regras_de_metadado(), preserve_index=False), "metadata_rules")
        )
        # Uma passada só pelo JSON: a avaliação enche o coletor enquanto decide.
        coletor: dict[str, list] = {c: [] for c in COLUNAS_VALORES}
        escritos.append(
            _gravar(pa.Table.from_pandas(avaliar_metadados(coletor), preserve_index=False), "record_metadata")
        )
        tabela_valores = valores_de_metadado(coletor)
        escritos.append(
            _gravar(
                pa.Table.from_pandas(tabela_valores, preserve_index=False),
                "record_metadata_values",
                copia_txt=False,
            )
        )
        particoes = particionar_valores(tabela_valores)
        print(f"  data/valores/: {particoes} partições de record_metadata_values")

    escrever_json(
        "dataset.json",
        {
            "dataset_id": DATASET_ID,
            "title": "HarvestBoard Evidence - Oasisbr",
            "subtitle": "Base 1: fontes de acesso aberto do Oasisbr",
            "exported_at": EXPORTADO_EM,
            "reference_date": REFERENCIA.strftime("%Y-%m-%d"),
            "repositories": int(len(base)),
            "records_last_snapshot": int(base["size"].sum()),
            "valid_records_last_snapshot": int(base.valid_size.sum()),
            "transformed_records_last_snapshot": int(base.transformed_size.sum()),
            "snapshots_total": int(len(snaps)),
            "records_sampled": int(len(reg)),
            "dataset_status": "FROZEN",
            "schema_version": VERSAO,
            "version": VERSAO,
            "publisher": "IBICT — Instituto Brasileiro de Informação em Ciência e Tecnologia",
            "license": "CC-BY-4.0",
            "spatial_coverage": "BR",
            "unit_of_observation": "fonte de metadados registrada no Oasisbr",
            "tables": [
                {
                    "name": c.stem,
                    "rows": pq.read_metadata(c).num_rows,
                    "columns": pq.read_metadata(c).num_columns,
                    "bytes": c.stat().st_size,
                }
                for c in escritos
            ],
        },
    )
    escrever_json("codebook.json", codebook())
    escrever_json("vocabularies.json", vocabularios())
    escrever_json("hints.json", hints(escritos))
    escrever_json("provenance.json", PROVENIENCIA)

    linhas = sorted(f"{_sha256(c)}  data/{c.name}" for c in escritos)
    (META / "checksums.sha256").write_text("\n".join(linhas) + "\n")

    total = sum(len(v["colunas"]) for v in hints(escritos).values())
    print(f"  hints.json: {total} colunas descritas em {len(escritos)} tabelas")
    for c in escritos:
        print(f"  data/{c.name:28} {pq.read_metadata(c).num_rows:>6} linhas  {c.stat().st_size // 1024:>5} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
