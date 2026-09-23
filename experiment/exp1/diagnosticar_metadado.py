#!/usr/bin/env python
"""Por que a coleta falhou: amostra o metadado das origens com erro.

    .venv/bin/python exp1/diagnosticar_metadado.py            # diagnostica o que falta
    .venv/bin/python exp1/diagnosticar_metadado.py --refazer
    .venv/bin/python exp1/diagnosticar_metadado.py --resumo

`snapshot_status = HARVESTING_FINISHED_ERROR` diz que a coleta terminou mal e
`valid_size = 0` diz que nada passou na validação, mas nenhum campo diz **por
quê**. A diferença entre "a origem não respondeu" e "a origem respondeu com
metadado que o perfil rejeita" é substantiva, e hoje está fora do dicionário.

Este script pede uma página de `ListRecords` a cada origem com erro e confere
quatro exigências do perfil DRIVER/OpenAIRE que a LA Referencia valida:

    identificador é URI    o OAI-PMH exige URI no header; `003325420` não é
    dc:type em info:eu-repo    `Dissertação` reprova, `…/masterThesis` passa
    dc:language em código      `pt`/`por` passa, `Português` reprova
    dc:rights presente         o OpenAIRE exige a declaração de acesso

**Pede o prefixo que o Harvester usou**, não `oai_dc` por conveniência: a
validação roda sobre o que foi coletado, e três destas origens são colhidas
em `xoai`. O extrator entende os dois formatos — o `xoai` aninha o valor em
`<element name="type"><element name="por"><field name="value">`, e ler só o
`oai_dc` mediria outra coisa.

Amostra a primeira página, não o repositório inteiro. Para detectar defeito
**sistemático** — que é o que reprova 16 mil registros — a primeira página
basta, e puxar o acervo completo de 450 origens seria abusivo com elas.
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

SAIDA = bf.DADOS / "diagnostico-metadado.json"
OAI = "{http://www.openarchives.org/OAI/2.0/}"
DC = "{http://purl.org/dc/elements/1.1/}"

CABECALHO = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}
TIMEOUT = 40.0
TRABALHADORES = 10


def _localname(tag: object) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _valores_oai_dc(registro: ET.Element, campo: str) -> list[str]:
    return [
        e.text.strip() for e in registro.iter(f"{DC}{campo}") if (e.text or "").strip()
    ]


def _valores_xoai(registro: ET.Element, campo: str) -> list[str]:
    """O `xoai` aninha: `element[name=campo] > element[name=idioma] > field`."""
    achados = []
    for elemento in registro.iter():
        if _localname(elemento.tag) != "element" or elemento.get("name") != campo:
            continue
        for campo_valor in elemento.iter():
            if (
                _localname(campo_valor.tag) == "field"
                and (campo_valor.text or "").strip()
            ):
                achados.append(campo_valor.text.strip())
    return achados


def conferir_pagina(raiz: ET.Element) -> dict:
    """As quatro exigências, contadas sobre os registros da página."""
    registros = raiz.findall(f".//{OAI}record")
    vivos = [
        r
        for r in registros
        if (r.find(f"{OAI}header") or ET.Element("x")).get("status") != "deleted"
    ]
    if not vivos:
        return {"registros": len(registros), "removidos": len(registros), "vazio": True}

    # O mesmo registro responde aos dois extratores; o que renderrender mais é o
    # formato certo, e isso evita depender do prefixo declarado estar correto.
    def valores(campo: str) -> list[str]:
        pelo_dc = [v for r in vivos for v in _valores_oai_dc(r, campo)]
        pelo_xoai = [v for r in vivos for v in _valores_xoai(r, campo)]
        return pelo_dc if len(pelo_dc) >= len(pelo_xoai) else pelo_xoai

    ids = [r.findtext(f"{OAI}header/{OAI}identifier") or "" for r in vivos]
    tipos, idiomas, direitos = valores("type"), valores("language"), valores("rights")
    return {
        "registros": len(registros),
        "removidos": len(registros) - len(vivos),
        "id_uri": sum(1 for i in ids if i.startswith("oai:") or "://" in i),
        "tipo_total": len(tipos),
        "tipo_eurepo": sum(1 for t in tipos if t.startswith("info:eu-repo")),
        "tipo_exemplos": [t for t, _ in collections.Counter(tipos).most_common(3)],
        "idioma_total": len(idiomas),
        "idioma_codigo": sum(
            1 for x in idiomas if re.fullmatch(r"[A-Za-z]{2,3}([_-][A-Za-z]{2,4})?", x)
        ),
        "idioma_exemplos": [x for x, _ in collections.Counter(idiomas).most_common(3)],
        "direitos": len(direitos),
        "vazio": False,
    }


def _uma(alvo: tuple[str, str, str]) -> dict:
    sid, base, prefixo = alvo
    partes = urlsplit(base)
    url = urlunsplit(
        (
            partes.scheme,
            partes.netloc,
            partes.path,
            urlencode({"verb": "ListRecords", "metadataPrefix": prefixo or "oai_dc"}),
            "",
        )
    )
    try:
        with httpx.Client(
            timeout=TIMEOUT, follow_redirects=True, headers=CABECALHO, verify=False
        ) as client:
            resposta = buscar(client, url)
    except httpx.HTTPError as erro:
        return {"id": sid, "desfecho": "rede", "detalhe": type(erro).__name__}
    if resposta.status_code >= 400:
        return {"id": sid, "desfecho": f"http-{resposta.status_code}", "detalhe": ""}
    try:
        raiz = ET.fromstring(resposta.content)
    except ET.ParseError:
        return {
            "id": sid,
            "desfecho": "nao-xml",
            "detalhe": resposta.headers.get("content-type", "")[:40],
        }
    erro = raiz.find(f".//{OAI}error")
    if erro is not None:
        return {"id": sid, "desfecho": "oai-error", "detalhe": erro.get("code") or ""}
    return {"id": sid, "desfecho": "ok", "prefixo": prefixo, **conferir_pagina(raiz)}


def alvos() -> list[tuple[str, str, str]]:
    base = bf.ler()
    com_erro = base[
        base["snapshot_status"].eq("HARVESTING_FINISHED_ERROR")
        & base["harvest_endpoint_url"].notna()
    ]
    return [
        (r.source_id, r.harvest_endpoint_url, r.harvest_metadata_prefix or "oai_dc")
        for r in com_erro.itertuples()
    ]


def carregar() -> dict[str, dict]:
    if not SAIDA.is_file():
        return {}
    return {o["id"]: o for o in json.loads(SAIDA.read_text())["origens"]}


def diagnosticar(refazer: bool = False) -> int:
    lista = alvos()
    havido = {} if refazer else carregar()
    pendentes = [a for a in lista if havido.get(a[0], {}).get("desfecho") != "ok"]
    print(
        f"{len(lista)} origens com HARVESTING_FINISHED_ERROR | {len(pendentes)} a diagnosticar"
    )
    if not pendentes:
        return resumo()

    resultados = dict(havido)
    feitas = 0
    with ThreadPoolExecutor(max_workers=TRABALHADORES) as piscina:
        futuros = {piscina.submit(_uma, a): a[0] for a in pendentes}
        for futuro in as_completed(futuros):
            achado = futuro.result()
            resultados[achado["id"]] = achado
            feitas += 1
            if feitas % 50 == 0:
                print(f"  {feitas}/{len(pendentes)}", flush=True)

    SAIDA.write_text(
        json.dumps(
            {
                "diagnosticadoEm": bf.pd.Timestamp.now(tz="UTC").isoformat(),
                "origens": sorted(resultados.values(), key=lambda o: int(o["id"])),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return resumo()


def resumo() -> int:
    origens = carregar()
    if not origens:
        print(f"{SAIDA} não existe")
        return 1
    print(f"\n{len(origens)} origens diagnosticadas")
    print(collections.Counter(o["desfecho"] for o in origens.values()).most_common())

    oks = [o for o in origens.values() if o["desfecho"] == "ok" and not o.get("vazio")]
    if not oks:
        return 0
    print(f"\n{len(oks)} responderam com registros. Das quatro exigências:")

    def vivos(o: dict) -> int:
        return o["registros"] - o.get("removidos", 0)

    def parcial(chave: str, total: str) -> int:
        """Origens em que ao menos um registro falha a exigência."""
        return sum(1 for o in oks if o.get(total, 0) and o.get(chave, 0) < o[total])

    print(
        f"  identificador não-URI em algum registro : {sum(1 for o in oks if o.get('id_uri', 0) < vivos(o))}"
    )
    print(
        f"  nenhum dc:type em info:eu-repo          : {sum(1 for o in oks if o.get('tipo_total', 0) and not o.get('tipo_eurepo'))}"
    )
    print(
        f"  algum dc:type fora de info:eu-repo      : {parcial('tipo_eurepo', 'tipo_total')}"
    )
    print(
        f"  algum dc:language fora de código        : {parcial('idioma_codigo', 'idioma_total')}"
    )
    print(
        f"  sem dc:rights nenhum                    : {sum(1 for o in oks if not o.get('direitos'))}"
    )
    print(
        f"  só registros removidos (deleted)        : {sum(1 for o in origens.values() if o.get('vazio'))}"
    )

    print("\nvalores de dc:type mais frequentes entre as que reprovam:")
    fora = collections.Counter(
        t for o in oks if not o.get("tipo_eurepo") for t in o.get("tipo_exemplos", [])
    )
    for termo, n in fora.most_common(8):
        print(f"  {n:>4}  {termo!r}")
    return 0


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument("--refazer", action="store_true")
    argumentos.add_argument("--resumo", action="store_true")
    opcoes = argumentos.parse_args()
    return resumo() if opcoes.resumo else diagnosticar(refazer=opcoes.refazer)


if __name__ == "__main__":
    raise SystemExit(main())
