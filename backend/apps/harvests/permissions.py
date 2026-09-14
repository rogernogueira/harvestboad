"""Controle de acesso das coletas.

O vínculo é indireto: o usuário tem acesso a repositórios (RepositoryAccess), e
um snapshot pertence a um repositório. Resolver esse elo exige consultar o
Harvester, por isso o resultado fica em cache em `services.snapshot_network`.
"""

from rest_framework.exceptions import PermissionDenied

from .services import snapshot_network


def assert_can_read_snapshot(user, snapshot_id: str) -> dict:
    """Garante que o usuário pode ler o snapshot e devolve o repositório dono.

    ADMIN passa direto. GESTOR só passa se o repositório do snapshot estiver
    entre os seus vínculos.
    """
    network = snapshot_network(snapshot_id)

    allowed = user.accessible_repository_ids()
    if allowed is None:  # ADMIN
        return network

    if network["harvesterRepositoryId"] not in allowed:
        raise PermissionDenied(
            "Esta coleta pertence a um repositório fora dos seus vínculos."
        )
    return network
