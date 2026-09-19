"""Consultas e transições das demandas de coleta."""

from django.db.models import QuerySet
from django.utils import timezone

from .models import HarvestRequest


def visiveis_para(user) -> QuerySet[HarvestRequest]:
    """O que cada perfil enxerga da fila.

    O ADMIN vê tudo — a demanda é única e compartilhada por todos eles.

    O gestor vê as **dos repositórios que gerencia**, e não só as que ele mesmo
    abriu: a demanda é do repositório, então o colega que assume o plantão
    precisa saber que o pedido já foi feito — senão abre outro, e a constraint
    o barra sem que ele entenda por quê.

    Aqui vale o contrato `None = todos` de `accessible_repository_ids()`, que é
    de autorização de leitura — diferente da caixa de entrada das notificações,
    onde ele daria ao administrador o acervo inteiro.
    """
    permitidos = user.accessible_repository_ids()
    queryset = HarvestRequest.objects.select_related("requester", "resolved_by")
    if permitidos is None:
        return queryset
    return queryset.filter(harvester_repository_id__in=permitidos)


def atender(demanda: HarvestRequest, snapshot_id: str, user) -> HarvestRequest:
    """Marca como atendida e guarda o número da coleta realizada."""
    demanda.status = HarvestRequest.Status.ATENDIDA
    demanda.snapshot_id = snapshot_id
    demanda.resolved_by = user
    demanda.resolved_at = timezone.now()
    demanda.save(update_fields=["status", "snapshot_id", "resolved_by", "resolved_at"])
    return demanda


def recusar(demanda: HarvestRequest, reason: str, user) -> HarvestRequest:
    """Marca como recusada. O motivo é obrigatório e volta para o gestor."""
    demanda.status = HarvestRequest.Status.RECUSADA
    demanda.reason = reason
    demanda.resolved_by = user
    demanda.resolved_at = timezone.now()
    demanda.save(update_fields=["status", "reason", "resolved_by", "resolved_at"])
    return demanda


def avisar_solicitante(demanda: HarvestRequest) -> None:
    """Fecha o ciclo: recado direto a quem pediu, com o desfecho.

    Reaproveita a notificação que já existe em vez de inventar outro canal — o
    gestor já tem o sino, e assim ele não precisa visitar a tela para descobrir
    que o pedido andou.

    A categoria é a de coleta quando existir; sem ela — catálogo editável, pode
    ter sido desativada — cai em qualquer ativa, e se não houver nenhuma o aviso
    é silenciosamente dispensado. A demanda resolvida é o registro que importa;
    derrubar o atendimento por falta de categoria seria pior.
    """
    from apps.notifications.models import Notification, NotificationCategory

    categoria = (
        NotificationCategory.objects.filter(slug="coleta", active=True).first()
        or NotificationCategory.objects.filter(active=True).first()
    )
    if categoria is None:
        return

    atendida = demanda.status == HarvestRequest.Status.ATENDIDA
    alvo = demanda.acronym or demanda.harvester_repository_id
    if atendida:
        titulo = f"Solicitação de coleta atendida — {alvo}"
        mensagem = f"Nova coleta realizada: #{demanda.snapshot_id}"
    else:
        titulo = f"Solicitação de coleta recusada — {alvo}"
        mensagem = demanda.reason

    Notification.objects.create(
        title=titulo[:120],
        message=mensagem,
        category=categoria,
        recipient=demanda.requester,
        author=demanda.resolved_by,
    )
