#!/usr/bin/env python
"""Pergunta `Identify` a cada origem e guarda a resposta inteira.

    .venv/bin/python exp1/coletar_identify.py            # coleta o que falta
    .venv/bin/python exp1/coletar_identify.py --refazer  # ignora o que já há
    .venv/bin/python exp1/coletar_identify.py --resumo   # só relata o coletado

Preenche de uma vez os sete campos que o experimento nunca capturou, porque os
sete saem da mesma resposta:

    oai_protocol_version        <protocolVersion>
    oai_earliest_datestamp      <earliestDatestamp>
    oai_deleted_record_policy   <deletedRecord>
    oai_granularity             <granularity>
    oai_repository_name         <repositoryName>
    platform_version_raw        <description><toolkit><version>
    identify_sha256             SHA-256 da resposta crua

A saída é `data/identify.json`, e é **acumulativa**: cada execução coleta só as
origens que ainda não responderam bem, e mantém as que já responderam. Uma
passada por 1.581 origens leva dezenas de minutos e algumas estarão fora do ar
hoje e no ar amanhã; recomeçar do zero toda vez transformaria isso em motivo
para não repetir a coleta.

O SHA-256 é da resposta como veio, antes de qualquer parse. É ele que permite
provar depois que o campo publicado veio daquele XML, e não de uma
interpretação nossa que mudou no meio do caminho.

**As origens são alcançáveis deste shell** — ao contrário do Harvester, que só
responde de dentro do `harvestboard_api`. Este script não fala com o Harvester:
lê os endpoints de `base-fontes.csv`, que já os tem.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
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

SAIDA = bf.DADOS / "identify.json"

# As respostas cruas, comprimidas, num arquivo só. Sem elas o
# `identify_sha256` seria hash de bytes que ninguém guardou — e o dicionário
# fala em "hash da resposta **preservada**". Guardá-las também permite
# rederivar qualquer campo do Identify sem voltar às origens, que é o mesmo
# argumento da base de evidências.
#
# O hash muda a cada pergunta, porque o envelope traz `<responseDate>`: ele
# identifica **aquela** resposta, não o conteúdo estável da origem.
RESPOSTAS = bf.DADOS / "identify-respostas.json.gz"

# O mesmo cabeçalho do resto do experimento: origem que filtra cliente
# desconhecido devolve 403, e o 403 vira "servidor vivo que recusa", que é
# conclusão sobre nós e não sobre ela.
CABECALHO = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

# Prazo folgado e concorrência modesta, pelo motivo que `verificar_mudas.py`
# documentou: sob pressa, tempo esgotado do nosso lado entra na base como
# não-resposta da origem, e vira propriedade atribuída a ela. Reconsultar em
# série e com calma recupera parte substancial das origens antes rotuladas como
# mudas — a proporção exata não está no pacote congelado e por isso não é citada
# aqui nem no artigo.
TIMEOUT = 25.0
TRABALHADORES = 16


def _localname(tag: object) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _texto(raiz: ET.Element, nome: str) -> str:
    for elem in raiz.iter():
        if _localname(elem.tag) == nome and (elem.text or "").strip():
            return elem.text.strip()
    return ""


def _toolkit(raiz: ET.Element) -> dict:
    """`<title>` e `<version>` de dentro do `<toolkit>`, e não quaisquer.

    O envelope do Identify tem outros `<title>` e outros `<version>` — o
    `<repositoryName>` vizinho, descrições de terceiros —, e pegar o primeiro
    que aparecer traz o nome errado. O mesmo cuidado que `classificar_quadro`
    já tomava para o título vale para a versão.
    """
    for elem in raiz.iter():
        if _localname(elem.tag) != "toolkit":
            continue
        achado = {}
        for filho in elem:
            nome = _localname(filho.tag)
            if nome in ("title", "version") and (filho.text or "").strip():
                achado[nome] = filho.text.strip()
        if achado:
            return achado
    return {}


def _porque_nao_e_xml(resposta: httpx.Response) -> dict:
    """Separa os quatro motivos que `xml-invalido` escondia numa etiqueta só.

    Nenhuma das 78 origens assim rotuladas devolvia XML quebrado: todas
    devolviam HTML, e por razões diferentes o bastante para mudar a situação
    da fonte. Um portal em manutenção está temporariamente fora; um OAI que
    redireciona para login tem a fonte **no ar** e o protocolo fechado; um
    desafio anti-bot é o nosso cliente sendo recusado, não a origem.

    Distinguir aqui é o que permite `SITUACAO` responder certo a cada um.
    """
    final = str(resposta.url).lower()
    corpo = resposta.text[:6000].lower()
    tipo = resposta.headers.get("content-type", "")[:40]

    if "/login" in final or "login?source=" in final:
        return {"desfecho": "oai-fechado", "detalhe": "redireciona para login"}
    if "manutenc" in final or "manutenç" in corpo or "em manutenção" in corpo:
        return {"desfecho": "portal-em-manutencao", "detalhe": tipo}
    if "cloudflare" in corpo or "checking your browser" in corpo or "captcha" in corpo:
        return {"desfecho": "anti-bot", "detalhe": tipo}
    return {"desfecho": "html-nao-xml", "detalhe": tipo}


def perguntar(client: httpx.Client, base: str) -> dict:
    """Um `Identify`. Não levanta: o desfecho é parte do dado."""
    partes = urlsplit(base)
    url = urlunsplit(
        (partes.scheme, partes.netloc, partes.path, urlencode({"verb": "Identify"}), "")
    )
    try:
        resposta = buscar(client, url)
    except httpx.HTTPError as erro:
        return {"desfecho": "rede", "detalhe": type(erro).__name__}
    if resposta.status_code >= 400:
        return {"desfecho": f"http-{resposta.status_code}", "detalhe": ""}
    try:
        raiz = ET.fromstring(resposta.content)
    except ET.ParseError:
        return {**_porque_nao_e_xml(resposta), "final": str(resposta.url)}

    for elem in raiz.iter():
        if _localname(elem.tag) == "error":
            return {"desfecho": "oai-error", "detalhe": elem.get("code") or "unknown"}

    kit = _toolkit(raiz)
    return {
        "desfecho": "ok",
        "detalhe": "",
        "sha256": hashlib.sha256(resposta.content).hexdigest(),
        "protocolVersion": _texto(raiz, "protocolVersion"),
        "earliestDatestamp": _texto(raiz, "earliestDatestamp"),
        "deletedRecord": _texto(raiz, "deletedRecord"),
        "granularity": _texto(raiz, "granularity"),
        "repositoryName": _texto(raiz, "repositoryName"),
        "toolkitTitle": kit.get("title", ""),
        "toolkitVersion": kit.get("version", ""),
        "finalUrl": str(resposta.url),
        # O corpo é guardado como texto e o hash é dos bytes. A
        # correspondência só vale se a decodificação for reversível — uma
        # origem em latin-1 quebraria o par em silêncio, e o hash deixaria de
        # conferir sem ninguém notar. Guardar o corpo só quando ele volta
        # idêntico transforma isso em campo ausente, que a conferência vê.
        "corpo": (
            texto
            if (texto := resposta.content.decode("utf-8", "replace")).encode("utf-8")
            == resposta.content
            else ""
        ),
    }


def _uma(alvo: tuple[str, str]) -> dict:
    source_id, base = alvo
    with httpx.Client(
        timeout=TIMEOUT, follow_redirects=True, headers=CABECALHO, verify=False
    ) as client:
        return {"id": source_id, "baseUrl": base, **perguntar(client, base)}


def carregar() -> dict[str, dict]:
    if not SAIDA.is_file():
        return {}
    return {o["id"]: o for o in json.loads(SAIDA.read_text())["origens"]}


def carregar_respostas() -> dict[str, str]:
    if not RESPOSTAS.is_file():
        return {}
    with gzip.open(RESPOSTAS, "rt", encoding="utf-8") as arquivo:
        return json.load(arquivo)


def coletar(refazer: bool = False) -> int:
    base = bf.ler()
    alvos = base.loc[
        base["harvest_endpoint_url"].notna(), ["source_id", "harvest_endpoint_url"]
    ]
    alvos = list(alvos.drop_duplicates("source_id").itertuples(index=False, name=None))

    havido = {} if refazer else carregar()
    # Só as que não responderam bem: origem que já entregou o Identify não
    # muda de política de exclusão entre uma execução e outra, e repetir a
    # pergunta é castigar um servidor que colaborou.
    pendentes = [(i, u) for i, u in alvos if havido.get(i, {}).get("desfecho") != "ok"]
    print(f"{len(alvos)} origens com endpoint | {len(pendentes)} a perguntar")
    if not pendentes:
        return 0

    resultados = dict(havido)
    corpos = {} if refazer else carregar_respostas()
    concluidas = 0
    with ThreadPoolExecutor(max_workers=TRABALHADORES) as piscina:
        futuros = {piscina.submit(_uma, alvo): alvo[0] for alvo in pendentes}
        for futuro in as_completed(futuros):
            achado = futuro.result()
            if corpo := achado.pop("corpo", ""):
                corpos[achado["id"]] = corpo
            resultados[achado["id"]] = achado
            concluidas += 1
            if concluidas % 100 == 0:
                oks = sum(1 for r in resultados.values() if r["desfecho"] == "ok")
                print(
                    f"  {concluidas}/{len(pendentes)} — {oks} ok acumulados", flush=True
                )

    with gzip.open(RESPOSTAS, "wt", encoding="utf-8") as arquivo:
        json.dump(corpos, arquivo, ensure_ascii=False)
    print(
        f"{RESPOSTAS.name}: {len(corpos)} respostas, {RESPOSTAS.stat().st_size // 1024} KB"
    )

    SAIDA.write_text(
        json.dumps(
            {
                "coletadoEm": bf.pd.Timestamp.now(tz="UTC").isoformat(),
                "timeout": TIMEOUT,
                "origens": sorted(resultados.values(), key=lambda o: int(o["id"])),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def resumo() -> int:
    origens = carregar()
    if not origens:
        print(f"{SAIDA} não existe")
        return 1
    import collections

    desfechos = collections.Counter(o["desfecho"] for o in origens.values())
    print(f"{len(origens)} origens perguntadas")
    for desfecho, quantas in desfechos.most_common():
        print(f"  {quantas:>5}  {desfecho}")
    oks = [o for o in origens.values() if o["desfecho"] == "ok"]
    if oks:
        print(f"\ncampos preenchidos entre as {len(oks)} que responderam:")
        for campo in (
            "protocolVersion",
            "earliestDatestamp",
            "deletedRecord",
            "granularity",
            "repositoryName",
            "toolkitVersion",
            "sha256",
        ):
            print(f"  {campo:<20} {sum(1 for o in oks if o.get(campo)):>5}")
    return 0


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument(
        "--refazer", action="store_true", help="ignora o já coletado"
    )
    argumentos.add_argument("--resumo", action="store_true", help="só relata")
    opcoes = argumentos.parse_args()
    return resumo() if opcoes.resumo else coletar(refazer=opcoes.refazer)


if __name__ == "__main__":
    raise SystemExit(main())
