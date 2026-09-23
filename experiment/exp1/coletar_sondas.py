#!/usr/bin/env python
"""Roda as sondas de plataforma contra cada fonte e guarda o que voltou.

    .venv/bin/python exp1/coletar_sondas.py            # coleta o que falta
    .venv/bin/python exp1/coletar_sondas.py --refazer  # ignora o já coletado
    .venv/bin/python exp1/coletar_sondas.py --resumo   # só relata

Quatro sondas de rede, por fonte — a quinta, o `Identify`, já foi coletada por
`coletar_identify.py` e é juntada em `gerar.py`:

    ListMetadataFormats   os prefixos expostos
    ListSets              a forma dos `setSpec`
    HTML do site          `<meta name="generator">`, cookies, marcador no corpo
    APIs próprias         /api/info/version e /server/api/core/sites

São quatro requisições por fonte e 2.178 fontes: perto de nove mil idas à rede.
Por isso é acumulativo — a coleta retoma de onde parou — e por isso guarda o
**resultado** de cada sonda, e não a página inteira: o que a classificação
precisa são os prefixos, os `setSpec`, o `generator` e o veredito das APIs.

A regra de ouro está em `sondas.py`: nenhuma sonda interrompe as outras. Parar
na primeira evidência explícita seria mais barato e tornaria `HIGH`
inalcançável, porque `HIGH` é contar sondas independentes.
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA))

import base_fontes as bf
from resolucao import buscar

SAIDA = bf.DADOS / "sondas.json"

CABECALHO = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}
TIMEOUT = 15.0
TRABALHADORES = 20

# Só os primeiros `setSpec`: uma origem com dez mil coleções não acrescenta
# nada à impressão digital depois dos primeiros, e guardar tudo encheria o
# arquivo com o catálogo de cada repositório.
SETS_GUARDADOS = 40

# Pistas de tecnologia no corpo do HTML. As do WordPress são as mais
# confiáveis do conjunto — `wp-content` aparece em todo caminho de tema e de
# upload —, e é justamente a que faltava.
MARCADORES = {
    "wordpress": ("wp-content", "wp-includes", "wp-json"),
    "dataverse": ("dataverse",),
    "dspace": ("dspace",),
    "eprints": ("eprints",),
    "joomla": ("/components/com_", "joomla"),
    "drupal": ("/sites/default/files", "drupal"),
}


def _localname(tag: object) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _verbo(client: httpx.Client, base: str, verbo: str, alvo: str) -> list[str] | None:
    """Os valores de `alvo` na resposta de um verbo. `None` é sonda que falhou."""
    partes = urlsplit(base)
    url = urlunsplit(
        (partes.scheme, partes.netloc, partes.path, urlencode({"verb": verbo}), "")
    )
    try:
        resposta = buscar(client, url)
        if resposta.status_code >= 400:
            return None
        raiz = ET.fromstring(resposta.content)
    except httpx.HTTPError, ET.ParseError:
        return None
    return [
        (elem.text or "").strip()
        for elem in raiz.iter()
        if _localname(elem.tag) == alvo and (elem.text or "").strip()
    ]


def _html(client: httpx.Client, site: str) -> dict:
    """`generator`, cookies e um marcador do corpo. Não guarda a página."""
    try:
        resposta = buscar(client, site)
    except httpx.HTTPError as erro:
        return {"desfecho": type(erro).__name__}
    if resposta.status_code >= 400:
        return {"desfecho": f"http-{resposta.status_code}"}

    corpo = resposta.text[:20000]
    gerador = ""
    for trecho in re.finditer(
        r'<meta[^>]+name=["\']generator["\'][^>]*>', corpo, re.IGNORECASE
    ):
        if achado := re.search(
            r'content=["\']([^"\']+)', trecho.group(0), re.IGNORECASE
        ):
            gerador = achado.group(1).strip()
            break

    # Marcadores no corpo da página, e não só o `<meta generator>`. Muita
    # instalação remove a tag generator — a Art Style é WordPress com 112
    # ocorrências de `wp-content` e nenhum generator —, e sem isto a sonda
    # fica cega para tudo que não se anuncia.
    minusculo = corpo.lower()
    marcadores = sorted(
        {
            tecnologia
            for tecnologia, pistas in MARCADORES.items()
            if any(pista in minusculo for pista in pistas)
        }
    )
    return {
        "desfecho": "ok",
        "generator": gerador,
        "cookies": "; ".join(resposta.cookies.keys()),
        "marcadores": marcadores,
        "final": str(resposta.url),
    }


def _apis(client: httpx.Client, endpoint: str, site: str) -> dict:
    """As duas APIs próprias. A do Dataverse entrega a versão de brinde."""
    achado: dict = {}
    partes = urlsplit(site or endpoint)
    raiz = f"{partes.scheme}://{partes.netloc}"

    try:
        resposta = buscar(client, f"{raiz}/api/info/version")
        if resposta.status_code < 400:
            dados = resposta.json()
            if dados.get("status") == "OK" and (dados.get("data") or {}).get("version"):
                achado["dataverseVersion"] = dados["data"]["version"]
    except httpx.HTTPError, ValueError:
        pass

    # O DSpace 7 serve a REST sob o mesmo prefixo do OAI (`/server`). Quando o
    # endpoint não revela o prefixo, `/server` é o padrão da instalação.
    caminho = urlsplit(endpoint).path
    prefixo = (
        f"{raiz}{caminho[: caminho.index('/server') + len('/server')]}"
        if "/server" in caminho
        else f"{raiz}/server"
    )
    try:
        resposta = buscar(client, f"{prefixo}/api/core/sites")
        if resposta.status_code < 400:
            dados = resposta.json()
            sites = (dados.get("_embedded") or {}).get("sites") or []
            if sites and sites[0].get("type") == "site":
                achado["dspaceSite"] = sites[0].get("name") or "site"
    except httpx.HTTPError, ValueError:
        pass
    return achado


def _uma(alvo: tuple[str, str, str]) -> dict:
    source_id, endpoint, site = alvo
    with httpx.Client(
        timeout=TIMEOUT, follow_redirects=True, headers=CABECALHO, verify=False
    ) as client:
        formatos = _verbo(client, endpoint, "ListMetadataFormats", "metadataPrefix")
        sets = _verbo(client, endpoint, "ListSets", "setSpec")
        return {
            "id": source_id,
            "endpoint": endpoint,
            "formatos": formatos,
            "sets": (sets or [])[:SETS_GUARDADOS],
            "setsTotal": len(sets) if sets is not None else None,
            "html": _html(client, site) if site else {"desfecho": "sem-site"},
            "api": _apis(client, endpoint, site),
        }


def carregar() -> dict[str, dict]:
    if not SAIDA.is_file():
        return {}
    return {s["id"]: s for s in json.loads(SAIDA.read_text())["sondas"]}


def _completa(sonda: dict) -> bool:
    """Sonda que já rendeu o que podia: não vale repetir na próxima execução."""
    return (
        sonda.get("formatos") is not None
        or (sonda.get("html") or {}).get("desfecho") == "ok"
    )


def coletar(refazer: bool = False) -> int:
    base = bf.ler()
    alvos = base.loc[
        base["harvest_endpoint_url"].notna(),
        ["source_id", "harvest_endpoint_url", "source_url"],
    ].drop_duplicates("source_id")
    lista = [
        (i, e, s if isinstance(s, str) else "")
        for i, e, s in alvos.itertuples(index=False, name=None)
    ]

    havido = {} if refazer else carregar()
    pendentes = [t for t in lista if not _completa(havido.get(t[0], {}))]
    print(f"{len(lista)} fontes com endpoint | {len(pendentes)} a sondar", flush=True)
    if not pendentes:
        return 0

    resultados = dict(havido)
    feitas = 0
    with ThreadPoolExecutor(max_workers=TRABALHADORES) as piscina:
        futuros = {piscina.submit(_uma, alvo): alvo[0] for alvo in pendentes}
        for futuro in as_completed(futuros):
            achado = futuro.result()
            resultados[achado["id"]] = achado
            feitas += 1
            if feitas % 200 == 0:
                print(f"  {feitas}/{len(pendentes)}", flush=True)

    SAIDA.write_text(
        json.dumps(
            {
                "coletadoEm": bf.pd.Timestamp.now(tz="UTC").isoformat(),
                "timeout": TIMEOUT,
                "sondas": sorted(resultados.values(), key=lambda s: int(s["id"])),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print(f"gravado {SAIDA.name}: {len(resultados)} fontes", flush=True)
    return 0


def resumo() -> int:
    sondas = carregar()
    if not sondas:
        print(f"{SAIDA} não existe")
        return 1
    print(f"{len(sondas)} fontes sondadas\n")
    print(
        f"  ListMetadataFormats respondeu: {sum(1 for s in sondas.values() if s.get('formatos') is not None)}"
    )
    print(
        f"  ListSets respondeu:            {sum(1 for s in sondas.values() if s.get('setsTotal') is not None)}"
    )
    print(
        f"  HTML respondeu:                {sum(1 for s in sondas.values() if (s.get('html') or {}).get('desfecho') == 'ok')}"
    )
    print(
        f"  com <meta generator>:          {sum(1 for s in sondas.values() if (s.get('html') or {}).get('generator'))}"
    )
    print(
        f"  API Dataverse:                 {sum(1 for s in sondas.values() if (s.get('api') or {}).get('dataverseVersion'))}"
    )
    print(
        f"  API DSpace 7:                  {sum(1 for s in sondas.values() if (s.get('api') or {}).get('dspaceSite'))}"
    )
    geradores = collections.Counter(
        (s.get("html") or {}).get("generator", "").split(" ")[0]
        for s in sondas.values()
        if (s.get("html") or {}).get("generator")
    )
    print("\n  geradores declarados:", dict(geradores.most_common(6)))
    return 0


def mudas(excluir_agregador: bool = True) -> int:
    """As fontes que não responderam a **nenhuma** das cinco sondas.

    Grava `data/fontes-mudas.csv`, uma linha por fonte, com o desfecho do
    `Identify` e o host. Serve de lista de trabalho: é sobre estas que uma
    passada nova de rede ou uma conferência humana teriam o que fazer.

    Por padrão exclui `old.scielo.br`, que sozinho responde por 212 das 361 e
    não é origem de nada — é o agregador morto. Mantê-las na lista faria
    parecer que há 361 repositórios inacessíveis quando há 149 em 124 hosts.
    """
    import json as _json

    sondagens = carregar()
    identify = bf.DADOS / "identify.json"
    respostas = (
        {o["id"]: o for o in _json.loads(identify.read_text())["origens"]}
        if identify.is_file()
        else {}
    )
    base = bf.ler().set_index("source_id")

    linhas = []
    for sid in base.index:
        s, i = sondagens.get(sid, {}), respostas.get(sid, {})
        if not s and not i:
            continue  # sem endpoint: nunca foi sondada
        h = s.get("html") or {}
        if any(
            (
                i.get("desfecho") == "ok",
                s.get("formatos") is not None,
                s.get("setsTotal") is not None,
                h.get("desfecho") == "ok",
                bool(s.get("api")),
            )
        ):
            continue
        endpoint = str(base.loc[sid, "harvest_endpoint_url"])
        host = endpoint.split("/")[2] if "//" in endpoint else ""
        if excluir_agregador and host == "old.scielo.br":
            continue
        linhas.append(
            {
                "source_id": sid,
                "host": host,
                "identify": i.get("desfecho", "(sem endpoint)"),
                "detalhe": i.get("detalhe", ""),
                "source_name_raw": base.loc[sid, "source_name_raw"],
                "institution_name": base.loc[sid, "institution_name"],
                "subdivision_code": base.loc[sid, "subdivision_code"],
                "platform_product": base.loc[sid, "platform_product"],
                "source_status": base.loc[sid, "source_status"],
                "harvest_endpoint_url": endpoint,
            }
        )

    quadro = bf.pd.DataFrame(linhas).sort_values(["identify", "host", "source_id"])
    saida = bf.DADOS / "fontes-mudas.csv"
    quadro.to_csv(saida, index=False)
    print(f"{len(quadro)} fontes mudas às cinco sondas, {quadro.host.nunique()} hosts")
    if excluir_agregador:
        print("  (excluindo old.scielo.br, o agregador morto)")
    print("\npor desfecho:")
    print(quadro.identify.value_counts().to_string())
    concentra = quadro.host.value_counts()
    print("\nhosts com 2 ou mais:")
    print(concentra[concentra >= 2].to_string())
    print("\nplataforma, mesmo sem sondar:")
    print(quadro.platform_product.value_counts().to_string())
    print(f"\n{saida.name}: gravado")
    return 0


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument("--refazer", action="store_true")
    argumentos.add_argument("--resumo", action="store_true")
    argumentos.add_argument(
        "--mudas", action="store_true", help="lista quem não respondeu a nenhuma sonda"
    )
    argumentos.add_argument(
        "--com-agregador", action="store_true", help="inclui old.scielo.br na lista"
    )
    opcoes = argumentos.parse_args()
    if opcoes.mudas:
        return mudas(excluir_agregador=not opcoes.com_agregador)
    return resumo() if opcoes.resumo else coletar(refazer=opcoes.refazer)


if __name__ == "__main__":
    raise SystemExit(main())
