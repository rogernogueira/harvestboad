#!/usr/bin/env python
"""Exporta o que o painel precisa, num JSON compacto.

    .venv/bin/python exp1/exportar_painel.py

O painel é uma página publicada e **não pode buscar arquivo externo** — a
política de conteúdo do visualizador bloqueia. Então os dados vão embutidos,
e o tamanho importa: 2.183 linhas com nome e instituição por extenso passariam
de meio megabyte à toa.

Daí o formato: cada coluna categórica vira um índice num vocabulário, e as
linhas são listas na ordem de `COLUNAS`. Fica em torno de um terço do que
custaria um array de objetos, e o JavaScript remonta em uma linha.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA))

import base_fontes as bf

SAIDA = bf.DADOS / "painel.json"
REFERENCIA = pd.Timestamp("2026-09-20", tz="UTC")

COLUNAS = [
    "id",
    "nome",
    "inst",
    "uf",
    "plataforma",
    "produto",
    "confianca",
    "tipo",
    "situacao",
    "coleta",
    "indice",
    "natureza",
    "size",
    "validos",
    "transformados",
    "dias",
    "snapshots",
    "falhas",
    "seq",
    "persistente",
]


def historico() -> pd.DataFrame:
    """Taxa de falha e sequência em curso, do histórico completo."""
    caminho = bf.DADOS / "historico.json"
    if not caminho.is_file():
        return pd.DataFrame(columns=["snapshots", "falhas", "seq"])
    linhas = []
    for h in json.loads(caminho.read_text())["repositorios"]:
        if h["desfecho"] != "ok" or not h["coletas"]:
            continue
        falhou = [c["status"] == "HARVESTING_FINISHED_ERROR" for c in h["coletas"]]
        seq = 0
        for f in falhou:  # a API devolve da mais recente para a mais antiga
            if not f:
                break
            seq += 1
        linhas.append(
            {"id": h["id"], "snapshots": len(falhou), "falhas": sum(falhou), "seq": seq}
        )
    return pd.DataFrame(linhas).set_index("id")


def main() -> int:
    b = bf.ler()
    h = historico()
    b = b.join(h, on="source_id")
    b["dias"] = (REFERENCIA - b.snapshot_date).dt.days
    # Persistente: ou está falhando agora há três coletas, ou falha na metade
    # das vezes num histórico que já dá para julgar. As duas condições pegam
    # fenômenos diferentes — a quebra recente e a instabilidade crônica.
    b["persistente"] = (b.seq.fillna(0) >= 3) | (
        (b.falhas.fillna(0) / b.snapshots.replace(0, pd.NA) >= 0.5) & (b.snapshots >= 4)
    )

    vocabs: dict[str, list[str]] = {}

    def indice(serie: pd.Series, nome: str) -> list[int]:
        valores = serie.astype("object").where(serie.notna(), "—").astype(str)
        vocab = sorted(valores.unique())
        vocabs[nome] = vocab
        posicao = {v: i for i, v in enumerate(vocab)}
        return [posicao[v] for v in valores]

    def inteiro(serie: pd.Series) -> list:
        return [None if pd.isna(v) else int(v) for v in serie]

    dados = {
        "id": b.source_id.tolist(),
        "nome": b.source_name_raw.fillna("—").tolist(),
        "inst": indice(b.institution_name, "inst"),
        "uf": indice(b.subdivision_code, "uf"),
        "plataforma": indice(b.platform_analysis_group, "plataforma"),
        "produto": indice(b.platform_product, "produto"),
        "confianca": indice(b.platform_confidence, "confianca"),
        "tipo": indice(b.source_type_detail, "tipo"),
        "situacao": indice(b.source_status, "situacao"),
        "coleta": indice(b.snapshot_status, "coleta"),
        "indice": indice(b.index_status, "indice"),
        "natureza": indice(b.institution_type, "natureza"),
        "size": inteiro(b["size"]),
        "validos": inteiro(b.valid_size),
        "transformados": inteiro(b.transformed_size),
        "dias": inteiro(b.dias),
        "snapshots": inteiro(b.snapshots),
        "falhas": inteiro(b.falhas),
        "seq": inteiro(b.seq),
        "persistente": [int(bool(v)) for v in b.persistente],
    }
    linhas = [[dados[c][i] for c in COLUNAS] for i in range(len(b))]

    SAIDA.write_text(
        json.dumps(
            {
                "geradoEm": pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d"),
                "referencia": REFERENCIA.strftime("%Y-%m-%d"),
                "colunas": COLUNAS,
                "vocabs": vocabs,
                "linhas": linhas,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    print(f"{SAIDA.name}: {len(linhas)} linhas · {SAIDA.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
