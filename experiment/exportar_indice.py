#!/usr/bin/env python
"""Despeja o índice de repositórios do cache num JSON legível.

`repositories:v1:index` é a lista inteira de repositórios do Harvester, com
cadastro e resumo da última coleta. Custa ~40 s para montar na origem, por isso
tem TTL de 12 h e um comando próprio (`warm_repository_index`) que paga esse
custo fora da hora do usuário. Aqui ele só é **lido**: se o cache estiver frio,
o script diz isso e sai, em vez de disparar a consulta cara sem querer.

O que o índice **não** traz é o `baseURL` OAI — o cadastro devolve `oaiSource`
nulo, e o endereço da origem é campo do registro coletado. Por isso este JSON
serve para escolher e descrever repositórios, não para alimentar direto o
`experimento.py`, que precisa de endereço.

    uv run python ../experiment/exportar_indice.py
    uv run python ../experiment/exportar_indice.py --so-com-coleta --saida x.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

PASTA = Path(__file__).resolve().parent
DADOS = PASTA / "data"
sys.path.insert(0, str(PASTA))

from ambiente import preparar  # noqa: E402

preparar()

from django.core.cache import cache  # noqa: E402

from apps.repositories.services import CACHE_PREFIX  # noqa: E402

CHAVE = f"{CACHE_PREFIX}:index"

# Preenchidos pela aplicação a cada requisição, a partir do banco local — não
# são do Harvester e não descrevem o repositório. Ficam de fora do despejo.
LOCAIS = ("managerCount", "unreadNotificationCount")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--saida", type=Path, default=DADOS / "indice-repositorios.json")
    parser.add_argument(
        "--so-com-coleta",
        action="store_true",
        help="descarta os que nunca foram coletados",
    )
    args = parser.parse_args()

    args.saida.parent.mkdir(parents=True, exist_ok=True)
    indice = cache.get(CHAVE)
    if not indice:
        print(
            f"cache frio: nada em `{CHAVE}`.\n"
            "Rode `manage.py warm_repository_index` de onde o Harvester responda.",
            file=sys.stderr,
        )
        return 1

    linhas = [{k: v for k, v in linha.items() if k not in LOCAIS} for linha in indice]
    if args.so_com_coleta:
        linhas = [linha for linha in linhas if linha.get("lastSnapshotId")]

    # Por sigla, como o painel ordena: o JSON é lido por gente, e a ordem de
    # chegada da origem não significa nada.
    linhas.sort(key=lambda linha: (linha.get("acronym") or "").upper())

    estados = Counter(linha.get("lastSnapshotStatus") or "SEM_COLETA" for linha in linhas)
    indexacao = Counter(linha.get("lastIndexStatus") or "SEM_INDICE" for linha in linhas)
    datas = sorted(linha["lastSnapshotDate"] for linha in linhas if linha.get("lastSnapshotDate"))

    resumo = {
        "repositorios": len(linhas),
        "semColeta": sum(1 for linha in linhas if not linha.get("lastSnapshotId")),
        "registrosNaUltimaColeta": sum(linha.get("lastSize") or 0 for linha in linhas),
        "validosNaUltimaColeta": sum(linha.get("lastValidSize") or 0 for linha in linhas),
        "porEstadoDaColeta": dict(estados.most_common()),
        "porEstadoDoIndice": dict(indexacao.most_common()),
        "coletaMaisAntiga": datas[0] if datas else None,
        "coletaMaisRecente": datas[-1] if datas else None,
    }

    args.saida.write_text(
        json.dumps(
            {
                "origem": f"cache `{CHAVE}` (TTL 12 h, posto por warm_repository_index)",
                "exportadoEm": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "observacao": (
                    "O índice não traz o baseURL OAI: `oaiSource` volta nulo no "
                    "cadastro, e o endereço da origem é campo do registro coletado."
                ),
                "resumo": resumo,
                "repositorios": linhas,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )

    print(f"{len(linhas)} repositórios em {args.saida}", file=sys.stderr)
    for chave, valor in resumo.items():
        if not isinstance(valor, dict):
            print(f"  {chave:<26} {valor}", file=sys.stderr)
    print(f"  porEstadoDaColeta          {resumo['porEstadoDaColeta']}", file=sys.stderr)
    print(f"  porEstadoDoIndice          {resumo['porEstadoDoIndice']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
