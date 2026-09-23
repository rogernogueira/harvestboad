#!/usr/bin/env python
"""Monta a lista de repositórios OAI do experimento.

São quatro fontes, e a escolha muda o que se está medindo:

- `--fonte harvester`: os repositórios que o HarvestBoard realmente mostra. É o
  alvo natural, e só responde dentro da rede do IBICT.
- `--fonte cache`: o Redis da aplicação. As chaves `oai:link:v1:` guardam o
  `baseURL` no próprio nome, então um cache quente é uma lista de endereços
  **comprovadamente em uso** — de graça e sem tocar em ninguém. O tamanho é o
  que o uso tiver produzido; num cache frio não vem nada.
- `--fonte indice`: sorteia entre os repositórios do índice da aplicação
  (`data/indice-repositorios.json`, ou o cache) e vai ao Harvester buscar o
  `origin` de um registro de cada. É a população de verdade, e a única fonte em
  que dá para filtrar por estado — só `lastIndexStatus == INDEXED` interessa,
  que são os repositórios cujos registros o HarvestBoard consegue mostrar.
  Precisa das duas redes ao mesmo tempo, logo do container.
- `--fonte re3data` (padrão): diretório aberto e sem chave, que publica o
  `baseURL` OAI-PMH de cada repositório registrado. É o que resta quando as
  duas de cima não estão ao alcance.

A diferença entre as duas populações importa na hora de ler o resultado: o
re3data é forte em repositório de dados (DSpace, Dataverse, CKAN) e fraco em
periódico OJS, que é a maioria do que o HarvestBoard coleta. Por isso a lista
sai anotada com a plataforma que o endereço denuncia, e o relatório separa os
números por ela.

Saída: `repositorios.json`, com `{"fonte", "geradoEm", "repositorios": [...]}`.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import httpx

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA))

from ambiente import preparar  # noqa: E402

# Os JSON ficam em `data/`, separados dos scripts: são saída de corrida, não
# código, e uma pasta só para eles deixa claro o que dá para apagar e refazer.
DADOS = PASTA / "data"
SAIDA = DADOS / "repositorios.json"

RE3DATA = "https://www.re3data.org/api/v1"
CABECALHO = {"User-Agent": "Mozilla/5.0 (compatible; HarvestBoard-experimento/1.0)"}

# Casos fixos, sempre no começo da lista. O primeiro é o registro que motivou a
# correção: o `dc:identifier` aponta o contexto de site do OJS, e o endereço da
# página do item só sai do `setSpec`.
SEMENTES = [
    {
        "id": "esmat",
        "nome": "Revista ESMAT (TJTO)",
        # Endereço como o Harvester o tem cadastrado — lido das chaves
        # `oai:link:v1:` do Redis da aplicação, não adivinhado. O caminho do
        # OJS traz o idioma (`/pt_BR`), e é por ele que a produção resolve.
        "baseUrl": "https://revista.esmat.tjto.jus.br/revista_esmat/pt_BR/oai",
        "plataforma": "ojs",
        "metadataPrefix": "oai_dc",
        "nota": "caso de origem: o DOI do dc:identifier nunca foi registrado (404)",
    },
]


def plataforma_de(base_url: str) -> str:
    """Plataforma que o próprio endereço denuncia.

    Palpite de rótulo, não de comportamento: serve para agrupar o relatório, e
    nada no experimento depende de acertar.
    """
    url = base_url.lower()
    if "/index.php/" in url or "/ojs" in url:
        return "ojs"
    if "dataverse" in url:
        return "dataverse"
    if "/oai/request" in url or "/dspace" in url or "/jspui" in url:
        return "dspace"
    if "eprints" in url:
        return "eprints"
    return "outra"


def sem_query(url: str) -> str:
    """O re3data publica o endereço já com `?verb=Identify`; o baseURL é sem."""
    partes = urlsplit(url.strip())
    return urlunsplit((partes.scheme, partes.netloc, partes.path, "", "")).rstrip("/")


def _ids_re3data(client: httpx.Client) -> list[str]:
    resposta = client.get(f"{RE3DATA}/repositories")
    resposta.raise_for_status()
    raiz = ET.fromstring(resposta.content)
    return [e.text or "" for e in raiz.iter("id") if (e.text or "").strip()]


def _oai_de(client: httpx.Client, ident: str) -> dict | None:
    """Detalhe de um repositório, se ele publicar endpoint OAI-PMH."""
    try:
        resposta = client.get(f"{RE3DATA}/repository/{ident}")
        resposta.raise_for_status()
        raiz = ET.fromstring(resposta.content)
    except (httpx.HTTPError, ET.ParseError):
        return None

    nome = ""
    for elem in raiz.iter():
        if elem.tag.rsplit("}", 1)[-1] == "repositoryName":
            nome = (elem.text or "").strip()
            break

    for elem in raiz.iter():
        if elem.tag.rsplit("}", 1)[-1] != "api":
            continue
        if (elem.get("apiType") or "").upper() != "OAI-PMH":
            continue
        base = sem_query(elem.text or "")
        if not base.startswith(("http://", "https://")):
            continue
        return {
            "id": ident,
            "nome": nome or ident,
            "baseUrl": base,
            "plataforma": plataforma_de(base),
        }
    return None


def do_re3data(quantidade: int, semente: int, trabalhadores: int) -> list[dict]:
    with httpx.Client(timeout=30, headers=CABECALHO, follow_redirects=True) as client:
        ids = _ids_re3data(client)
        print(f"re3data: {len(ids)} repositórios registrados", file=sys.stderr)

        # Amostra embaralhada com semente fixa: o experimento precisa ser
        # repetível, e varrer o diretório em ordem alfabética concentraria a
        # amostra num punhado de instituições.
        random.Random(semente).shuffle(ids)

        achados: list[dict] = []
        # A cota conta endereço único, não registro: uma federação inscreve
        # cada repositório-membro com o mesmo endpoint OAI do nó central, e
        # deduplicar só no fim entregaria uma lista curta.
        vistos: set[str] = set()
        with ThreadPoolExecutor(max_workers=trabalhadores) as pool:
            # Em lotes, para parar de buscar assim que a cota fecha — só uma
            # fração dos registros publica endpoint OAI.
            for inicio in range(0, len(ids), trabalhadores * 8):
                lote = ids[inicio : inicio + trabalhadores * 8]
                for achado in pool.map(lambda i: _oai_de(client, i), lote):
                    if achado and achado["baseUrl"] not in vistos:
                        vistos.add(achado["baseUrl"])
                        achados.append(achado)
                print(f"  ... {len(achados)}/{quantidade}", file=sys.stderr)
                if len(achados) >= quantidade:
                    break
        return achados[:quantidade]


def do_harvester(quantidade: int) -> list[dict]:
    """Repositórios como o HarvestBoard os vê, pelo Harvester.

    O `baseURL` OAI não vem na listagem: `/private/networks` traz cadastro e
    resumo da última coleta, e o `oaiSource` só aparece no detalhe de cada
    repositório. São duas rotas, uma por repositório na segunda.

    Este caminho **não foi exercitado** ao escrever o experimento: a porta 8090
    do Harvester não responde fora da rede do IBICT. Rode-o lá dentro antes de
    confiar nos números que ele produzir.
    """
    preparar()

    from apps.harvests import services as harvests  # noqa: PLC0415
    from apps.integrations.harvester import HarvesterClient  # noqa: PLC0415
    from apps.repositories import services  # noqa: PLC0415

    client = HarvesterClient()
    payload = client.list_networks(page=1, count=quantidade * 2) or {}
    linhas = payload.get("networks") or []

    achados = []
    for linha in linhas:
        ident = str(linha.get("networkID") or "")
        snapshot = linha.get("lstSnapshotID")
        if not ident or not snapshot:
            continue
        # O `baseURL` **não** está no cadastro: `oaiSource` volta `None` nos
        # repositórios que conferi no cache. Ele é campo do registro coletado,
        # então o caminho é pedir um registro da última coleta e ler o `origin`.
        try:
            pagina = harvests.records(str(snapshot), page=1, count=1, client=client)
        except Exception:  # noqa: BLE001 — repositório sem coleta indexada
            continue
        primeiro = (pagina.get("results") or [None])[0]
        if not primeiro:
            continue
        base = sem_query(primeiro.get("origin") or "")
        if not base.startswith(("http://", "https://")):
            continue
        detalhe = services.repository_detail(ident, client=client)
        achados.append(
            {
                "id": ident,
                "nome": detalhe.get("name") or linha.get("name") or ident,
                "baseUrl": base,
                "plataforma": plataforma_de(base),
                "metadataPrefix": primeiro.get("metadataPrefix")
                or detalhe.get("metadataPrefix")
                or "oai_dc",
            }
        )
        if len(achados) >= quantidade:
            break
    return achados


def _origem_do_repositorio(linha: dict, harvests, client) -> dict | None:
    """`baseURL` e prefixo de um repositório, lidos de um registro da última coleta.

    É a única forma: o cadastro devolve `oaiSource` nulo, e o endereço da origem
    é campo do registro. Um registro basta — todos os de uma coleta vêm do mesmo
    `baseURL`.
    """
    snapshot = linha.get("lastSnapshotId")
    if not snapshot:
        return None
    try:
        pagina = harvests.records(str(snapshot), page=1, count=1, client=client)
    except Exception:  # noqa: BLE001 — coleta some, origem cai; pula o repositório
        return None

    primeiro = (pagina.get("results") or [None])[0]
    if not primeiro:
        return None
    base = sem_query(primeiro.get("origin") or "")
    if not base.startswith(("http://", "https://")):
        return None
    return {
        "id": str(linha.get("harvesterRepositoryId") or ""),
        "nome": linha.get("name") or linha.get("acronym") or "",
        "sigla": linha.get("acronym"),
        "instituicao": linha.get("institutionName"),
        "baseUrl": base,
        "plataforma": plataforma_de(base),
        "metadataPrefix": primeiro.get("metadataPrefix") or "oai_dc",
        "ultimaColeta": linha.get("lastSnapshotId"),
        "ultimaColetaEm": linha.get("lastSnapshotDate"),
        "estadoDaColeta": linha.get("lastSnapshotStatus"),
        "estadoDoIndice": linha.get("lastIndexStatus"),
        "registrosNaUltimaColeta": linha.get("lastSize"),
    }


def _indice() -> list[dict]:
    """O índice, do JSON exportado se houver, senão do cache da aplicação."""
    arquivo = DADOS / "indice-repositorios.json"
    if arquivo.is_file():
        return json.loads(arquivo.read_text())["repositorios"]

    preparar()
    from django.core.cache import cache  # noqa: PLC0415

    from apps.repositories.services import CACHE_PREFIX  # noqa: PLC0415

    return cache.get(f"{CACHE_PREFIX}:index") or []


def do_indice(
    quantidade: int, semente: int, estado: str, trabalhadores: int
) -> list[dict]:
    """Amostra do índice da aplicação, com o `baseURL` buscado no Harvester."""
    preparar()

    from apps.harvests import services as harvests  # noqa: PLC0415
    from apps.integrations.harvester import HarvesterClient  # noqa: PLC0415

    linhas = _indice()
    if not linhas:
        print("índice vazio: exporte-o ou aqueça o cache antes", file=sys.stderr)
        return []

    if estado:
        linhas = [linha for linha in linhas if linha.get("lastIndexStatus") == estado]
    print(
        f"índice: {len(linhas)} repositórios com estado {estado or 'qualquer'}",
        file=sys.stderr,
    )

    # Embaralha com semente fixa e vai consumindo: parte não devolve `origin`
    # (coleta sumida, origem fora do ar), então a amostra precisa de folga.
    random.Random(semente).shuffle(linhas)

    client = HarvesterClient()
    achados: list[dict] = []
    vistos: set[str] = set()
    # Poucos trabalhadores de propósito: a origem é lenta e perde cerca de
    # metade das conexões, e empilhar paralelismo em cima disso só multiplica
    # repetição. Aqui o ganho vem do cache, não da pressa.
    with ThreadPoolExecutor(max_workers=trabalhadores) as pool:
        for inicio in range(0, len(linhas), trabalhadores * 4):
            lote = linhas[inicio : inicio + trabalhadores * 4]
            for achado in pool.map(
                lambda linha: _origem_do_repositorio(linha, harvests, client), lote
            ):
                if achado and achado["baseUrl"] not in vistos:
                    vistos.add(achado["baseUrl"])
                    achados.append(achado)
            print(f"  ... {len(achados)}/{quantidade}", file=sys.stderr)
            if len(achados) >= quantidade:
                break
    return achados[:quantidade]



# Alocação por estrato, e o que cada uma responde.
#
# `proporcional` reproduz a população: serve para estimar o total, e é o que
# minimiza a variância da estimativa global quando os desvios são parecidos —
# que é o caso aqui (0,38 no DSpace, 0,34 no OJS, 0,34 nos demais).
#
# `igual` dá o mesmo número a cada estrato: serve para **comparar tipos**, que
# é a pergunta quando se estratifica por tipo de repositório. Com alocação
# proporcional o DSpace ficaria com ~7% da amostra e margem de ±18 pontos, que
# não sustenta comparação nenhuma.
#
# `censo` leva o estrato inteiro. É o certo para estrato pequeno: o DSpace tem
# cerca de 110 repositórios na população, e alcançar ±5 pontos por amostragem
# exigiria mais repositórios do que existem.
ALOCACOES = ("proporcional", "igual", "censo")


def alocar(
    estratos: dict[str, list], quantidade: int, modo: str, teto_censo: int = 250
) -> dict[str, int]:
    """Quantos repositórios sortear de cada estrato."""
    if modo == "censo":
        return {nome: len(linhas) for nome, linhas in estratos.items()}

    if modo == "igual":
        base = quantidade // len(estratos)
        # Estrato menor que a cota vira censo: não há como sortear 200 de 110.
        cotas = {nome: min(base, len(linhas)) for nome, linhas in estratos.items()}
        # O que sobrou de estrato pequeno é redistribuído entre os que cabem.
        sobra = quantidade - sum(cotas.values())
        folgados = [n for n, l in estratos.items() if len(l) > cotas[n]]
        while sobra > 0 and folgados:
            for nome in folgados:
                if sobra == 0:
                    break
                if cotas[nome] < len(estratos[nome]):
                    cotas[nome] += 1
                    sobra -= 1
            folgados = [n for n in folgados if cotas[n] < len(estratos[n])]
        return cotas

    total = sum(len(l) for l in estratos.values()) or 1
    return {
        nome: min(len(linhas), round(quantidade * len(linhas) / total))
        for nome, linhas in estratos.items()
    }


def do_quadro(
    quantidade: int,
    semente: int,
    campo: str,
    modo: str,
    excluir: tuple[str, ...],
    trabalhadores: int,
) -> list[dict]:
    """Amostra estratificada a partir do quadro já classificado.

    Diferente de `do_indice`, que sorteia de uma população sem estrato: aqui o
    tipo de cada repositório já foi apurado por `classificar_quadro.py`, e o
    sorteio acontece **dentro** de cada estrato. É isso que permite comparar
    tipos com precisão parecida, em vez de deixar o menor deles como ruído.

    O `baseURL` já vem no quadro, então este caminho **não** toca o Harvester.
    """
    arquivo = DADOS / "quadro-amostral.json"
    if not arquivo.is_file():
        print(
            f"sem quadro classificado em {arquivo};\n"
            "rode `classificar_quadro.py` antes — não dá para estratificar por "
            "um atributo que a população não tem.",
            file=sys.stderr,
        )
        return []

    linhas = json.loads(arquivo.read_text())["repositorios"]
    linhas = [
        l
        for l in linhas
        if l.get("baseUrl") and l.get(campo) and l[campo] not in excluir
    ]

    estratos: dict[str, list] = {}
    for linha in linhas:
        estratos.setdefault(linha[campo], []).append(linha)

    cotas = alocar(estratos, quantidade, modo)
    print(f"quadro: {len(linhas)} repositórios em {len(estratos)} estratos", file=sys.stderr)
    for nome in sorted(estratos, key=lambda n: -len(estratos[n])):
        print(f"  {nome:<16}{len(estratos[nome]):>5} na população → {cotas[nome]:>4} sorteados", file=sys.stderr)

    sorteio = random.Random(semente)
    achados: list[dict] = []
    for nome, grupo in sorted(estratos.items()):
        escolhidos = sorteio.sample(grupo, min(cotas[nome], len(grupo)))
        for linha in escolhidos:
            achados.append(
                {
                    "id": linha["id"],
                    "nome": linha.get("nome") or linha["id"],
                    "sigla": linha.get("sigla"),
                    "instituicao": linha.get("instituicao"),
                    "baseUrl": linha["baseUrl"],
                    # A plataforma deixa de ser palpite sobre a URL: vem do
                    # `Identify` da própria origem, com a evidência ao lado.
                    "plataforma": linha.get("tipo"),
                    "natureza": linha.get("natureza"),
                    "evidenciaDoTipo": linha.get("evidencia"),
                    "estratoDeAmostra": nome,
                    "metadataPrefix": linha.get("metadataPrefix") or "oai_dc",
                    "ultimaColeta": linha.get("ultimaColeta"),
                    "ultimaColetaEm": linha.get("ultimaColetaEm"),
                    "estadoDoIndice": linha.get("estadoDoIndice"),
                    "registrosNaUltimaColeta": linha.get("registrosNaUltimaColeta"),
                }
            )
    return achados


def base_url_da_chave(chave: str) -> tuple[str, str] | None:
    """`baseURL` e prefixo escondidos numa chave `oai:link:v1:...`.

    A chave é `{prefixo_do_cache}:{base_url}:{prefix}:{oai_id}`, e os três
    últimos campos têm ":" dentro: o baseURL pode ter porta, e o identificador
    OAI começa com `oai:`. Não dá para separar por contagem de ":", então o
    corte é testado da esquerda para a direita e vale o primeiro em que o lado
    esquerdo é uma URL inteira e o campo seguinte parece nome de prefixo de
    metadado — nunca um número, que seria porta.
    """
    marca = "oai:link:v1:"
    if marca not in chave:
        return None
    resto = chave.split(marca, 1)[1]
    if not resto.startswith(("http://", "https://")):
        return None

    posicao = len("https://")
    while (corte := resto.find(":", posicao)) != -1:
        base, cauda = resto[:corte], resto[corte + 1 :]
        prefixo, _, identificador = cauda.partition(":")
        partes = urlsplit(base)
        if (
            partes.netloc
            and identificador
            and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]*", prefixo)
        ):
            return base, prefixo
        posicao = corte + 1
    return None


def do_cache(quantidade: int) -> list[dict]:
    """Endereços que a própria aplicação já resolveu, lidos do Redis.

    Vale o que o uso tiver produzido: num cache frio não vem nada, e mesmo
    quente ele cobre só os registros que alguém abriu. Em compensação são
    endereços que comprovadamente passaram pela resolução de verdade.
    """
    preparar()

    from django.core.cache import cache  # noqa: PLC0415

    try:
        # `RedisCache` nativo do Django: o cliente de verdade mora em
        # `_cache.get_client()`. Não é a mesma API do `django-redis`, que
        # exporia `cache.client` — trocar de backend quebra esta linha.
        cliente = cache._cache.get_client()  # noqa: SLF001
        chaves = [
            c.decode() if isinstance(c, bytes) else c
            for c in cliente.scan_iter(match="*oai:link:v1:*")
        ]
    except Exception as falha:  # noqa: BLE001
        print(f"cache indisponível: {falha}", file=sys.stderr)
        return []

    achados: dict[str, dict] = {}
    for chave in chaves:
        lido = base_url_da_chave(chave)
        if not lido:
            continue
        base, prefixo = lido
        base = sem_query(base)
        if base in achados:
            continue
        achados[base] = {
            "id": f"cache-{len(achados) + 1}",
            "nome": urlsplit(base).netloc,
            "baseUrl": base,
            "plataforma": plataforma_de(base),
            "metadataPrefix": prefixo,
        }
    print(f"cache: {len(chaves)} chaves -> {len(achados)} endereços", file=sys.stderr)
    return list(achados.values())[:quantidade]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fonte",
        choices=("re3data", "harvester", "cache", "indice", "quadro"),
        default="re3data",
    )
    parser.add_argument(
        "--estratificar-por",
        default="tipo",
        choices=("tipo", "natureza"),
        help="campo do quadro classificado que define o estrato",
    )
    parser.add_argument(
        "--alocacao",
        default="igual",
        choices=ALOCACOES,
        help="`igual` para comparar tipos; `proporcional` para estimar o total",
    )
    parser.add_argument(
        "--excluir-tipo",
        action="append",
        default=["sem-origem", "origem-muda"],
        help="tipos fora da amostra; repetível",
    )
    parser.add_argument(
        "--estado-do-indice",
        default="INDEXED",
        help="filtro de `lastIndexStatus` na fonte `indice`; vazio aceita todos",
    )
    parser.add_argument("--quantidade", type=int, default=100)
    parser.add_argument("--semente", type=int, default=20260919)
    parser.add_argument("--trabalhadores", type=int, default=16)
    parser.add_argument("--saida", type=Path, default=SAIDA)
    args = parser.parse_args()

    args.saida.parent.mkdir(parents=True, exist_ok=True)
    cota = max(0, args.quantidade - len(SEMENTES))
    if args.fonte == "harvester":
        repositorios = do_harvester(cota)
    elif args.fonte == "cache":
        repositorios = do_cache(cota)
    elif args.fonte == "quadro":
        repositorios = do_quadro(
            cota,
            args.semente,
            args.estratificar_por,
            args.alocacao,
            tuple(args.excluir_tipo),
            args.trabalhadores,
        )
    elif args.fonte == "indice":
        repositorios = do_indice(
            cota, args.semente, args.estado_do_indice, args.trabalhadores
        )
    else:
        repositorios = do_re3data(cota, args.semente, args.trabalhadores)

    # Semente primeiro, e sem repetir baseURL — o re3data registra o mesmo
    # endpoint para repositórios irmãos de uma federação.
    todos, vistos = [], set()
    for item in [*SEMENTES, *repositorios]:
        if item["baseUrl"] in vistos:
            continue
        vistos.add(item["baseUrl"])
        todos.append(item)

    args.saida.write_text(
        json.dumps(
            {
                "fonte": args.fonte,
                "geradoEm": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "semente": args.semente,
                "repositorios": todos,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    print(f"{len(todos)} repositórios em {args.saida}", file=sys.stderr)
    contagem: dict[str, int] = {}
    for item in todos:
        contagem[item["plataforma"]] = contagem.get(item["plataforma"], 0) + 1
    print(f"  plataformas: {contagem}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
