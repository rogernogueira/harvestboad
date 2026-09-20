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
do baseURL e do identificador.

**Nenhum endereço sai daqui sem ter sido conferido**, venha ele do metadado ou
da derivação. Por muito tempo só a derivação era confirmada, com o argumento de
que o metadado é declaração da origem e não palpite nosso — mas declarado não é
sinônimo de vivo. O caso que derrubou esse argumento:
`oai:revista.esmat.tjto.jus.br:article/120` traz no `dc:identifier` um DOI que
nunca chegou a ser registrado (404 no resolvedor) e, logo abaixo dele, a URL do
artigo, que abre. Como o DOI é o primeiro da ordem de preferência, a régua
antiga parava nele e a tela oferecia o link morto — sem nunca olhar a candidata
seguinte. Daí `_por_prioridade` devolver a fila inteira, e não o primeiro
colocado.

A conferência é de forma, e não só de status, porque 200 prova pouco: o OJS
atende o pedido de um artigo fechado **com a tela de login**, e o DSpace faz o
mesmo com a capa da coleção. Então, para as regras cuja marca mora na rota do
próprio item (`/article/view/`, `/handle/`), o endereço final — depois dos
redirecionamentos — ainda precisa carregar essa marca. Isso não vale para DOI
nem para `hdl.handle.net`: sair do domínio de origem é o que esses dois fazem
quando dão certo.

Quando nenhuma candidata do metadado sobrevive, a derivação assume — e para o
OJS ela lê o periódico no `setSpec` do próprio registro (`revista_esmat:EDT`),
em vez de confiar no contexto que está no baseURL. Isso cobre a origem
cadastrada pelo OAI do contexto de site (`/index.php/index/oai`), que lista os
artigos de todos os periódicos sem hospedar nenhum: derivar dele dá
`/index/article/view/120`, e é justamente ali que o OJS responde com o login.
Vale registrar que **não é o que conserta o caso da ESMAT** — o baseURL que o
Harvester tem cadastrado para ela é o do periódico, e por ele a resolução para
na candidata do metadado. É prevenção para a forma de cadastro, não para aquele
registro.
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
#
# A segunda metade da lista é vocabulário de outra natureza, e entrou depois de
# um registro do `researchdata.uibk.ac.at` devolver
# `https://creativecommons.org/licenses/by/4.0/legalcode` como página do item:
# licença, direito e identificador de pessoa ou instituição descrevem o
# documento, e nenhum deles **é** o documento. Antes isso ficava escondido
# porque a primeira candidata reconhecida por uma regra sempre ganhava; desde
# que a candidata pode ser recusada, a fila desce até o desempate por ordem de
# documento, e aí uma URL dessas chega ao botão.
DOMINIOS_DE_ESQUEMA = (
    "openarchives.org",
    "purl.org",
    "w3.org",
    "schema.org",
    "datacite.org",
    "creativecommons.org",
    "licensebuttons.net",
    "opensource.org",
    "rightsstatements.org",
    "spdx.org",
    "orcid.org",
    "ror.org",
    "isni.org",
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
#
# A terceira coluna diz se a marca da regra **mora na rota do item**. Quando
# mora, ela é também o gabarito da conferência: o endereço final, depois dos
# redirecionamentos, ainda tem de carregá-la. `doi` e `handle` ficam de fora
# porque os dois são resolvedores — redirecionar para longe do próprio domínio
# é o que eles fazem quando dão certo.
REGRAS = (
    ("doi", lambda url: "doi.org" in url, False),
    ("ojs", lambda url: "/article/view/" in url, True),
    ("dspace", lambda url: "/handle/" in url, True),
    ("handle", lambda url: "hdl.handle.net" in url, False),
    ("download", lambda url: "/article/download/" in url, True),
)

# Gabarito de conferência por nome de regra — as que sobrevivem a redirecionamento.
# Serve às candidatas do metadado e às derivadas, que usam os mesmos nomes de
# plataforma (`ojs`, `dspace`).
FORMA_NA_ROTA = {nome: regra for nome, regra, na_rota in REGRAS if na_rota}

# Teto de candidatas conferidas por registro. Cada uma custa uma requisição à
# origem, e metadado ruim às vezes despeja dezenas de URLs: passado esse ponto a
# chance de a próxima ser a página do item não paga a espera de quem olha a tela.
MAX_CONFIRMACOES = 4


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


def _set_spec(root: ET.Element) -> str | None:
    """Primeiro `<setSpec>` do cabeçalho do registro.

    No OJS ele é `{periodico}:{secao}`, e o periódico é a única pista confiável
    de onde o item mora quando o baseURL cadastrado aponta o contexto de site.
    Um registro pode estar em vários conjuntos; o primeiro basta, porque todos
    trazem o mesmo periódico à esquerda do ":".
    """
    for elem in root.iter():
        if _localname(elem.tag) == "setSpec":
            texto = (elem.text or "").strip()
            if texto:
                return texto
    return None


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


def _por_prioridade(candidatas: list[str]) -> list[tuple[str, str]]:
    """Candidatas em ordem de tentativa, cada uma com a regra que a escolheu.

    Antes daqui saía só a primeira colocada. Devolver a fila inteira é o que
    permite descartar uma candidata que a origem nega e seguir para a seguinte,
    em vez de desistir do registro — o DOI que nunca foi registrado não pode
    esconder a URL de artigo que vem logo abaixo dele no mesmo `dc:identifier`.

    As que nenhuma regra reconhece vão para o fim, em ordem de documento, sob o
    nome `primeira` que já nomeava esse desempate.
    """
    fila: list[tuple[str, str]] = []
    vistas: set[str] = set()
    for nome, regra, _ in REGRAS:
        for url in candidatas:
            if url not in vistas and regra(url):
                vistas.add(url)
                fila.append((url, nome))
    fila.extend((url, "primeira") for url in candidatas if url not in vistas)
    return fila


def _raiz_do_servico(base_url: str) -> str | None:
    for sufixo in SUFIXOS_OAI:
        if base_url.endswith(sufixo):
            return base_url[: -len(sufixo)]
    return None


def _contexto_ojs(raiz: str, set_spec: str | None) -> str:
    """Raiz do OJS com o periódico que o `setSpec` do registro nomeia.

    No OJS o caminho é `{host}/index.php/{periodico}`, e o `setSpec` é
    `{periodico}:{secao}` — `revista_esmat:EDT`. Quem cadastra a origem costuma
    apontar o OAI do contexto de site (`/index.php/index/oai`), que lista os
    artigos de todos os periódicos sem hospedar nenhum: derivar a partir dele dá
    `/index/article/view/120`, que o OJS responde com a tela de login.

    O `setSpec` vem do próprio registro, e diz de qual periódico ele é. Trocar
    por ele o último segmento da raiz corrige esse caso e não mexe em nada
    quando o baseURL já aponta o periódico certo.
    """
    if not set_spec:
        return raiz
    periodico = set_spec.split(":", 1)[0].strip().strip("/")
    if not periodico:
        return raiz
    partes = urlparse(raiz)
    segmentos = [s for s in partes.path.split("/") if s]
    # Sem segmento nenhum não há contexto a trocar, e concatenar produziria um
    # endereço sem host (`https://revista_esmat`).
    if not segmentos or segmentos[-1] == periodico:
        return raiz
    segmentos[-1] = periodico
    return f"{partes.scheme}://{partes.netloc}/" + "/".join(segmentos)


def _derivadas(
    oai_id: str, base_url: str, set_spec: str | None = None
) -> list[tuple[str, str]]:
    """Endereços deduzidos da forma do identificador, ainda sem confirmação.

    A cauda depois do último ":" é o que o repositório usa para nomear o item —
    `article/1315` no OJS, `riufs/10820` no DSpace. Quem manda no domínio é o
    baseURL, não o identificador: é justamente quando o repositório muda de
    endereço que o identificador guardado na coleta envelhece.

    São vários palpites, não um, porque o `setSpec` melhora o caso comum e
    estraga um caso raro: há instalações de periódico único cujo `setSpec` traz
    só a seção (`ART`), e aí a troca de contexto inventa um caminho que não
    existe. O palpite corrigido vai na frente e o antigo fica de reserva — como
    os dois passam pela confirmação, errar o primeiro custa uma requisição, não
    o link.
    """
    raiz = _raiz_do_servico(base_url)
    cauda = oai_id.rsplit(":", 1)[-1].strip().strip("/")
    if not raiz or "/" not in cauda:
        return []
    if not cauda.startswith("article/"):
        return [(f"{raiz}/handle/{cauda}", "dspace")]

    numero = cauda.removeprefix("article/")
    raizes = dict.fromkeys([_contexto_ojs(raiz, set_spec), raiz])
    return [(f"{r}/article/view/{numero}", "ojs") for r in raizes]


def _confirmar(url: str, forma=None) -> tuple[str, bool] | None:
    """Verifica um endereço. Devolve `(endereço, verificada)` ou `None`.

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

    `forma` é o gabarito que o endereço **final** precisa satisfazer, para as
    regras cuja marca mora na rota do item. Sem ele, um 200 seria prova fraca
    demais: o OJS responde 200 mandando para a tela de login, e o DSpace faz o
    mesmo com a capa da coleção. Redirecionar para fora da rota do item é o
    servidor dizendo que não vai mostrar o item.

    HEAD basta e não baixa a página. Servidores que não o implementam respondem
    405/501, e aí vale um GET, de que só interessa o status.
    """

    def desfecho(status: int, final: str) -> tuple[str, bool] | None:
        if status >= 400:
            return None
        if forma is not None and not forma(final):
            return None
        return final, True

    try:
        with httpx.Client(
            timeout=_config("TIMEOUT"), follow_redirects=True, headers=USER_AGENT_HEADER
        ) as client:
            resposta = client.head(url)
            if resposta.status_code in (405, 501):
                with client.stream("GET", url) as resposta:
                    return desfecho(resposta.status_code, str(resposta.url))
            return desfecho(resposta.status_code, str(resposta.url))
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
    set_spec: str | None = None,
) -> dict:
    """Últimos recursos, quando o `GetRecord` não produziu endereço utilizável.

    "Não produziu" cobre dois casos: o `GetRecord` falhou, e aí não há `setSpec`
    a passar; ou ele respondeu, mas nenhuma das URLs do metadado sobreviveu à
    conferência — e aí o `setSpec` do registro vem junto, porque é ele que diz
    em qual periódico do OJS o item mora.

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

    derivadas = _derivadas(oai_id, base_url, set_spec)
    if derivadas and not confirmar:
        # Sem como conferir, sai o palpite antigo — o que não depende do
        # `setSpec`. A correção de contexto é boa quando se pode testá-la; num
        # endereço que já vai marcado como provável, empilhar uma segunda
        # dedução seria adivinhar duas vezes e avisar uma só.
        palpite, plataforma = derivadas[-1]
        return _resultado(palpite, f"derived-unverified:{plataforma}", motivo, candidatas)

    for palpite, plataforma in derivadas:
        conferida = _confirmar(palpite, FORMA_NA_ROTA.get(plataforma))
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
    set_spec = _set_spec(root)
    if not candidatas:
        return _sem_registro(
            oai_id, base_url, "no-usable-url", candidatas, set_spec=set_spec
        )

    # Desce a fila até uma candidata que a origem confirme. Só a recusa
    # explícita — 4xx/5xx, ou um redirecionamento que sai da rota do item —
    # descarta uma candidata; não conseguir perguntar devolve o endereço mesmo
    # assim, que é o que `_confirmar` já fazia pela derivação.
    for url, regra in _por_prioridade(candidatas)[:MAX_CONFIRMACOES]:
        conferida = _confirmar(url, FORMA_NA_ROTA.get(regra))
        if conferida:
            final, _ = conferida
            return _resultado(final, f"record:{regra}", candidatas=candidatas)

    # O metadado trazia endereços e a origem negou todos: é diferente de não
    # trazer nenhum, e a tela explica as duas coisas de formas diferentes.
    return _sem_registro(
        oai_id, base_url, "no-reachable-url", candidatas, set_spec=set_spec
    )


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
