from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """Registro administrativo de ações relevantes.

    O usuário é preservado como NULL quando a conta é removida, para que o
    histórico não desapareça junto.
    """

    class Action(models.TextChoices):
        LOGIN = "LOGIN", "Autenticação"
        LOGOUT = "LOGOUT", "Encerramento de sessão"
        CREATE = "CREATE", "Criação"
        UPDATE = "UPDATE", "Alteração"
        DELETE = "DELETE", "Exclusão"
        EXPORT = "EXPORT", "Exportação"
        HARVEST = "HARVEST", "Coleta"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="audit_logs",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="usuário",
    )
    action = models.CharField("ação", max_length=16, choices=Action.choices)
    resource = models.CharField("recurso", max_length=64)
    resource_id = models.CharField("identificador do recurso", max_length=64, blank=True)
    created_at = models.DateTimeField("data", auto_now_add=True, db_index=True)
    ip_address = models.GenericIPAddressField("endereço IP", null=True, blank=True)

    class Meta:
        verbose_name = "registro de auditoria"
        verbose_name_plural = "registros de auditoria"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["resource", "resource_id"]),
        ]

    def __str__(self) -> str:
        return f"{self.created_at:%d/%m/%Y %H:%M} — {self.user or 'anônimo'}: {self.action} {self.resource}"
