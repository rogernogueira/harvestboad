"""Ponto único de gravação da trilha de auditoria."""

from typing import Any

from django.http import HttpRequest

from .models import AuditLog


def client_ip(request: HttpRequest | None) -> str | None:
    """IP do cliente, respeitando X-Forwarded-For quando houver proxy à frente."""
    if request is None:
        return None
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def record(
    *,
    action: str,
    resource: str,
    resource_id: str | Any = "",
    user: Any = None,
    request: HttpRequest | None = None,
) -> AuditLog:
    """Grava uma entrada de auditoria.

    `user` cai para `request.user` quando não informado; usuários anônimos são
    gravados como NULL.
    """
    if user is None and request is not None:
        candidate = getattr(request, "user", None)
        user = candidate if getattr(candidate, "is_authenticated", False) else None

    return AuditLog.objects.create(
        user=user,
        action=action,
        resource=resource,
        resource_id=str(resource_id or ""),
        ip_address=client_ip(request),
    )
