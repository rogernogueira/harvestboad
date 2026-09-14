from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from apps.audit.models import AuditLog
from apps.audit.services import record
from apps.integrations.harvester import HarvesterClient, HarvesterError
from apps.integrations.views import HarvesterBackedAPIView

from . import services
from .models import RepositoryAccess
from .permissions import IsAdminProfile, assert_can_read_repository
from .serializers import RepositoryAccessSerializer, RepositoryAccessWriteSerializer

RESOURCE = "repository_access"


@extend_schema_view(
    list=extend_schema(description="ADMIN vê todos os vínculos; GESTOR, apenas os próprios."),
    create=extend_schema(description="Associa um gestor a um repositório. Exclusivo do perfil ADMIN."),
    destroy=extend_schema(description="Remove o vínculo. Exclusivo do perfil ADMIN."),
)
class RepositoryAccessViewSet(
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Vínculos usuário↔repositório.

    Leitura é permitida a qualquer autenticado, com escopo por perfil.
    Escrita é restrita ao perfil ADMIN. Não há atualização: um vínculo é
    criado ou removido, nunca editado.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.action in {"create", "destroy"}:
            return [permissions.IsAuthenticated(), IsAdminProfile()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == "create":
            return RepositoryAccessWriteSerializer
        return RepositoryAccessSerializer

    def get_queryset(self):
        queryset = RepositoryAccess.objects.select_related("user")
        user = self.request.user
        if user.is_admin:
            return queryset
        return queryset.filter(user=user)

    def perform_create(self, serializer) -> None:
        access = serializer.save()
        record(
            action=AuditLog.Action.CREATE,
            resource=RESOURCE,
            resource_id=access.pk,
            request=self.request,
        )

    def perform_destroy(self, instance) -> None:
        resource_id = instance.pk
        instance.delete()
        record(
            action=AuditLog.Action.DELETE,
            resource=RESOURCE,
            resource_id=resource_id,
            request=self.request,
        )

    @extend_schema(
        description=(
            "Repositórios disponíveis no Harvester, para o ADMIN escolher ao criar "
            "um vínculo. Responde 503 quando o Harvester está inacessível."
        ),
        responses={200: None, 503: None},
    )
    @action(detail=False, methods=["get"], permission_classes=[permissions.IsAuthenticated, IsAdminProfile])
    def available(self, request: Request) -> Response:
        page = int(request.query_params.get("page", 0))
        size = int(request.query_params.get("size", 50))
        try:
            payload = HarvesterClient().list_networks_rest(page=page, size=size)
        except HarvesterError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        networks = (payload or {}).get("_embedded", {}).get("network", [])
        return Response(
            {
                "page": (payload or {}).get("page", {}),
                "results": [
                    {
                        "harvesterRepositoryId": (
                            network.get("_links", {}).get("self", {}).get("href", "").rsplit("/", 1)[-1]
                        ),
                        "acronym": network.get("acronym"),
                        "name": network.get("name"),
                        "institutionName": network.get("institutionName"),
                        "published": network.get("published"),
                    }
                    for network in networks
                ],
            }
        )


REPOSITORY_PARAM = OpenApiParameter(
    "repository_id", int, OpenApiParameter.PATH, description="ID do repositório no Harvester."
)


class RepositoryDetailView(HarvesterBackedAPIView):
    """Visão geral do repositório: dados cadastrais vindos do Harvester."""

    @extend_schema(
        parameters=[REPOSITORY_PARAM],
        description="Dados cadastrais do repositório. Restrito aos vínculos do usuário.",
    )
    def get(self, request: Request, repository_id: int) -> Response:
        assert_can_read_repository(request.user, repository_id)
        return Response(services.repository_detail(str(repository_id)))


class RepositoryHarvestsView(HarvesterBackedAPIView):
    """Histórico de coletas do repositório.

    É o elo que faltava entre escolher um repositório e abrir uma coleta: daqui
    saem os `snapshotId` consumidos por /api/v1/harvests/{snapshot_id}.
    """

    @extend_schema(
        parameters=[REPOSITORY_PARAM],
        description="Coletas do repositório, da mais recente para a mais antiga.",
    )
    def get(self, request: Request, repository_id: int) -> Response:
        assert_can_read_repository(request.user, repository_id)
        return Response(services.repository_harvests(str(repository_id)))
