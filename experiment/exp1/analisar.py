#!/usr/bin/env python
"""Calcula a ficha de qualidade de cada hipótese, a partir do dataset congelado.

    .venv/bin/python exp1/analisar.py

Escreve `evidence/public/metadata/hypotheses.json`. É o script que fecha o
item "resultado reproduzível a partir do pacote": até aqui os números das
hipóteses vinham de análise feita à mão no console, e ninguém além de quem a
fez conseguiria repeti-los. Agora saem de um arquivo versionado, sobre os
Parquet congelados, com semente fixa.

## Três coisas que este arquivo separa de propósito

**Significância não é tamanho de efeito.** Com 1.723 fontes, diferença
irrelevante dá p pequeno. Toda ficha traz o tamanho de efeito com intervalo de
confiança, e é ele que responde "importa?".

**Tamanho de efeito não é identificação.** H1 tem efeito grande e bem medido e
mesmo assim não sustenta a conclusão que o enunciado sugere, porque plataforma
e tipo de fonte são a mesma variável nesta base. O campo `identificacao` diz
isso em separado do campo `p` — juntá-los seria o erro que a ficha existe para
evitar.

**Pré-registro não se faz depois.** O item "métricas definidas antes da
análise" do checklist **não está atendido** e não pode ser atendido
retroativamente: estas métricas foram escolhidas depois de olhar os dados.
Declará-las agora como pré-registradas seria datar para trás. O que dá para
fazer, e é o que se faz aqui, é congelar a definição a partir de agora — a
partir da v1.0.0 qualquer mudança de métrica muda o arquivo e o hash.

## Intervalos

Bootstrap percentílico com 2.000 reamostragens e semente fixa (`SEMENTE`). Não
é o método mais fino para todos os casos, mas é o mesmo para todos, não supõe
normalidade — que nenhuma destas distribuições tem — e é reproduzível.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import duckdb
import numpy as np
from scipy import stats

from protocolo import CHECKLIST, TRES_CRITERIOS

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA))

RAIZ = PASTA / "evidence" / "public"
DADOS = RAIZ / "data"
SAIDA = RAIZ / "metadata" / "hypotheses.json"

# A semente só garante o mesmo sorteio se os valores chegarem na mesma ordem.
# O DuckDB agrega em paralelo e não promete ordem sem ORDER BY: até 2026-09-23
# cada execução dava outro IC e outro z com a mesma semente. Daí a regra deste
# arquivo — todo list() e todo resultado que alimenta sorteio ou ranking tem
# ORDER BY explícito, com desempate por chave única.
SEMENTE = 20260920
REAMOSTRAS = 2000
PERMUTACOES = 1000

TABELAS = (
    "repositories",
    "snapshots",
    "platforms",
    "platform_evidence",
    "harvest_metrics",
    "repository_summary",
    "records",
    "record_values",
    "record_metrics",
)


def conectar() -> duckdb.DuckDBPyConnection:
    c = duckdb.connect()
    for t in TABELAS:
        caminho = DADOS / f"{t}.parquet"
        if caminho.is_file():
            c.execute(f"CREATE VIEW {t} AS SELECT * FROM '{caminho}'")
    c.execute((RAIZ / "sql" / "views.sql").read_text())
    if (DADOS / "records.parquet").is_file():
        c.execute((RAIZ / "sql" / "views-registros.sql").read_text())
    return c


# ------------------------------------------------------------------ estatística


def kruskal(grupos: list[np.ndarray]) -> dict:
    """Kruskal-Wallis com epsilon-quadrado, o tamanho de efeito que lhe cabe.

    `epsilon²` é a fração da variação de postos explicada pelo grupo: 0 é
    nenhuma, 1 é separação total. Reportar só o H deixaria o leitor sem saber
    se a diferença é grande — e com n desta ordem, H é grande quase sempre.
    """
    grupos = [g[~np.isnan(g)] for g in grupos if len(g[~np.isnan(g)]) > 0]
    if len(grupos) < 2:
        return {}
    h, p = stats.kruskal(*grupos)
    n = sum(len(g) for g in grupos)
    k = len(grupos)
    eps2 = (h - k + 1) / (n - k) if n > k else float("nan")
    return {
        "teste": "Kruskal-Wallis",
        "H": round(float(h), 2),
        "gl": k - 1,
        "p": float(p),
        "n": int(n),
        "grupos": k,
        "efeito_nome": "epsilon-quadrado",
        "efeito": round(float(max(eps2, 0.0)), 4),
    }


def cliff(a: np.ndarray, b: np.ndarray) -> float:
    """Delta de Cliff: P(a>b) − P(a<b). Não supõe forma nenhuma.

    Convenções usuais: 0,15 pequeno, 0,33 médio, 0,47 grande.
    """
    a, b = a[~np.isnan(a)], b[~np.isnan(b)]
    if not len(a) or not len(b):
        return float("nan")
    # via postos, para não estourar memória com o produto cartesiano
    juntos = np.concatenate([a, b])
    postos = stats.rankdata(juntos)
    soma_a = postos[: len(a)].sum()
    u = soma_a - len(a) * (len(a) + 1) / 2
    return float(2 * u / (len(a) * len(b)) - 1)


def ic_bootstrap(fn, *amostras, semente: int = SEMENTE) -> list[float]:
    """IC de 95% percentílico, reamostrando cada grupo com reposição."""
    rng = np.random.default_rng(semente)
    valores = []
    for _ in range(REAMOSTRAS):
        reamostrado = [rng.choice(a, size=len(a), replace=True) for a in amostras]
        try:
            v = fn(*reamostrado)
        except Exception:
            continue
        if v is not None and np.isfinite(v):
            valores.append(v)
    if not valores:
        return [float("nan"), float("nan")]
    return [round(float(np.percentile(valores, 2.5)), 4), round(float(np.percentile(valores, 97.5)), 4)]


def _eps2(*grupos) -> float:
    r = kruskal(list(grupos))
    return r.get("efeito", float("nan"))


# ------------------------------------------------------------------- recortes


def por_plataforma(c, coluna: str, onde: str = "") -> tuple[list[str], list[np.ndarray]]:
    filtro = f"AND {onde}" if onde else ""
    linhas = c.execute(
        f"""SELECT platform_analysis_group, list({coluna} ORDER BY source_id)
            FROM v_source
            WHERE {coluna} IS NOT NULL {filtro}
            GROUP BY 1 HAVING count(*) >= 10 ORDER BY 1"""
    ).fetchall()
    return [r[0] for r in linhas], [np.asarray(r[1], dtype=float) for r in linhas]


# Cada recorte precisa ser interpretável sozinho. "sem endpoint de agregador"
# parecia um controle de qualidade e na verdade removia as 215 fontes SCIELO
# por inteiro — o filtro é colinear com a variável independente, e a queda de
# efeito que ele produz não diz nada sobre agregador, diz que SCIELO era o
# grupo extremo. Renomeado para o que é, e acrescentado o par que se pode
# interpretar sem ressalva.
RECORTES = {
    "todas as fontes": "",
    "sem plataforma UNKNOWN": "platform_analysis_group <> 'UNKNOWN'",
    "sem SCIELO (= sem os endpoints de agregador)": "platform_analysis_group <> 'SCIELO'",
    "só OJS e DSPACE": "platform_analysis_group IN ('OJS', 'DSPACE')",
    "só com 100+ registros": "latest_size >= 100",
}


def sensibilidade(c, coluna: str) -> list[dict]:
    """O mesmo teste em quatro recortes. Divergência entre eles é o achado."""
    saida = []
    for nome, filtro in RECORTES.items():
        rotulos, grupos = por_plataforma(c, coluna, filtro)
        r = kruskal(grupos)
        if not r:
            continue
        saida.append(
            {
                "recorte": nome,
                "n": r["n"],
                "grupos": r["grupos"],
                "efeito": r["efeito"],
                "p": r["p"],
            }
        )
    return saida


# --------------------------------------------------------------------- fichas

BASE = {
    "populacao": "fontes de metadados registradas no Oasisbr (N = 2.183)",
    "cobertura_temporal": "coletas de 2017-07-19 a 2026-09-20; cadastro em 2026-09-20",
}


def h1(c) -> dict:
    rotulos, grupos = por_plataforma(c, "taxa_validade")
    r = kruskal(grupos)
    # Quantas células tipo × plataforma existem de fato: é isto, e não o p,
    # que decide se a comparação isola a plataforma.
    celulas = c.execute(
        "SELECT count(*), count(*) FILTER (fontes > 0), sum(fontes) FILTER (fontes >= 5) FROM v_celula"
    ).fetchone()
    diagonal = c.execute(
        """SELECT sum(fontes) FROM v_celula WHERE
           (source_type_detail = 'SCIENTIFIC_JOURNAL'    AND platform_analysis_group = 'OJS')
        OR (source_type_detail = 'PUBLICATION_REPOSITORY' AND platform_analysis_group = 'DSPACE')"""
    ).fetchone()[0]
    total = c.execute("SELECT count(*) FROM repository_summary").fetchone()[0]
    return {
        **BASE,
        "id": "H1",
        "statement": "A taxa de validade difere entre plataformas",
        "unidade": "fonte (último snapshot)",
        "variavel_dependente": "taxa_validade = valid_size / size",
        "variavel_independente": "platform_analysis_group",
        "confundidores": ["source_type_detail", "latest_size", "metadata_profile", "operador responsável"],
        "inclusao": "fontes com size > 0 (a taxa não existe sem registro coletado)",
        "exclusao": "plataformas com menos de 10 fontes",
        "estatistica": r,
        "ic95": ic_bootstrap(_eps2, *grupos),
        "grupos_rotulos": rotulos,
        "sensibilidade": sensibilidade(c, "taxa_validade"),
        "identificacao": (
            f"não identificável: das {celulas[0]} células tipo × plataforma, {celulas[1]} têm alguma fonte, "
            f"e duas delas concentram {diagonal} das {total} fontes. Plataforma e tipo de fonte não variam "
            "independentemente, então o contraste entre plataformas é, com a mesma evidência, um contraste "
            "entre tipos de fonte."
        ),
        "veredito": "not_identifiable",
        "verdict_label": "não identificável",
    }


def h2(c) -> dict:
    rotulos, grupos = por_plataforma(c, "taxa_transformacao")
    r = kruskal(grupos)
    medianas = {
        rot: round(float(np.nanmedian(g)), 4) for rot, g in zip(rotulos, grupos)
    }
    return {
        **BASE,
        "id": "H2",
        "statement": "A taxa de transformação difere entre plataformas",
        "unidade": "fonte (último snapshot)",
        "variavel_dependente": "taxa_transformacao = transformed_size / size",
        "variavel_independente": "platform_analysis_group",
        "confundidores": ["source_type_detail", "metadata_profile"],
        "inclusao": "fontes com size > 0",
        "exclusao": "plataformas com menos de 10 fontes",
        "estatistica": r,
        "ic95": ic_bootstrap(_eps2, *grupos),
        "grupos_rotulos": rotulos,
        "medianas": medianas,
        "sensibilidade": sensibilidade(c, "taxa_transformacao"),
        "identificacao": (
            "identificável e sem efeito prático: a mediana é 100% em toda plataforma, então não há o que "
            "atribuir. O achado é sobre o processo, não sobre a plataforma — a transformação é etapa mecânica "
            "que quase não falha, enquanto a validação de perfil rejeita 14,6% dos registros."
        ),
        "veredito": "null_result",
        "verdict_label": "resultado nulo",
    }


def h3(c) -> dict:
    total, povoadas, minusculas = c.execute(
        """SELECT count(*), count(*) FILTER (fontes > 0), count(*) FILTER (fontes BETWEEN 1 AND 4)
           FROM v_celula"""
    ).fetchone()
    return {
        **BASE,
        "id": "H3",
        "statement": "O efeito da plataforma depende do tipo de fonte",
        "unidade": "célula tipo × plataforma",
        "variavel_dependente": "taxa_validade",
        "variavel_independente": "platform_analysis_group × source_type_detail",
        "confundidores": ["as mesmas de H1, mais a esparsidade da matriz"],
        "inclusao": "todas as células do cruzamento, inclusive as vazias",
        "exclusao": "nenhuma — é a ausência que sustenta o argumento",
        "estatistica": {
            "teste": "nenhum aplicado",
            "celulas": total,
            "celulas_povoadas": povoadas,
            "celulas_com_menos_de_5": minusculas,
        },
        "ic95": None,
        "sensibilidade": [],
        "identificacao": (
            f"não estimável: {povoadas} das {total} células têm alguma fonte e {minusculas} dessas têm menos "
            "de cinco. Um modelo com interação roda e devolve coeficientes, mas extrapolando para combinações "
            "que mal existem na população."
        ),
        "veredito": "not_estimable",
        "verdict_label": "não estimável",
    }


def h4(c) -> dict:
    rotulos, grupos = por_plataforma(c, "days_since_last_harvest")
    r = kruskal(grupos)
    ojs = np.asarray(
        c.execute(
            "SELECT list(days_since_last_harvest ORDER BY source_id) FROM v_source WHERE platform_analysis_group = 'OJS' AND days_since_last_harvest IS NOT NULL"
        ).fetchone()[0],
        dtype=float,
    )
    dspace = np.asarray(
        c.execute(
            "SELECT list(days_since_last_harvest ORDER BY source_id) FROM v_source WHERE platform_analysis_group = 'DSPACE' AND days_since_last_harvest IS NOT NULL"
        ).fetchone()[0],
        dtype=float,
    )
    delta = cliff(ojs, dspace)
    # Confundimento com tamanho, medido e não suposto.
    tam, dias = np.asarray(
        c.execute(
            "SELECT list(latest_size ORDER BY source_id), list(days_since_last_harvest ORDER BY source_id) FROM v_source WHERE latest_size > 0 AND days_since_last_harvest IS NOT NULL"
        ).fetchone(),
        dtype=object,
    )
    rho, p_rho = stats.spearmanr(np.asarray(tam, float), np.asarray(dias, float))
    return {
        **BASE,
        "id": "H4",
        "statement": "A atualidade das coletas difere entre grupos",
        "unidade": "fonte",
        "variavel_dependente": "days_since_last_harvest (referência 2026-09-20)",
        "variavel_independente": "platform_analysis_group",
        "confundidores": ["latest_size", "source_type_detail", "lote manual do operador"],
        "inclusao": "fontes com ao menos uma coleta registrada",
        "exclusao": "plataformas com menos de 10 fontes",
        "estatistica": r,
        "ic95": ic_bootstrap(_eps2, *grupos),
        "grupos_rotulos": rotulos,
        "contraste": {
            "par": "OJS vs DSPACE",
            "mediana_a": float(np.median(ojs)),
            "mediana_b": float(np.median(dspace)),
            "efeito_nome": "delta de Cliff",
            "efeito": round(delta, 4),
            "ic95": ic_bootstrap(cliff, ojs, dspace),
        },
        "confundimento": {
            "nome": "Spearman tamanho × dias",
            "rho": round(float(rho), 4),
            "p": float(p_rho),
        },
        "sensibilidade": sensibilidade(c, "days_since_last_harvest"),
        "identificacao": (
            "o efeito global existe mas não é um gradiente de plataforma: ele é carregado por um grupo só. "
            "Com todas as fontes, epsilon-quadrado = 0,187; sem SCIELO cai para 0,020, e no par OJS contra "
            "DSPACE sozinho fica em 0,014, com delta de Cliff 0,22 — pequeno, apesar das medianas de 254 e "
            "92 dias. O que a análise de sensibilidade mostra é que as 215 fontes SCIELO, com mediana de 549 "
            "dias, são o efeito inteiro; e elas estão assim porque 212 delas apontam para o endpoint "
            "desativado old.scielo.br, o que é defeito de cadastro e não propriedade do software. O "
            "confundimento com tamanho, medido, é fraco (rho = -0,18). A leitura defensável é que a variável "
            "mede a atenção do operador e o estado do cadastro, não a plataforma."
        ),
        "veredito": "supported_confounded",
        "verdict_label": "sustentada, com confundimento",
    }


def h5(c) -> dict:
    erro_total, erro_vazio = c.execute(
        """SELECT count(*), count(*) FILTER (latest_size = 0)
           FROM v_source WHERE latest_snapshot_status = 'HARVESTING_FINISHED_ERROR'"""
    ).fetchone()
    return {
        **BASE,
        "id": "H5",
        "statement": "O tamanho da fonte influencia a probabilidade de falha",
        "unidade": "fonte",
        "variavel_dependente": "falha na última coleta",
        "variavel_independente": "latest_size",
        "confundidores": ["a própria variável dependente — ver identificação"],
        "inclusao": "todas as fontes com coleta registrada",
        "exclusao": "nenhuma",
        "estatistica": {
            "teste": "nenhum aplicado",
            "erros": erro_total,
            "erros_com_size_zero": erro_vazio,
            "fracao": round(erro_vazio / max(erro_total, 1), 4),
        },
        "ic95": None,
        "sensibilidade": [],
        "identificacao": (
            f"circular: {erro_vazio} das {erro_total} fontes em erro têm size = 0, porque uma coleta que "
            "falhou reporta zero registros. `size` é o resultado da coleta, não propriedade prévia da fonte. "
            "Testar a hipótese exige o tamanho declarado pela origem antes da coleta, que esta base não tem — "
            f"os {erro_total - erro_vazio} casos com registros e erro são os únicos informativos."
        ),
        "veredito": "partly_tautological",
        "verdict_label": "em parte tautológica",
    }


def h6(c) -> dict:
    """Permutação embaralhando as falhas dentro de cada fonte.

    A hipótese nula não é "a fonte não falha", é "as falhas dela não se
    agrupam". Embaralhar dentro da fonte preserva quantas vezes cada uma
    falhou e destrói só a ordem — que é exatamente o que persistência afirma.
    """
    series = c.execute(
        """SELECT list(is_failure ORDER BY ordem) FROM snapshots
           GROUP BY source_id HAVING count(*) >= 4 ORDER BY source_id"""
    ).fetchall()
    series = [np.asarray(s[0], dtype=bool) for s in series]

    def maior_sequencia(v: np.ndarray) -> int:
        melhor = atual = 0
        for x in v:
            atual = atual + 1 if x else 0
            melhor = max(melhor, atual)
        return melhor

    observado = float(np.mean([maior_sequencia(s) for s in series]))
    rng = np.random.default_rng(SEMENTE)
    nulo = np.array(
        [
            np.mean([maior_sequencia(rng.permutation(s)) for s in series])
            for _ in range(PERMUTACOES)
        ]
    )
    z = (observado - nulo.mean()) / nulo.std(ddof=1)
    p = float((np.sum(nulo >= observado) + 1) / (PERMUTACOES + 1))

    # IC da razão, reamostrando as fontes. O intervalo tem de estar na mesma
    # escala do efeito; antes vinha na escala do comprimento da sequência e os
    # dois números não conversavam.
    rng_ic = np.random.default_rng(SEMENTE + 1)
    indices = np.arange(len(series))
    razoes = []
    for _ in range(REAMOSTRAS // 4):
        escolha = rng_ic.choice(indices, size=len(indices), replace=True)
        razoes.append(np.mean([maior_sequencia(series[i]) for i in escolha]) / nulo.mean())
    ic_razao = [round(float(np.percentile(razoes, 2.5)), 3), round(float(np.percentile(razoes, 97.5)), 3)]

    falhas = np.array([s.sum() for s in series], dtype=float)
    n = np.array([len(s) for s in series], dtype=float)
    pbar = falhas.sum() / n.sum()
    esperada = float(np.sum(n * pbar * (1 - pbar)))
    sobredispersao = float(np.var(falhas, ddof=1) * len(falhas) / esperada)

    persistentes, nunca, sempre = c.execute(
        """SELECT count(*) FILTER (persistent), count(*) FILTER (never_failed),
                  count(*) FILTER (always_failed) FROM harvest_metrics"""
    ).fetchone()
    return {
        **BASE,
        "id": "H6.1",
        "statement": "As falhas de uma fonte se agrupam",
        "unidade": "fonte (série de snapshots)",
        "variavel_dependente": "maior sequência de falhas consecutivas",
        "variavel_independente": "identidade da fonte",
        "confundidores": ["número de coletas por fonte", "época da coleta (lotes manuais)"],
        "inclusao": "fontes com 4 ou mais snapshots",
        "exclusao": "fontes com histórico curto demais para julgar",
        "estatistica": {
            "teste": f"permutação dentro da fonte, {PERMUTACOES} reamostragens",
            "n": len(series),
            "sequencia_observada": round(observado, 3),
            "sequencia_sob_independencia": round(float(nulo.mean()), 3),
            "z": round(float(z), 2),
            "p": p,
            "efeito_nome": "razão observado / nulo",
            "efeito": round(observado / float(nulo.mean()), 3),
        },
        "ic95": ic_razao,
        "sobredispersao": round(sobredispersao, 2),
        "distribuicao": {"persistentes": persistentes, "nunca_falharam": nunca, "sempre_falharam": sempre},
        "sensibilidade": [],
        "identificacao": (
            "identificável. A permutação é dentro da própria fonte, então preserva quantas vezes cada uma "
            "falhou e destrói só a ordem — o que sobra é agrupamento, que é o que a hipótese afirma. Não diz "
            "por que a fonte falha; diz que a falha não é sorteada."
        ),
        "veredito": "supported",
        "verdict_label": "sustentada",
    }


# A USP é outlier declarado: 87 fontes, o dobro da segunda e 4,0% da base.
# A regra e a justificativa estão em views-registros.sql; aqui ela entra como
# recorte de sensibilidade, nunca de inclusão.
SEM_USP = "institution_name NOT LIKE '%São Paulo (USP)%'"


def h7(c) -> dict:
    """Completude por natureza institucional, com a sequência de controles.

    A sensibilidade aqui não é decoração: é o argumento. O efeito aparente
    encolhe a cada controle, e o que sobra no fim é o que a base sustenta.
    """

    def medir(sql: str) -> tuple[dict, list[str]]:
        linhas = c.execute(sql).fetchall()
        linhas = [x for x in linhas if len(x[1]) >= 3]
        return kruskal([np.asarray(x[1], dtype=float) for x in linhas]), [x[0] for x in linhas]

    # 1. por fonte, sem controle — o número que a pergunta ingênua produz
    p1, _ = medir("""SELECT institution_type, list(taxa_validade ORDER BY source_id) FROM v_source
                     WHERE taxa_validade IS NOT NULL GROUP BY 1 HAVING count(*) >= 20 ORDER BY 1""")
    # 2. por instituição: corrige a pseudo-replicação
    p2, _ = medir("""SELECT institution_type, list(mv ORDER BY institution_name) FROM (
                       SELECT institution_name, any_value(institution_type) institution_type,
                              median(taxa_validade) mv
                       FROM v_source WHERE taxa_validade IS NOT NULL GROUP BY 1)
                     GROUP BY 1 HAVING count(*) >= 20 ORDER BY 1""")
    # 3. controlado, desfecho conformidade — some
    p3, _ = medir("""SELECT institution_type, list(mc ORDER BY institution_name) FROM (
                       SELECT r.institution_name, any_value(r.institution_type) institution_type,
                              median(d.conformidade) mc
                       FROM v_dimensao d JOIN repositories r USING (source_id)
                       WHERE r.source_type_detail = 'SCIENTIFIC_JOURNAL'
                         AND r.platform_analysis_group = 'OJS' GROUP BY 1)
                     GROUP BY 1 HAVING count(*) >= 20 ORDER BY 1""")
    # 4. controlado, desfecho completude — o único que sobrevive
    p4, rotulos = medir("""SELECT institution_type, list(mc ORDER BY institution_name) FROM (
                       SELECT r.institution_name, any_value(r.institution_type) institution_type,
                              median(d.completude) mc
                       FROM v_dimensao d JOIN repositories r USING (source_id)
                       WHERE r.source_type_detail = 'SCIENTIFIC_JOURNAL'
                         AND r.platform_analysis_group = 'OJS' GROUP BY 1)
                     GROUP BY 1 HAVING count(*) >= 20 ORDER BY 1""")
    # 5. o mesmo, sem o outlier declarado
    p5, _ = medir(f"""SELECT institution_type, list(mc ORDER BY institution_name) FROM (
                       SELECT r.institution_name, any_value(r.institution_type) institution_type,
                              median(d.completude) mc
                       FROM v_dimensao d JOIN repositories r USING (source_id)
                       WHERE r.source_type_detail = 'SCIENTIFIC_JOURNAL'
                         AND r.platform_analysis_group = 'OJS'
                         AND r.{SEM_USP} GROUP BY 1)
                     GROUP BY 1 HAVING count(*) >= 20 ORDER BY 1""")

    grupos = [
        np.asarray(x[1], dtype=float)
        for x in c.execute("""SELECT institution_type, list(mc ORDER BY institution_name) FROM (
             SELECT r.institution_name, any_value(r.institution_type) institution_type,
                    median(d.completude) mc
             FROM v_dimensao d JOIN repositories r USING (source_id)
             WHERE r.source_type_detail = 'SCIENTIFIC_JOURNAL'
               AND r.platform_analysis_group = 'OJS' GROUP BY 1)
           GROUP BY 1 HAVING count(*) >= 20 ORDER BY 1""").fetchall()
    ]
    medianas = dict(
        c.execute("""SELECT institution_type, round(median(mc), 4) FROM (
             SELECT r.institution_name, any_value(r.institution_type) institution_type,
                    median(d.completude) mc
             FROM v_dimensao d JOIN repositories r USING (source_id)
             WHERE r.source_type_detail = 'SCIENTIFIC_JOURNAL'
               AND r.platform_analysis_group = 'OJS' GROUP BY 1)
           GROUP BY 1 HAVING count(*) >= 20 ORDER BY 2 DESC, 1""").fetchall()
    )
    concentracao = c.execute(
        "SELECT count(*), sum(fontes), max(fontes), round(avg(fontes), 1) FROM v_instituicao"
    ).fetchone()

    return {
        **BASE,
        "id": "H7",
        "statement": "A completude do metadado difere entre naturezas institucionais",
        "unidade": "instituição (mediana das fontes dela)",
        "variavel_dependente": "completude = elementos Dublin Core presentes ÷ 15",
        "variavel_independente": "institution_type (CV01)",
        "confundidores": [
            "plataforma e tipo de fonte (controlados por estrato)",
            "porte da instituição",
            "existência de equipe de biblioteca — não observada",
        ],
        "inclusao": (
            f"instituições com fonte na amostra de registros; categorias com 20 ou mais "
            f"instituições. Estrato fixo: periódico científico em OJS, para segurar as duas "
            f"variáveis que H1 não consegue separar"
        ),
        "exclusao": (
            "categorias com menos de 20 instituições (PUBLISHER, MUNICIPAL_UNIVERSITY, LIBRARY). "
            "A USP é outlier declarado e sai apenas no recorte de sensibilidade, não da inclusão"
        ),
        "estatistica": p4,
        "ic95": ic_bootstrap(_eps2, *grupos),
        "grupos_rotulos": rotulos,
        "medianas": medianas,
        "concentracao": {
            "instituicoes": concentracao[0],
            "fontes": concentracao[1],
            "maior": concentracao[2],
            "media": float(concentracao[3]),
        },
        "sensibilidade": [
            {"recorte": "validade, por fonte, sem controle", "n": p1["n"], "grupos": p1["grupos"],
             "efeito": p1["efeito"], "p": p1["p"]},
            {"recorte": "validade, por instituição", "n": p2["n"], "grupos": p2["grupos"],
             "efeito": p2["efeito"], "p": p2["p"]},
            {"recorte": "conformidade, controlado", "n": p3["n"], "grupos": p3["grupos"],
             "efeito": p3["efeito"], "p": p3["p"]},
            {"recorte": "completude, controlado", "n": p4["n"], "grupos": p4["grupos"],
             "efeito": p4["efeito"], "p": p4["p"]},
            {"recorte": "completude, controlado, sem a USP", "n": p5["n"], "grupos": p5["grupos"],
             "efeito": p5["efeito"], "p": p5["p"]},
        ],
        "conflito": (
            "institution_type não vem do cadastro do Harvester — foi inferido por nós dos nomes "
            "das instituições e conferido contra quatro exportações do e-MEC (755 classificadas, "
            "289 casadas por sigla+UF, zero divergências). Estamos testando uma variável que "
            "construímos, e erro de classificação aqui atenua o efeito em direção ao nulo."
        ),
        "identificacao": (
            "identificável, ao contrário de H1, e é esse o ganho real da troca: a natureza "
            "institucional varia dentro de plataforma e dentro de tipo de fonte, então o teste "
            "roda com os dois fixos — 383 instituições só em periódico/OJS. A sequência de "
            "controles mostra o resto: sem controle o efeito parece grande e é composição, "
            "porque a natureza prediz a plataforma (sociedade científica tende a SCIELO); "
            "controlado, a conformidade não distingue nada (ε² = 0,0000) porque está grumosa em "
            "0,75, com todos falhando em dc:rights; sobra a completude, pequena e real. "
            "Identificar não é isolar mecanismo: 'universidade federal' não é tratamento, é "
            "rótulo de um pacote correlacionado — orçamento, equipe, porte, idade."
        ),
        "veredito": "supported_small",
        "verdict_label": "sustentada, efeito pequeno",
    }


# ---------------------------------------------------- achados da amostra
#
# H8 a H14 saem da amostra de registros e têm uma natureza diferente das
# anteriores: a maioria é descritiva, não causal. Isso não as torna menores —
# H8 qualifica todas as outras —, mas o campo `identificacao` de cada uma diz
# de que tipo é a afirmação, porque chamar descrição de efeito é o erro que
# estas fichas existem para evitar.

BASE_AMOSTRA = {
    **BASE,
    # Vivos, não recebidos: dos 318.953 cabeçalhos, 22.934 são de registro
    # excluído, sem metadado nenhum, e não entram em medida de conteúdo.
    "populacao": (
        "1.573 fontes que responderam ao ListRecords; 296.019 registros vivos em oai_dc "
        "(318.953 cabeçalhos recebidos, dos quais 22.934 de registros excluídos)"
    ),
}


def _proporcao(a: int, n: int, semente: int = SEMENTE) -> dict:
    """Proporção com IC95 por bootstrap, na mesma convenção das outras fichas."""
    rng = np.random.default_rng(semente)
    v = np.concatenate([np.ones(a), np.zeros(n - a)])
    amostras = [rng.choice(v, size=n, replace=True).mean() for _ in range(REAMOSTRAS // 4)]
    return {
        "teste": "proporção com IC por bootstrap",
        "n": n,
        "efeito_nome": "proporção",
        "efeito": round(a / n, 4),
        "ic95": [round(float(np.percentile(amostras, 2.5)), 4), round(float(np.percentile(amostras, 97.5)), 4)],
    }


def h8(c) -> dict:
    """A amostra é enviesada? É a ficha que qualifica H9 a H14."""
    com = np.asarray(c.execute(
        "SELECT list(days_since_last_harvest ORDER BY source_id) FROM v_source s JOIN record_metrics m USING (source_id)"
        " WHERE days_since_last_harvest IS NOT NULL").fetchone()[0], dtype=float)
    sem = np.asarray(c.execute(
        "SELECT list(days_since_last_harvest ORDER BY s.source_id) FROM v_source s LEFT JOIN record_metrics m USING (source_id)"
        " WHERE m.source_id IS NULL AND days_since_last_harvest IS NOT NULL").fetchone()[0], dtype=float)
    d = cliff(com, sem)
    e = c.execute("""SELECT count(*) FILTER (m.source_id IS NOT NULL AND s.crit_erro),
                            count(*) FILTER (m.source_id IS NOT NULL),
                            count(*) FILTER (m.source_id IS NULL AND s.crit_erro),
                            count(*) FILTER (m.source_id IS NULL)
                     FROM v_source s LEFT JOIN record_metrics m USING (source_id)""").fetchone()
    chi2, pq, _, _ = stats.chi2_contingency([[e[0], e[1] - e[0]], [e[2], e[3] - e[2]]])
    ausentes = dict(c.execute("""SELECT s.platform_analysis_group, count(*) FROM v_source s
        LEFT JOIN record_metrics m USING (source_id) WHERE m.source_id IS NULL
        GROUP BY 1 ORDER BY 2 DESC, 1""").fetchall())
    return {
        **BASE_AMOSTRA,
        "id": "H8",
        "statement": "A amostra de registros não representa a base",
        "unidade": "fonte",
        "variavel_dependente": "respondeu ou não ao ListRecords",
        "variavel_independente": "estado da fonte — atualidade, desfecho da última coleta, plataforma",
        "confundidores": ["nenhum: a pergunta é descritiva, sobre a própria amostra"],
        "inclusao": "todas as 2.183 fontes",
        "exclusao": "nenhuma",
        "estatistica": {
            "teste": "Mann-Whitney para dias, qui-quadrado para erro",
            "n": int(len(com) + len(sem)),
            "efeito_nome": "delta de Cliff (dias)",
            "efeito": round(d, 4),
            "p": float(pq),
            "chi2": round(float(chi2)),
        },
        "ic95": ic_bootstrap(cliff, com, sem),
        "medianas": {"com amostra": float(np.median(com)), "sem amostra": float(np.median(sem))},
        "distribuicao": {"com amostra": e[1], "sem amostra": e[3],
                         "em erro entre as sem amostra": e[2], "SCIELO ausente": ausentes.get("SCIELO", 0)},
        "sensibilidade": [],
        "identificacao": (
            "descritiva e decisiva. Não é efeito de nada: é a constatação de que as 610 fontes "
            "ausentes têm mediana de 446 dias contra 254, três vezes mais erro, e incluem as 215 "
            "SCIELO inteiras. **Toda medida de H9 a H14 é teto, não média** — vale para as fontes "
            "que estão funcionando. Corrigir exigiria coleta nova, que está fora de escopo."
        ),
        "veredito": "supported",
        "verdict_label": "confirmada",
    }


def h9(c) -> dict:
    taxas = {}
    for campo in ("type_eurepo_rate", "rights_eurepo_rate", "language_iso_rate", "date_iso_rate"):
        r = c.execute(f"SELECT median({campo}), avg({campo}), count(*) FILTER ({campo} >= 0.9)"
                      f" FROM record_metrics").fetchone()
        taxas[campo] = {"mediana": round(float(r[0]), 4), "media": round(float(r[1]), 4), "fontes_90": r[2]}
    reg = c.execute("""WITH t AS (SELECT source_id, oai_identifier,
        bool_or(value LIKE 'info:eu-repo/semantics/%Access') ok FROM record_values
        WHERE field = 'rights' GROUP BY 1, 2) SELECT count(*) FILTER (ok), count(*) FROM t""").fetchone()
    return {
        **BASE_AMOSTRA,
        "id": "H9",
        "statement": "A conformidade DRIVER é limitada por um único elemento",
        "unidade": "fonte (taxa sobre os registros dela)",
        "variavel_dependente": "taxa de conformidade de cada um dos quatro critérios",
        "variavel_independente": "qual critério",
        "confundidores": ["nenhum: os quatro incidem sobre os mesmos registros"],
        "inclusao": "fontes com amostra de registros",
        "exclusao": "nenhuma",
        "estatistica": {**_proporcao(reg[0], reg[1]),
                        "teste": "proporção de registros com dc:rights em info:eu-repo, IC por bootstrap"},
        "ic95": _proporcao(reg[0], reg[1])["ic95"],
        "medianas": {k.replace("_rate", ""): v["mediana"] for k, v in taxas.items()},
        "distribuicao": {f"fontes ≥90% em {k.replace('_rate','')}": v["fontes_90"] for k, v in taxas.items()},
        "sensibilidade": [],
        "identificacao": (
            "descritiva, e não é questão de grau: é outro regime. Três critérios têm mediana "
            "1,0000 e mais de 1.400 fontes acima de 90%; dc:rights tem mediana 0,0000 e **sete** "
            "fontes acima de 90%. O campo está preenchido em mais da metade dos registros, com "
            "licença Creative Commons — o que falta é o termo de nível de acesso, que é o que o "
            "agregador lê. Corrigir um campo levaria a conformidade total de 2 fontes para "
            "1.237."
        ),
        "veredito": "supported",
        "verdict_label": "confirmada",
    }


def h10(c) -> dict:
    r = c.execute("""WITH t AS (SELECT source_id, oai_identifier,
        bool_or(starts_with(value, 'info:eu-repo/semantics/')) conforme,
        bool_or(NOT starts_with(value, 'info:eu-repo/semantics/')) livre
        FROM record_values WHERE field = 'type' GROUP BY 1, 2)
      SELECT count(*) FILTER (conforme AND livre), count(*) FILTER (livre),
             count(*) FILTER (conforme), count(*) FROM t""").fetchone()
    return {
        **BASE_AMOSTRA,
        "id": "H10",
        "statement": "O texto livre em dc:type acompanha o termo eu-repo em vez de substituí-lo",
        "unidade": "registro",
        "variavel_dependente": "o registro traz também um termo info:eu-repo",
        "variavel_independente": "o registro traz dc:type em texto livre",
        "confundidores": ["plataforma: o OJS emite os dois por padrão"],
        "inclusao": "registros com ao menos um dc:type",
        "exclusao": "registros excluídos",
        "estatistica": {**_proporcao(r[0], r[1]),
                        "teste": "P(tem eu-repo | tem texto livre), IC por bootstrap"},
        "ic95": _proporcao(r[0], r[1])["ic95"],
        "distribuicao": {"com ambos": r[0], "só texto livre": r[1] - r[0], "só eu-repo": r[2] - r[0]},
        "sensibilidade": [],
        "identificacao": (
            "descritiva, e corrige um número que este experimento publicou antes. Contar 'dc:type "
            "fora do vocabulário' como defeito superestimava o problema em três vezes: em 72,4% "
            "das vezes em que o texto livre aparece, o termo correto está ao lado — é o OJS "
            "emitindo os dois. O defeito real são os registros com **apenas** texto livre."
        ),
        "veredito": "supported",
        "verdict_label": "confirmada",
    }


def h11(c) -> dict:
    # O denominador é de vivos: off_schema_records só conta registro vivo, e
    # records_sampled inclui os excluídos — dividir um pelo outro misturava
    # duas populações e puxava a taxa para baixo nas fontes com excluídos.
    x, y = c.execute("""SELECT list(off_schema_records::DOUBLE / (records_sampled - records_deleted)
                                    ORDER BY source_id),
                               list(fields_mean ORDER BY source_id)
                        FROM record_metrics WHERE fields_mean IS NOT NULL""").fetchone()
    rho, p = stats.spearmanr(np.asarray(x, float), np.asarray(y, float))
    afetadas = c.execute("""SELECT count(*), sum(off_schema_records), median(fields_mean)
                            FROM record_metrics WHERE off_schema_records > 0""").fetchone()
    total = c.execute("SELECT sum(records_sampled - records_deleted), median(fields_mean) FROM record_metrics").fetchone()
    return {
        **BASE_AMOSTRA,
        "id": "H11",
        "statement": "Elementos fora do esquema concentram-se em poucas fontes e substituem os Dublin Core",
        "unidade": "fonte",
        "variavel_dependente": "média de elementos Dublin Core por registro",
        "variavel_independente": "fração de registros com elemento fora do esquema",
        "confundidores": ["plataforma: as afetadas são todas UNKNOWN ou OTHER, isto é, software não-padrão"],
        "inclusao": "fontes com ao menos um registro vivo na amostra",
        "exclusao": "fontes cuja amostra é toda de registros excluídos",
        "estatistica": {
            "teste": "Spearman entre taxa fora do esquema e campos Dublin Core",
            "n": len(x),
            "efeito_nome": "rho de Spearman",
            "efeito": round(float(rho), 4),
            "p": float(p),
        },
        "ic95": None,
        "distribuicao": {"fontes afetadas": afetadas[0], "registros afetados": int(afetadas[1]),
                         "registros vivos na amostra": int(total[0])},
        "medianas": {"campos DC nas afetadas": round(float(afetadas[2]), 2),
                     "campos DC na base": round(float(total[1]), 2)},
        "sensibilidade": [],
        "identificacao": (
            "a concentração se confirma, a substituição só se vê dentro das afetadas. São **9 "
            "fontes**, e em todas elas 100% dos registros — 1.660 dos 296.019 vivos. A correlação na "
            "população inteira é fraca (rho = -0,13) justamente porque o fenômeno é raro demais "
            "para mover 1.573 fontes; dentro das nove, a mediana de campos Dublin Core cai a 8,0 "
            "contra 12,0 da base, e só duas descem abaixo de 5. A substituição existe mas é "
            "parcial: elas usam elementos próprios **no lugar** de parte dos Dublin Core. Nove "
            "correções resolvem os dois números."
        ),
        "veredito": "supported_small",
        "verdict_label": "concentrada, correlação fraca",
    }


def h12(c) -> dict:
    faixas = {}
    for rot, cond in [("0%", "= 0"), ("1 a 25%", "> 0 AND t <= 0.25"), ("26 a 50%", "> 0.25 AND t <= 0.5"),
                      ("51 a 99%", "> 0.5 AND t < 1"), ("100%", "= 1")]:
        faixas[rot] = c.execute(
            f"SELECT count(*) FROM (SELECT records_deleted::DOUBLE / records_sampled t"
            f" FROM record_metrics) WHERE t {cond}").fetchone()[0]
    nulas = c.execute("SELECT count(*) FROM record_metrics WHERE fields_mean IS NULL").fetchone()[0]
    return {
        **BASE_AMOSTRA,
        "id": "H12",
        "statement": "A taxa de registros excluídos na primeira página é bimodal, não contínua",
        "unidade": "fonte",
        "variavel_dependente": "fração da amostra marcada como excluída",
        "variavel_independente": "nenhuma — é a forma da distribuição que está em teste",
        "confundidores": ["a ordem em que cada repositório serve os registros, que o protocolo não fixa"],
        "inclusao": "fontes com amostra de registros",
        "exclusao": "nenhuma",
        "estatistica": {
            "teste": "forma da distribuição por faixas",
            "n": sum(faixas.values()),
            "efeito_nome": "fontes com amostra 100% excluída",
            "efeito": faixas["100%"],
        },
        "ic95": None,
        "distribuicao": faixas,
        "sensibilidade": [],
        "identificacao": (
            "descritiva, e a forma é o achado: 1.004 fontes em zero, um vale de 37 fontes na "
            "faixa do meio, e um pico de 48 em exatamente 100%. Processo contínuo não produz "
            "pico no extremo. Para o experimento é ruído de amostragem — essas fontes ficam sem "
            "medida de completude, e são as mesmas 48 com fields_mean nulo. Para a operação é "
            "outra coisa: a primeira página do ListRecords delas não traz documento nenhum, em "
            "fontes com acervo de 101 a 1.124 registros."
        ),
        "veredito": "supported",
        "verdict_label": "confirmada",
    }


def h13(c) -> dict:
    r = c.execute("""SELECT count(*), count(*) FILTER (g = 1), avg(g), count(*) FILTER (g >= 3)
        FROM (SELECT source_id, count(DISTINCT value) g FROM record_values
              WHERE field = 'language' GROUP BY 1)""").fetchone()
    grafias = dict(c.execute("""SELECT value, count(*) FROM record_values WHERE field = 'language'
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 6""").fetchall())
    return {
        **BASE_AMOSTRA,
        "id": "H13",
        "statement": "A grafia do idioma é configuração da fonte, constante dentro dela",
        "unidade": "fonte",
        "variavel_dependente": "número de grafias distintas de dc:language na amostra",
        "variavel_independente": "nenhuma — é a constância interna que está em teste",
        "confundidores": ["tamanho da amostra: fonte com mais registros tem mais chance de mostrar variação"],
        "inclusao": "fontes com ao menos um dc:language",
        "exclusao": "nenhuma",
        "estatistica": {**_proporcao(r[1], r[0]),
                        "teste": "proporção de fontes com uma grafia só, IC por bootstrap"},
        "ic95": _proporcao(r[1], r[0])["ic95"],
        "medianas": {"grafias por fonte (média)": round(float(r[2]), 2)},
        "distribuicao": {"uma grafia só": r[1], "três ou mais": r[3], "fontes": r[0],
                         **{f"valor {k}": v for k, v in list(grafias.items())[:4]}},
        "sensibilidade": [],
        "identificacao": (
            "**refutada**, e a refutação muda o que fazer. A hipótese era que cada fonte escolhe "
            "uma grafia e a repete, o que tornaria a padronização uma correção por fonte. Não é: "
            "só 43,6% usam uma grafia só, a média é 2,07 e **449 fontes usam três ou mais**. A "
            "variação está dentro da fonte, registro a registro — provavelmente escolha de quem "
            "depositou cada artigo. Padronizar exige regra de normalização no agregador, não "
            "conserto na origem."
        ),
        "veredito": "refuted",
        "verdict_label": "refutada",
    }


def h14(c) -> dict:
    r = c.execute("""SELECT count(*) FROM (SELECT value FROM record_values WHERE field = 'identifier'
        GROUP BY 1 HAVING count(DISTINCT source_id) > 1)""").fetchone()[0]
    n = c.execute("SELECT count(*) FROM record_values WHERE field = 'identifier'").fetchone()[0]
    fontes = c.execute("SELECT count(DISTINCT source_id) FROM records").fetchone()[0]
    return {
        **BASE_AMOSTRA,
        "id": "H14",
        "statement": "Existe duplicação de registro entre fontes distintas",
        "unidade": "valor de dc:identifier",
        "variavel_dependente": "o identificador aparece em mais de uma fonte",
        "variavel_independente": "nenhuma",
        "confundidores": ["a amostra é de uma página por fonte: dois acervos podem se sobrepor fora dela"],
        "inclusao": f"os {n:,} valores de dc:identifier de {fontes} fontes".replace(",", "."),
        "exclusao": "registros excluídos",
        "estatistica": {
            "teste": "contagem exata de identificadores compartilhados",
            "n": n,
            "efeito_nome": "identificadores em mais de uma fonte",
            "efeito": r,
        },
        "ic95": None,
        "distribuicao": {"compartilhados": r, "valores examinados": n, "fontes": fontes},
        "sensibilidade": [],
        "identificacao": (
            "**resultado nulo, e limpo**: zero. Combinado com a correção dos títulos genéricos — "
            "'Editorial' aparece em 578 revistas e não é duplicata —, isso fecha a dimensão "
            "duplicação: não há o mesmo documento entrando duas vezes por fontes diferentes. "
            "A ressalva é de alcance, não de método: a amostra é de uma página por fonte, então "
            "sobreposição fora dela não seria vista. O que se afirma é que ela não é comum."
        ),
        "veredito": "null_result",
        "verdict_label": "resultado nulo",
    }


def h15(c) -> dict:
    """O identificador OAI é globalmente único, como o protocolo exige?"""
    colisoes, pares = c.execute("""SELECT count(*), COALESCE(sum(f), 0) FROM (
        SELECT oai_identifier, count(DISTINCT source_id) f FROM records
        GROUP BY 1 HAVING count(DISTINCT source_id) > 1)""").fetchone()
    distintos, total = c.execute(
        "SELECT count(DISTINCT oai_identifier), count(*) FROM records").fetchone()
    pior = c.execute("""SELECT oai_identifier, count(DISTINCT source_id) FROM records
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1""").fetchone()
    plataformas = dict(c.execute("""SELECT r.platform_analysis_group, count(*) FROM records g
        JOIN repositories r USING (source_id) WHERE g.oai_identifier IN
        (SELECT oai_identifier FROM records GROUP BY 1 HAVING count(DISTINCT source_id) > 1)
        GROUP BY 1 ORDER BY 2 DESC, 1""").fetchall())
    dc = c.execute("""SELECT count(*) FROM (SELECT value FROM record_values
        WHERE field = 'identifier' GROUP BY 1 HAVING count(DISTINCT source_id) > 1)""").fetchone()[0]
    return {
        **BASE_AMOSTRA,
        "id": "H15",
        "statement": "O identificador OAI é globalmente único, como o protocolo exige",
        "unidade": "valor de oai_identifier",
        "variavel_dependente": "o identificador aparece em mais de uma fonte",
        "variavel_independente": "nenhuma — é a unicidade que está em teste",
        "confundidores": ["nenhum: unicidade é propriedade verificável, não estimada"],
        # Aqui entram também os excluídos: o cabeçalho deles traz identificador,
        # e é a unicidade do identificador que está em teste.
        "inclusao": f"os {total} cabeçalhos recebidos, vivos e excluídos",
        "exclusao": "nenhuma",
        "estatistica": {
            "teste": "contagem exata de identificadores compartilhados",
            "n": total,
            "efeito_nome": "identificadores em mais de uma fonte",
            "efeito": colisoes,
            "maior_colisao": pior[1],
        },
        "ic95": None,
        "distribuicao": {
            "identificadores colidindo": colisoes,
            "pares fonte-identificador afetados": int(pares),
            "distintos": distintos,
            "registros": total,
            **{f"colisões em {k}": v for k, v in plataformas.items()},
            "colisões de dc:identifier": dc,
        },
        "sensibilidade": [],
        "identificacao": (
            "**refutada, e é o achado mais sério da amostra.** O OAI-PMH exige identificador "
            "globalmente único — é a razão de existir do esquema oai:. Aqui 14.122 identificadores "
            "aparecem em mais de uma fonte, afetando 69.628 pares fonte-registro, e "
            "oai:ojs.pkp.sfu.ca:article/24 aparece em **60 periódicos diferentes**. A causa é "
            "visível no valor: são instalações de OJS que nunca trocaram o namespace padrão da "
            "PKP, e 68.399 das colisões estão em OJS. "
            "O que esta base **não** consegue dizer é se há perda: isso depende de o agregador "
            "chavear registro por identificador OAI, o que exigiria testar o Harvester. Se "
            "chavear, registros de revistas distintas se sobrescrevem. "
            "Contraste com H14: dc:identifier, que carrega a URL, tem zero colisões — o "
            "identificador que o protocolo exige que seja único é justamente o que não é."
        ),
        "veredito": "refuted",
        "verdict_label": "refutada",
    }


# ------------------------------------------------- H6, decomposta
#
# H6 afirma que há fontes persistentemente problemáticas, e o teste dela
# embaralha as falhas **dentro de cada fonte**. Esse nulo preserva quantas
# vezes cada fonte falhou e destrói só a ordem — ele responde "as falhas desta
# fonte se agrupam?" e **não** responde "a fonte é a causa?".
#
# A diferença importa porque a coleta acontece em lotes: se um lote inteiro
# falha, toda fonte nele acumula falhas sem ter defeito nenhum. H6.2 é o teste
# que separa as duas coisas, e é o que faltava em H6.

SUB_H6 = {
    **BASE,
    "populacao": "42.358 coletas de 2.183 fontes, de 2017-07-19 a 2026-09-20",
}


def _matriz(c):
    """Falhas com o índice de fonte e de dia, para permutar por grupo sem pandas."""
    linhas = c.execute(
        """SELECT source_id, start_time::DATE, is_failure::INT, ordem, duration_seconds,
                  size, valid_size
           FROM snapshots WHERE start_time IS NOT NULL
           ORDER BY source_id, start_time, ordem DESC"""
    ).fetchall()
    fonte = np.array([r[0] for r in linhas])
    dia = np.array([str(r[1]) for r in linhas])
    falha = np.array([r[2] for r in linhas], dtype=np.int8)
    return fonte, dia, falha


def _grupos(chaves: np.ndarray) -> list[np.ndarray]:
    """Índices de cada grupo, uma vez só — permutar em laço é o custo real."""
    ordem = np.argsort(chaves, kind="stable")
    cortes = np.flatnonzero(chaves[ordem][1:] != chaves[ordem][:-1]) + 1
    return np.split(ordem, cortes)


def _dispersao(valores: np.ndarray, grupos: list[np.ndarray]) -> float:
    """Variância das taxas de falha entre grupos."""
    return float(np.var([valores[g].mean() for g in grupos], ddof=1))


def _permutar(valores: np.ndarray, grupos: list[np.ndarray], rng) -> np.ndarray:
    saida = valores.copy()
    for g in grupos:
        saida[g] = rng.permutation(valores[g])
    return saida


def h6_2(c) -> dict:
    """A fonte importa além do lote, e o lote além da fonte?

    Dois nulos, cada um destruindo uma das duas estruturas:

    - embaralhar **dentro do dia** preserva a taxa de falha de cada lote e
      apaga a identidade da fonte. Se a dispersão entre fontes sobreviver, a
      fonte importa por si.
    - embaralhar **dentro da fonte** preserva a taxa de cada fonte e apaga o
      lote. É o nulo de H6, aqui aplicado à dispersão entre dias.
    """
    fonte, dia, falha = _matriz(c)
    g_fonte, g_dia = _grupos(fonte), _grupos(dia)
    rng = np.random.default_rng(SEMENTE)
    n = 300  # 42 mil linhas por permutação; 300 já estabiliza o z

    obs_f, obs_d = _dispersao(falha, g_fonte), _dispersao(falha, g_dia)
    nulo_f = np.array([_dispersao(_permutar(falha, g_dia, rng), g_fonte) for _ in range(n)])
    nulo_d = np.array([_dispersao(_permutar(falha, g_fonte, rng), g_dia) for _ in range(n)])

    z_f = (obs_f - nulo_f.mean()) / nulo_f.std(ddof=1)
    z_d = (obs_d - nulo_d.mean()) / nulo_d.std(ddof=1)

    piores = c.execute(
        """SELECT strftime(start_time, '%Y-%m-%d'), count(*), round(avg(is_failure::INT), 3)
           FROM snapshots WHERE start_time IS NOT NULL GROUP BY 1
           HAVING count(*) >= 300 ORDER BY 3 DESC, 2 DESC, 1 LIMIT 3"""
    ).fetchall()
    melhores = c.execute(
        """SELECT strftime(start_time, '%Y-%m-%d'), count(*), round(avg(is_failure::INT), 3)
           FROM snapshots WHERE start_time IS NOT NULL GROUP BY 1
           HAVING count(*) >= 300 ORDER BY 3 ASC, 2 DESC, 1 LIMIT 3"""
    ).fetchall()

    return {
        **SUB_H6,
        "id": "H6.2",
        "statement": "O agrupamento das falhas é da fonte, não apenas do lote",
        "unidade": "coleta",
        "variavel_dependente": "dispersão da taxa de falha entre fontes, e entre dias",
        "variavel_independente": "identidade da fonte · dia da coleta",
        "confundidores": ["as duas estruturas se sobrepõem: lote grande cobre muitas fontes de uma vez"],
        "inclusao": "coletas com data registrada",
        "exclusao": "nenhuma",
        "estatistica": {
            "teste": f"permutação cruzada, {n} reamostragens por nulo",
            "n": int(len(falha)),
            "efeito_nome": "razão observado / nulo (dispersão entre fontes)",
            "efeito": round(float(obs_f / nulo_f.mean()), 3),
            "z": round(float(z_f), 1),
            "p": float((np.sum(nulo_f >= obs_f) + 1) / (n + 1)),
        },
        "ic95": None,
        "contraste": {
            "par": "fonte além do lote · lote além da fonte",
            "mediana_a": round(float(obs_f / nulo_f.mean()), 3),
            "mediana_b": round(float(obs_d / nulo_d.mean()), 3),
            "efeito_nome": "z de cada um",
            "efeito": round(float(z_f), 1),
            "ic95": [round(float(z_f), 1), round(float(z_d), 1)],
        },
        "distribuicao": {
            **{f"pior lote {d}": f"{n_} coletas, taxa {t}" for d, n_, t in piores},
            **{f"melhor lote {d}": f"{n_} coletas, taxa {t}" for d, n_, t in melhores},
        },
        "sensibilidade": [],
        "identificacao": (
            "as duas estruturas são reais, e essa é a correção que H6 precisava. Embaralhando "
            "dentro do dia — o que preserva a taxa de cada lote e apaga a fonte — a dispersão "
            f"entre fontes ainda fica {round(float(obs_f / nulo_f.mean()), 2)}× acima do nulo, "
            f"z = {round(float(z_f), 1)}: a fonte importa por si. Mas o inverso também vale, e com "
            f"força comparável: embaralhando dentro da fonte, a dispersão entre dias fica "
            f"{round(float(obs_d / nulo_d.mean()), 2)}× acima, z = {round(float(z_d), 1)}. "
            "Há lotes de mais de 300 coletas com taxa de falha zero e lotes do mesmo tamanho "
            "acima de 60%. **H6 sozinha atribuía à fonte o que em boa parte é do lote.**"
        ),
        "veredito": "supported_confounded",
        "verdict_label": "as duas coisas, não uma",
    }


def h6_3(c) -> dict:
    """Há sinal antes da primeira falha de uma sequência?

    A comparação é **pareada dentro da fonte**: cada coleta da janela contra a
    mediana da própria fonte antes dela. A versão não pareada que tentei
    primeiro comparava medianas de populações diferentes e dava o sinal
    invertido — fontes que falham cedo têm duração menor por serem menores,
    não por estarem degradando.
    """
    janela = c.execute(
        """WITH s AS (
             SELECT source_id, start_time, is_failure, duration_seconds, size,
                    row_number() OVER (PARTITION BY source_id ORDER BY start_time, ordem DESC) i
             FROM snapshots WHERE start_time IS NOT NULL),
           p AS (SELECT source_id, min(i) i0 FROM s WHERE is_failure
                 GROUP BY 1 HAVING min(i) >= 4),
           base AS (SELECT s.source_id, median(s.duration_seconds) d0, median(s.size) t0
                    FROM s JOIN p USING (source_id)
                    WHERE s.i < p.i0 - 3 AND NOT s.is_failure GROUP BY 1)
           SELECT s.i - p.i0 AS rel, count(*),
                  round(median(s.duration_seconds / nullif(b.d0, 0)), 3),
                  round(median(s.size / nullif(b.t0, 0)), 3)
           FROM s JOIN p USING (source_id) JOIN base b ON b.source_id = s.source_id
           WHERE s.i BETWEEN p.i0 - 3 AND p.i0 - 1 GROUP BY 1 ORDER BY 1"""
    ).fetchall()

    razoes = np.array(
        [
            x[0]
            for x in c.execute(
                """WITH s AS (
                     SELECT source_id, start_time, is_failure, duration_seconds,
                            row_number() OVER (PARTITION BY source_id ORDER BY start_time, ordem DESC) i
                     FROM snapshots WHERE start_time IS NOT NULL),
                   p AS (SELECT source_id, min(i) i0 FROM s WHERE is_failure
                         GROUP BY 1 HAVING min(i) >= 4),
                   base AS (SELECT s.source_id, median(s.duration_seconds) d0
                            FROM s JOIN p USING (source_id)
                            WHERE s.i < p.i0 - 3 AND NOT s.is_failure GROUP BY 1)
                   SELECT s.duration_seconds / nullif(b.d0, 0) FROM s JOIN p USING (source_id)
                   JOIN base b ON b.source_id = s.source_id
                   WHERE s.i = p.i0 - 1 AND b.d0 > 0
                   ORDER BY s.source_id"""
            ).fetchall()
            if x[0] is not None
        ],
        dtype=float,
    )
    razoes = razoes[np.isfinite(razoes)]
    _, pw = stats.wilcoxon(razoes - 1)
    mediana = float(np.median(razoes))
    contra = float((razoes < 1).mean())

    return {
        **SUB_H6,
        "id": "H6.3",
        "statement": "Há sinal observável antes do início de uma sequência de falhas",
        "unidade": "coleta anterior à primeira falha, pareada com a própria fonte",
        "variavel_dependente": "duração e volume relativos à mediana da fonte",
        "variavel_independente": "distância até a primeira falha (-3, -2, -1)",
        "confundidores": [
            "lotes manuais: a coleta anterior pode ter sido meses antes, em outro contexto",
            "porte da fonte, neutralizado pelo pareamento",
        ],
        "inclusao": "fontes cuja primeira falha ocorre a partir da 4ª coleta, para haver janela",
        "exclusao": "fontes que nunca falharam ou que falham desde o início",
        "estatistica": {
            "teste": "Wilcoxon pareado sobre a razão duração ÷ mediana da fonte",
            "n": int(len(razoes)),
            "efeito_nome": "razão de duração na coleta imediatamente anterior",
            "efeito": round(mediana, 3),
            "p": float(pw),
        },
        "ic95": ic_bootstrap(lambda v: float(np.median(v)), razoes),
        "medianas": {f"{r[0]} coleta(s) antes · duração": r[2] for r in janela}
        | {f"{r[0]} coleta(s) antes · volume": r[3] for r in janela},
        "distribuicao": {f"observações em {r[0]}": r[1] for r in janela},
        "sensibilidade": [],
        "identificacao": (
            f"há sinal, e ele é inútil. A coleta imediatamente anterior à primeira falha dura "
            f"{round((mediana - 1) * 100, 1)}% a mais que a mediana da própria fonte, com "
            f"p = {pw:.0e} — detectável porque n é grande, não porque o efeito seja grande. "
            f"E **{round(contra * 100, 1)}% dos casos vão na direção oposta**: como preditor, "
            "isso é pouco melhor que cara ou coroa. O volume também sobe de leve (1,08), o que "
            "não é degradação. "
            "Vale como exemplo do que a ficha inteira existe para separar: significância "
            "estatística e utilidade prática são coisas diferentes. Um preditor de verdade "
            "exigiria série regular, que o agendamento dormente impede."
        ),
        "veredito": "supported_small",
        "verdict_label": "sinal real, sem valor preditivo",
    }


def h6_4(c) -> dict:
    """Depois da falha, quanto custa voltar?"""
    r = c.execute(
        """WITH s AS (
             SELECT source_id, start_time, is_failure,
                    row_number() OVER (PARTITION BY source_id ORDER BY start_time, ordem DESC) i
             FROM snapshots WHERE start_time IS NOT NULL),
           falhas AS (SELECT source_id, i, start_time FROM s WHERE is_failure),
           volta AS (
             SELECT f.source_id, f.i, f.start_time,
                    min(s.i) i_ok, min(s.start_time) t_ok
             FROM falhas f LEFT JOIN s ON s.source_id = f.source_id
                                      AND s.i > f.i AND NOT s.is_failure
             GROUP BY 1, 2, 3)
           SELECT count(*), count(*) FILTER (i_ok IS NULL),
                  median(i_ok - i), median(date_diff('day', start_time, t_ok)),
                  quantile_cont(date_diff('day', start_time, t_ok), 0.75)
           FROM volta"""
    ).fetchone()
    nunca = c.execute(
        """SELECT count(*) FROM harvest_metrics WHERE current_failure_streak > 0"""
    ).fetchone()[0]
    return {
        **SUB_H6,
        "id": "H6.4",
        "statement": "Fontes que falham voltam, e o custo da volta é mensurável",
        "unidade": "episódio de falha",
        "variavel_dependente": "coletas e dias até a próxima coleta bem-sucedida",
        "variavel_independente": "nenhuma — é a distribuição do tempo de volta",
        "confundidores": [
            "o relógio é de lote, não de calendário: 'dias até voltar' mede quando o operador "
            "coletou de novo, não quando a fonte se consertou"
        ],
        "inclusao": "toda coleta com desfecho de erro",
        "exclusao": "nenhuma",
        "estatistica": {
            "teste": "distribuição do intervalo até a próxima coleta bem-sucedida",
            "n": r[0],
            "efeito_nome": "coletas até voltar (mediana)",
            "efeito": float(r[2]) if r[2] is not None else None,
        },
        "ic95": None,
        "medianas": {
            "coletas até voltar": float(r[2]) if r[2] is not None else None,
            "dias até voltar": float(r[3]) if r[3] is not None else None,
            "dias até voltar (p75)": round(float(r[4]), 1) if r[4] is not None else None,
        },
        "distribuicao": {
            "episódios de falha": r[0],
            "sem volta até o fim da série": r[1],
            "fontes falhando agora": nunca,
        },
        "sensibilidade": [],
        "identificacao": (
            "descritiva, com uma ressalva que muda a leitura. A maioria dos episódios termina: a "
            "falha é evento, não estado. Mas **'dias até voltar' não mede a fonte se consertando** "
            "— mede quando o operador a coletou de novo, e com lotes manuais separados por meses "
            "esse número é do calendário de operação, não da recuperação técnica. A medida em "
            "número de coletas é a menos contaminada das duas."
        ),
        "veredito": "supported",
        "verdict_label": "confirmada, com ressalva de relógio",
    }


def main() -> int:
    c = conectar()
    fichas = [f(c) for f in (h1, h2, h3, h4, h5, h6, h7, h8, h9, h10, h11, h12, h13, h14, h15,
                            h6_2, h6_3, h6_4)]
    def chave(f):
        partes = f["id"].removeprefix("H").split(".")
        return (int(partes[0]), int(partes[1]) if len(partes) > 1 else 0)

    fichas.sort(key=chave)
    SAIDA.write_text(json.dumps(fichas, ensure_ascii=False, indent=2) + "\n")

    protocolo = SAIDA.parent / "protocol.json"
    protocolo.write_text(
        json.dumps(
            {
                "checklist": CHECKLIST,
                "criterios": TRES_CRITERIOS,
                "semente": SEMENTE,
                "reamostragens": REAMOSTRAS,
                "permutacoes": PERMUTACOES,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )

    for f in fichas:
        e = f["estatistica"]
        efeito = e.get("efeito")
        print(f"\n{f['id']}  {f['verdict_label']}")
        print(f"   {f['statement']}")
        if efeito is not None:
            ic = f.get("ic95") or ["—", "—"]
            print(f"   {e.get('efeito_nome')} = {efeito}  IC95 [{ic[0]}, {ic[1]}]  p = {e.get('p'):.2e}"
                  if isinstance(e.get("p"), float) else f"   efeito = {efeito}")
        if f["sensibilidade"]:
            for s in f["sensibilidade"]:
                print(f"     · {s['recorte']:<28} n={s['n']:<5} efeito={s['efeito']:<8} p={s['p']:.1e}")
    atendidos = sum(1 for i in CHECKLIST if i["situacao"] == "atendido")
    print(f"\n{SAIDA.relative_to(PASTA)}: {len(fichas)} fichas")
    print(f"protocol.json: {atendidos}/{len(CHECKLIST)} itens atendidos")
    for i in CHECKLIST:
        if i["situacao"] != "atendido":
            print(f"  [{i['situacao']:>7}] {i['item']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
