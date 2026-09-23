#!/usr/bin/env python
"""Roda `coletar_historico.py` dentro do container e traz o JSON.

    .venv/bin/python exp1/rodar_historico.py

Mesmos três passos de `rodar_cadastro.py`: o Harvester só responde de dentro
do `harvestboard_api`, e o container não tem o experimento montado.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA))

import base_fontes as bf

CONTAINER = "harvestboard_api"
SAIDA = bf.DADOS / "historico.json"


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument("--refazer", action="store_true")
    opcoes = argumentos.parse_args()

    ids = sorted(bf.ler()["source_id"].dropna().unique(), key=int)
    lista = bf.DADOS / "ids-historico.json"
    lista.write_text(json.dumps(list(ids)))
    print(f"{len(ids)} repositórios")

    subprocess.run(
        [
            "docker",
            "cp",
            str(PASTA / "coletar_historico.py"),
            f"{CONTAINER}:/tmp/coletar_historico.py",
        ],
        check=True,
    )
    subprocess.run(
        ["docker", "cp", str(lista), f"{CONTAINER}:/tmp/ids_hist.json"], check=True
    )
    comando = (
        "cd /app/backend; python /tmp/coletar_historico.py "
        "--ids /tmp/ids_hist.json --saida /tmp/historico.json"
    )
    if opcoes.refazer:
        comando += " --refazer"
    subprocess.run(["docker", "exec", CONTAINER, "sh", "-c", comando], check=True)
    subprocess.run(
        ["docker", "cp", f"{CONTAINER}:/tmp/historico.json", str(SAIDA)], check=True
    )
    lista.unlink(missing_ok=True)
    print(f"{SAIDA.name}: {SAIDA.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
