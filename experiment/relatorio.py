#!/usr/bin/env python
"""Relê `resultados.json` sem repetir a corrida.

O experimento leva alguns minutos e bate em cem origens de verdade; toda
pergunta que se possa responder sobre o JSON já gravado deve ser respondida
aqui, e não rodando tudo de novo.

    uv run python ../experiment/relatorio.py                 # o resumo
    uv run python ../experiment/relatorio.py --por-plataforma
    uv run python ../experiment/relatorio.py --ganhos        # o que mudou
    uv run python ../experiment/relatorio.py --enganosos     # link que mente
    uv run python ../experiment/relatorio.py --repo esmat
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

PASTA = Path(__file__).resolve().parent
DADOS = PASTA / "data"

# O desfecho que o experimento chama de link enganoso: a tela ofereceu um
# botão, e o botão não leva à página do item.
ENGANOSOS = ("fora-da-rota", "http-4xx", "http-5xx")


def registros(dados: dict):
    for repo in dados["repositorios"]:
        for registro in repo.get("registros", []):
            if "falha" not in registro:
                yield repo, registro


def desfechos(registro: dict) -> tuple[str, str]:
    return (
        registro["paginaDoItem"]["nova"]["abertura"]["desfecho"],
        registro["paginaDoItem"]["antiga"]["abertura"]["desfecho"],
    )


def mostrar(repo: dict, registro: dict) -> None:
    nova = registro["paginaDoItem"]["nova"]
    antiga = registro["paginaDoItem"]["antiga"]
    print(f"\n{repo['baseUrl']}  [{repo['plataforma']}]")
    print(f"  id      {registro['identifier']}")
    for rotulo, lado in (("nova", nova), ("antiga", antiga)):
        print(
            f"  {rotulo:<7} {str(lado['source']):<22}"
            f" {lado['abertura']['desfecho']:<13} {lado['link'] or '—'}"
        )
    print(f"  oai     {registro['oaiPmh']['abertura']['desfecho']}")


def por_plataforma(dados: dict) -> None:
    tabela: dict[str, dict[str, int]] = {}
    for repo, registro in registros(dados):
        nova, antiga = desfechos(registro)
        linha = tabela.setdefault(
            repo["plataforma"], {"n": 0, "novaOk": 0, "antigaOk": 0, "engNova": 0, "engAntiga": 0}
        )
        linha["n"] += 1
        linha["novaOk"] += nova == "ok"
        linha["antigaOk"] += antiga == "ok"
        linha["engNova"] += nova in ENGANOSOS
        linha["engAntiga"] += antiga in ENGANOSOS

    print(f"{'plataforma':<12}{'itens':>6}{'abre (antiga)':>15}{'abre (nova)':>13}{'engana':>16}")
    for nome, linha in sorted(tabela.items(), key=lambda p: -p[1]["n"]):
        print(
            f"{nome:<12}{linha['n']:>6}"
            f"{linha['antigaOk']:>15}{linha['novaOk']:>13}"
            f"{linha['engAntiga']:>9} -> {linha['engNova']:<4}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arquivo", type=Path, default=DADOS / "resultados.json")
    parser.add_argument("--por-plataforma", action="store_true")
    parser.add_argument("--ganhos", action="store_true")
    parser.add_argument("--perdas", action="store_true")
    parser.add_argument("--enganosos", action="store_true")
    parser.add_argument("--repo", help="filtra por id, nome ou baseURL")
    args = parser.parse_args()

    dados = json.loads(args.arquivo.read_text())

    if args.repo:
        alvo = args.repo.lower()
        for repo, registro in registros(dados):
            campos = f"{repo['id']} {repo['nome']} {repo['baseUrl']}".lower()
            if alvo in campos:
                mostrar(repo, registro)
        return 0

    if args.por_plataforma:
        por_plataforma(dados)
        return 0

    if args.ganhos or args.perdas or args.enganosos:
        for repo, registro in registros(dados):
            nova, antiga = desfechos(registro)
            if args.ganhos and nova == "ok" and antiga != "ok":
                mostrar(repo, registro)
            if args.perdas and antiga == "ok" and nova != "ok":
                mostrar(repo, registro)
            if args.enganosos and (nova in ENGANOSOS or antiga in ENGANOSOS):
                mostrar(repo, registro)
        return 0

    from experimento import imprimir  # noqa: PLC0415 — só para reusar o formato

    print(f"rodado em {dados['rodadoEm']}  (fonte: {dados['fonte']})")
    imprimir(dados["resumo"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
