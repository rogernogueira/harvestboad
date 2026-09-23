#!/usr/bin/env python
"""Mede se os pesos das sondas acertam, e diz quais deveriam mudar.

    .venv/bin/python exp1/validar_sondas.py            # o relatório
    .venv/bin/python exp1/validar_sondas.py --propor   # pesos sugeridos

Os pesos de `sondas.py` nasceram como heurística operacional: plausíveis, não
medidos. Isto os mede.

## O desenho: esconder a assinatura

1.677 observações têm **assinatura** — uma declaração inequívoca da própria
plataforma: a API do Dataverse, a do DSpace 7, o `<meta generator>` do OJS, o
`<toolkit>` do `Identify`. Nessas, a plataforma é conhecida sem margem.

A validação apaga essas assinaturas e pergunta ao resto dos sinais — formatos,
`setSpec`, rota, forma do identificador — **o que eles teriam concluído
sozinhos**. Onde eles acertam, o peso está bom; onde erram, o peso está alto.

Isso é validação de verdade e não autoavaliação: o que é medido (sinais
fracos) é disjunto do que dá o gabarito (assinaturas). O mesmo número não
aparece nos dois lados.

A limitação que isso tem, e que precisa estar dita: o gabarito só existe onde
**há** assinatura, e origem que não declara nada pode ser sistematicamente
diferente das que declaram. A medida vale para as 1.677, não para as 291 sem
sinal nenhum.

## O que sai daqui

- **Acerto por sinal** — de todas as vezes em que `formato-xoai` apareceu, em
  quantas a plataforma verdadeira era mesmo DSpace. É a precisão empírica do
  sinal, e é ela que deveria definir o peso.
- **Calibragem da confiança** — `HIGH` precisa acertar mais que `MEDIUM`, que
  precisa acertar mais que `LOW`. Se não acertar, a escala não significa nada.
- **Pesos propostos**, proporcionais à precisão medida.

Nada aqui toca a rede: roda sobre `base-evidencias.csv`, que é exatamente o
que a base de evidências existe para permitir.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import pandas as pd

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA))

import base_fontes as bf
from sondas import ASSINATURA, CARACTERISTICA, POR_NOME, confianca

EVIDENCIAS = bf.DADOS / "base-evidencias.csv"


def carregar() -> tuple[pd.DataFrame, pd.DataFrame]:
    evidencias = pd.read_csv(EVIDENCIAS, dtype={"signal_weight": "Int64"})
    fontes = bf.ler()
    return fontes, evidencias


def gabarito(fontes: pd.DataFrame, evidencias: pd.DataFrame) -> pd.Series:
    """A plataforma conhecida sem margem: a que a assinatura declarou.

    Vem da evidência, não da conclusão, para não herdar o escore que está
    sendo julgado.
    """
    assinaturas = evidencias[evidencias["signal_strength"] == ASSINATURA]
    # Observação com duas assinaturas discordantes não tem gabarito: é o caso
    # que a validação não pode julgar, e omiti-lo é melhor que arbitrar.
    por_observacao = assinaturas.groupby("source_observation_id")["inferred_product"]
    unicas = por_observacao.nunique()
    del fontes
    return por_observacao.first()[unicas.eq(1)]


def prever_sem_assinatura(
    evidencias: pd.DataFrame, pesos: dict[str, int]
) -> pd.DataFrame:
    """O que os sinais fracos concluiriam sozinhos, por observação."""
    fracos = evidencias[
        evidencias["signal_strength"].isin([CARACTERISTICA, "indireta"])
    ].copy()
    fracos["peso"] = fracos["signal_name"].map(pesos)

    linhas = []
    for observacao, grupo in fracos.groupby("source_observation_id"):
        escores = grupo.groupby("inferred_product")["peso"].sum()
        vencedora = escores.idxmax()
        dela = grupo[grupo["inferred_product"] == vencedora]
        sinais = [
            {"sonda": linha.probe, "forca": linha.signal_strength}
            for linha in dela.itertuples()
        ]
        linhas.append(
            {
                "source_observation_id": observacao,
                "previsto": vencedora,
                "escore": int(escores.max()),
                "confianca": confianca(sinais),
                "sondas": dela["probe"].nunique(),
            }
        )
    return pd.DataFrame(linhas).set_index("source_observation_id")


def acerto_por_sinal(evidencias: pd.DataFrame, verdade: pd.Series) -> pd.DataFrame:
    """Precisão empírica de cada sinal: quantas vezes ele apontou certo."""
    alvo = evidencias[evidencias["source_observation_id"].isin(verdade.index)].copy()
    alvo["verdade"] = alvo["source_observation_id"].map(verdade)
    alvo["acertou"] = alvo["inferred_product"] == alvo["verdade"]
    resumo = (
        alvo.groupby("signal_name")
        .agg(vezes=("acertou", "size"), acertos=("acertou", "sum"))
        .assign(precisao=lambda d: (d["acertos"] / d["vezes"]).round(3))
    )
    resumo["peso_atual"] = [
        POR_NOME[n].peso if n in POR_NOME else pd.NA for n in resumo.index
    ]
    resumo["forca"] = [
        POR_NOME[n].forca if n in POR_NOME else pd.NA for n in resumo.index
    ]

    # **A precisão sozinha engana.** 77% do gabarito é OJS: um sinal que diga
    # OJS a esmo acerta 77% das vezes sem informar nada. O que mede informação
    # é quanto o sinal supera a taxa-base da plataforma que ele aponta — daí
    # `ganho`, que é 1,0 para um sinal que não acrescenta nada e sobe até
    # 1/taxa-base para um sinal perfeito sobre plataforma rara.
    taxa_base = verdade.value_counts(normalize=True)
    resumo["taxa_base"] = [
        round(taxa_base.get(POR_NOME[n].plataforma, 0.0), 3) if n in POR_NOME else pd.NA
        for n in resumo.index
    ]
    resumo["ganho"] = (resumo["precisao"] / resumo["taxa_base"]).round(1)
    return resumo.sort_values(["forca", "ganho"], ascending=[False, False])


def pesos_propostos(resumo: pd.DataFrame) -> pd.DataFrame:
    """Peso pelo **ganho** medido, não pela precisão.

    A precisão sozinha premia o sinal que aponta a plataforma mais comum: com
    92% do gabarito em OJS, dizer OJS acerta quase sempre sem informar nada.
    O que um peso precisa medir é o quanto o sinal favorece uma plataforma
    **contra as outras**, e isso é a razão entre a precisão e a taxa-base.

    O ganho vai de 1,1 a mais de 300, então entra em escala logarítmica —
    senão um sinal sobre plataforma rara esmagaria todo o resto do escore por
    ser raro, não por ser bom.

    A força continua mandando na confiança; o peso só ordena candidatos.
    Sinal com menos de 20 aparições fica como está: ganho de amostra pequena é
    ruído, e três dos sinais têm quatro ou cinco casos.
    """
    # **Assinatura fica de fora do repeso.** O ganho mede o quanto um sinal
    # *circunstancial* estreita o campo, e isso depende da taxa-base da
    # população. A autoridade de uma autodeclaração não depende disso: o
    # `<meta generator>` do OJS não vale menos por haver muito OJS no Brasil.
    # Repesá-la por ganho amarraria o classificador a esta população e faria
    # uma API do DSpace vencer um generator do OJS num empate — que é
    # exatamente o contrário do que o desenho quer.
    faixa = {CARACTERISTICA: (15, 45), "indireta": (5, 20)}
    teto_log = 2.5  # ganho de ~300 já é o máximo que a escala distingue
    linhas = []
    for nome, linha in resumo.iterrows():
        if pd.isna(linha["forca"]) or linha["forca"] == ASSINATURA:
            continue
        minimo, maximo = faixa[linha["forca"]]
        if linha["vezes"] < 20:
            sugerido, motivo = (
                linha["peso_atual"],
                f"amostra pequena ({linha['vezes']})",
            )
        else:
            proporcao = min(math.log10(max(linha["ganho"], 1.0)) / teto_log, 1.0)
            sugerido = round(minimo + (maximo - minimo) * proporcao)
            motivo = f"ganho {linha['ganho']:.1f}× em {linha['vezes']} casos"
        linhas.append(
            {
                "sinal": nome,
                "forca": linha["forca"],
                "peso_atual": linha["peso_atual"],
                "peso_proposto": sugerido,
                "motivo": motivo,
            }
        )
    quadro = pd.DataFrame(linhas)
    return quadro[quadro["peso_atual"] != quadro["peso_proposto"]]


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument(
        "--propor", action="store_true", help="só os pesos sugeridos"
    )
    opcoes = argumentos.parse_args()

    fontes, evidencias = carregar()
    verdade = gabarito(fontes, evidencias)
    pesos = {nome: sinal.peso for nome, sinal in POR_NOME.items()}
    previsao = prever_sem_assinatura(evidencias, pesos)

    julgaveis = previsao.index.intersection(verdade.index)
    comparacao = pd.DataFrame(
        {
            "verdade": verdade.loc[julgaveis],
            "previsto": previsao.loc[julgaveis, "previsto"],
            "confianca": previsao.loc[julgaveis, "confianca"],
            "sondas": previsao.loc[julgaveis, "sondas"],
        }
    )
    comparacao["acertou"] = comparacao["verdade"] == comparacao["previsto"]

    resumo = acerto_por_sinal(evidencias, verdade)

    if opcoes.propor:
        print(pesos_propostos(resumo).to_string(index=False))
        return 0

    print(f"gabarito: {len(verdade)} observações com assinatura inequívoca")
    print(f"julgáveis: {len(comparacao)} têm também sinal fraco para prever\n")
    print(f"acerto dos sinais fracos sozinhos: {comparacao['acertou'].mean():.1%}\n")

    print("por confiança que os sinais fracos teriam declarado:")
    print(
        comparacao.groupby("confianca")
        .agg(casos=("acertou", "size"), acerto=("acertou", "mean"))
        .assign(acerto=lambda d: (d["acerto"] * 100).round(1))
        .sort_values("acerto", ascending=False)
        .to_string()
    )

    # Os erros não são aleatórios: são sempre substrato no lugar do produto.
    # TEDE2 e TEDE rodam **sobre** DSpace; OMP e OPS são software do PKP e
    # compartilham com o OJS a rota e a forma do identificador. Os sinais
    # circunstanciais enxergam a base técnica e não a camada de cima, que só
    # a autodeclaração revela. Ver isso separado importa: é a diferença entre
    # um classificador que erra e um que acerta o que consegue ver.
    erros = comparacao[~comparacao["acertou"]]
    print(f"\nerros: {len(erros)} em {len(comparacao)}")
    if len(erros):
        print(erros.groupby(["verdade", "previsto"]).size().rename("casos").to_string())

    print("\nmatriz de confusão (linha = verdade, coluna = previsto):")
    print(pd.crosstab(comparacao["verdade"], comparacao["previsto"]).to_string())

    print("\nprecisão empírica por sinal (`ganho` = precisão ÷ taxa-base):")
    print(resumo.to_string())
    print(
        "\ntaxa-base do gabarito: "
        + " · ".join(
            f"{p} {v:.0%}" for p, v in verdade.value_counts(normalize=True).items()
        )
    )

    propostos = pesos_propostos(resumo)
    print(f"\n{len(propostos)} pesos mudariam se seguissem a precisão medida:")
    if len(propostos):
        print(propostos.to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
