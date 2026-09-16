"""Link público de um registro, resolvido no OAI-PMH do repositório de origem.

O Harvester guarda o identificador OAI (`oai:host:article/1`), que não é
navegável: quem abre um registro na tela precisa do endereço real da página no
repositório. Esse endereço não está no diagnóstico — está no metadado do
próprio registro, que só a origem serve.

Daí este módulo falar direto com o `baseURL` OAI do repositório, e não com o
Harvester: são serviços diferentes, com falhas diferentes. O Harvester pode
estar de pé e a origem fora do ar, e vice-versa.

A resolução tem quatro caminhos, do mais barato ao mais caro:

1. o próprio identificador já é um DOI (`doi:10.x/y`) — resposta sem rede;
2. `GetRecord` na origem, varrendo o metadado por uma URL utilizável;
3. o `GetRecord` não ajudou, mas há um DOI no texto do identificador;
4. nada disso deu, e o endereço é derivado da forma do identificador.

O quarto existe porque o `GetRecord` falha com frequência por motivos que nada
têm a ver com o documento: o Harvester guarda o identificador como ele era na
coleta, e repositórios trocam de domínio (o id vira `badArgument`); há origens
cujo `GetRecord` responde `idDoesNotExist` até para o que elas mesmas listam.
Em todos esses casos a página do item continua no ar, e o endereço dela segue
do baseURL e do identificador. Derivação é palpite, então só é devolvida depois
de confirmada com uma requisição — link quebrado é pior que link nenhum.
"""

import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import urlparse

import httpx
from django.conf import settings

from .cache import cached

CACHE_PREFIX = "oai:link:v1"

# Navegador no User-Agent: repositórios atrás de WAF (Cloudflare e afins)
# respondem 403 a clientes que se identificam como biblioteca HTTP.
USER_AGENT_HEADER = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

# URLs de namespace e de esquema aparecem em quase todo registro OAI
# (`xsi:schemaLocation`, `dc:format`). São vocabulário do formato, nunca o
# endereço do documento.
DOMINIOS_DE_ESQUEMA = (
    "openarchives.org",
    "purl.org",
    "w3.org",
    "schema.org",
    "datacite.org",
)

# Ordem de preferência entre as URLs encontradas. DOI primeiro por ser o
# identificador persistente; depois as rotas canônicas de OJS e DSpace, que
# levam à página do item; o link de download vem por último entre as regras
# porque entrega o arquivo em vez da página.
#
# Os dois endereços de DSpace são regras separadas, e o `/handle/` vem antes:
# ele aponta direto para a página do item no repositório, enquanto o
# `hdl.handle.net` é o resolvedor global, que só redireciona para lá — um salto
# a mais, dependente de um serviço de terceiros. O resolvedor continua na lista
# porque em alguns registros ele é o único endereço publicado.
REGRAS = (
    ("doi", lambda url: "doi.org" in url),
    ("ojs", lambda url: "/article/view/" in url),
    ("dspace", lambda url: "/handle/" in url),
    ("handle", lambda url: "hdl.handle.net" in url),
    ("download", lambda url: "/article/download/" in url),
)


# Sufixos com que um baseURL OAI costuma terminar. Removê-los devolve a raiz de
# onde penduram as rotas de item — `/article/view/` no OJS, `/handle/` no
# DSpace.
SUFIXOS_OAI = ("/oai/request", "/oai2", "/oai")


class _RespostaGrande(Exception):
    """A origem devolveu mais bytes do que vale a pena ler."""


def _config(nome: str) -> Any:
    return settings.OAI[nome]


def _localname(tag: str) -> str:
    """Nome da tag sem o namespace (`{http://...}metadata` -> `metadata`)."""
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _doi_url(valor: str) -> str:
    return f"https://doi.org/{valor.strip().strip('/')}"


def _doi_do_identificador(oai_id: str) -> str | None:
    """DOI embutido no identificador, quando houver.

    Cobre tanto `doi:10.48472/deposita/0BYR5E` quanto identificadores que
    carregam o DOI solto no meio do texto.
    """
    texto = oai_id.strip()
    if texto.lower().startswith("doi:"):
        return _doi_url(texto.split(":", 1)[1])
    for parte in texto.replace(":", " ").split():
        if parte.startswith("10.") and "/" in parte:
            return _doi_url(parte)
    return None


def _buscar_registro(base_url: str, oai_id: str, prefix: str) -> bytes:
    """GetRecord na origem, com teto de bytes lidos.

    O corpo é lido em pedaços e abortado ao estourar o limite: um `baseURL`
    errado pode apontar para qualquer coisa, e ler a resposta inteira antes de
    descobrir o tamanho deixaria o worker refém dela.
    """
    params = {"verb": "GetRecord", "identifier": oai_id, "metadataPrefix": prefix}
    limite = _config("MAX_BYTES")

    with httpx.Client(timeout=_config("TIMEOUT"), follow_redirects=True) as client:
        with client.stream(
            "GET", base_url, params=params, headers=USER_AGENT_HEADER
        ) as response:
            response.raise_for_status()
            pedacos: list[bytes] = []
            lidos = 0
            for pedaco in response.iter_bytes():
                lidos += len(pedaco)
                if lidos > limite:
                    raise _RespostaGrande(f"Resposta maior que {limite} bytes.")
                pedacos.append(pedaco)
    return b"".join(pedacos)


def _erro_oai(root: ET.Element) -> str | None:
    """Código do `<error>` do OAI-PMH, que vem com status 200."""
    for elem in root.iter():
        if _localname(elem.tag) == "error":
            return elem.get("code") or "unknown"
    return None


def _escopo_do_metadado(root: ET.Element) -> ET.Element:
    """Subárvore `<metadata>`, onde moram as URLs do documento.

    Fora dela a resposta traz o `<request>`, cujo texto é o próprio `baseURL`
    OAI — uma URL válida que não leva a registro nenhum. Restringir o escopo
    elimina essa e outras falsas candidatas do envelope.
    """
    for elem in root.iter():
        if _localname(elem.tag) == "metadata":
            return elem
    return root


def _candidatas(escopo: ET.Element) -> list[str]:
    """URLs do metadado, em ordem de documento e sem repetição.

    A ordem importa: ela é o desempate quando nenhuma regra de prioridade se
    aplica. Um `set` deixaria a escolha à mercê do hash, e o mesmo registro
    responderia links diferentes entre processos.
    """
    encontradas: list[str] = []
    for elem in escopo.iter():
        if _localname(elem.tag) == "request":
            continue
        texto = (elem.text or "").strip()
        if not texto:
            continue
        if texto.startswith(("http://", "https://")):
            dominio = urlparse(texto).netloc.lower()
            if any(esquema in dominio for esquema in DOMINIOS_DE_ESQUEMA):
                continue
            encontradas.append(texto)
        elif texto.startswith("10.") and "/" in texto:
            # Prefixo DOI cru, como o DataCite costuma publicar.
            encontradas.append(_doi_url(texto))
    return list(dict.fromkeys(encontradas))


def _melhor(candidatas: list[str]) -> tuple[str, str] | None:
    for nome, regra in REGRAS:
        for url in candidatas:
            if regra(url):
                return url, nome
    if candidatas:
        return candidatas[0], "primeira"
    return None


def _raiz_do_servico(base_url: str) -> str | None:
    for sufixo in SUFIXOS_OAI:
        if base_url.endswith(sufixo):
            return base_url[: -len(sufixo)]
    return None


def _url_derivada(oai_id: str, base_url: str) -> tuple[str, str] | None:
    """Endereço deduzido da forma do identificador, ainda sem confirmação.

    A cauda depois do último ":" é o que o repositório usa para nomear o item —
    `article/1315` no OJS, `riufs/10820` no DSpace. Quem manda no domínio é o
    baseURL, não o identificador: é justamente quando o repositório muda de
    endereço que o identificador guardado na coleta envelhece.
    """
    raiz = _raiz_do_servico(base_url)
    cauda = oai_id.rsplit(":", 1)[-1].strip().strip("/")
    if not raiz or "/" not in cauda:
        return None
    if cauda.startswith("article/"):
        return f"{raiz}/article/view/{cauda.removeprefix('article/')}", "ojs"
    return f"{raiz}/handle/{cauda}", "dspace"


def _confirmar(url: str) -> tuple[str, bool] | None:
    """Verifica a URL derivada. Devolve `(endereço, verificada)` ou `None`.

    Os três desfechos são diferentes e não podem ser confundidos:

    - o servidor respondeu que a página existe -> `(endereço final, True)`. O
      endereço final importa, não o palpite: o baseURL cadastrado costuma ser
      `http` e o repositório redireciona para `https`; devolver o palpite faria
      o usuário atravessar o redirecionamento a cada visita e guardaria no
      cache um endereço que não é o canônico;
    - o servidor respondeu que **não** existe (4xx/5xx) -> `None`. O palpite
      estava errado, e link quebrado é pior que link nenhum;
    - não deu para perguntar (rede) -> `(palpite, False)`. Isso não diz nada
      sobre o link: diz que este servidor não alcança aquela rede. Quem abrir
      pode muito bem alcançar, então o palpite vai adiante — marcado.

    HEAD basta e não baixa a página. Servidores que não o implementam respondem
    405/501, e aí vale um GET, de que só interessa o status.
    """
    try:
        with httpx.Client(
            timeout=_config("TIMEOUT"), follow_redirects=True, headers=USER_AGENT_HEADER
        ) as client:
            resposta = client.head(url)
            if resposta.status_code in (405, 501):
                with client.stream("GET", url) as resposta:
                    return (str(resposta.url), True) if resposta.status_code < 400 else None
            return (str(resposta.url), True) if resposta.status_code < 400 else None
    except httpx.HTTPError:
        return url, False


def _resultado(
    link: str | None,
    origem: str | None,
    motivo: str | None = None,
    candidatas: list[str] | None = None,
) -> dict:
    return {
        "link": link,
        "source": origem,
        "reason": motivo,
        "candidates": candidatas or [],
    }


def _sem_registro(
    oai_id: str,
    base_url: str,
    motivo: str,
    candidatas: list[str] | None = None,
    confirmar: bool = True,
) -> dict:
    """Últimos recursos, quando o `GetRecord` não produziu endereço.

    O DOI vem antes da derivação por ser um identificador declarado, não
    deduzido. `motivo` só aparece quando nenhum dos dois resolve — ou junto de
    um link não verificado, para dizer por que a verificação não aconteceu.

    `confirmar=False` para quando nem a conexão com o host se estabeleceu: a
    URL derivada mora no mesmo host e porta, então perguntar por ela custaria um
    segundo timeout inteiro para chegar à mesma conclusão. O palpite sai
    marcado, sem a espera. Isso vale só para falha de conexão — se a origem
    atendeu e demorou a responder, a página do item pode estar de pé, e aí vale
    perguntar.
    """
    doi = _doi_do_identificador(oai_id)
    if doi:
        return _resultado(doi, "identifier", candidatas=candidatas)

    derivada = _url_derivada(oai_id, base_url)
    if derivada:
        palpite, plataforma = derivada
        if not confirmar:
            return _resultado(
                palpite, f"derived-unverified:{plataforma}", motivo, candidatas
            )
        conferida = _confirmar(palpite)
        if conferida:
            url, verificada = conferida
            prefixo = "derived" if verificada else "derived-unverified"
            return _resultado(
                url, f"{prefixo}:{plataforma}", None if verificada else motivo, candidatas
            )

    return _resultado(None, None, motivo, candidatas)


def _resolver(oai_id: str, base_url: str, prefix: str) -> dict:
    if oai_id.strip().lower().startswith("doi:"):
        doi = _doi_do_identificador(oai_id)
        if doi:
            # Identificador que já é DOI: link resolvido sem tocar na rede.
            return _resultado(doi, "identifier")

    try:
        corpo = _buscar_registro(base_url, oai_id, prefix)
        root = ET.fromstring(corpo)
    except (httpx.ConnectError, httpx.ConnectTimeout):
        # Nem a conexão se estabeleceu: host fora do ar, IP privado inacessível
        # ou porta filtrada. Nada mais no mesmo host vai atender.
        return _sem_registro(oai_id, base_url, "unreachable", confirmar=False)
    except (httpx.HTTPError, _RespostaGrande, ET.ParseError):
        # A origem atendeu, mas não entregou XML utilizável — demorou demais a
        # responder, mandou algo grande demais ou devolveu lixo.
        return _sem_registro(oai_id, base_url, "unreachable")

    codigo = _erro_oai(root)
    if codigo == "cannotDisseminateFormat" and prefix != "oai_dc":
        # `oai_dc` é obrigatório no protocolo: sempre existe como segunda
        # tentativa quando o prefixo pedido não é servido para este registro.
        return _resolver(oai_id, base_url, "oai_dc")
    if codigo:
        return _sem_registro(oai_id, base_url, f"oai-error:{codigo}")

    candidatas = _candidatas(_escopo_do_metadado(root))
    escolha = _melhor(candidatas)
    if escolha is None:
        return _sem_registro(oai_id, base_url, "no-usable-url", candidatas)

    url, regra = escolha
    return _resultado(url, f"record:{regra}", candidatas=candidatas)


def suggested_link(oai_id: str, base_url: str, prefix: str = "oai_dc") -> dict:
    """Link público do registro, ou `link: None` com o motivo.

    Devolve também `candidates`, as URLs consideradas: quando a heurística erra
    de alvo, é por ali que se enxerga o porquê sem repetir a consulta à origem.

    Só resolução bem-sucedida entra em cache. Guardar a falha faria uma queda
    momentânea da origem fixar "sem link" por toda a janela do TTL — e é
    exatamente durante a instabilidade que a tela seria reaberta.
    """
    chave = f"{CACHE_PREFIX}:{base_url}:{prefix}:{oai_id}"
    return cached(
        chave,
        _config("CACHE_TTL_LINK"),
        lambda: _resolver(oai_id, base_url.rstrip("/"), prefix),
        should_cache=lambda resultado: resultado["link"] is not None,
    )


__all__ = ["CACHE_PREFIX", "suggested_link"]
