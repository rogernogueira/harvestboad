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
    phone = models.CharField(
        "telefone para contato",
        max_length=32,
        blank=True,
        # Texto livre, e não um formato validado: o cadastro recebe ramal
        # ("(61) 3217-6360 r. 214") e número internacional, e nenhuma máscara
        # de celular brasileiro aceitaria os dois.
        help_text="Telefone de contato, com DDD.",
    )
    institution = models.CharField(
        "instituição",
        max_length=200,
        blank=True,
        # Declarada pelo gestor, não derivada dos repositórios a que ele tem
        # acesso: quem cuida do repositório de uma universidade nem sempre é
        # dela.
        help_text="Instituição à qual o gestor está vinculado.",
    )
    department_email = models.EmailField(
        "e-mail do departamento/setor",
        blank=True,
        # Sem `unique`, ao contrário do `email`: é o endereço do setor, e a
        # equipe inteira de um repositório costuma declarar o mesmo.
        help_text="E-mail institucional do departamento ou setor, para contato da equipe.",
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
