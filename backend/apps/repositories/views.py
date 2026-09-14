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
from .serializers import (
    RepositoryAccessSerializer,
    RepositoryAccessWriteSerializer,
    RepositoryManagerSerializer,
)

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
        if not user.is_admin:
            queryset = queryset.filter(user=user)

        repositorio = self.request.query_params.get("repository")
        if repositorio:
            queryset = queryset.filter(harvester_repository_id=repositorio)

        return queryset

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
        parameters=[
            OpenApiParameter(
                "search",
                str,
                description="Busca por sigla, nome ou instituição. Sem acento não encontra nomes acentuados.",
            ),
            OpenApiParameter("page", int, description="Página, começando em 1."),
            OpenApiParameter("count", int, description="Resultados por página (máx. 100)."),
        ],
        description=(
            "Busca repositórios no Harvester por sigla, nome ou instituição, com "
            "paginação da própria origem. Sem termo, lista todos. Responde 503 "
            "quando o Harvester está inacessível."
        ),
        responses={200: None, 503: None},
    )
    @action(
        detail=False,
        methods=["get"],
        url_path="search",
        permission_classes=[permissions.IsAuthenticated, IsAdminProfile],
    )
    def search(self, request: Request) -> Response:
        try:
            page = max(1, int(request.query_params.get("page", 1)))
            count = min(100, max(1, int(request.query_params.get("count", 20))))
        except ValueError:
            page, count = 1, 20

        try:
            resultado = services.search_repositories(
                request.query_params.get("search", ""), page=page, count=count
            )
        except HarvesterError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        return Response(resultado)

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


class MyRepositoriesSummaryView(HarvesterBackedAPIView):
    """Painel de repositórios do usuário, com estatísticas da última coleta.

    Existe para que o painel faça **uma** requisição em vez de três por
    repositório: histórico, diagnóstico e regras são compostos aqui, sobre o
    mesmo cache das telas de coleta.
    """

    @extend_schema(
        description=(
            "Repositórios do usuário com o resumo da última coleta: totais, data, "
            "quantidade de regras violadas e as três com mais violações."
        ),
    )
    def get(self, request: Request) -> Response:
        queryset = RepositoryAccess.objects.select_related("user")
        if not request.user.is_admin:
            queryset = queryset.filter(user=request.user)

        resumos = services.access_summaries(queryset)
        return Response({"count": len(resumos), "results": resumos})


class RepositoryDetailView(HarvesterBackedAPIView):
    """Visão geral do repositório: dados cadastrais vindos do Harvester."""

    @extend_schema(
        parameters=[REPOSITORY_PARAM],
        description="Dados cadastrais do repositório. Restrito aos vínculos do usuário.",
    )
    def get(self, request: Request, repository_id: int) -> Response:
        assert_can_read_repository(request.user, repository_id)
        return Response(services.repository_detail(str(repository_id)))


class RepositoryManagersView(HarvesterBackedAPIView):
    """Gestores vinculados a um repositório.

    Diferente de `/accesses/?repository=`, que devolve ao gestor apenas o próprio
    vínculo: aqui quem tem acesso ao repositório vê **todos** os que cuidam dele.
    A regra de entrada é a mesma das outras rotas do repositório.
    """

    @extend_schema(
        parameters=[REPOSITORY_PARAM],
        description=(
            "Gestores vinculados ao repositório. Exige acesso ao próprio "
            "repositório; o e-mail só é devolvido ao perfil ADMIN."
        ),
    )
    def get(self, request: Request, repository_id: int) -> Response:
        assert_can_read_repository(request.user, repository_id)

        vinculos = (
            RepositoryAccess.objects.select_related("user")
            .filter(harvester_repository_id=str(repository_id))
            .order_by("user__username")
        )
        serializer = RepositoryManagerSerializer(
            vinculos, many=True, context={"request": request}
        )
        return Response({"count": vinculos.count(), "results": serializer.data})


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
