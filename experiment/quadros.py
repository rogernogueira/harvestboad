#!/usr/bin/env python
"""Os resultados do experimento em DataFrames do pandas.

`analise.py` responde as perguntas que já sabemos fazer, e imprime. Este aqui
não imprime conclusão nenhuma: entrega os dados numa forma em que **qualquer**
pergunta é uma linha de código. É para quando a próxima pergunta ainda não
existe — cruzar plataforma com regra, olhar só um domínio, plotar, exportar.

Serve como módulo e como script:

    # exploração, de dentro de `backend/`
    uv run --with pandas --with ipython ipython
    >>> import sys; sys.path.insert(0, "../experiment")
    >>> from quadros import carregar, taxa_por
    >>> reg, rep = carregar("../experiment/data/resultados-indexed.json")
    >>> taxa_por(reg, "plataforma", "nova_regra")
    >>> reg.query("nova_engana")[["repo", "nova_fonte", "nova_link"]]

    # panorama pronto, sem abrir REPL
    uv run --with pandas python ../experiment/quadros.py
    uv run --with pandas python ../experiment/quadros.py --csv
    uv run --with pandas --with pyarrow python ../experiment/quadros.py --parquet

Pandas **não** é dependência do projeto, e não deve virar uma: ele existe para
explorar resultado de experimento, não para servir requisição. Por isso o
`uv run --with pandas`, que resolve na hora e não deixa rastro no `pyproject`.

Dois quadros, porque são duas unidades de observação:

- `registros` — uma linha por item medido, com os atributos do repositório
  repetidos ao lado. É o quadro de trabalho: quase toda pergunta é sobre
  registro, e cruzar com repositório é metade delas.
- `repositorios` — uma linha por repositório, inclusive os que não listaram
  nada. Só ele responde "quantas origens não atenderam", que no quadro de
  registros simplesmente não aparecem.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

import numpy as np
import pandas as pd

PASTA = Path(__file__).resolve().parent
DADOS = PASTA / "data"

# Ordem dos desfechos, do melhor para o pior. Vira `Categorical` ordenado: é o
# que faz `sort_values` e o eixo de um gráfico saírem na ordem que significa
# alguma coisa, em vez da alfabética, onde `bloqueado` viria antes de `ok`.
DESFECHOS = [
    "ok",
    "fora-da-rota",
    "http-4xx",
    "http-5xx",
    "bloqueado",
    "rede",
    "sem-link",
]

# Desfecho em que a tela ofereceu um botão e o botão não leva à página do item.
# `bloqueado` e `rede` ficam de fora: não são veredito sobre o endereço.
ENGANOSOS = ["fora-da-rota", "http-4xx", "http-5xx"]
INCONCLUSIVOS = ["bloqueado", "rede"]


def _host(url: object) -> str | None:
    if not isinstance(url, str) or not url:
        return None
    return urlsplit(url).netloc or None


def _lado(bloco: dict, prefixo: str) -> dict:
    """Achata um dos lados da comparação (`nova` ou `antiga`)."""
    fonte = bloco.get("source") or ""
    abertura = bloco.get("abertura") or {}
    return {
        f"{prefixo}_fonte": fonte or None,
        # `record:ojs` -> via `record`, regra `ojs`. A via diz de onde veio o
        # endereço; a regra, o que o reconheceu. As duas explicam coisas
        # diferentes, e separar aqui evita `str.split` em toda consulta.
        f"{prefixo}_via": fonte.split(":")[0] or None,
        f"{prefixo}_regra": fonte.split(":")[-1] or None,
        f"{prefixo}_link": bloco.get("link"),
        f"{prefixo}_host": _host(bloco.get("link")),
        f"{prefixo}_desfecho": abertura.get("desfecho"),
        f"{prefixo}_status": abertura.get("status"),
        f"{prefixo}_final": abertura.get("final"),
        f"{prefixo}_motivo": abertura.get("detalhe"),
    }


def _validacao(bloco: dict | None) -> dict:
    """Achata a conferência do título da página contra o do metadado."""
    bloco = bloco or {}
    return {
        "validacao": bloco.get("desfecho"),
        "validacao_semelhanca": bloco.get("semelhanca"),
        "titulo_na_pagina": bloco.get("tituloNaPagina"),
    }


def registros(caminho: str | Path) -> pd.DataFrame:
    """Uma linha por registro medido."""
    dados = json.loads(Path(caminho).read_text())
    linhas = []
    for repo in dados["repositorios"]:
        comum = {
            "repo_id": repo.get("id"),
            "repo": repo.get("nome") or repo["baseUrl"],
            "sigla": repo.get("sigla"),
            "instituicao": repo.get("instituicao"),
            "base_url": repo["baseUrl"],
            "base_host": _host(repo["baseUrl"]),
            "plataforma": repo.get("plataforma"),
            "coleta_em": repo.get("ultimaColetaEm"),
            "coleta_tamanho": repo.get("registrosNaUltimaColeta"),
            "estado_da_coleta": repo.get("estadoDaColeta"),
        }
        for registro in repo.get("registros", []):
            if "falha" in registro:
                continue
            linhas.append(
                {
                    **comum,
                    "identifier": registro["identifier"],
                    # Como este registro entrou na amostra: `primeiros` é o topo
                    # do acervo, que o OAI-PMH devolve por ordem de datestamp;
                    # `janela` é um recorte de data sorteado. Comparar os dois é
                    # o que mede o viés de amostragem, em vez de só evitá-lo.
                    "estrato": registro.get("estrato"),
                    "n_titulos": len(registro.get("titulos") or []),
                    "n_candidatas": len(registro.get("candidates") or []),
                    "candidatas": registro.get("candidates") or [],
                    **_validacao(registro.get("validacao")),
                    **_lado(registro["paginaDoItem"]["nova"], "nova"),
                    **_lado(registro["paginaDoItem"]["antiga"], "antiga"),
                    **_lado({**registro["oaiPmh"], "source": ""}, "oai"),
                }
            )

    quadro = pd.DataFrame(linhas)
    if quadro.empty:
        return quadro

    quadro["coleta_em"] = pd.to_datetime(quadro["coleta_em"], errors="coerce")
    for coluna in ("coleta_tamanho", "nova_status", "antiga_status", "oai_status"):
        quadro[coluna] = pd.to_numeric(quadro[coluna], errors="coerce").astype("Int64")

    tipo = pd.CategoricalDtype(DESFECHOS, ordered=True)
    for lado in ("nova", "antiga", "oai"):
        quadro[f"{lado}_desfecho"] = quadro[f"{lado}_desfecho"].astype(tipo)
        quadro[f"{lado}_ok"] = quadro[f"{lado}_desfecho"].eq("ok")
    for lado in ("nova", "antiga"):
        quadro[f"{lado}_engana"] = quadro[f"{lado}_desfecho"].isin(ENGANOSOS)
        quadro[f"{lado}_inconclusivo"] = quadro[f"{lado}_desfecho"].isin(INCONCLUSIVOS)

    quadro["ganho"] = quadro["nova_ok"] & ~quadro["antiga_ok"]
    quadro["perda"] = quadro["antiga_ok"] & ~quadro["nova_ok"]
    # `fillna("")` antes de comparar: em dtype objeto, ausente != ausente é
    # `True`, e sem isso os 69 registros que nenhuma das duas réguas resolveu
    # apareceriam como "trocou de endereço".
    quadro["trocou_endereco"] = quadro["nova_link"].fillna("").ne(
        quadro["antiga_link"].fillna("")
    )
    # O link saiu do domínio da origem? Não é defeito — DOI e hdl.handle.net
    # são resolvedores —, mas separa dois regimes de falha bem diferentes.
    quadro["saiu_do_dominio"] = (
        quadro["nova_host"].notna() & quadro["nova_host"].ne(quadro["base_host"])
    )

    quadro["validacao_semelhanca"] = pd.to_numeric(
        quadro["validacao_semelhanca"], errors="coerce"
    )
    for coluna in ("plataforma", "nova_via", "nova_regra", "antiga_regra", "estrato",
                   "validacao"):
        quadro[coluna] = quadro[coluna].astype("category")
    return quadro


def repositorios(caminho: str | Path) -> pd.DataFrame:
    """Uma linha por repositório, inclusive os que não listaram registro."""
    dados = json.loads(Path(caminho).read_text())
    linhas = []
    for repo in dados["repositorios"]:
        medidos = [r for r in repo.get("registros", []) if "falha" not in r]
        erro = repo.get("erro")
        linhas.append(
            {
                "repo_id": repo.get("id"),
                "repo": repo.get("nome") or repo["baseUrl"],
                "sigla": repo.get("sigla"),
                "instituicao": repo.get("instituicao"),
                "base_url": repo["baseUrl"],
                "base_host": _host(repo["baseUrl"]),
                "plataforma": repo.get("plataforma"),
                "coleta_em": repo.get("ultimaColetaEm"),
                "coleta_tamanho": repo.get("registrosNaUltimaColeta"),
                "estado_da_coleta": repo.get("estadoDaColeta"),
                "listou": erro is None,
                "erro": erro,
                "erro_classe": erro.split(":")[0] if erro else None,
                "n_registros": len(medidos),
            }
        )
    quadro = pd.DataFrame(linhas)
    if quadro.empty:
        return quadro
    quadro["coleta_em"] = pd.to_datetime(quadro["coleta_em"], errors="coerce")
    quadro["coleta_tamanho"] = pd.to_numeric(
        quadro["coleta_tamanho"], errors="coerce"
    ).astype("Int64")
    return quadro


def carregar(caminho: str | Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Os dois quadros de uma vez — o par que quase toda sessão quer."""
    return registros(caminho), repositorios(caminho)


def wilson(sucessos: pd.Series, total: pd.Series, z: float = 1.96):
    """Intervalo de confiança para uma proporção, vetorizado.

    Wilson e não o normal porque as fatias ficam pequenas — uma regra com 3
    itens, uma plataforma com 30. Ali o intervalo normal escapa de [0, 1] e
    finge precisão que a amostra não tem.
    """
    n = total.replace(0, np.nan)
    p = sucessos / n
    centro = (p + z * z / (2 * n)) / (1 + z * z / n)
    margem = (z / (1 + z * z / n)) * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (centro - margem).clip(0, 1), (centro + margem).clip(0, 1)


SEM_LINK = "(sem link)"


def _rotular(quadro: pd.DataFrame, colunas: list[str]) -> pd.DataFrame:
    """Troca ausência por rótulo antes de agrupar.

    `groupby` descarta grupo nulo por padrão, e aqui o nulo **é** um resultado:
    "a resolução não produziu endereço" é o segundo desfecho mais comum. Deixar
    o padrão faz as fatias somarem menos que o total sem avisar — numa primeira
    versão deste arquivo, 509 de 595.
    """
    copia = quadro.copy()
    for coluna in colunas:
        serie = copia[coluna]
        if isinstance(serie.dtype, pd.CategoricalDtype):
            serie = serie.astype(object)
        copia[coluna] = serie.fillna(SEM_LINK)
    return copia


def taxa_por(
    quadro: pd.DataFrame,
    *colunas: str,
    minimo: int = 1,
    conglomerado: bool = True,
) -> pd.DataFrame:
    """Taxa de acerto das duas réguas por um ou mais recortes.

    É a operação que se repete em toda pergunta deste experimento — "abre mais,
    onde?" —, então vale uma função em vez de um `groupby` reescrito a cada vez.
    `minimo` corta as fatias pequenas demais para dizer o que quer que seja.
    """
    chaves = list(colunas)
    agrupado = _rotular(quadro, chaves).groupby(chaves, observed=True)
    saida = agrupado.agg(
        itens=("nova_ok", "size"),
        antiga_ok=("antiga_ok", "sum"),
        nova_ok=("nova_ok", "sum"),
        antiga_engana=("antiga_engana", "sum"),
        nova_engana=("nova_engana", "sum"),
    )
    saida = saida[saida["itens"] >= minimo]
    saida["antiga_taxa"] = saida["antiga_ok"] / saida["itens"]
    saida["nova_taxa"] = saida["nova_ok"] / saida["itens"]
    saida["delta"] = saida["nova_taxa"] - saida["antiga_taxa"]
    if conglomerado:
        # O intervalo sai do n efetivo de **cada** fatia: o efeito de
        # conglomerado não é o mesmo em todas, porque o número de registros por
        # repositório varia entre elas.
        efeitos, rotulado = {}, _rotular(quadro, chaves)
        for nome, grupo in rotulado.groupby(chaves, observed=True):
            # Com uma chave só, o índice do resultado é escalar, mas o
            # `groupby` entrega tupla de um elemento. Sem desembrulhar, a busca
            # falha em silêncio e todo `deff` volta 1,0 — que é justamente o
            # valor que a correção existe para não usar.
            chave = nome[0] if isinstance(nome, tuple) and len(chaves) == 1 else nome
            efeitos[chave] = deff(grupo)[0]
        saida["deff"] = [efeitos.get(i, 1.0) for i in saida.index]
        saida["n_efetivo"] = saida["itens"] / saida["deff"]
        saida["ic_baixo"], saida["ic_alto"] = wilson(
            saida["nova_ok"] / saida["deff"], saida["n_efetivo"]
        )
    else:
        saida["ic_baixo"], saida["ic_alto"] = wilson(saida["nova_ok"], saida["itens"])
    return saida.sort_values("itens", ascending=False)


# ------------------------------------------- amostra por conglomerado e estrato


# --------------------------------------------------- o quadro amostral e suas evidências


# Motivos de uma origem não ter tipo, agrupados pelo que significam para a
# amostragem. A distinção importa: `servidor-vivo` é repositório que existe e
# recusa **este** cliente, e excluí-lo da amostra é diferente de excluir um que
# não existe mais.
CLASSES_DE_FALHA = {
    "rede": "inalcancavel",
    "http-403": "servidor-vivo",
    "http-401": "servidor-vivo",
    "http-429": "servidor-vivo",
    "xml-invalido": "servidor-vivo",
    "http-500": "servidor-vivo",
    "http-502": "servidor-vivo",
    "http-503": "servidor-vivo",
    "http-404": "cadastro-errado",
    "oai-error": "protocolo-recusa",
}

# Tipos que **não** são tipo: são a classificação não tendo conseguido decidir.
SEM_TIPO = (
    "origem-muda",
    "indeterminado",
    "erro-harvester",
    "nao-apurado",
    "sem-origem",
    "sem-coleta",
    "coleta-vazia",
    "registro-sem-origem",
)


def quadro(
    caminho: str | Path | None = None, verificacao: str | Path | None = None
) -> pd.DataFrame:
    """O quadro amostral com a evidência de cada decisão de classificação.

    Uma linha por repositório da população, e não da amostra — é ele que diz o
    que se pode estratificar e o que ficou de fora. Junta duas apurações:

    - `classificar_quadro.py`, que perguntou o tipo ao `Identify` de cada
      origem e guardou **por qual sinal** decidiu (`toolkit`, `sampleIdentifier`
      ou `repositoryName`);
    - `verificar_mudas.py`, que voltou às origens sem tipo, com prazo folgado e
      pouca concorrência, para separar falha transitória nossa de origem
      realmente fora do ar.

    A segunda existe porque a primeira passagem, feita sob concorrência,
    rotulou como característica do repositório o que era pressa nossa: 91 de
    106 `sem-origem` tinham origem perfeita quando perguntados de novo.
    """
    caminho = Path(caminho or DADOS / "quadro-amostral.json")
    dados = json.loads(caminho.read_text())
    linhas = pd.DataFrame(dados["repositorios"])

    if linhas.empty:
        return linhas

    caminho_v = Path(verificacao or DADOS / "verificacao-mudas.json")
    if caminho_v.is_file():
        checagem = pd.DataFrame(json.loads(caminho_v.read_text())["origens"])
        colunas = [
            "id",
            "identify",
            "identifyDetalhe",
            "listIdentifiers",
            "listIdentifiersDetalhe",
            "veredito",
        ]
        linhas = linhas.merge(checagem[colunas], on="id", how="left")
    else:
        for coluna in ("identify", "listIdentifiers", "veredito"):
            linhas[coluna] = None

    linhas["classificado"] = ~linhas["tipo"].isin(SEM_TIPO)
    linhas["tem_base_url"] = linhas["baseUrl"].notna() & linhas["baseUrl"].ne("")
    # `amostravel` é a condição para entrar num sorteio estratificado: ter
    # endereço **e** ter estrato. Faltando qualquer um, o repositório é
    # não-resposta do quadro, e isso precisa ser declarado, não silenciado.
    linhas["amostravel"] = linhas["classificado"] & linhas["tem_base_url"]
    linhas["classe_de_falha"] = (
        linhas["identify"].map(CLASSES_DE_FALHA).where(~linhas["classificado"])
    )
    linhas["responde_algum_verbo"] = linhas["veredito"].isin(
        ["responde-aos-dois", "so-Identify", "so-ListIdentifiers"]
    )

    linhas["ultimaColetaEm"] = pd.to_datetime(
        linhas.get("ultimaColetaEm"), errors="coerce"
    )
    linhas["registrosNaUltimaColeta"] = pd.to_numeric(
        linhas.get("registrosNaUltimaColeta"), errors="coerce"
    ).astype("Int64")
    for coluna in ("tipo", "natureza", "evidencia", "veredito", "classe_de_falha"):
        if coluna in linhas:
            linhas[coluna] = linhas[coluna].astype("category")
    return linhas


def evidencias(quadro_amostral: pd.DataFrame) -> pd.DataFrame:
    """Resumo por tipo: quantos, por qual sinal foram decididos, que tamanho têm.

    Serve para responder de uma vez "dá para estratificar por isso?" — um
    estrato de 2 unidades não é estrato, e a coluna de evidência diz se o
    rótulo veio do software se declarando ou de um palpite sobre a forma do
    identificador.
    """
    tabela = quadro_amostral.pivot_table(
        index="tipo",
        columns="evidencia",
        values="id",
        aggfunc="count",
        observed=True,
        fill_value=0,
    )
    tabela["total"] = tabela.sum(axis=1)
    resumo = quadro_amostral.groupby("tipo", observed=True).agg(
        com_base_url=("tem_base_url", "sum"),
        amostravel=("amostravel", "sum"),
        mediana_registros=("registrosNaUltimaColeta", "median"),
    )
    return tabela.join(resumo).sort_values("total", ascending=False)


def icc_binaria(
    quadro: pd.DataFrame, valor: str = "nova_ok", cluster: str = "base_url"
) -> float:
    """Correlação intraclasse de um desfecho binário, pelo estimador de ANOVA.

    Mede quanto dois registros do mesmo repositório se parecem. Aqui ela é
    alta — na corrida de 20/09/2026 deu 0,78 e 0,72 nos dois estratos —, e isso
    tem consequência prática: se um registro do repositório abre, o outro quase
    certamente abre, então o segundo registro traz pouca informação nova.

    É por causa dela que os intervalos calculados como se os registros fossem
    independentes ficam **estreitos demais**.
    """
    grupos = quadro.groupby(cluster, observed=True)[valor].agg(["size", "sum"])
    grupos = grupos[grupos["size"] > 1]
    if len(grupos) < 2:
        return 0.0

    n_i = grupos["size"].to_numpy(dtype=float)
    y_i = grupos["sum"].to_numpy(dtype=float)
    k, n = len(n_i), n_i.sum()
    p = y_i.sum() / n

    # Soma de quadrados entre e dentro dos conglomerados.
    sqe = float(((y_i / n_i - p) ** 2 * n_i).sum())
    sqd = float((y_i * (1 - y_i / n_i)).sum())
    gle, gld = k - 1, n - k
    if gle <= 0 or gld <= 0:
        return 0.0

    mqe, mqd = sqe / gle, sqd / gld
    # Tamanho médio corrigido: com conglomerados desiguais, a média simples
    # enviesa o estimador.
    n0 = (n - (n_i**2).sum() / n) / (k - 1)
    if mqe + (n0 - 1) * mqd == 0:
        return 0.0
    return float(max(0.0, min(1.0, (mqe - mqd) / (mqe + (n0 - 1) * mqd))))


def deff(
    quadro: pd.DataFrame, valor: str = "nova_ok", cluster: str = "base_url"
) -> tuple[float, float, float]:
    """`(deff, ICC, tamanho médio do conglomerado)`.

    O *design effect* diz por quanto a variância real é maior que a de uma
    amostra aleatória simples do mesmo tamanho. Dividir o n por ele dá o
    **n efetivo**: quantos registros independentes esta amostra realmente vale.
    """
    coeficiente = icc_binaria(quadro, valor, cluster)
    m = quadro.groupby(cluster, observed=True).size().mean()
    return 1 + (m - 1) * coeficiente, coeficiente, float(m)


def wilson_conglomerado(
    sucessos: pd.Series, total: pd.Series, efeito: float, z: float = 1.96
):
    """Wilson sobre o n **efetivo**, e não sobre o n bruto.

    A proporção continua sendo a observada; o que muda é a incerteza em torno
    dela, que passa a refletir o fato de os registros virem em conglomerados.
    """
    return wilson(sucessos / max(efeito, 1.0), total / max(efeito, 1.0), z)


def taxa_estratificada(
    quadro: pd.DataFrame,
    estrato: str,
    pesos: dict[str, float],
    valor: str = "nova_ok",
    cluster: str = "base_url",
) -> dict:
    """Estimativa para a população inteira, a partir de estratos desiguais.

    Quando os estratos são amostrados em proporções diferentes da população —
    que é o ponto de amostrar por tipo de repositório —, a média simples da
    amostra **não** estima a média da população. Cada estrato entra com o peso
    que tem lá fora.

    `pesos` é `{estrato: fração da população}`. O que não estiver no dicionário
    fica de fora do cálculo, e o resultado diz quanto da população foi coberto.
    """
    linhas = []
    for nome, grupo in quadro.groupby(estrato, observed=True):
        if nome not in pesos:
            continue
        efeito, _, _ = deff(grupo, valor, cluster)
        n = len(grupo)
        p = float(grupo[valor].mean())
        n_ef = n / max(efeito, 1.0)
        linhas.append(
            {
                "estrato": nome,
                "n": n,
                "n_efetivo": n_ef,
                "p": p,
                "peso": pesos[nome],
                "variancia": p * (1 - p) / n_ef if n_ef > 0 else 0.0,
            }
        )

    if not linhas:
        return {}

    cobertura = sum(linha["peso"] for linha in linhas)
    # Renormaliza: se os pesos não somam 1 (estrato sem amostra), a estimativa
    # vale para a parte coberta, e o número é declarado junto.
    ponto = sum(linha["peso"] * linha["p"] for linha in linhas) / cobertura
    variancia = sum(
        (linha["peso"] / cobertura) ** 2 * linha["variancia"] for linha in linhas
    )
    erro = variancia**0.5
    return {
        "estimativa": ponto,
        "erro_padrao": erro,
        "ic_baixo": max(0.0, ponto - 1.96 * erro),
        "ic_alto": min(1.0, ponto + 1.96 * erro),
        "cobertura_dos_pesos": cobertura,
        "estratos": pd.DataFrame(linhas).set_index("estrato"),
    }


def migracao(quadro: pd.DataFrame) -> pd.DataFrame:
    """Matriz antiga × nova. A diagonal é o que não mudou; os cantos informam."""
    return pd.crosstab(
        quadro["antiga_desfecho"], quadro["nova_desfecho"], dropna=False
    )


def trocas(quadro: pd.DataFrame) -> pd.DataFrame:
    """Quantas vezes cada par (regra antiga -> regra nova) trocou de endereço."""
    chaves = ["antiga_regra", "nova_regra"]
    mudou = _rotular(quadro[quadro["trocou_endereco"]], chaves)
    return (
        mudou.groupby(chaves, observed=True)
        .agg(n=("nova_ok", "size"), abre=("nova_ok", "sum"))
        .sort_values("n", ascending=False)
    )


def _panorama(reg: pd.DataFrame, rep: pd.DataFrame) -> None:
    pd.set_option("display.width", 120, "display.max_columns", 40)
    pd.set_option("display.float_format", lambda v: f"{v:,.3f}")

    print(f"\n# quadros\nregistros {reg.shape}   repositorios {rep.shape}")
    print(f"\n# repositórios que não listaram\n{rep['erro_classe'].value_counts()}")
    print(f"\n# desfecho da página do item\n{reg[['antiga_desfecho', 'nova_desfecho']].apply(pd.Series.value_counts)}")
    print(f"\n# taxa por plataforma\n{taxa_por(reg, 'plataforma')[['itens', 'antiga_taxa', 'nova_taxa', 'delta', 'nova_engana']]}")
    print(f"\n# taxa por fonte do endereço\n{taxa_por(reg, 'nova_fonte')[['itens', 'nova_taxa', 'ic_baixo', 'ic_alto']]}")
    print(f"\n# migração antiga x nova\n{migracao(reg)}")
    print(f"\n# trocas de endereço\n{trocas(reg).head(10)}")
    print(f"\n# ganhos: {int(reg['ganho'].sum())}   perdas: {int(reg['perda'].sum())}")
    print(f"# enganosos: {int(reg['antiga_engana'].sum())} -> {int(reg['nova_engana'].sum())}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arquivo", type=Path, default=DADOS / "resultados-indexed.json")
    parser.add_argument("--parquet", action="store_true", help="grava os dois quadros")
    parser.add_argument("--csv", action="store_true", help="idem, em CSV")
    parser.add_argument("--quieto", action="store_true", help="só grava, não imprime")
    args = parser.parse_args()

    reg, rep = carregar(args.arquivo)
    if reg.empty:
        print("nenhum registro medido no arquivo")
        return 1

    raiz = args.arquivo.with_suffix("")
    if args.parquet:
        for nome, quadro in (("registros", reg), ("repositorios", rep)):
            # `candidatas` é lista: o parquet aguenta, o CSV não — lá ela vira
            # texto e deixa de ser lista, então some.
            destino = Path(f"{raiz}-{nome}.parquet")
            try:
                quadro.to_parquet(destino, index=False)
            except ImportError:
                # O pandas só diz "nenhuma engine utilizável", e quem chamou não
                # tem como adivinhar que a resposta é outro `--with`.
                print(
                    "parquet precisa do pyarrow; repita com "
                    "`uv run --with pandas --with pyarrow`",
                )
                return 1
            print(f"{destino}  {quadro.shape}")
    if args.csv:
        for nome, quadro in (("registros", reg), ("repositorios", rep)):
            destino = Path(f"{raiz}-{nome}.csv")
            quadro.drop(columns=["candidatas"], errors="ignore").to_csv(
                destino, index=False
            )
            print(f"{destino}  {quadro.shape}")

    if not args.quieto:
        _panorama(reg, rep)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
