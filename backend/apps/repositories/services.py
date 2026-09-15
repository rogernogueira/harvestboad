"""Leitura dos repositórios no Harvester.

O `RepositoryAccess` guarda apenas o vínculo (quem acessa o quê). Os dados
cadastrais do repositório e o histórico de coletas vivem no Harvester, e são
lidos aqui — sempre com cache, porque a origem é lenta e instável.
"""

from typing import Any

from django.conf import settings
from django.db.models import Count

from apps.integrations.cache import cached
from apps.integrations.harvester import HarvesterClient, HarvesterError

from .models import RepositoryAccess

CACHE_PREFIX = "repositories:v1"


def _ttl(name: str) -> int:
    return settings.HARVESTER[f"CACHE_TTL_{name}"]


def _id_from_href(payload: dict | None) -> str:
    href = ((payload or {}).get("_links", {}).get("self", {}) or {}).get("href", "")
    return href.rstrip("/").rsplit("/", 1)[-1] if href else ""


def repository_detail(repository_id: str, client: HarvesterClient | None = None) -> dict:
    """Dados cadastrais do repositório. Propaga HarvesterError."""
    client = client or HarvesterClient()

    def produce() -> dict:
        network = client.get_network(repository_id) or {}
        return {
            "harvesterRepositoryId": str(repository_id),
            "acronym": network.get("acronym"),
            "name": network.get("name"),
            "institutionAcronym": network.get("institutionAcronym"),
            "institutionName": network.get("institutionName"),
            "metadataPrefix": network.get("metadataPrefix"),
            "metadataStoreSchema": network.get("metadataStoreSchema"),
            "oaiSource": network.get("oaiSource"),
            "published": network.get("published"),
        }

    return cached(f"{CACHE_PREFIX}:detail:{repository_id}", _ttl("NETWORK"), produce)


def repository_summary(
    repository_id: str, client: HarvesterClient | None = None
) -> dict | None:
    """Versão resumida para listagens, tolerante a falha.

    A lista "Meus repositórios" precisa renderizar mesmo com o Harvester fora;
    nesse caso o enriquecimento simplesmente não vem, e a sigla local basta.
    """
    try:
        detail = repository_detail(repository_id, client)
    except HarvesterError:
        return None
    return {
        "acronym": detail.get("acronym"),
        "name": detail.get("name"),
        "institutionName": detail.get("institutionName"),
        "published": detail.get("published"),
    }


def repository_harvests(repository_id: str, client: HarvesterClient | None = None) -> dict:
    """Histórico de coletas do repositório, da mais recente para a mais antiga.

    O Harvester devolve o envelope HAL do Spring Data REST; o ID de cada coleta
    só aparece no `_links.self.href`, daí a extração.
    """
    client = client or HarvesterClient()

    def produce() -> list[dict[str, Any]]:
        payload = client.list_snapshots(repository_id) or {}
        snapshots = (payload.get("_embedded") or {}).get("snapshot") or []
        return [
            {
                "snapshotId": _id_from_href(snapshot),
                "status": snapshot.get("status"),
                "indexStatus": snapshot.get("indexStatus"),
                "startTime": snapshot.get("startTime"),
                "endTime": snapshot.get("endTime"),
                "lastIncrementalTime": snapshot.get("lastIncrementalTime"),
                "size": snapshot.get("size"),
                "validSize": snapshot.get("validSize"),
                "transformedSize": snapshot.get("transformedSize"),
                "deleted": snapshot.get("deleted"),
                "previousSnapshotId": snapshot.get("previousSnapshotId"),
            }
            for snapshot in snapshots
        ]

    results = cached(
        f"{CACHE_PREFIX}:harvests:{repository_id}", _ttl("SNAPSHOT"), produce
    )
    return {
        "harvesterRepositoryId": str(repository_id),
        "count": len(results),
        "results": results,
    }


def _latest_finished(snapshots: list[dict]) -> dict | None:
    """Coleta mais recente que efetivamente terminou.

    A lista vem ordenada da mais nova para a mais antiga, mas a primeira pode
    ser uma coleta em andamento ou abortada sem registros — para um resumo
    estatístico, interessa a última que produziu dados.
    """
    for snapshot in snapshots:
        if snapshot.get("endTime") and (snapshot.get("size") or 0) > 0:
            return snapshot
    return snapshots[0] if snapshots else None


def _network_row_by_id(
    repository_id: str, acronym: str | None, client: HarvesterClient
) -> dict | None:
    """Linha de /private/networks correspondente ao repositório, se houver.

    Essa rota traz cadastro e resumo da última coleta juntos, mas só filtra por
    sigla — e a sigla gravada envelhece. Por isso o resultado é conferido pelo
    `networkID`, que é autoritativo: se não bater, o chamador usa o caminho
    lento por identificador.
    """
    if not acronym:
        return None

    payload = cached(
        f"{CACHE_PREFIX}:private:{acronym}",
        _ttl("SNAPSHOT"),
        lambda: client.list_networks(
            page=1, count=20, filter_field="acronym", filter_value=acronym
        )
        or {},
    )

    for rede in payload.get("networks") or []:
        if str(rede.get("networkID", "")) == str(repository_id):
            return rede
    return None


def last_harvest_summary(repository_id: str, client: HarvesterClient | None = None) -> dict | None:
    """Estatísticas da última coleta, pelo histórico do repositório.

    Caminho de contingência do painel: usado quando a sigla gravada não localiza
    o repositório em `/private/networks`. Custa duas consultas em vez de uma.
    Devolve None quando o repositório nunca foi coletado.
    """
    client = client or HarvesterClient()

    historico = repository_harvests(repository_id, client)
    ultima = _latest_finished(historico["results"])
    if not ultima or not ultima.get("snapshotId"):
        return None

    snapshot_id = ultima["snapshotId"]
    resumo = _resumo_base(
        snapshot_id=snapshot_id,
        status=ultima.get("status"),
        index_status=ultima.get("indexStatus"),
        end_time=ultima.get("endTime"),
        size=ultima.get("size"),
        valid_size=ultima.get("validSize"),
        transformed_size=ultima.get("transformedSize"),
    )

    # O diagnóstico é a parte mais cara e a que mais falha; sem ele o resumo
    # ainda vale pelos números da própria coleta.
    return _com_regras(resumo, snapshot_id, client)


def _harvest_from_network_row(rede: dict, client: HarvesterClient) -> dict | None:
    """Resumo da última coleta a partir de uma linha de /private/networks.

    Os campos `lst*` já vêm na listagem; só as regras violadas exigem consultar
    o diagnóstico.
    """
    snapshot_id = rede.get("lstSnapshotID")
    if not snapshot_id:
        return None

    return _com_regras(
        _resumo_base(
            snapshot_id=str(snapshot_id),
            status=rede.get("lstSnapshotStatus"),
            index_status=rede.get("lstIndexStatus"),
            end_time=rede.get("lstSnapshotDate"),
            size=rede.get("lstSize"),
            valid_size=rede.get("lstValidSize"),
            transformed_size=rede.get("lstTransformedSize"),
        ),
        str(snapshot_id),
        client,
    )


def _resumo_base(
    *,
    snapshot_id: str,
    status: str | None,
    index_status: str | None,
    end_time: str | None,
    size,
    valid_size,
    transformed_size,
) -> dict:
    """Monta o resumo de uma coleta, decidindo se dá para falar em inválidos.

    Coleta não indexada não tem diagnóstico: `size` vem preenchido e `validSize`
    zerado, e subtrair um do outro daria "todos inválidos" quando a verdade é
    "nada foi avaliado". Ver `invalid_ratio` para a evidência.
    """
    avaliada = (index_status or "").upper() == "INDEXED"
    total = size or 0
    validos = valid_size or 0

    return {
        "snapshotId": snapshot_id,
        "status": status,
        "indexStatus": index_status,
        "evaluated": avaliada,
        "endTime": end_time,
        "size": size,
        "validSize": valid_size if avaliada else None,
        "transformedSize": transformed_size,
        "invalidSize": (total - validos) if avaliada else None,
        "violatedRuleCount": None,
        "topViolations": [],
    }


def _com_regras(resumo: dict, snapshot_id: str, client: HarvesterClient) -> dict:
    """Acrescenta as regras violadas ao resumo, se o diagnóstico responder.

    Coleta não avaliada nem chega a consultar: não há diagnóstico para ela, e a
    chamada seria desperdício contra uma origem instável.
    """
    if not resumo.get("evaluated"):
        return resumo

    # Import local: `harvests` importa de `integrations`, e importar no topo
    # criaria um ciclo entre as duas apps de domínio.
    from apps.harvests import services as harvests

    try:
        regras = harvests.rules(snapshot_id, client)
    except HarvesterError:
        return resumo

    violadas = [r for r in regras["results"] if (r.get("invalidCount") or 0) > 0]
    violadas.sort(key=lambda regra: regra["invalidCount"], reverse=True)
    resumo["violatedRuleCount"] = len(violadas)
    resumo["topViolations"] = [
        {"ruleId": r["ruleId"], "name": r["name"], "invalidCount": r["invalidCount"]}
        for r in violadas[:3]
    ]
    return resumo


def access_summaries(accesses) -> list[dict]:
    """Vínculos do usuário enriquecidos com as estatísticas da última coleta.

    Cada repositório é independente: se o Harvester falhar para um, os demais
    continuam sendo devolvidos e a linha correspondente é marcada como
    indisponível, em vez de derrubar o painel inteiro.
    """
    client = HarvesterClient()
    resumos = []

    for acesso in accesses:
        repository_id = acesso.harvester_repository_id
        linha = {
            "id": acesso.pk,
            "harvesterRepositoryId": repository_id,
            "acronym": acesso.acronym,
            "name": None,
            "institutionName": None,
            "grantedAt": acesso.granted_at,
            "lastHarvest": None,
            "unavailable": False,
        }

        try:
            # Caminho rápido: uma consulta a /private/networks devolve cadastro e
            # resumo da última coleta de uma vez. O caminho lento (dois pedidos)
            # só entra quando a sigla gravada não localiza o repositório.
            rede = _network_row_by_id(repository_id, acesso.acronym, client)

            if rede is not None:
                linha["acronym"] = rede.get("acronym") or acesso.acronym
                linha["name"] = rede.get("name")
                linha["institutionName"] = rede.get("institution")
                linha["lastHarvest"] = _harvest_from_network_row(rede, client)
            else:
                detalhe = repository_detail(repository_id, client)
                linha["acronym"] = detalhe.get("acronym") or acesso.acronym
                linha["name"] = detalhe.get("name")
                linha["institutionName"] = detalhe.get("institutionName")
                linha["lastHarvest"] = last_harvest_summary(repository_id, client)
        except HarvesterError:
            linha["unavailable"] = True

        resumos.append(linha)

    return resumos


def _network_to_row(network: dict) -> dict:
    """Normaliza um repositório do envelope HAL para o formato da nossa API."""
    return {
        "harvesterRepositoryId": _id_from_href(network),
        "acronym": network.get("acronym"),
        "name": network.get("name"),
        "institutionName": network.get("institutionName"),
        "published": network.get("published"),
    }


SEARCH_FIELDS = ("acronym", "name", "institution")


def _private_network_to_row(network: dict) -> dict:
    """Normaliza uma linha de /private/networks.

    Essa rota já traz o resumo da última coleta (`lst*`), então a linha serve
    tanto para escolher um repositório quanto para exibir seu estado.
    """
    return {
        "harvesterRepositoryId": str(network.get("networkID", "")),
        "acronym": network.get("acronym"),
        "name": network.get("name"),
        "institutionName": network.get("institution"),
        "institutionAcronym": network.get("institutionAcronym"),
        "lastSnapshotId": (
            str(network["lstSnapshotID"]) if network.get("lstSnapshotID") else None
        ),
        "lastSnapshotDate": network.get("lstSnapshotDate"),
        "lastSnapshotStatus": network.get("lstSnapshotStatus"),
        "lastSize": network.get("lstSize"),
        "lastValidSize": network.get("lstValidSize"),
        "lastTransformedSize": network.get("lstTransformedSize"),
        "lastIndexStatus": network.get("lstIndexStatus"),
        # Preenchido por `_annotate_manager_counts`; a origem não sabe disso.
        "managerCount": 0,
    }


def _annotate_manager_counts(rows: list[dict]) -> list[dict]:
    """Conta os gestores de cada repositório da página.

    É informação nossa, não da origem: uma agregação local sobre os
    identificadores da página, em uma consulta só.
    """
    if not rows:
        return rows

    identificadores = [linha["harvesterRepositoryId"] for linha in rows]
    contagens = dict(
        RepositoryAccess.objects.filter(harvester_repository_id__in=identificadores)
        .values_list("harvester_repository_id")
        .annotate(total=Count("id"))
    )

    for linha in rows:
        linha["managerCount"] = contagens.get(linha["harvesterRepositoryId"], 0)
    return rows


# O índice inteiro custa ~40 s e 2,9 MB. Só vale porque o cache é persistente:
# uma busca por TTL, compartilhada entre workers e sobrevivendo a reinício.
FULL_INDEX_TIMEOUT = 180.0
FULL_INDEX_PAGE = 2500


def full_network_index(client: HarvesterClient | None = None) -> list[dict]:
    """Todos os repositórios do Harvester, em uma lista.

    Existe para ordenações que a origem não oferece — ela só ordena por sigla,
    nome e instituição, e o painel precisa ordenar por percentual de registros
    inválidos, que é calculado.

    Ordenar apenas a página visível daria a ilusão de ordenar o conjunto, então
    ou se traz tudo ou não se ordena. Trazer tudo custa ~40 s, o que só é
    aceitável com cache persistente — daí o TTL longo e o comando
    `warm_repository_index`, que paga esse custo fora da hora do usuário.
    """
    def produce() -> list[dict]:
        # Cliente próprio: o timeout padrão de 10 s não cobre uma resposta de 40 s.
        lento = HarvesterClient(timeout=FULL_INDEX_TIMEOUT)
        payload = lento.list_networks(page=1, count=FULL_INDEX_PAGE) or {}
        return [_private_network_to_row(rede) for rede in payload.get("networks") or []]

    return cached(f"{CACHE_PREFIX}:index", _ttl("INDEX"), produce)


def invalid_ratio(row: dict) -> float:
    """Fração de registros inválidos da última coleta, entre 0 e 1.

    Devolve -1 quando **não há como saber**, e isso cobre dois casos distintos
    de "0% inválidos":

    1. coleta sem registros;
    2. coleta que não foi indexada (`lstIndexStatus` diferente de `INDEXED`).

    O segundo caso importa mais do que parece. Uma coleta que terminou em erro
    tem `lstSize` preenchido e `lstValidSize` zerado, e a conta ingênua daria
    **100% de inválidos** — quando a verdade é que nada foi avaliado. Verificado
    contra a origem: com `INDEXED`, diagnóstico e registros batem exatamente com
    `lstSize`; com `UNKNOWN` ou `FAILED`, ambos vêm zerados.

    Sem isso, 44 repositórios não avaliados ocupavam o topo da ordenação à
    frente de 755 com problemas reais de validação.
    """
    if (row.get("lastIndexStatus") or "").upper() != "INDEXED":
        return -1.0

    total = row.get("lastSize") or 0
    if total <= 0:
        return -1.0
    validos = row.get("lastValidSize") or 0
    return max(0.0, (total - validos) / total)


def repositories_by_invalid_ratio(
    page: int = 1,
    count: int = 25,
    client: HarvesterClient | None = None,
) -> dict:
    """Todos os repositórios, do mais problemático para o menos.

    Ordena pelo percentual de registros inválidos da última coleta e pagina
    localmente, já que a ordenação não vem da origem.
    """
    indice = list(full_network_index(client))
    indice.sort(
        key=lambda linha: (-invalid_ratio(linha), (linha.get("acronym") or "").lower())
    )

    total = len(indice)
    inicio = (page - 1) * count
    pagina = _annotate_manager_counts(indice[inicio : inicio + count])

    for linha in pagina:
        proporcao = invalid_ratio(linha)
        linha["invalidRatio"] = None if proporcao < 0 else round(proporcao, 6)
        linha["invalidSize"] = (
            None
            if proporcao < 0
            else (linha.get("lastSize") or 0) - (linha.get("lastValidSize") or 0)
        )

    return {
        "query": "",
        "field": None,
        "ordering": "invalidRatio",
        "page": page,
        "count": count,
        "totalElements": total,
        "totalPages": max(1, -(-total // count)) if total else 0,
        "results": pagina,
    }


def repository_index(client: HarvesterClient | None = None) -> dict:
    """Acervo inteiro, anotado e pronto para ordenar e filtrar no navegador.

    São ~960 KB (240 KB comprimidos) para 2.181 repositórios. Vale a pena porque
    é tela de administração: o custo é pago uma vez e, em troca, ordenar e
    filtrar por qualquer coluna deixa de exigir ida ao servidor. A alternativa
    — paginar e ordenar aqui — obrigaria a um parâmetro de consulta por critério.

    As contagens de gestores saem em **uma** consulta ao banco para todo o
    acervo, não uma por linha.
    """
    linhas = [dict(linha) for linha in full_network_index(client)]
    _annotate_manager_counts(linhas)

    for linha in linhas:
        proporcao = invalid_ratio(linha)
        linha["invalidRatio"] = None if proporcao < 0 else round(proporcao, 6)
        linha["invalidSize"] = (
            None
            if proporcao < 0
            else (linha.get("lastSize") or 0) - (linha.get("lastValidSize") or 0)
        )

    return {"count": len(linhas), "results": linhas}


def search_repositories(
    term: str,
    page: int = 1,
    count: int = 20,
    client: HarvesterClient | None = None,
) -> dict:
    """Busca repositórios por sigla, nome ou instituição.

    Usa `/private/networks`, a mesma rota da interface do Harvester: ela pagina
    de verdade e filtra no servidor, ao contrário de mesclar consultas soltas.

    A origem filtra um campo por vez, então o termo é tentado em sequência —
    sigla, nome, instituição — parando no primeiro que encontrar algo. Buscas
    por sigla, o caso comum, resolvem na primeira tentativa.

    Sem termo, devolve a lista completa paginada.
    """
    client = client or HarvesterClient()
    termo = (term or "").strip()

    def montar(payload: dict, campo: str | None) -> dict:
        total = payload.get("totalElements") or 0
        return {
            "query": termo,
            "field": campo,
            "page": page,
            "count": count,
            "totalElements": total,
            "totalPages": max(1, -(-total // count)) if total else 0,
            "results": _annotate_manager_counts(
                [_private_network_to_row(rede) for rede in payload.get("networks") or []]
            ),
        }

    if not termo:
        payload = client.list_networks(page=page, count=count, sort_field="acronym") or {}
        return montar(payload, None)

    for campo in SEARCH_FIELDS:
        payload = (
            client.list_networks(
                page=page, count=count, filter_field=campo, filter_value=termo
            )
            or {}
        )
        if (payload.get("totalElements") or 0) > 0:
            return montar(payload, campo)

    return montar({}, None)
