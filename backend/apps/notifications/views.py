from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.request import Request
from rest_framework.response import Response

from apps.audit.models import AuditLog
from apps.audit.services import record
from apps.repositories.permissions import IsAdminProfile, assert_can_read_repository

from . import services
from .models import Notification
from .serializers import NotificationSerializer, NotificationWriteSerializer

RESOURCE = "notification"


@extend_schema(tags=["notifications"])
class NotificationViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """Avisos do administrador aos gestores.

    Sem `update` nem `destroy`: uma notificação enviada é um fato, e editá-la
    depois mudaria por baixo o que alguém já leu.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.action == "create":
            return [permissions.IsAuthenticated(), IsAdminProfile()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == "create":
            return NotificationWriteSerializer
        return NotificationSerializer

    def get_queryset(self):
        repositorio = self.request.query_params.get("repository")
        if repositorio:
            # Lista de um repositório: aqui sim vale o contrato de autorização,
            # em que `None` libera o ADMIN.
            assert_can_read_repository(self.request.user, repositorio)
            queryset = services.do_repositorio(repositorio)
        else:
            queryset = services.visiveis_para(self.request.user)

        if self.request.query_params.get("sent") == "true":
            # O histórico do que o próprio ADMIN enviou. Recorta sobre o que ele
            # já enxerga, nunca sobre a tabela inteira.
            queryset = queryset.filter(author=self.request.user)
        if self.request.query_params.get("unread") == "true":
            queryset = queryset.filter(read_at__isnull=True)
        categoria = self.request.query_params.get("category")
        if categoria:
            queryset = queryset.filter(category=categoria)

        return queryset.select_related("recipient", "author", "read_by")

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "repository",
                str,
                description=(
                    "Restringe às notificações de um repositório. Sem ele, a "
                    "resposta é a caixa de entrada de quem pede: os recados "
                    "diretos mais os dos repositórios que a pessoa gerencia."
                ),
            ),
            OpenApiParameter("unread", bool, description="Só as que seguem sem leitura."),
            OpenApiParameter("category", str, description="Filtra por categoria."),
            OpenApiParameter(
                "sent", bool, description="Só as que o próprio usuário enviou."
            ),
        ],
        description="Notificações visíveis para o usuário autenticado.",
    )
    def list(self, request: Request, *args, **kwargs) -> Response:
        return super().list(request, *args, **kwargs)

    @extend_schema(
        request=NotificationWriteSerializer,
        responses={201: NotificationSerializer},
        description=(
            "Cria uma notificação. O destino é o repositório **ou** o "
            "destinatário, nunca os dois. Exclusivo do perfil ADMIN."
        ),
    )
    def create(self, request: Request, *args, **kwargs) -> Response:
        entrada = self.get_serializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        notificacao = entrada.save(author=request.user)

        record(
            action=AuditLog.Action.CREATE,
            resource=RESOURCE,
            resource_id=notificacao.pk,
            request=request,
        )
        saida = NotificationSerializer(notificacao, context=self.get_serializer_context())
        return Response(saida.data, status=201)

    @extend_schema(
        request=None,
        responses={200: NotificationSerializer},
        description=(
            "Marca a notificação como lida. A leitura vale para todos os "
            "gestores do repositório, e não se desfaz: relida, a resposta é a "
            "mesma e quem leu primeiro continua registrado.\n\n"
            "É POST, e não PATCH, porque o cliente só fala GET/POST/DELETE."
        ),
    )
    @action(detail=True, methods=["post"], url_path="read")
    def read(self, request: Request, pk: str | None = None) -> Response:
        notificacao = self.get_object()

        # Só registra na trilha quando esta chamada foi a que marcou: re-clique
        # em item já lido não é fato novo, e encheria a auditoria de ruído.
        if services.marcar_lida(notificacao.pk, request.user):
            record(
                action=AuditLog.Action.UPDATE,
                resource=f"{RESOURCE}.read",
                resource_id=notificacao.pk,
                request=request,
            )
        notificacao.refresh_from_db()
        serializer = NotificationSerializer(
            notificacao, context=self.get_serializer_context()
        )
        return Response(serializer.data)

    @extend_schema(
        responses={200: None},
        description=(
            "Quantas notificações da caixa de entrada seguem sem leitura. "
            "Existe para o sino do cabeçalho não precisar baixar a lista."
        ),
    )
    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request: Request) -> Response:
        total = services.visiveis_para(request.user).filter(read_at__isnull=True).count()
        return Response({"unread": total})

    def get_object(self) -> Notification:
        """Só alcança o que a pessoa enxerga.

        O `get_queryset` desta view já recorta pela caixa de entrada, mas a rota
        `read` recebe um `pk` avulso: sem este filtro, um gestor marcaria como
        lida — para a equipe inteira de outro repositório — qualquer id que
        adivinhasse.

        Devolve **404**, e não 403, como já faz o `RepositoryAccessViewSet` com
        vínculo alheio: a existência do registro alheio não é informação a dar.
        """
        pk = self.kwargs["pk"]
        if self.request.user.is_admin:
            notificacao = Notification.objects.filter(pk=pk).first()
        else:
            notificacao = services.visiveis_para(self.request.user).filter(pk=pk).first()

        if notificacao is None:
            raise NotFound("Notificação inexistente ou fora do seu alcance.")
        return notificacao
