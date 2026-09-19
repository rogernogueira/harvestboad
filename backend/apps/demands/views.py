from django.db import IntegrityError, transaction
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.request import Request
from rest_framework.response import Response

from apps.audit.models import AuditLog
from apps.audit.services import record
from apps.repositories.permissions import IsAdminProfile, assert_can_read_repository

from . import services
from .models import HarvestRequest
from .serializers import (
    AtenderSerializer,
    HarvestRequestSerializer,
    HarvestRequestWriteSerializer,
    RecusarSerializer,
)

RESOURCE = "harvest_request"


@extend_schema(tags=["demands"])
class HarvestRequestViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """Demandas de nova coleta, do gestor para os administradores.

    Sem `update` nem `destroy`: a demanda muda de situação pelas ações
    `attend` e `refuse`, que registram quem resolveu e quando. Editá-la por
    fora disso apagaria esse rastro.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.action in {"attend", "refuse"}:
            return [permissions.IsAuthenticated(), IsAdminProfile()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == "create":
            return HarvestRequestWriteSerializer
        if self.action == "attend":
            return AtenderSerializer
        if self.action == "refuse":
            return RecusarSerializer
        return HarvestRequestSerializer

    def get_queryset(self):
        queryset = services.visiveis_para(self.request.user)

        repositorio = self.request.query_params.get("repository")
        if repositorio:
            queryset = queryset.filter(harvester_repository_id=str(repositorio))
        situacao = self.request.query_params.get("status")
        if situacao:
            queryset = queryset.filter(status=situacao)
        return queryset

    @extend_schema(
        parameters=[
            OpenApiParameter("repository", str, description="Só as de um repositório."),
            OpenApiParameter("status", str, description="PENDENTE, ATENDIDA ou RECUSADA."),
        ],
        description=(
            "Demandas visíveis: o ADMIN vê todas — a demanda é única e "
            "compartilhada entre eles —, e o gestor vê as dos repositórios que "
            "gerencia, inclusive as abertas por colegas."
        ),
    )
    def list(self, request: Request, *args, **kwargs) -> Response:
        return super().list(request, *args, **kwargs)

    @extend_schema(
        request=HarvestRequestWriteSerializer,
        responses={201: HarvestRequestSerializer},
        description=(
            "Abre uma demanda de nova coleta. Exige vínculo com o repositório. "
            "Um repositório só pode ter uma demanda pendente por vez."
        ),
    )
    def create(self, request: Request, *args, **kwargs) -> Response:
        entrada = self.get_serializer(data=request.data)
        entrada.is_valid(raise_exception=True)

        repositorio = entrada.validated_data["harvester_repository_id"]
        # Pedir coleta é agir sobre o repositório: vale o mesmo vínculo que
        # autoriza a leitura dele.
        assert_can_read_repository(request.user, repositorio)

        try:
            # `atomic` aqui é o savepoint: sem ele, a violação da constraint
            # deixa a transação da requisição quebrada, e qualquer consulta
            # seguinte — inclusive a que monta a resposta de erro — falha com
            # `TransactionManagementError`.
            with transaction.atomic():
                demanda = entrada.save(requester=request.user)
        except IntegrityError as exc:
            # A constraint parcial barra a segunda pendente. Erro de fluxo, não
            # falha do servidor: o gestor precisa saber que o pedido já existe.
            raise DRFValidationError(
                {"detail": "Este repositório já tem uma demanda pendente."}
            ) from exc

        record(
            action=AuditLog.Action.CREATE,
            resource=RESOURCE,
            resource_id=demanda.pk,
            request=request,
        )
        saida = HarvestRequestSerializer(demanda, context=self.get_serializer_context())
        return Response(saida.data, status=201)

    @extend_schema(
        request=AtenderSerializer,
        responses={200: HarvestRequestSerializer},
        description=(
            "Marca a demanda como atendida e informa o número da coleta "
            "realizada. Avisa o solicitante por notificação. Exclusivo do ADMIN."
        ),
    )
    @action(detail=True, methods=["post"], url_path="attend")
    def attend(self, request: Request, pk: str | None = None) -> Response:
        return self._resolver(request, "attend")

    @extend_schema(
        request=RecusarSerializer,
        responses={200: HarvestRequestSerializer},
        description=(
            "Recusa a demanda, com motivo obrigatório. Avisa o solicitante por "
            "notificação. Exclusivo do ADMIN."
        ),
    )
    @action(detail=True, methods=["post"], url_path="refuse")
    def refuse(self, request: Request, pk: str | None = None) -> Response:
        return self._resolver(request, "refuse")

    def _resolver(self, request: Request, acao: str) -> Response:
        demanda = self.get_object()
        if demanda.status != HarvestRequest.Status.PENDENTE:
            raise DRFValidationError({"detail": "Esta demanda já foi resolvida."})

        entrada = self.get_serializer(data=request.data)
        entrada.is_valid(raise_exception=True)

        if acao == "attend":
            services.atender(demanda, entrada.validated_data["snapshotId"], request.user)
        else:
            services.recusar(demanda, entrada.validated_data["reason"], request.user)

        services.avisar_solicitante(demanda)
        record(
            action=AuditLog.Action.UPDATE,
            resource=f"{RESOURCE}.{acao}",
            resource_id=demanda.pk,
            request=request,
        )
        saida = HarvestRequestSerializer(demanda, context=self.get_serializer_context())
        return Response(saida.data)

    def get_object(self) -> HarvestRequest:
        """404 para o que está fora do alcance, como no resto do projeto."""
        demanda = services.visiveis_para(self.request.user).filter(pk=self.kwargs["pk"]).first()
        if demanda is None:
            raise NotFound("Demanda inexistente ou fora do seu alcance.")
        return demanda
