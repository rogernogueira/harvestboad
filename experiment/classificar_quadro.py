#!/usr/bin/env python
"""Enriquece o quadro amostral com o tipo de cada repositório.

Estratificar exige saber o estrato de **cada unidade da população**, e não só
das sorteadas. Hoje o tipo sai de um palpite sobre a forma da URL, que falha em
cerca de um terço dos casos e devolve o rótulo `outra` — que não é um tipo, é a
classificação desistindo. Sortear dentro de um estrato assim não é estratificar.

Este script resolve isso perguntando à própria origem. O verbo `Identify` do
OAI-PMH traz, em ordem de confiança:

1. `<toolkit><title>` — o software se declara: "Open Journal Systems",
   "Open Preprint Systems", "DSpace";
2. `<sampleIdentifier>` — a forma do identificador denuncia a plataforma:
   `article/1` é OJS, `123456789/1234` é DSpace;
3. `<repositoryName>` — "DSpace at IFRS" diz o que é sem precisar de mais nada.

São duas passagens caras por repositório: buscar o `baseURL` no Harvester (o
cadastro não o tem; ele é campo do registro) e chamar `Identify` na origem. Por
isso o resultado é **gravado a cada lote** e o script **retoma de onde parou** —
uma corrida de mil e seiscentos repositórios não pode perder tudo num timeout.

    python classificar_quadro.py                    # dentro do container
    python classificar_quadro.py --limite 50        # experimentar
    python classificar_quadro.py --refazer          # ignora o que já existe

Saída: `data/quadro-amostral.json`, uma linha por repositório com `tipo`,
`natureza` e a evidência que levou à decisão.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA))

from ambiente import preparar  # noqa: E402

DADOS = PASTA / "data"
SAIDA = DADOS / "quadro-amostral.json"

CABECALHO = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

# Software declarado no `<toolkit>`, que é a evidência mais forte. A chave é
# procurada no texto em minúsculas.
TOOLKITS = {
    "open journal systems": ("ojs", "periodico"),
    "open preprint systems": ("ops", "periodico"),
    "open monograph press": ("omp", "livro"),
    "dspace": ("dspace", "repositorio"),
    "eprints": ("eprints", "repositorio"),
    "islandora": ("islandora", "repositorio"),
    "dataverse": ("dataverse", "dados"),
}

# Forma da cauda do `sampleIdentifier`, quando o toolkit não se declara.
#
# As duas primeiras são rotas de item do PKP. A terceira é o **handle** do
# DSpace, e o padrão começou exigindo seis dígitos ou mais antes da barra — o
# que só reconhecia o prefixo `123456789` que vem de fábrica. Instalação
# brasileira quase sempre troca isso: `tede/123`, `icict/456`, `riufs/789`,
# `11612/1234`. O resultado foi 66 repositórios `indeterminado` cuja forma era
# handle o tempo todo.
#
# `HANDLE` aceita qualquer prefixo sem barra seguido de número, e vem **depois**
# das rotas do PKP para não roubar `article/1`. É evidência mais fraca que o
# toolkit, e sai rotulada como tal.
FORMAS = (
    (re.compile(r"article/\d+$"), ("ojs", "periodico"), "sampleIdentifier"),
    (re.compile(r"preprint/\d+$"), ("ops", "periodico"), "sampleIdentifier"),
    (re.compile(r"\d{6,}/\d+$"), ("dspace", "repositorio"), "sampleIdentifier"),
    (re.compile(r"^oai:[^:]+:\d+$"), ("eprints", "repositorio"), "sampleIdentifier"),
    (re.compile(r":[A-Za-z0-9_.-]+/\d+$"), ("dspace", "repositorio"), "forma-handle"),
)

# Última tentativa: o nome que o repositório dá a si mesmo.
NO_NOME = (
    ("dspace", ("dspace", "repositorio")),
    ("eprints", ("eprints", "repositorio")),
    ("dataverse", ("dataverse", "dados")),
)


def _texto(raiz: ET.Element, nome: str) -> str:
    for elem in raiz.iter():
        if elem.tag.rsplit("}", 1)[-1] == nome and (elem.text or "").strip():
            return elem.text.strip()
    return ""


def _toolkit(raiz: ET.Element) -> str:
    """Título declarado dentro de `<toolkit>`, e não qualquer `<title>`.

    O envelope tem outros `<title>` — `<repositoryName>` vizinho, descrições —,
    e pegar o primeiro que aparecer confundiria o nome da revista com o nome do
    software.
    """
    for elem in raiz.iter():
        if elem.tag.rsplit("}", 1)[-1] != "toolkit":
            continue
        for filho in elem.iter():
            if filho.tag.rsplit("}", 1)[-1] == "title" and (filho.text or "").strip():
                return filho.text.strip()
    return ""


def classificar(raiz: ET.Element) -> dict:
    """Tipo e natureza do repositório, com a evidência que decidiu."""
    toolkit = _toolkit(raiz)
    nome = _texto(raiz, "repositoryName")
    exemplo = _texto(raiz, "sampleIdentifier")

    base = {"toolkit": toolkit, "repositoryName": nome, "sampleIdentifier": exemplo}

    for chave, (tipo, natureza) in TOOLKITS.items():
        if chave in toolkit.lower():
            return {**base, "tipo": tipo, "natureza": natureza, "evidencia": "toolkit"}

    for padrao, (tipo, natureza), rotulo in FORMAS:
        if exemplo and padrao.search(exemplo):
            return {**base, "tipo": tipo, "natureza": natureza, "evidencia": rotulo}

    for chave, (tipo, natureza) in NO_NOME:
        if chave in nome.lower():
            return {
                **base,
                "tipo": tipo,
                "natureza": natureza,
                "evidencia": "repositoryName",
            }

    # `indeterminado` é um desfecho honesto, e diferente de `outra`: quer dizer
    # que a origem respondeu e nada no que ela disse permitiu decidir. Quem ler
    # tem a evidência crua ao lado para julgar por conta própria.
    return {**base, "tipo": "indeterminado", "natureza": "indeterminado",
            "evidencia": "nenhuma"}


def identificar(client: httpx.Client, base_url: str, timeout: float) -> dict | None:
    partes = urlsplit(base_url)
    url = urlunsplit(
        (partes.scheme, partes.netloc, partes.path, urlencode({"verb": "Identify"}), "")
    )
    try:
        resposta = client.get(url, timeout=timeout)
        resposta.raise_for_status()
        return classificar(ET.fromstring(resposta.content))
    except (httpx.HTTPError, ET.ParseError):
        return None


def _uma_linha(linha: dict, harvests, client_hv, timeout: float) -> dict:
    """Um repositório: busca o `baseURL` no Harvester e classifica na origem."""
    saida = {
        "id": str(linha.get("harvesterRepositoryId") or ""),
        "sigla": linha.get("acronym"),
        "nome": linha.get("name"),
        "instituicao": linha.get("institutionName"),
        "ultimaColeta": linha.get("lastSnapshotId"),
        "ultimaColetaEm": linha.get("lastSnapshotDate"),
        "estadoDoIndice": linha.get("lastIndexStatus"),
        "registrosNaUltimaColeta": linha.get("lastSize"),
        "baseUrl": None,
        "tipo": "nao-apurado",
        "natureza": "nao-apurado",
        "evidencia": "nenhuma",
    }

    # Os motivos de não haver origem são diferentes e **não podem** compartilhar
    # um rótulo. Na primeira passagem todos viravam `sem-origem`, e ao conferir
    # quatro deles à mão os quatro tinham origem perfeita: o que falhou foi a
    # chamada ao Harvester, sob concorrência, num serviço que a documentação do
    # projeto descreve como perdendo cerca de metade das conexões. Um rótulo
    # único transformava falha transitória nossa em característica do
    # repositório — e inflava a não-resposta do quadro amostral.
    snapshot = linha.get("lastSnapshotId")
    if not snapshot:
        saida["tipo"] = saida["natureza"] = "sem-coleta"
        return saida
    try:
        pagina = harvests.records(str(snapshot), page=1, count=1, client=client_hv)
    except Exception as falha:  # noqa: BLE001
        saida["tipo"] = saida["natureza"] = "erro-harvester"
        saida["detalhe"] = f"{type(falha).__name__}: {str(falha)[:120]}"
        return saida

    primeiro = (pagina.get("results") or [None])[0]
    if not primeiro:
        saida["tipo"] = saida["natureza"] = "coleta-vazia"
        saida["detalhe"] = f"totalElements={pagina.get('totalElements')}"
        return saida

    base = (primeiro.get("origin") or "").strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        saida["tipo"] = saida["natureza"] = "registro-sem-origem"
        saida["detalhe"] = f"origin={primeiro.get('origin')!r}"
        return saida
    saida["baseUrl"] = base
    saida["metadataPrefix"] = primeiro.get("metadataPrefix") or "oai_dc"

    with httpx.Client(
        timeout=timeout, follow_redirects=True, headers=CABECALHO
    ) as client:
        achado = identificar(client, base, timeout)

    if achado is None:
        saida["tipo"] = "origem-muda"
        saida["natureza"] = "origem-muda"
        return saida
    return {**saida, **achado}


def reclassificar(caminho: Path) -> int:
    """Reaplica as regras à evidência já gravada.

    A evidência crua — `toolkit`, `repositoryName`, `sampleIdentifier` — fica no
    arquivo justamente para isto: quando a regra de classificação melhora, não
    é preciso perguntar de novo a mil e seiscentas origens. Só quem não tem
    evidência nenhuma continua como está.
    """
    dados = json.loads(caminho.read_text())
    antes: dict[str, int] = {}
    depois: dict[str, int] = {}

    for linha in dados["repositorios"]:
        antes[linha["tipo"]] = antes.get(linha["tipo"], 0) + 1
        evidencia = ET.Element("Identify")
        for tag, valor in (
            ("repositoryName", linha.get("repositoryName")),
            ("sampleIdentifier", linha.get("sampleIdentifier")),
        ):
            if valor:
                ET.SubElement(evidencia, tag).text = valor
        if linha.get("toolkit"):
            kit = ET.SubElement(evidencia, "toolkit")
            ET.SubElement(kit, "title").text = linha["toolkit"]

        if len(evidencia) == 0:
            depois[linha["tipo"]] = depois.get(linha["tipo"], 0) + 1
            continue

        novo = classificar(evidencia)
        if novo["tipo"] != "indeterminado" or linha["tipo"] == "indeterminado":
            linha.update(
                {k: novo[k] for k in ("tipo", "natureza", "evidencia")}
            )
        depois[linha["tipo"]] = depois.get(linha["tipo"], 0) + 1

    dados["porTipo"] = dict(sorted(depois.items(), key=lambda p: -p[1]))
    dados["reclassificadoEm"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    temporario = caminho.with_suffix(".json.parcial")
    temporario.write_text(json.dumps(dados, ensure_ascii=False, indent=2) + "\n")
    os.replace(temporario, caminho)

    print(f"reclassificados {len(dados['repositorios'])} sem tocar na rede", file=sys.stderr)
    for tipo in sorted(set(antes) | set(depois), key=lambda t: -depois.get(t, 0)):
        a, d = antes.get(tipo, 0), depois.get(tipo, 0)
        marca = f"  {d - a:+d}" if d != a else ""
        print(f"  {tipo:<18}{a:>5} → {d:>5}{marca}", file=sys.stderr)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--entrada", type=Path, default=DADOS / "indice-repositorios.json")
    parser.add_argument("--saida", type=Path, default=SAIDA)
    parser.add_argument("--estado", default="INDEXED", help="vazio aceita todos")
    parser.add_argument("--limite", type=int, default=0)
    parser.add_argument("--trabalhadores", type=int, default=8)
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument(
        "--reclassificar",
        action="store_true",
        help=(
            "reaplica as regras à evidência já gravada, sem tocar na rede. "
            "Serve quando a regra melhora e os dados continuam bons."
        ),
    )
    parser.add_argument("--refazer", action="store_true")
    parser.add_argument(
        "--somente-verificadas",
        type=Path,
        help=(
            "arquivo de `verificar_mudas.py`: refaz só as origens que a "
            "verificação mostrou vivas. Sem isso, `--refazer-falhas` gastaria "
            "o prazo cheio nas que já se sabe mortas."
        ),
    )
    parser.add_argument(
        "--refazer-falhas",
        action="store_true",
        help="reprocessa só os que não renderam tipo — falha transitória é comum",
    )
    args = parser.parse_args()

    if args.reclassificar:
        return reclassificar(args.saida)

    preparar()
    from apps.harvests import services as harvests  # noqa: PLC0415
    from apps.integrations.harvester import HarvesterClient  # noqa: PLC0415

    linhas = json.loads(args.entrada.read_text())["repositorios"]
    if args.estado:
        linhas = [l for l in linhas if l.get("lastIndexStatus") == args.estado]
    if args.limite:
        linhas = linhas[: args.limite]

    # Retomada: o que já foi classificado não é refeito. Uma passagem de mil e
    # seiscentos repositórios leva dezenas de minutos e atravessa origens
    # instáveis; perder tudo por causa da última seria absurdo.
    SEM_TIPO = {
        "nao-apurado",
        "sem-origem",
        "erro-harvester",
        "origem-muda",
        "indeterminado",
    }
    prontos: dict[str, dict] = {}
    if args.saida.is_file() and not args.refazer:
        anterior = json.loads(args.saida.read_text())
        prontos = {r["id"]: r for r in anterior.get("repositorios", [])}
        if args.refazer_falhas:
            # Só sai de `prontos` o que **vai mesmo** ser refeito. Tirar todas
            # as falhas e só depois filtrar a fila por `--somente-verificadas`
            # apagava do arquivo as que ficaram de fora: numa execução o quadro
            # encolheu de 1.596 para 1.326 linhas, em silêncio.
            vivas = None
            if args.somente_verificadas:
                checagem = json.loads(args.somente_verificadas.read_text())
                vivas = {
                    o["id"]
                    for o in checagem["origens"]
                    if o["veredito"] in ("responde-aos-dois", "so-Identify")
                }
            refazer = {
                k
                for k, v in prontos.items()
                if v.get("tipo") in SEM_TIPO and (vivas is None or k in vivas)
            }
            for chave in refazer:
                del prontos[chave]
            print(
                f"refazendo {len(refazer)} falhas; {len(prontos)} preservados",
                file=sys.stderr,
            )
        else:
            print(f"retomando: {len(prontos)} já classificados", file=sys.stderr)

    pendentes = [l for l in linhas if str(l.get("harvesterRepositoryId")) not in prontos]

    if args.somente_verificadas:
        # Só as que respondem ao `Identify`: é dele que sai o tipo. As que não
        # respondem a verbo nenhum não viram tipo por insistência, e gastariam
        # o prazo folgado duas vezes cada.
        verificacao = json.loads(args.somente_verificadas.read_text())
        vivas = {
            o["id"]
            for o in verificacao["origens"]
            if o["veredito"] in ("responde-aos-dois", "so-Identify")
        }
        antes = len(pendentes)
        pendentes = [
            l for l in pendentes if str(l.get("harvesterRepositoryId")) in vivas
        ]
        print(
            f"só as verificadas vivas: {len(pendentes)} de {antes} pendentes",
            file=sys.stderr,
        )
    print(f"{len(pendentes)} a classificar de {len(linhas)}", file=sys.stderr)

    client_hv = HarvesterClient()
    args.saida.parent.mkdir(parents=True, exist_ok=True)

    def gravar() -> None:
        """Grava por arquivo temporário e renomeia.

        `write_text` direto deixa o arquivo pela metade entre o `open` e o
        `close`, e quem o ler nesse instante vê JSON truncado. Numa corrida de
        dezenas de minutos, que reescreve a cada lote justamente para poder ser
        acompanhada, isso não é teórico: aconteceu na primeira execução.
        `os.replace` é atômico dentro do mesmo sistema de arquivos.
        """
        contagem: dict[str, int] = {}
        for item in prontos.values():
            contagem[item["tipo"]] = contagem.get(item["tipo"], 0) + 1
        temporario = args.saida.with_suffix(".json.parcial")
        temporario.write_text(
            json.dumps(
                {
                    "geradoEm": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "estado": args.estado,
                    "porTipo": dict(sorted(contagem.items(), key=lambda p: -p[1])),
                    "repositorios": list(prontos.values()),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n"
        )
        os.replace(temporario, args.saida)

    lote = args.trabalhadores * 5
    with ThreadPoolExecutor(max_workers=args.trabalhadores) as pool:
        for inicio in range(0, len(pendentes), lote):
            fatia = pendentes[inicio : inicio + lote]
            for achado in pool.map(
                lambda l: _uma_linha(l, harvests, client_hv, args.timeout), fatia
            ):
                prontos[achado["id"]] = achado
            gravar()
            print(f"  ... {len(prontos)}/{len(linhas)}", file=sys.stderr)

    gravar()
    contagem: dict[str, int] = {}
    for item in prontos.values():
        contagem[item["tipo"]] = contagem.get(item["tipo"], 0) + 1
    print(f"\n{len(prontos)} em {args.saida}", file=sys.stderr)
    for tipo, n in sorted(contagem.items(), key=lambda p: -p[1]):
        print(f"  {tipo:<16}{n:>5}  {100 * n / len(prontos):5.1f}%", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
