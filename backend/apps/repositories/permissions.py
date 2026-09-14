from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request
from rest_framework.views import APIView


class IsAdminProfile(permissions.BasePermission):
    """Restringe o acesso ao perfil ADMIN da aplicação.

    Não confundir com `is_staff`, que governa apenas o Django Admin.
    """

    message = "Apenas o perfil ADMIN pode executar esta ação."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_admin)


def assert_can_read_repository(user, repository_id: str) -> None:
    """Garante que o usuário pode ler o repositório.

    ADMIN passa direto; GESTOR precisa do vínculo em RepositoryAccess. A mesma
    checagem que `harvests` faz por snapshot, aqui feita direto pelo repositório.
    """
    allowed = user.accessible_repository_ids()
    if allowed is None:
        return
    if str(repository_id) not in allowed:
        raise PermissionDenied("Este repositório está fora dos seus vínculos.")
