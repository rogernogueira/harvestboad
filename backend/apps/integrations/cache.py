"""Cache das respostas do Harvester.

Vive em `integrations` porque mais de uma app de domínio precisa do mesmo
comportamento: guardar o que veio da origem, nunca guardar falha.
"""

from typing import Any, Callable

from django.core.cache import cache

_MISS = object()


def cached(key: str, ttl: int, produce: Callable[[], Any]) -> Any:
    """Lê do cache ou produz e grava.

    Usa sentinela em vez de `is not None` para que valores legitimamente vazios
    (um dicionário sem chaves, uma lista vazia) também sejam cacheados. Falhas
    do Harvester propagam sem serem gravadas: erro não vira resposta cacheada,
    senão uma indisponibilidade momentânea contaminaria toda a janela do TTL.
    """
    hit = cache.get(key, _MISS)
    if hit is not _MISS:
        return hit

    value = produce()
    cache.set(key, value, ttl)
    return value
