from django.conf import settings
from django.db import models


class HarvestRequest(models.Model):
    """Pedido de nova coleta, do gestor para os administradores.

    Inverte o sentido do resto do sistema: até aqui o administrador avisava o
    gestor, e aqui é o gestor que abre uma demanda.

    **A demanda é uma só para todos os administradores**, não uma cópia por
    pessoa — o mesmo arranjo das notificações, e pelo mesmo motivo: quem atende
    resolve pela equipe, e duplicar o registro faria a fila mostrar o mesmo
    pedido várias vezes.

    Um repositório só pode ter **uma demanda pendente por vez**. Sem isso, o
    gestor que não vê resposta clica de novo e a fila enche de duplicatas do
    mesmo pedido — a constraint parcial devolve o erro em vez de aceitar.
    """

    class Status(models.TextChoices):
        PENDENTE = "PENDENTE", "Pendente"
        ATENDIDA = "ATENDIDA", "Atendida"
        RECUSADA = "RECUSADA", "Recusada"

    harvester_repository_id = models.CharField(
        "identificador no Harvester", max_length=64, db_index=True
    )
    # Sigla no momento do pedido, como em `RepositoryAccess`: a fila precisa
    # nomear o repositório sem uma ida ao Harvester por linha.
    acronym = models.CharField("sigla", max_length=32, blank=True)
    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="harvest_requests",
        on_delete=models.CASCADE,
        verbose_name="solicitante",
    )
    note = models.TextField("justificativa", blank=True)

    status = models.CharField(
        "situação", max_length=16, choices=Status.choices, default=Status.PENDENTE, db_index=True
    )
    # Preenchido ao atender: é o retorno concreto que o gestor esperava.
    snapshot_id = models.CharField("coleta realizada", max_length=64, blank=True)
    # Preenchido ao recusar. Obrigatório nesse caso — sem o motivo, o gestor
    # repete o pedido sem saber por quê.
    reason = models.TextField("motivo da recusa", blank=True)

    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="harvest_requests_resolved",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="resolvida por",
    )
    resolved_at = models.DateTimeField("resolvida em", null=True, blank=True)
    created_at = models.DateTimeField("aberta em", auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "demanda de coleta"
        verbose_name_plural = "demandas de coleta"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["harvester_repository_id"],
                condition=models.Q(status="PENDENTE"),
                name="uma_demanda_pendente_por_repositorio",
            ),
            models.CheckConstraint(
                # Cada situação carrega o que lhe cabe: atendida tem a coleta,
                # recusada tem o motivo, pendente não tem nem um nem outro.
                condition=(
                    models.Q(status="PENDENTE", snapshot_id="", reason="", resolved_at__isnull=True)
                    | models.Q(status="ATENDIDA", reason="", resolved_at__isnull=False)
                    & ~models.Q(snapshot_id="")
                    | models.Q(status="RECUSADA", snapshot_id="", resolved_at__isnull=False)
                    & ~models.Q(reason="")
                ),
                name="demanda_coerente_com_a_situacao",
            ),
        ]
        indexes = [models.Index(fields=["status", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.acronym or self.harvester_repository_id} — {self.get_status_display()}"
