from django.contrib.auth.models import AbstractUser
from django.db import models


class Profile(models.TextChoices):
    """Perfis de acesso da aplicação."""

    ADMIN = "ADMIN", "Administrador"
    GESTOR = "GESTOR", "Gestor"


class User(AbstractUser):
    """Usuário da aplicação.

    Herda de AbstractUser para manter o hashing de senha, permissões e o
    `last_login` do Django, acrescentando o perfil e a troca obrigatória de senha.
    """

    email = models.EmailField("e-mail", unique=True)
    profile = models.CharField(
        "perfil",
        max_length=16,
        choices=Profile.choices,
        default=Profile.GESTOR,
    )
    must_change_password = models.BooleanField(
        "troca obrigatória de senha",
        default=True,
        help_text="Obriga a definir uma nova senha no próximo acesso.",
    )

    class Meta:
        verbose_name = "usuário"
        verbose_name_plural = "usuários"
        ordering = ["username"]

    def __str__(self) -> str:
        return f"{self.get_full_name() or self.username} ({self.get_profile_display()})"

    @property
    def is_admin(self) -> bool:
        return self.profile == Profile.ADMIN

    def accessible_repository_ids(self) -> list[str] | None:
        """IDs de repositório no Harvester que o usuário pode ver.

        `None` significa "todos" — usado pelo perfil ADMIN, que não é limitado
        por vínculos em RepositoryAccess.
        """
        if self.is_admin:
            return None
        return list(self.repository_accesses.values_list("harvester_repository_id", flat=True))
