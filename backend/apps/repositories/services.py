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
