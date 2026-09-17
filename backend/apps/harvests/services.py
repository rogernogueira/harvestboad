"""Regras de leitura das coletas, sobre o cliente do Harvester.

Três preocupações moram aqui: resolver a qual repositório um snapshot pertence
(base do controle de acesso do GESTOR), normalizar as respostas do Harvester
para o formato da nossa API e guardar em cache o que vem da origem.

Sobre o cache: ele é aplicado nas **respostas cruas do Harvester**, não nas
respostas já formatadas. Isso faz `diagnosis()` e `rules()` — que derivam do
mesmo `/public/diagnose/{id}` — compartilharem uma única ida à origem, e faz a
varredura de `find_record()` reaproveitar páginas já buscadas.

Os dados cacheados não dependem do usuário: a autorização acontece antes, na
view, e a chave é sempre o snapshot. Um cache compartilhado entre usuários é,
portanto, correto aqui.
"""

import hashlib
from typing import Any

from django.conf import settings
from django.core.cache import cache

from apps.integrations.cache import cached as _cached
from apps.integrations.harvester import HarvesterClient, HarvesterError

from .filters import RecordFilters

# Mudar este prefixo invalida tudo de uma vez — útil quando o formato normalizado
# muda e o cache antigo passa a ter a forma errada.
CACHE_PREFIX = "harvests:v1"

def _ttl(name: str) -> int:
    return settings.HARVESTER[f"CACHE_TTL_{name}"]


def _id_from_href(payload: dict | None) -> str:
    """Extrai o identificador do `_links.self.href` do HAL do Spring Data REST."""
    href = ((payload or {}).get("_links", {}).get("self", {}) or {}).get("href", "")
    return href.rstrip("/").rsplit("/", 1)[-1] if href else ""


# --- Camada crua, cacheada ---------------------------------------------------


def _raw_snapshot(snapshot_id: str, client: HarvesterClient) -> dict:
    return _cached(
        f"{CACHE_PREFIX}:snapshot:{snapshot_id}",
        _ttl("SNAPSHOT"),
        lambda: client.get_json(f"/rest/snapshot/{snapshot_id}") or {},
    )


def _raw_diagnose(snapshot_id: str, client: HarvesterClient) -> dict:
    """Diagnóstico cru, compartilhado por `diagnosis()` e `rules()`."""
    return _cached(
        f"{CACHE_PREFIX}:diagnose:{snapshot_id}",
        _ttl("DIAGNOSE"),
        lambda: client.get_diagnose(snapshot_id) or {},
    )


def _raw_records_page(
    snapshot_id: str,
    page: int,
    count: int,
    client: HarvesterClient,
    filters: RecordFilters | None = None,
) -> dict:
    filters = filters or RecordFilters()
    query = filters.to_query()
    return _cached(
        f"{CACHE_PREFIX}:records:{snapshot_id}:{filters.cache_token()}:{page}:{count}",
        _ttl("RECORDS"),
        lambda: client.list_record_validation_results(
            snapshot_id, page=page, count=count, query=query
        )
        or {},
    )


# --- API do módulo -----------------------------------------------------------


def snapshot_network(snapshot_id: str, client: HarvesterClient | None = None) -> dict:
    """Repositório dono do snapshot.

    Entra em toda requisição autorizada, por isso o TTL mais longo: o vínculo
    entre snapshot e repositório não muda depois que a coleta existe.
    """
    client = client or HarvesterClient()

    def produce() -> dict:
        payload = client.get_json(f"/rest/snapshot/{snapshot_id}/network")
        return {
            "harvesterRepositoryId": _id_from_href(payload),
            "acronym": (payload or {}).get("acronym"),
            "name": (payload or {}).get("name"),
            "institutionName": (payload or {}).get("institutionName"),
        }

    return _cached(f"{CACHE_PREFIX}:network:{snapshot_id}", _ttl("NETWORK"), produce)


def snapshot_detail(snapshot_id: str, client: HarvesterClient | None = None) -> dict:
    client = client or HarvesterClient()
    snapshot = _raw_snapshot(snapshot_id, client)
    return {
        "snapshotId": str(snapshot_id),
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
        "repository": snapshot_network(snapshot_id, client),
    }


def diagnosis(snapshot_id: str, client: HarvesterClient | None = None) -> dict:
    """Resumo do diagnóstico. As regras saem no endpoint próprio."""
    payload = _raw_diagnose(snapshot_id, client or HarvesterClient())
    size = payload.get("size") or 0
    valid = payload.get("validSize") or 0
    return {
        "snapshotId": str(snapshot_id),
        "size": payload.get("size"),
        "validSize": payload.get("validSize"),
        "invalidSize": size - valid,
        "transformedSize": payload.get("transformedSize"),
        "ruleCount": len(payload.get("rulesByID") or {}),
        "facets": payload.get("facets"),
    }


def rules(snapshot_id: str, client: HarvesterClient | None = None) -> dict:
    """Regras de validação aplicadas, extraídas do diagnóstico.

    O Harvester devolve um mapa `rulesByID`; aqui vira lista ordenada.
    """
    payload = _raw_diagnose(snapshot_id, client or HarvesterClient())
    by_id = payload.get("rulesByID") or {}
    results = [
        {
            "ruleId": rule.get("ruleID"),
            "name": rule.get("name"),
            "description": rule.get("description"),
            "quantifier": rule.get("quantifier"),
            "mandatory": rule.get("mandatory"),
            "validCount": rule.get("validCount"),
            "invalidCount": rule.get("invalidCount"),
        }
        for rule in by_id.values()
    ]
    results.sort(key=lambda item: (item["ruleId"] is None, item["ruleId"]))
    return {"snapshotId": str(snapshot_id), "count": len(results), "results": results}


def rule_occurrences(
    snapshot_id: str,
    rule_id: str,
    client: HarvesterClient | None = None,
    filters: RecordFilters | None = None,
) -> dict:
    """Ocorrências de uma regra na coleta, agrupadas por valor.

    O Harvester devolve `validRuleOccrs` / `invalidRuleOccrs`; aqui viram `valid`
    e `invalid`, com os totais somados.

    Os filtros são os mesmos da listagem de registros e recortam as contagens da
    mesma forma, o que mantém o modal de ocorrências coerente com o número em
    que o usuário clicou. Sem filtro a consulta não vai no caminho: o literal
    neutro "fq" da listagem faz esta rota responder 500.
    """
    client = client or HarvesterClient()
    filters = filters or RecordFilters()
    query = None if filters.is_empty else filters.to_query()
    payload = _cached(
        f"{CACHE_PREFIX}:occurrences:{snapshot_id}:{rule_id}:{filters.cache_token()}",
        _ttl("DIAGNOSE"),
        lambda: client.list_validation_occurrences(snapshot_id, rule_id, query=query) or {},
    )

    def normalize(entries: list | None) -> list[dict]:
        return [
            {"value": entry.get("value"), "count": entry.get("count")}
            for entry in (entries or [])
        ]

    valid = normalize(payload.get("validRuleOccrs"))
    invalid = normalize(payload.get("invalidRuleOccrs"))
    return {
        "snapshotId": str(snapshot_id),
        "ruleId": str(rule_id),
        "validTotal": sum(item["count"] or 0 for item in valid),
        "invalidTotal": sum(item["count"] or 0 for item in invalid),
        "filters": filters.as_dict(),
        "valid": valid,
        "invalid": invalid,
    }


def records(
    snapshot_id: str,
    page: int = 1,
    count: int = 20,
    client: HarvesterClient | None = None,
    filters: RecordFilters | None = None,
) -> dict:
    filters = filters or RecordFilters()
    payload = _raw_records_page(
        snapshot_id, page, count, client or HarvesterClient(), filters
    )
    return {
        "snapshotId": str(snapshot_id),
        "page": page,
        "count": count,
        "totalElements": payload.get("totalElements"),
        "totalPages": payload.get("totalPages"),
        # Eco dos filtros: permite ao cliente preservá-los ao navegar entre
        # diagnóstico e registros sem remontar a query string.
        "filters": filters.as_dict(),
        "results": payload.get("content") or [],
    }


def record_id_for(snapshot_id: str, identifier: str, acronym: str) -> str:
    """Monta o ID interno do registro no índice do Harvester.

    O formato é `{snapshotID}-{sigla}_{md5(identifier)}`, verificado contra os
    dados reais. Conhecê-lo permite localizar um registro com uma única consulta
    filtrada, em vez de varrer páginas.
    """
    digest = hashlib.md5(identifier.encode("utf-8")).hexdigest()
    return f"{snapshot_id}-{acronym}_{digest}"


def find_record(
    snapshot_id: str,
    identifier: str,
    client: HarvesterClient | None = None,
    filters: RecordFilters | None = None,
) -> dict | None:
    """Localiza um registro pelo identificador OAI.

    O índice não aceita filtro por `identifier`: com aspas responde 500, com
    dois-pontos escapados responde 400, e o "/" dos identificadores OAI faz o
    Tomcat recusar o caminho. Só `id` funciona como filtro.

    O problema é que o formato do `id` **não é uniforme** entre coletas: umas
    usam `{snapshot}-{sigla}_{md5(identifier)}`, outras um inteiro opaco. Daí a
    estratégia em dois tempos:

    1. tenta o `id` derivado — uma requisição, resolve as coletas do primeiro
       formato;
    2. se não achar, varre as páginas, aplicando os filtros que vierem da tela.
       Vindo de uma listagem filtrada, o espaço de busca costuma ser pequeno.
    """
    client = client or HarvesterClient()
    filters = filters or RecordFilters()

    acronym = snapshot_network(snapshot_id, client).get("acronym")
    if acronym:
        derivado = filters.with_record_id(record_id_for(snapshot_id, identifier, acronym))
        payload = _raw_records_page(snapshot_id, 1, 1, client, derivado)
        for record in payload.get("content") or []:
            if record.get("identifier") == identifier:
                return record

    return _scan_for_record(snapshot_id, identifier, client, filters)


def _scan_for_record(
    snapshot_id: str,
    identifier: str,
    client: HarvesterClient,
    filters: RecordFilters,
) -> dict | None:
    """Varredura paginada, limitada por orçamento configurável."""
    page_size = settings.HARVESTER["RECORD_SCAN_PAGE_SIZE"]
    max_pages = settings.HARVESTER["RECORD_SCAN_MAX_PAGES"]

    for page in range(1, max_pages + 1):
        payload = _raw_records_page(snapshot_id, page, page_size, client, filters)
        content = payload.get("content") or []
        for record in content:
            if record.get("identifier") == identifier:
                return record
        total_pages = payload.get("totalPages") or 0
        if not content or page >= total_pages:
            return None
    return None


def record_xml(
    snapshot_id: str,
    identifier: str,
    client: HarvesterClient | None = None,
) -> str | None:
    """XML transformado do registro, ou None quando o Harvester não o resolve.

    O serviço responde 200 com a mensagem de texto
    "No record found - Probably the diagnose report is outdated" em vez de um
    404, então a detecção é pelo conteúdo. A ausência também é cacheada: hoje
    ela é a resposta para todo registro, e repetir a chamada não muda nada.
    """
    client = client or HarvesterClient()
    body = _cached(
        f"{CACHE_PREFIX}:xml:{snapshot_id}:{identifier}",
        _ttl("XML"),
        lambda: client.get_record_metadata(snapshot_id, identifier),
    )
    stripped = (body or "").strip()
    if not stripped or not stripped.startswith("<"):
        return None
    return stripped


def clear_snapshot_cache(snapshot_id: str) -> None:
    """Descarta o que é barato de reconstruir para um snapshot.

    Não remove as páginas de registros nem os XMLs: as chaves dependem de
    paginação e identificador, e o backend de cache não oferece varredura por
    prefixo de forma portátil. Para um descarte total, mude `CACHE_PREFIX`.
    """
    cache.delete_many(
        [
            f"{CACHE_PREFIX}:snapshot:{snapshot_id}",
            f"{CACHE_PREFIX}:diagnose:{snapshot_id}",
            f"{CACHE_PREFIX}:network:{snapshot_id}",
        ]
    )


__all__ = [
    "CACHE_PREFIX",
    "HarvesterError",
    "clear_snapshot_cache",
    "diagnosis",
    "find_record",
    "record_xml",
    "records",
    "rule_occurrences",
    "rules",
    "snapshot_detail",
    "snapshot_network",
]
