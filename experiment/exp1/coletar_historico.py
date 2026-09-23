#!/usr/bin/env python
"""Histórico completo de coletas de cada repositório, do Harvester.

Roda **dentro do `harvestboard_api`**. Do lado de fora:

    .venv/bin/python exp1/rodar_historico.py

`base-fontes.csv` guarda só a última coleta, e pergunta sobre persistência —
"esta fonte falha sempre ou falhou uma vez?" — precisa da série. O Harvester
tem todas, por repositório.

**Usa o cliente cru, e não `repository_harvests`.** O serviço do backend não
passa `size` e o Spring Data REST corta em 20 por página, sem avisar: para a
USP ele devolve 20 de 42. Quem lê pelo app vê metade do histórico achando que
vê tudo. Aqui pedimos 500 por página, que cobre o maior histórico da base com
folga.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import django

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from apps.integrations.harvester import HarvesterClient  # noqa: E402

TRABALHADORES = 6
TENTATIVAS = 3
POR_PAGINA = 500

CAMPOS = (
    "status",
    "indexStatus",
    "startTime",
    "endTime",
    "size",
    "validSize",
    "transformedSize",
    "deleted",
)


def _id_do_href(payload: dict) -> str:
    href = ((payload or {}).get("_links", {}).get("self", {}) or {}).get("href", "")
    return href.rstrip("/").rsplit("/", 1)[-1] if href else ""


def _um(repositorio: str) -> dict:
    cliente = HarvesterClient()
    for tentativa in range(TENTATIVAS):
        try:
            pagina = (
                cliente.get_json(
                    "/rest/snapshot/search/findByNetworkIdOrdered",
                    params={"network_id": repositorio, "size": str(POR_PAGINA)},
                )
                or {}
            )
        except Exception as falha:  # noqa: BLE001
            if tentativa == TENTATIVAS - 1:
                return {
                    "id": repositorio,
                    "desfecho": "erro",
                    "detalhe": f"{type(falha).__name__}: {str(falha)[:100]}",
                }
            time.sleep(1.5 * (tentativa + 1))
            continue

        snapshots = (pagina.get("_embedded") or {}).get("snapshot") or []
        total = (pagina.get("page") or {}).get("totalElements", len(snapshots))
        return {
            "id": repositorio,
            "desfecho": "ok",
            # Se isto divergir, a página cortou e o histórico está incompleto.
            "total": total,
            "recebidos": len(snapshots),
            "coletas": [
                {"snapshotId": _id_do_href(s), **{c: s.get(c) for c in CAMPOS}}
                for s in snapshots
            ],
        }
    return {"id": repositorio, "desfecho": "erro", "detalhe": "esgotou tentativas"}


def coletar(ids: list[str], saida: str, refazer: bool = False) -> int:
    havido: dict[str, dict] = {}
    if not refazer and os.path.isfile(saida):
        with open(saida) as arquivo:
            havido = {h["id"]: h for h in json.load(arquivo)["repositorios"]}

    pendentes = [i for i in ids if havido.get(i, {}).get("desfecho") != "ok"]
    print(f"{len(ids)} repositórios | {len(pendentes)} a perguntar", flush=True)

    resultados = dict(havido)
    feitas = 0
    with ThreadPoolExecutor(max_workers=TRABALHADORES) as piscina:
        futuros = {piscina.submit(_um, i): i for i in pendentes}
        for futuro in as_completed(futuros):
            achado = futuro.result()
            resultados[achado["id"]] = achado
            feitas += 1
            if feitas % 200 == 0:
                print(f"  {feitas}/{len(pendentes)}", flush=True)

    with open(saida, "w") as arquivo:
        json.dump(
            {
                "coletadoEm": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "porPagina": POR_PAGINA,
                "repositorios": sorted(resultados.values(), key=lambda h: int(h["id"])),
            },
            arquivo,
            ensure_ascii=False,
        )
    oks = [h for h in resultados.values() if h["desfecho"] == "ok"]
    coletas = sum(len(h["coletas"]) for h in oks)
    truncados = sum(1 for h in oks if h["recebidos"] < h["total"])
    print(
        f"gravado {saida}: {len(oks)}/{len(ids)} ok · {coletas} coletas · truncados: {truncados}"
    )
    return 0


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument("--ids", required=True)
    argumentos.add_argument("--saida", required=True)
    argumentos.add_argument("--refazer", action="store_true")
    opcoes = argumentos.parse_args()
    with open(opcoes.ids) as arquivo:
        ids = [str(i) for i in json.load(arquivo)]
    return coletar(ids, opcoes.saida, refazer=opcoes.refazer)


if __name__ == "__main__":
    raise SystemExit(main())
