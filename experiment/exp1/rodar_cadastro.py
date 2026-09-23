#!/usr/bin/env python
"""Roda `coletar_cadastro.py` dentro do `harvestboard_api` e traz o JSON.

    .venv/bin/python exp1/rodar_cadastro.py

Existe porque o Harvester só responde de dentro do container: `200.130.0.61:8090`
é mudo do shell da máquina. O container não tem o diretório do experimento
montado, então o caminho é copiar o script e a lista de ids para dentro, rodar,
e copiar o resultado de volta — os mesmos três passos que o README do
experimento descreve para a árvore corrigida.

O `--refazer` é repassado; sem ele a coleta retoma de onde parou, o que
importa porque o Harvester perde perto de metade das conexões e uma passada
inteira leva cerca de quinze minutos.
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
TRABALHO = "/app/backend"
SAIDA = bf.DADOS / "cadastro.json"


def _docker(*argumentos: str) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", *argumentos], check=True, text=True)


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument("--refazer", action="store_true")
    opcoes = argumentos.parse_args()

    ids = sorted(bf.ler()["source_id"].dropna().unique(), key=int)
    lista = bf.DADOS / "ids-cadastro.json"
    lista.write_text(json.dumps(list(ids)))
    print(f"{len(ids)} repositórios")

    _docker(
        "cp",
        str(PASTA / "coletar_cadastro.py"),
        f"{CONTAINER}:/tmp/coletar_cadastro.py",
    )
    _docker("cp", str(lista), f"{CONTAINER}:/tmp/ids.json")

    comando = f"cd {TRABALHO}; python /tmp/coletar_cadastro.py --ids /tmp/ids.json --saida /tmp/cadastro.json"
    if opcoes.refazer:
        comando += " --refazer"
    subprocess.run(
        ["docker", "exec", CONTAINER, "sh", "-c", comando], check=True, text=True
    )

    _docker("cp", f"{CONTAINER}:/tmp/cadastro.json", str(SAIDA))
    lista.unlink(missing_ok=True)
    print(f"{SAIDA}: {SAIDA.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
