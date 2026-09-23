#!/usr/bin/env python
"""Os dois botões do registro, medidos em 100 repositórios × 2 itens.

A tela de um registro oferece dois destinos, e o experimento abre os dois:

- **Página do item** — endereço resolvido por `apps.integrations.oai`, o mesmo
  código que a aplicação roda. É o que tem heurística e, portanto, o que pode
  errar de alvo.
- **OAI-PMH** — o `GetRecord` na origem, montado aqui do mesmo jeito que
  `frontend/src/lib/recordLink.ts:oaiGetRecordUrl` monta. Não tem heurística:
  ou a origem atende, ou não.

Cada registro é medido **duas vezes**, pela régua nova e pela antiga, para que
a comparação não dependa de trocar de commit no meio:

- `nova`: o endereço que `_resolver` devolve hoje — candidatas do metadado
  conferidas uma a uma, e derivação pelo `setSpec` quando nenhuma sobrevive;
- `antiga`: o que a régua anterior teria escolhido — a primeira candidata na
  ordem de preferência, devolvida sem conferir.

A conferência do experimento é própria e independente das duas: abre o
endereço, segue os redirecionamentos e pergunta se o que chegou ainda é a rota
de um item. Um 200 na tela de login do OJS não conta como página do item, e é
justamente esse desfecho que a régua antiga não enxergava.

Uso (de dentro de `backend/`, que é onde vive o ambiente):

    uv run python ../experiment/experimento.py
    uv run python ../experiment/experimento.py --itens 2 --trabalhadores 12

Saída: `resultados.json` e um resumo no terminal. `relatorio.py` relê o JSON.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import threading
import unicodedata
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA))

from ambiente import preparar  # noqa: E402

preparar()

from django.conf import settings  # noqa: E402

from apps.integrations.oai import (  # noqa: E402
    FORMA_NA_ROTA,
    REGRAS,
    USER_AGENT_HEADER,
    _confirmar,
    _derivadas,
    _doi_do_identificador,
    _resolver,
)

DADOS = PASTA / "data"
ENTRADA = DADOS / "repositorios.json"
SAIDA = DADOS / "resultados.json"

PREFIXO_PADRAO = "oai_dc"


# ---------------------------------------------------------------- utilidades


def _localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def url_get_record(base_url: str, oai_id: str, prefix: str) -> str:
    """O endereço do botão OAI-PMH, montado como o frontend monta.

    `oaiGetRecordUrl` usa `URL.searchParams`, que preserva o que já estava na
    query do `origin` e substitui só os três parâmetros do verbo. `urlsplit` +
    `urlencode` aqui fazem o mesmo para o caso que interessa: baseURL sem query.
    """
    partes = urlsplit(base_url)
    query = urlencode(
        {"verb": "GetRecord", "identifier": oai_id, "metadataPrefix": prefix}
    )
    return urlunsplit((partes.scheme, partes.netloc, partes.path, query, ""))


# Um endereço só é aberto uma vez por corrida, e o desfecho vale para as duas
# réguas. Além de cortar quase metade das requisições, é o que torna a
# comparação legítima: numa medição anterior o mesmo `/handle/` deu `ok` para
# uma régua e `rede` para a outra — a origem tinha passado a limitar taxa entre
# as duas visitas, e a diferença ia para a conta da mudança sem ser dela.
_ABERTURAS: dict[tuple[str, str], dict] = {}
_TRAVA = threading.Lock()

# Status que não dizem se a página existe: dizem que este cliente não é
# bem-vindo. Contá-los como link quebrado culparia a heurística por um WAF.
BLOQUEIO = {401, 403, 405, 429}


def abrir(client: httpx.Client, url: str, forma=None, regra: str = "") -> dict:
    """Abre um endereço e diz o que aconteceu, do ponto de vista de quem clica.

    `forma` é o gabarito da rota do item, quando a regra que escolheu o
    endereço tem um. Os desfechos:

    - `ok`: abriu e continua sendo a rota de um item;
    - `fora-da-rota`: respondeu 2xx/3xx, mas o redirecionamento levou para
      outro lugar — login, capa do periódico, busca;
    - `bloqueado`: 401/403/405/429. Cloudflare barrando cliente sem navegador,
      ou servidor que não implementa HEAD. Não é veredito sobre o endereço, e
      por isso não entra na conta de link enganoso;
    - `http-4xx` / `http-5xx`: a origem negou;
    - `rede`: não deu para perguntar (DNS, conexão, TLS, tempo).
    """
    chave = (url, regra)
    with _TRAVA:
        if chave in _ABERTURAS:
            return _ABERTURAS[chave]

    try:
        resposta = client.head(url)
        if resposta.status_code in (405, 501):
            # Servidor que não implementa HEAD; do GET só interessa o status.
            resposta = client.get(url)
        final = str(resposta.url)
        status = resposta.status_code
        if status in BLOQUEIO:
            saida = {"desfecho": "bloqueado", "status": status, "final": final}
        elif status >= 500:
            saida = {"desfecho": "http-5xx", "status": status, "final": final}
        elif status >= 400:
            saida = {"desfecho": "http-4xx", "status": status, "final": final}
        elif forma is not None and not forma(final):
            saida = {"desfecho": "fora-da-rota", "status": status, "final": final}
        else:
            saida = {"desfecho": "ok", "status": status, "final": final}
    except httpx.HTTPError as erro:
        saida = {"desfecho": "rede", "detalhe": type(erro).__name__}

    with _TRAVA:
        _ABERTURAS[chave] = saida
    return saida


def _melhor_antigo(candidatas: list[str]) -> tuple[str, str] | None:
    """A escolha da régua anterior entre as URLs do metadado.

    Reimplementada aqui, e não importada, porque ela não existe mais no módulo.
    São seis linhas, e mantê-las no experimento é o que permite comparar as
    duas réguas numa passada só, sem trocar de commit no meio da medição.
    """
    for nome, regra, _ in REGRAS:
        for url in candidatas:
            if regra(url):
                return url, nome
    if candidatas:
        return candidatas[0], "primeira"
    return None


def link_antigo(oai_id: str, base_url: str, candidatas: list[str]) -> dict:
    """O endereço que a régua anterior teria devolvido, inteira.

    Reconstruí-la por completo é o que impede o experimento de inventar ganho:
    sem candidata no metadado, a régua antiga **derivava**, e a derivação já
    era conferida antes da mudança. Contar esses casos como "a antiga não
    tinha link" contaria a favor da nova um acerto que ela não trouxe.

    As três diferenças que sobram, e que o experimento mede:

    1. a candidata do metadado saía sem conferência nenhuma;
    2. a conferência da derivada olhava só o status, não a rota final;
    3. a derivação do OJS não conhecia o `setSpec`.
    """
    escolha = _melhor_antigo(candidatas)
    if escolha:
        url, regra = escolha
        return {"link": url, "source": f"record:{regra}", "regra": regra}

    doi = _doi_do_identificador(oai_id)
    if doi:
        return {"link": doi, "source": "identifier", "regra": "doi"}

    # Derivação sem `setSpec` — `_derivadas` devolve só o palpite antigo — e
    # conferida como antes, sem gabarito de rota.
    for palpite, plataforma in _derivadas(oai_id, base_url, None):
        conferida = _confirmar(palpite)
        if conferida:
            return {
                "link": conferida[0],
                "source": f"derived:{plataforma}",
                "regra": plataforma,
            }
    return {"link": None, "source": None, "regra": ""}


# ------------------------------------------------- validação do próprio árbitro


# Meta tags que carregam o título do documento, em ordem de confiança. As duas
# primeiras são declaradas para indexadores (Google Scholar, Zotero) e são o que
# OJS e DSpace emitem; `og:title` é de rede social e às vezes traz o nome do
# periódico junto; `<title>` é o último recurso, quase sempre sujo.
TITULOS_NA_PAGINA = (
    re.compile(r'<meta[^>]+name=["\']citation_title["\'][^>]+content=["\']([^"\']+)', re.I),
    re.compile(r'<meta[^>]+name=["\']DC\.[Tt]itle["\'][^>]+content=["\']([^"\']+)', re.I),
    re.compile(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)', re.I),
    re.compile(r"<title[^>]*>([^<]+)</title>", re.I),
)

# Teto de leitura ao validar: o título mora no `<head>`, e baixar o PDF anexo de
# um artigo para achar uma meta tag seria desperdício.
MAX_BYTES_PAGINA = 300_000

# Acima disto o título da página e o do metadado são considerados o mesmo
# documento. Não é 1,0 porque a página costuma acrescentar o nome do periódico,
# e o metadado às vezes traz subtítulo que a página corta.
LIMIAR_TITULO = 0.7


def _palavras(texto: str) -> set[str]:
    """Palavras significativas de um título, sem acento, caixa nem pontuação."""
    sem_acento = unicodedata.normalize("NFKD", texto)
    sem_acento = "".join(c for c in sem_acento if not unicodedata.combining(c))
    return {p for p in re.findall(r"[a-z0-9]+", sem_acento.lower()) if len(p) > 2}


def semelhanca(um: str, outro: str) -> float:
    """Quanto dois títulos se sobrepõem, de 0 a 1.

    Contenção, e não Jaccard: a página quase sempre acrescenta o nome do
    periódico ao título do artigo, e uma medida simétrica puniria isso como se
    fosse divergência. O que interessa é se o título menor cabe no maior.
    """
    a, b = _palavras(um), _palavras(outro)
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def titulo_da_pagina(texto: str) -> str | None:
    for padrao in TITULOS_NA_PAGINA:
        achado = padrao.search(texto)
        if achado and achado.group(1).strip():
            return achado.group(1).strip()
    return None


def titulos_do_metadado(raiz: ET.Element) -> list[str]:
    """Todos os títulos do registro, em qualquer um dos dois formatos de metadado.

    **Todos**, no plural, porque um registro pode ter vários. Periódico
    bilíngue publica `dc:title` em português e em inglês, e o OAI-PMH devolve os
    dois; a página do item mostra um. Comparar só com o primeiro reprovava o
    artigo certo — foi o que aconteceu num teste: o metadado veio com
    "LEGAL MICROSYSTEMS: A LUSO-BRAZILIAN PERSPECTIVE" e a página com
    "O DIREITO DAS RELAÇÕES PRIVADAS DOS MICROSSISTEMAS JURÍDICOS".

    Dois formatos porque o Harvester coleta em `oai_dc` e em `xoai`. No primeiro
    o título é `<dc:title>texto</dc:title>`; no segundo é
    `<element name="title">…<field name="value">texto</field>`, e o nome do
    campo está no atributo, não na tag.
    """
    achados: list[str] = []

    for elem in raiz.iter():
        if _localname(elem.tag) == "title" and (elem.text or "").strip():
            achados.append(elem.text.strip())

    for elem in raiz.iter():
        if _localname(elem.tag) != "element" or elem.get("name") != "title":
            continue
        for filho in elem.iter():
            if _localname(filho.tag) == "field" and (filho.text or "").strip():
                achados.append(filho.text.strip())

    return list(dict.fromkeys(achados))


def validar_titulo(client: httpx.Client, url: str, esperados: list[str]) -> dict:
    """Abre a página e pergunta se o artigo do metadado está mesmo ali.

    Esta é a medida do **instrumento**, não do sistema. O árbitro classifica
    como `ok` o endereço que responde e cuja rota final tem a marca certa — o
    que não prova que a página mostra o documento. Sem esta conferência, o erro
    do árbitro é desconhecido, e todo número do experimento herda essa dúvida.
    """
    if not esperados:
        return {"desfecho": "sem-titulo-no-metadado"}
    try:
        with client.stream("GET", url) as resposta:
            if resposta.status_code >= 400:
                return {"desfecho": "falhou", "status": resposta.status_code}
            pedacos, lidos = [], 0
            for pedaco in resposta.iter_bytes():
                lidos += len(pedaco)
                pedacos.append(pedaco)
                if lidos > MAX_BYTES_PAGINA:
                    break
        corpo = b"".join(pedacos).decode("utf-8", errors="replace")
    except httpx.HTTPError as erro:
        return {"desfecho": "falhou", "detalhe": type(erro).__name__}

    encontrado = titulo_da_pagina(corpo)
    if not encontrado:
        return {"desfecho": "sem-titulo-na-pagina"}

    # O melhor entre os títulos do registro: basta **um** bater para o
    # documento ser o mesmo.
    grau = max(semelhanca(esperado, encontrado) for esperado in esperados)
    return {
        "desfecho": "confere" if grau >= LIMIAR_TITULO else "diverge",
        "semelhanca": round(grau, 3),
        "tituloNaPagina": encontrado[:200],
        "titulosNoMetadado": len(esperados),
    }



# ------------------------------------------------------------------- medição


def _verbo(base_url: str, **params) -> str:
    partes = urlsplit(base_url)
    return urlunsplit((partes.scheme, partes.netloc, partes.path, urlencode(params), ""))


def identify(client: httpx.Client, base_url: str, timeout: float) -> dict:
    """`earliestDatestamp` e `granularity` da origem, para montar janelas de data.

    Sem os dois não dá para sortear um recorte de tempo: a data mais antiga
    define o começo do intervalo, e a granularidade diz se a origem aceita
    `2020-03-01` ou exige `2020-03-01T00:00:00Z`. Pedir no formato errado
    devolve `badArgument`, não um recorte vazio.
    """
    try:
        resposta = client.get(_verbo(base_url, verb="Identify"), timeout=timeout)
        resposta.raise_for_status()
        raiz = ET.fromstring(resposta.content)
    except (httpx.HTTPError, ET.ParseError):
        return {}

    saida: dict[str, str] = {}
    for elem in raiz.iter():
        nome = _localname(elem.tag)
        if nome in ("earliestDatestamp", "granularity") and (elem.text or "").strip():
            saida[nome] = elem.text.strip()
    return saida


def _data(texto: str) -> datetime | None:
    for formato in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(texto.strip(), formato).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _formatar(quando: datetime, granularidade: str) -> str:
    if granularidade.startswith("YYYY-MM-DDT"):
        return quando.strftime("%Y-%m-%dT%H:%M:%SZ")
    return quando.strftime("%Y-%m-%d")


def janela_aleatoria(
    identidade: dict, ate: datetime | None, semente: int, largura_dias: int
) -> tuple[str, str] | None:
    """Um recorte de tempo sorteado dentro da vida do repositório.

    O sorteio é semeado pelo próprio repositório, para a corrida ser
    reproduzível sem depender da ordem em que as tarefas terminam.
    """
    inicio = _data(identidade.get("earliestDatestamp", ""))
    if inicio is None:
        return None
    fim = ate or datetime.now(timezone.utc)
    if fim <= inicio:
        return None

    vao = (fim - inicio).days
    if vao <= largura_dias:
        return None  # acervo curto demais para recortar: não vale o esforço

    granularidade = identidade.get("granularity", "YYYY-MM-DD")
    sorteio = random.Random(semente)
    comeco = inicio + timedelta(days=sorteio.randint(0, vao - largura_dias))
    return (
        _formatar(comeco, granularidade),
        _formatar(comeco + timedelta(days=largura_dias), granularidade),
    )


def _listar(
    client: httpx.Client,
    base_url: str,
    prefix: str,
    quantos: int,
    timeout: float,
    recorte: tuple[str, str] | None = None,
):
    """Uma chamada de `ListIdentifiers`, com recorte de data opcional."""
    params = {"verb": "ListIdentifiers", "metadataPrefix": prefix}
    if recorte:
        params["from"], params["until"] = recorte

    try:
        resposta = client.get(_verbo(base_url, **params), timeout=timeout)
        resposta.raise_for_status()
        raiz = ET.fromstring(resposta.content)
    except httpx.HTTPError as erro:
        return [], f"rede:{type(erro).__name__}"
    except ET.ParseError:
        return [], "xml-invalido"

    for elem in raiz.iter():
        if _localname(elem.tag) == "error":
            return [], f"oai-error:{elem.get('code') or 'unknown'}"

    achados = []
    for cabecalho in raiz.iter():
        if _localname(cabecalho.tag) != "header":
            continue
        ident = ""
        for filho in cabecalho:
            if _localname(filho.tag) == "identifier":
                ident = (filho.text or "").strip()
        if ident:
            achados.append(ident)
        if len(achados) >= quantos:
            break
    return achados, None if achados else "sem-identificadores"


def identificadores(
    client: httpx.Client,
    base_url: str,
    prefix: str,
    quantos: int,
    timeout: float,
    recorte: tuple[str, str] | None = None,
):
    """Identificadores que a origem lista, opcionalmente num recorte de data.

    Sem recorte vêm **os mais antigos do acervo**: o OAI-PMH entrega em ordem de
    datestamp crescente, e a primeira página é sempre o começo da revista. Foi
    assim que a primeira corrida deste experimento amostrou — e um quarto dos
    identificadores OJS eram dos 25 primeiros artigos já publicados. Registro
    velho é justamente o mais propenso a DOI não depositado e a endereço de um
    layout de site que não existe mais, então a medida descrevia o pior pedaço
    do acervo sem dizer isso.

    Timeout próprio, e mais folgado que o das outras requisições:
    `ListIdentifiers` varre o acervo para montar a primeira página, enquanto
    `GetRecord` e o HEAD de conferência tocam um documento só. Com o prazo do
    resolvedor, origens vivas e grandes entravam na conta como `rede` — a medida
    estaria punindo o tamanho do repositório, não a saúde dele.
    """
    return _listar(client, base_url, prefix, quantos, timeout, recorte)


def abrir_oai(client: httpx.Client, url: str) -> tuple[dict, list[str]]:
    """Sonda o botão OAI-PMH e, de quebra, lê o título do registro.

    Antes esta sonda era um `HEAD`. Virou `GET` porque o corpo da resposta é o
    metadado, e dele sai o `dc:title` — que é a referência para conferir se a
    página do item mostra mesmo este documento. Mesma requisição, dois usos: o
    desfecho do botão e o gabarito da validação.
    """
    try:
        with client.stream("GET", url) as resposta:
            status, final = resposta.status_code, str(resposta.url)
            pedacos, lidos = [], 0
            if status < 400:
                for pedaco in resposta.iter_bytes():
                    lidos += len(pedaco)
                    pedacos.append(pedaco)
                    if lidos > MAX_BYTES_PAGINA:
                        break
    except httpx.HTTPError as erro:
        return {"desfecho": "rede", "detalhe": type(erro).__name__}, []

    if status in BLOQUEIO:
        return {"desfecho": "bloqueado", "status": status, "final": final}, []
    if status >= 500:
        return {"desfecho": "http-5xx", "status": status, "final": final}, []
    if status >= 400:
        return {"desfecho": "http-4xx", "status": status, "final": final}, []

    try:
        titulos = titulos_do_metadado(ET.fromstring(b"".join(pedacos)))
    except ET.ParseError:
        titulos = []
    return {"desfecho": "ok", "status": status, "final": final}, titulos


def medir_registro(
    client: httpx.Client,
    base_url: str,
    oai_id: str,
    prefix: str,
    estrato: str,
    validar: bool,
) -> dict:
    resolvido = _resolver(oai_id, base_url, prefix)
    candidatas = resolvido.get("candidates") or []

    nova = {"link": resolvido["link"], "source": resolvido["source"]}
    regra_nova = (resolvido["source"] or "").split(":")[-1]
    nova["abertura"] = (
        abrir(client, nova["link"], FORMA_NA_ROTA.get(regra_nova), regra_nova)
        if nova["link"]
        else {"desfecho": "sem-link", "detalhe": resolvido.get("reason")}
    )

    antiga = link_antigo(oai_id, base_url, candidatas)
    # Aberta com o mesmo gabarito da nova: o que se compara é onde cada régua
    # leva quem clica, não o critério com que cada uma escolheu.
    antiga["abertura"] = (
        abrir(client, antiga["link"], FORMA_NA_ROTA.get(antiga["regra"]), antiga["regra"])
        if antiga["link"]
        else {"desfecho": "sem-link"}
    )

    oai = url_get_record(base_url, oai_id, prefix)
    abertura_oai, titulos = abrir_oai(client, oai)

    saida = {
        "identifier": oai_id,
        "estrato": estrato,
        "titulos": titulos,
        "candidates": candidatas,
        "paginaDoItem": {"nova": nova, "antiga": antiga},
        "oaiPmh": {"link": oai, "abertura": abertura_oai},
    }
    # Só vale conferir o que o árbitro aprovou: é justamente o `ok` que está sob
    # suspeita de ser generoso demais.
    if validar and nova["abertura"]["desfecho"] == "ok":
        saida["validacao"] = validar_titulo(
            client, nova["abertura"].get("final") or nova["link"], titulos
        )
    return saida


# Quantas vezes o prazo de uma requisição comum vale para a listagem.
FOLGA_DA_LISTAGEM = 6

# Larguras de recorte tentadas, em dias, da mais estreita para a mais larga. A
# primeira é a que melhor isola um ponto da história do periódico; as seguintes
# existem porque acervo pequeno ou revista de periodicidade longa deixa janela
# estreita vazia, e recorte vazio é largura errada, não origem quebrada.
LARGURAS_DA_JANELA = (30, 180, 730)


def _amostrar(
    client: httpx.Client,
    repo: dict,
    prefix: str,
    itens: int,
    prazo: float,
    modos: tuple[str, ...],
    semente: int,
) -> tuple[list[tuple[str, str]], str | None, dict]:
    """Identificadores de um repositório, por estrato.

    Devolve `(pares, erro, diagnóstico)`. O erro só é fatal quando **nenhum**
    estrato produziu identificador: um recorte de data vazio não invalida a
    amostragem do topo, e vice-versa.
    """
    pares: list[tuple[str, str]] = []
    diagnostico: dict = {}
    erros: list[str] = []

    if "primeiros" in modos:
        ids, erro = identificadores(client, repo["baseUrl"], prefix, itens, prazo)
        diagnostico["primeiros"] = erro or f"{len(ids)} ids"
        pares += [(i, "primeiros") for i in ids]
        if erro:
            erros.append(erro)

    if "janela" in modos:
        identidade = identify(client, repo["baseUrl"], prazo)
        ate = _data(repo.get("ultimaColetaEm") or "")
        # Trinta dias caem vazios numa revista trimestral, e um recorte vazio
        # não é falha da origem — é largura errada. Alarga até achar algo, em
        # vez de desistir e devolver o repositório inteiro ao estrato do topo.
        ultimo_erro = "sem-como-recortar"
        for largura in LARGURAS_DA_JANELA:
            recorte = janela_aleatoria(identidade, ate, semente, largura)
            if recorte is None:
                continue
            ids, erro = identificadores(
                client, repo["baseUrl"], prefix, itens, prazo, recorte
            )
            if ids:
                diagnostico["janela"] = f"{len(ids)} ids em {largura}d"
                diagnostico["recorte"] = list(recorte)
                pares += [(i, "janela") for i in ids]
                break
            ultimo_erro = erro or "sem-identificadores"
            # Rede caída não melhora com janela maior; recorte vazio, sim.
            if erro and erro.startswith("rede:"):
                break
        else:
            diagnostico["janela"] = ultimo_erro
            erros.append(f"janela:{ultimo_erro}")
        if "janela" not in diagnostico:
            diagnostico["janela"] = ultimo_erro
            erros.append(f"janela:{ultimo_erro}")

    # Um identificador pode cair nos dois estratos (acervo curto). O primeiro
    # rótulo vence, e o registro não é medido duas vezes.
    vistos: set[str] = set()
    unicos = [(i, e) for i, e in pares if not (i in vistos or vistos.add(i))]
    return unicos, (None if unicos else "; ".join(erros) or "sem-identificadores"), diagnostico


def medir_repositorio(
    repo: dict,
    itens: int,
    timeout: float,
    modos: tuple[str, ...],
    validar: bool,
    semente: int,
) -> dict:
    prefix = repo.get("metadataPrefix") or PREFIXO_PADRAO
    saida = {**repo, "registros": [], "erro": None, "amostragem": {}}
    # Certificado é verificado, como o resolvedor verifica e como o navegador
    # de quem clica verificaria: origem com cadeia quebrada conta como `rede`,
    # que é o que o usuário vê.
    with httpx.Client(
        timeout=timeout, follow_redirects=True, headers=USER_AGENT_HEADER
    ) as client:
        pares, erro, diagnostico = _amostrar(
            client,
            repo,
            prefix,
            itens,
            timeout * FOLGA_DA_LISTAGEM,
            modos,
            semente + abs(hash(repo["baseUrl"])) % 10_000,
        )
        saida["amostragem"] = diagnostico
        if erro:
            saida["erro"] = erro
            return saida
        for oai_id, estrato in pares:
            try:
                saida["registros"].append(
                    medir_registro(
                        client, repo["baseUrl"], oai_id, prefix, estrato, validar
                    )
                )
            except Exception as falha:  # noqa: BLE001 — um item ruim não derruba a corrida
                saida["registros"].append(
                    {"identifier": oai_id, "falha": f"{type(falha).__name__}: {falha}"}
                )
    return saida


# ------------------------------------------------------------------- resumo


def resumir(repositorios: list[dict]) -> dict:
    def contador() -> dict:
        return {}

    def conta(alvo: dict, chave: str) -> None:
        alvo[chave] = alvo.get(chave, 0) + 1

    resumo = {
        "repositorios": len(repositorios),
        "repositoriosQueListaram": 0,
        "registros": 0,
        "paginaDoItem": {"nova": contador(), "antiga": contador()},
        "oaiPmh": contador(),
        "errosDeListagem": contador(),
        "ganhos": 0,
        "perdas": 0,
        "porEstrato": {},
        "validacao": {},
        # Link oferecido na tela que não abre a página do item. É o desfecho
        # pior de todos: "endereço não disponível" avisa que não há para onde
        # ir, enquanto um botão que leva ao login ou a um 404 faz o usuário
        # concluir que o registro sumiu do repositório.
        "enganosos": {"nova": 0, "antiga": 0},
    }
    for repo in repositorios:
        if repo.get("erro"):
            conta(resumo["errosDeListagem"], repo["erro"].split(":")[0])
            continue
        resumo["repositoriosQueListaram"] += 1
        for registro in repo["registros"]:
            if "falha" in registro:
                conta(resumo["paginaDoItem"]["nova"], "falha")
                continue
            resumo["registros"] += 1
            estrato = registro.get("estrato") or "?"
            alvo = resumo["porEstrato"].setdefault(
                estrato, {"itens": 0, "antigaOk": 0, "novaOk": 0, "antigaEngana": 0}
            )
            alvo["itens"] += 1
            if registro.get("validacao"):
                conta(resumo["validacao"], registro["validacao"]["desfecho"])
            nova = registro["paginaDoItem"]["nova"]["abertura"]["desfecho"]
            antiga = registro["paginaDoItem"]["antiga"]["abertura"]["desfecho"]
            conta(resumo["paginaDoItem"]["nova"], nova)
            conta(resumo["paginaDoItem"]["antiga"], antiga)
            conta(resumo["oaiPmh"], registro["oaiPmh"]["abertura"]["desfecho"])
            alvo["novaOk"] += nova == "ok"
            alvo["antigaOk"] += antiga == "ok"
            alvo["antigaEngana"] += antiga in ("fora-da-rota", "http-4xx", "http-5xx")
            for regua, desfecho in (("nova", nova), ("antiga", antiga)):
                if desfecho in ("fora-da-rota", "http-4xx", "http-5xx"):
                    resumo["enganosos"][regua] += 1
            if nova == "ok" and antiga != "ok":
                resumo["ganhos"] += 1
            elif antiga == "ok" and nova != "ok":
                resumo["perdas"] += 1
    return resumo


def imprimir(resumo: dict) -> None:
    def linha(titulo: str, contagem: dict, total: int) -> None:
        print(f"\n{titulo}")
        for chave, valor in sorted(contagem.items(), key=lambda p: -p[1]):
            fatia = f"{100 * valor / total:5.1f}%" if total else "    —"
            print(f"  {chave:<16} {valor:>5}  {fatia}")

    print("=" * 58)
    print(f"repositórios consultados : {resumo['repositorios']}")
    print(f"  que listaram registros : {resumo['repositoriosQueListaram']}")
    print(f"registros medidos        : {resumo['registros']}")
    total = resumo["registros"]
    linha("PÁGINA DO ITEM — régua nova", resumo["paginaDoItem"]["nova"], total)
    linha("PÁGINA DO ITEM — régua antiga", resumo["paginaDoItem"]["antiga"], total)
    linha("OAI-PMH (GetRecord)", resumo["oaiPmh"], total)
    linha("repositórios que não listaram", resumo["errosDeListagem"], resumo["repositorios"])
    if resumo["porEstrato"]:
        print("\nPOR ESTRATO DE AMOSTRAGEM")
        print(f"  {'':<12}{'itens':>7}{'antiga':>10}{'nova':>10}{'engana':>9}")
        # `celula`, e não `linha`: esta função já tem uma `linha` acima, e
        # sombreá-la quebra a impressão da validação logo abaixo.
        for nome, celula in sorted(resumo["porEstrato"].items()):
            n = celula["itens"] or 1
            print(
                f"  {nome:<12}{celula['itens']:>7}"
                f"{100 * celula['antigaOk'] / n:>9.1f}%{100 * celula['novaOk'] / n:>9.1f}%"
                f"{celula['antigaEngana']:>9}"
            )
    if resumo["validacao"]:
        total_v = sum(resumo["validacao"].values())
        linha("VALIDAÇÃO DO ÁRBITRO (título da página × metadado)",
              resumo["validacao"], total_v)

    print(f"\nregistros que passaram a abrir : +{resumo['ganhos']}")
    print(f"registros que deixaram de abrir: -{resumo['perdas']}")
    enganosos = resumo["enganosos"]
    print(
        f"links enganosos na tela        : "
        f"{enganosos['antiga']} (antiga) -> {enganosos['nova']} (nova)"
    )
    print("=" * 58)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--entrada", type=Path, default=ENTRADA)
    parser.add_argument("--saida", type=Path, default=SAIDA)
    # Um registro por repositório, e não dois.
    #
    # A corrida de 20/09/2026 mediu ICC de 0,47 a 0,78 no desfecho entre
    # registros do mesmo repositório: se um abre, o outro quase certamente
    # abre. Com esse grau de parecença, o segundo registro custa quatro
    # requisições e acrescenta pouca informação — o efeito de desenho a 3,4
    # registros por repositório é 2,13, ou seja, 1.033 registros valem 485.
    #
    # Pelo custo desta medição (≈3 requisições por repositório novo, ≈4 por
    # registro a mais), o tamanho ótimo de conglomerado dá 0,5, que arredonda
    # para 1. A precisão vem do número de repositórios; gaste ali.
    parser.add_argument(
        "--itens",
        type=int,
        default=1,
        help="registros por repositório e por estrato (1 é o ótimo medido)",
    )
    parser.add_argument("--trabalhadores", type=int, default=12)
    parser.add_argument("--timeout", type=float, default=float(settings.OAI["TIMEOUT"]))
    parser.add_argument("--limite", type=int, default=0, help="só os N primeiros repos")
    parser.add_argument(
        "--amostragem",
        choices=("primeiros", "janela", "ambos"),
        default="ambos",
        help="'primeiros' repete o viés do topo do acervo; 'ambos' mede o viés",
    )
    parser.add_argument(
        "--sem-validacao",
        action="store_true",
        help="não confere o título da página contra o do metadado",
    )
    parser.add_argument("--semente", type=int, default=20260920)
    args = parser.parse_args()

    args.saida.parent.mkdir(parents=True, exist_ok=True)
    entrada = json.loads(args.entrada.read_text())
    repos = entrada["repositorios"][: args.limite or None]
    print(f"{len(repos)} repositórios × {args.itens} itens", file=sys.stderr)

    modos = ("primeiros", "janela") if args.amostragem == "ambos" else (args.amostragem,)
    print(f"estratos: {', '.join(modos)}", file=sys.stderr)

    resultados: list[dict] = []
    with ThreadPoolExecutor(max_workers=args.trabalhadores) as pool:
        futuros = {
            pool.submit(
                medir_repositorio,
                repo,
                args.itens,
                args.timeout,
                modos,
                not args.sem_validacao,
                args.semente,
            ): repo
            for repo in repos
        }
        for feito, futuro in enumerate(as_completed(futuros), 1):
            repo = futuros[futuro]
            try:
                resultados.append(futuro.result())
            except Exception as falha:  # noqa: BLE001
                resultados.append({**repo, "registros": [], "erro": f"falha:{falha}"})
            if feito % 10 == 0 or feito == len(repos):
                print(f"  ... {feito}/{len(repos)}", file=sys.stderr)

    # Na ordem da entrada, e não na de chegada: o JSON é lido por gente.
    ordem = {r["baseUrl"]: i for i, r in enumerate(repos)}
    resultados.sort(key=lambda r: ordem.get(r["baseUrl"], 1 << 30))

    resumo = resumir(resultados)
    args.saida.write_text(
        json.dumps(
            {
                "rodadoEm": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "fonte": entrada.get("fonte"),
                "itensPorRepositorio": args.itens,
                "timeout": args.timeout,
                "amostragem": args.amostragem,
                "semente": args.semente,
                "validou": not args.sem_validacao,
                "resumo": resumo,
                "repositorios": resultados,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    imprimir(resumo)
    print(f"\ndetalhe em {args.saida}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
