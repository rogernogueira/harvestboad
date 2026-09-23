#!/usr/bin/env python
"""As origens que não responderam ao `Identify` respondem ao `ListIdentifiers`?

A pergunta é de desenho amostral, não de curiosidade. `classificar_quadro.py`
deixou 285 repositórios sem tipo, e 270 deles **têm `baseURL`** — o Harvester
sabe o endereço, mas a origem não respondeu ao `Identify`. Excluí-los da amostra
enviesaria o resultado **para cima**, porque origem que não responde é candidata
a repositório abandonado, e repositório abandonado é justamente onde o link
tende a estar quebrado.

O que decide é se eles são mensuráveis apesar de não classificáveis:

- respondem aos dois verbos  → foi falha transitória; entram normalmente;
- só ao `ListIdentifiers`    → dá para medir, só o **tipo** fica desconhecido;
- a nenhum dos dois          → estão mesmo fora do ar, e a exclusão é legítima —
                               mas precisa ser declarada como não-resposta.

`Identify` é o verbo mais leve do protocolo, então falhar nele e funcionar no
`ListIdentifiers` seria estranho. Não é impossível: há servidor que implementa
mal o que quase ninguém pede.

Em série e com prazo folgado de propósito: a pergunta é se a origem responde
**quando lhe dão tempo**, e medir isso sob concorrência repetiria o erro que
inflou a não-resposta na primeira passagem.

    uv run python ../experiment/verificar_mudas.py
    uv run python ../experiment/verificar_mudas.py --limite 30
"""

from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx

PASTA = Path(__file__).resolve().parent
DADOS = PASTA / "data"

SEM_TIPO = ("origem-muda", "indeterminado", "erro-harvester", "nao-apurado", "sem-origem")
CABECALHO = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}


def _localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _chamar(client: httpx.Client, base: str, **params) -> tuple[str, str]:
    """`(desfecho, detalhe)` de um verbo. Não levanta: o desfecho é o dado."""
    partes = urlsplit(base)
    url = urlunsplit((partes.scheme, partes.netloc, partes.path, urlencode(params), ""))
    try:
        resposta = client.get(url)
    except httpx.HTTPError as erro:
        return "rede", type(erro).__name__
    if resposta.status_code >= 400:
        return f"http-{resposta.status_code}", ""
    try:
        raiz = ET.fromstring(resposta.content)
    except ET.ParseError:
        return "xml-invalido", resposta.headers.get("content-type", "")[:40]

    for elem in raiz.iter():
        if _localname(elem.tag) == "error":
            return "oai-error", elem.get("code") or "unknown"
    return "ok", ""


def verificar(linha: dict, timeout: float) -> dict:
    base = linha["baseUrl"]
    prefix = linha.get("metadataPrefix") or "oai_dc"
    with httpx.Client(
        timeout=timeout, follow_redirects=True, headers=CABECALHO
    ) as client:
        ident, det_ident = _chamar(client, base, verb="Identify")
        lista, det_lista = _chamar(
            client, base, verb="ListIdentifiers", metadataPrefix=prefix
        )

    if ident == "ok" and lista == "ok":
        veredito = "responde-aos-dois"
    elif lista == "ok":
        veredito = "so-ListIdentifiers"
    elif ident == "ok":
        veredito = "so-Identify"
    else:
        veredito = "nenhum-dos-dois"

    return {
        "id": linha["id"],
        "sigla": linha.get("sigla"),
        "nome": linha.get("nome"),
        "baseUrl": base,
        "tipoAnterior": linha["tipo"],
        "identify": ident,
        "identifyDetalhe": det_ident,
        "listIdentifiers": lista,
        "listIdentifiersDetalhe": det_lista,
        "veredito": veredito,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quadro", type=Path, default=DADOS / "quadro-amostral.json")
    parser.add_argument("--saida", type=Path, default=DADOS / "verificacao-mudas.json")
    parser.add_argument("--limite", type=int, default=0)
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument(
        "--trabalhadores",
        type=int,
        default=4,
        help="baixo de propósito: a pergunta é se a origem responde com tempo",
    )
    args = parser.parse_args()

    quadro = json.loads(args.quadro.read_text())["repositorios"]
    alvos = [r for r in quadro if r["tipo"] in SEM_TIPO and r.get("baseUrl")]
    sem_url = [r for r in quadro if r["tipo"] in SEM_TIPO and not r.get("baseUrl")]
    if args.limite:
        alvos = alvos[: args.limite]

    print(
        f"{len(alvos)} origens sem tipo mas com baseURL "
        f"({len(sem_url)} sem baseURL ficam de fora)",
        file=sys.stderr,
    )

    achados: list[dict] = []
    with ThreadPoolExecutor(max_workers=args.trabalhadores) as pool:
        for i, achado in enumerate(
            pool.map(lambda l: verificar(l, args.timeout), alvos), 1
        ):
            achados.append(achado)
            if i % 25 == 0 or i == len(alvos):
                print(f"  ... {i}/{len(alvos)}", file=sys.stderr)

    vereditos = Counter(a["veredito"] for a in achados)
    args.saida.parent.mkdir(parents=True, exist_ok=True)
    args.saida.write_text(
        json.dumps(
            {
                "verificadoEm": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "timeout": args.timeout,
                "semBaseUrl": len(sem_url),
                "porVeredito": dict(vereditos.most_common()),
                "origens": achados,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )

    print(f"\n{len(achados)} verificadas → {args.saida}", file=sys.stderr)
    for nome, n in vereditos.most_common():
        print(f"  {nome:<20}{n:>5}  {100 * n / len(achados):5.1f}%", file=sys.stderr)
    print("\n  por que o Identify falhou:", file=sys.stderr)
    for nome, n in Counter(a["identify"] for a in achados).most_common():
        print(f"    {nome:<18}{n:>5}", file=sys.stderr)
    print("\n  por que o ListIdentifiers falhou:", file=sys.stderr)
    for nome, n in Counter(a["listIdentifiers"] for a in achados).most_common():
        print(f"    {nome:<18}{n:>5}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
