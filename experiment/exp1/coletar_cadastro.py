#!/usr/bin/env python
"""Lê o cadastro cru de cada repositório no Harvester.

Roda **dentro do `harvestboard_api`**, que é quem alcança o Harvester
(`200.130.0.61:8090`, mudo do shell da máquina). Do lado de fora:

    .venv/bin/python exp1/rodar_cadastro.py

O backend mapeia oito campos do cadastro (`repository_detail`), e o cadastro
tem muito mais. Três deles a base precisava e não tinha:

    sets                  -> harvest_scope: lista vazia é coleta da fonte inteira
    originURL             -> harvest_endpoint_url, inclusive das 587 sem endpoint
    attributes.state      -> subdivision_code (BR-MG, BR-SP…)

E outros que valem como conferência do que inferimos:
`attributes.source_type`, `attributes.institution_type`,
`attributes.software`, `attributes.source_url`.

O `oaiSource` que o exportador do índice procurava **não existe** no cadastro:
o campo chama-se `originURL`. Foi por isso que o índice saiu sem endereço e o
experimento teve de garimpar o `origin` de dentro de um registro coletado.

Acumulativo e com segunda passada, pelo motivo de sempre: o Harvester perde
perto de metade das conexões, e uma falha dele não é um cadastro ausente.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import django

# O script é copiado para `/tmp` dentro do container, então `sys.path[0]` é
# `/tmp` e não o diretório do projeto: sem isto o `config.settings` não é
# encontrado, mesmo com o `cd` certo.
sys.path.insert(0, os.getcwd())

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from apps.integrations.harvester import HarvesterClient

# Concorrência baixa de propósito. `classificar_quadro.py` já pagou essa conta:
# sob pressa, origem que demora entra na base como origem sem cadastro, e boa
# parte delas responde perfeitamente quando perguntada de novo com calma. A
# proporção exata não está no pacote congelado e por isso não é citada — ver
# evidence/public/texts/resposta_metodos_dimensoes.md, ponto 12.
TRABALHADORES = 6
TENTATIVAS = 3

INTERESSAM = (
    "state",
    "city",
    "source_type",
    "content_type",
    "institution_type",
    "software",
    "source_url",
    "oai_url",
    "issn",
    "issn_l",
    "language",
)


def _um(repositorio: str) -> dict:
    cliente = HarvesterClient()
    for tentativa in range(TENTATIVAS):
        try:
            cadastro = cliente.get_network(repositorio) or {}
        except Exception as falha:  # noqa: BLE001
            if tentativa == TENTATIVAS - 1:
                return {
                    "id": repositorio,
                    "desfecho": "erro",
                    "detalhe": f"{type(falha).__name__}: {str(falha)[:120]}",
                }
            time.sleep(1.5 * (tentativa + 1))
            continue
        atributos = cadastro.get("attributes") or {}
        return {
            "id": repositorio,
            "desfecho": "ok",
            "originURL": cadastro.get("originURL") or "",
            "sets": cadastro.get("sets") or [],
            "metadataPrefix": cadastro.get("metadataPrefix") or "",
            "metadataStoreSchema": cadastro.get("metadataStoreSchema") or "",
            "published": cadastro.get("published"),
            # O agendamento da coleta. É o que separa "a plataforma coleta
            # melhor" de "o Harvester visita esta plataforma mais vezes" —
            # sem ele, atualidade de coleta é correlação sem explicação.
            "scheduleCronExpression": cadastro.get("scheduleCronExpression") or "",
            # Vem na mesma resposta, sem custo, e responde à mesma pergunta:
            # `FORCE_FULL_HARVESTING` refaz o acervo inteiro a cada coleta, o
            # que por si só espaça as visitas a repositório grande.
            "properties": cadastro.get("properties") or {},
            **{chave: (atributos.get(chave) or "") for chave in INTERESSAM},
        }
    return {"id": repositorio, "desfecho": "erro", "detalhe": "esgotou tentativas"}


def coletar(ids: list[str], saida: str, refazer: bool = False) -> int:
    havido: dict[str, dict] = {}
    if not refazer and os.path.isfile(saida):
        with open(saida) as arquivo:
            havido = {c["id"]: c for c in json.load(arquivo)["cadastros"]}

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
                oks = sum(1 for c in resultados.values() if c["desfecho"] == "ok")
                print(f"  {feitas}/{len(pendentes)} — {oks} ok", flush=True)

    with open(saida, "w") as arquivo:
        json.dump(
            {
                "coletadoEm": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "cadastros": sorted(resultados.values(), key=lambda c: int(c["id"])),
            },
            arquivo,
            ensure_ascii=False,
            indent=2,
        )
    oks = sum(1 for c in resultados.values() if c["desfecho"] == "ok")
    print(f"gravado {saida}: {oks}/{len(ids)} ok", flush=True)
    return 0


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument("--ids", required=True, help="JSON com a lista de ids")
    argumentos.add_argument("--saida", required=True, help="JSON de saída")
    argumentos.add_argument("--refazer", action="store_true")
    opcoes = argumentos.parse_args()
    with open(opcoes.ids) as arquivo:
        ids = [str(i) for i in json.load(arquivo)]
    return coletar(ids, opcoes.saida, refazer=opcoes.refazer)


if __name__ == "__main__":
    raise SystemExit(main())
