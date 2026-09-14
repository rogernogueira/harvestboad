"""Leitura dos repositórios no Harvester.

O `RepositoryAccess` guarda apenas o vínculo (quem acessa o quê). Os dados
cadastrais do repositório e o histórico de coletas vivem no Harvester, e são
lidos aqui — sempre com cache, porque a origem é lenta e instável.
"""

from typing import Any

from django.conf import settings

from apps.integrations.cache import cached
from apps.integrations.harvester import HarvesterClient, HarvesterError

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


def last_harvest_summary(repository_id: str, client: HarvesterClient | None = None) -> dict | None:
    """Estatísticas da última coleta do repositório.

    Compõe três leituras já cacheadas individualmente (histórico, diagnóstico e
    regras), de modo que o painel não precise fazer três viagens por linha.
    Devolve None quando o repositório nunca foi coletado.
    """
    # Import local: `harvests` importa de `integrations`, e importar no topo
    # criaria um ciclo entre as duas apps de domínio.
    from apps.harvests import services as harvests

    client = client or HarvesterClient()

    historico = repository_harvests(repository_id, client)
    ultima = _latest_finished(historico["results"])
    if not ultima or not ultima.get("snapshotId"):
        return None

    snapshot_id = ultima["snapshotId"]
    resumo = {
        "snapshotId": snapshot_id,
        "status": ultima.get("status"),
        "endTime": ultima.get("endTime"),
        "size": ultima.get("size"),
        "validSize": ultima.get("validSize"),
        "transformedSize": ultima.get("transformedSize"),
        "invalidSize": (ultima.get("size") or 0) - (ultima.get("validSize") or 0),
        "harvestCount": historico["count"],
        "violatedRuleCount": None,
        "topViolations": [],
    }

    # O diagnóstico é a parte mais cara e a que mais falha; sem ele o resumo
    # ainda vale pelos números da própria coleta.
    try:
        regras = harvests.rules(snapshot_id, client)
    except HarvesterError:
        return resumo

    violadas = [
        regra for regra in regras["results"] if (regra.get("invalidCount") or 0) > 0
    ]
    violadas.sort(key=lambda regra: regra["invalidCount"], reverse=True)

    resumo["violatedRuleCount"] = len(violadas)
    resumo["topViolations"] = [
        {
            "ruleId": regra["ruleId"],
            "name": regra["name"],
            "invalidCount": regra["invalidCount"],
        }
        for regra in violadas[:3]
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
            detalhe = repository_detail(repository_id, client)
            linha["acronym"] = detalhe.get("acronym") or acesso.acronym
            linha["name"] = detalhe.get("name")
            linha["institutionName"] = detalhe.get("institutionName")
            linha["lastHarvest"] = last_harvest_summary(repository_id, client)
        except HarvesterError:
            linha["unavailable"] = True

        resumos.append(linha)

    return resumos
