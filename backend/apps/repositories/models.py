from django.conf import settings
from django.db import models


class RepositoryAccess(models.Model):
    """Vínculo entre um gestor e um repositório do Harvester.

    O perfil ADMIN enxerga todos os repositórios e não depende destes registros.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="repository_accesses",
        on_delete=models.CASCADE,
        verbose_name="usuário",
    )
    harvester_repository_id = models.CharField(
        "identificador no Harvester",
        max_length=64,
        db_index=True,
    )
    acronym = models.CharField("sigla", max_length=32)
    granted_at = models.DateTimeField("associado em", auto_now_add=True)

    class Meta:
        verbose_name = "acesso a repositório"
        verbose_name_plural = "acessos a repositórios"
        ordering = ["acronym"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "harvester_repository_id"],
                name="unique_user_repository",
            )
        ]

    def __str__(self) -> str:
        return f"{self.user} → {self.acronym}"
