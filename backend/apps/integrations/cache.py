"""Cache das respostas do Harvester.

Vive em `integrations` porque mais de uma app de domínio precisa do mesmo
comportamento: guardar o que veio da origem, nunca guardar falha, e nunca deixar
o cache derrubar a aplicação.
"""

import logging
from typing import Any, Callable

from django.core.cache import cache

logger = logging.getLogger(__name__)

_MISS = object()


def _ler(key: str) -> Any:
    """Lê do cache tolerando indisponibilidade do backend.

    O backend nativo de Redis do Django não tem `IGNORE_EXCEPTIONS`: sem este
    tratamento, um Redis fora do ar viraria erro 500 em toda tela. Aqui a falha
    apenas degrada para "não tinha em cache", e o dado é buscado na origem.
    """
    try:
        return cache.get(key, _MISS)
    except Exception:
        logger.warning("Cache indisponível na leitura de %s", key, exc_info=True)
        return _MISS


def _gravar(key: str, value: Any, ttl: int) -> None:
    try:
        cache.set(key, value, ttl)
    except Exception:
        # Não conseguir gravar é perda de desempenho, não de correção.
        logger.warning("Cache indisponível na gravação de %s", key, exc_info=True)


def cached(key: str, ttl: int, produce: Callable[[], Any]) -> Any:
    """Lê do cache ou produz e grava.

    Usa sentinela em vez de `is not None` para que valores legitimamente vazios
    (um dicionário sem chaves, uma lista vazia) também sejam cacheados. Falhas
    do Harvester propagam sem serem gravadas: erro não vira resposta cacheada,
    senão uma indisponibilidade momentânea contaminaria toda a janela do TTL.
    """
    hit = _ler(key)
    if hit is not _MISS:
        return hit

    value = produce()
    _gravar(key, value, ttl)
    return value
