from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.request import Request
from rest_framework.response import Response

from apps.audit.models import AuditLog
from apps.audit.services import record
from apps.repositories.models import RepositoryAccess
from apps.repositories.permissions import IsAdminProfile, assert_can_read_repository

from . import services
from .models import Notification
from .models import NotificationCategory, NotificationTemplate
from .serializers import (
    NotificationBulkSerializer,
    NotificationCategorySerializer,
    NotificationSerializer,
    NotificationTemplateSerializer,
    NotificationWriteSerializer,
)

RESOURCE = "notification"


@extend_schema(tags=["notifications"])
class NotificationViewSet(
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """Avisos do administrador aos gestores.

    Sem `update`: uma notificação enviada é um fato, e editá-la depois mudaria
    por baixo o que alguém já leu. A exclusão existe — e é do ADMIN — porque o
    aviso mandado por engano precisa sair do ar, e apagar é diferente de
    reescrever.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.action in {"create", "bulk", "destroy"}:
            return [permissions.IsAuthenticated(), IsAdminProfile()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == "create":
            return NotificationWriteSerializer
        if self.action == "bulk":
            return NotificationBulkSerializer
        return NotificationSerializer

    def get_serializer_context(self) -> dict:
        """Leva o mapa de pendentes junto, para a lista não custar N consultas."""
        contexto = super().get_serializer_context()
        contexto["pendentes"] = self._pendentes_da_pagina()
        return contexto

    def _pendentes_da_pagina(self) -> dict[str, list[str]] | None:
        """Gestores de cada repositório citado nesta resposta, em uma consulta.

        Só a listagem precisa disso, e só quando alguém pergunta pelo que
        enviou — é a tela de gestão do administrador. Nas outras rotas o
        serializer recebe `None` e omite o campo em vez de inventá-lo.
        """
        if self.action != "list" or self.request.query_params.get("sent") != "true":
            return None

        identificadores = set(
            self.filter_queryset(self.get_queryset())
            .exclude(harvester_repository_id="")
            .values_list("harvester_repository_id", flat=True)
        )
        if not identificadores:
            return {}

        mapa: dict[str, list[str]] = {}
        vinculos = RepositoryAccess.objects.filter(
            harvester_repository_id__in=identificadores
        ).values_list("harvester_repository_id", "user__username")
        for repositorio, username in vinculos:
            mapa.setdefault(repositorio, []).append(username)
        for nomes in mapa.values():
            nomes.sort()
        return mapa

    def get_queryset(self):
        repositorio = self.request.query_params.get("repository")
        enviadas = self.request.query_params.get("sent") == "true"

        if enviadas:
            # O que eu enviei não passa pela minha caixa de entrada: o
            # administrador não é destinatário do que manda, e recortar por
            # `visiveis_para` devolvia lista vazia para ele. O recorte por
            # autoria já é a garantia — ninguém vê o que outro enviou.
            queryset = services.do_autor(self.request.user)
            if repositorio:
                queryset = queryset.filter(harvester_repository_id=str(repositorio))
        elif repositorio:
            # Lista de um repositório: aqui sim vale o contrato de autorização,
            # em que `None` libera o ADMIN.
            assert_can_read_repository(self.request.user, repositorio)
            queryset = services.do_repositorio(repositorio)
        else:
            queryset = services.visiveis_para(self.request.user)

        if self.request.query_params.get("unread") == "true":
            queryset = queryset.filter(read_at__isnull=True)
        categoria = self.request.query_params.get("category")
        if categoria:
            queryset = queryset.filter(category=categoria)

        # `category` entra aqui porque o serializer a aninha: sem ela, cada linha
        # da lista custava uma consulta ao catálogo.
        return queryset.select_related("category", "recipient", "author", "read_by")

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
        request=NotificationBulkSerializer,
        responses={200: None},
        description=(
            "Envia o mesmo aviso para vários repositórios e/ou vários gestores "
            "de uma vez. Cada destino vira uma notificação própria. Exclusivo "
            "do perfil ADMIN."
        ),
    )
    @action(detail=False, methods=["post"], url_path="bulk")
    def bulk(self, request: Request) -> Response:
        entrada = self.get_serializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        dados = entrada.validated_data

        # O alcance amplo entra junto das escolhas avulsas; a deduplicação por
        # identificador evita mandar duas vezes para quem já estava marcado.
        repositorios = list(dados.get("repositories", []))
        destinatarios = list(dados.get("recipients", []))
        se_todos, gestores_todos = services.destinos_do_alcance(dados.get("scope") or "")

        ja_escolhidos = {r["harvesterRepositoryId"] for r in repositorios}
        repositorios += [r for r in se_todos if r["harvesterRepositoryId"] not in ja_escolhidos]
        destinatarios += [g for g in gestores_todos if g not in destinatarios]

        comum = {
            "title": dados["title"],
            "message": dados["message"],
            "category": dados["category"],
            "requires_acknowledgement": dados["requiresAcknowledgement"],
            "author": request.user,
        }

        # Sem transação, como no lote de vínculos: um destino que falhe não
        # deve desfazer os avisos que já chegaram aos outros.
        criadas = []
        for repositorio in repositorios:
            criadas.append(
                Notification.objects.create(
                    **comum,
                    harvester_repository_id=repositorio["harvesterRepositoryId"],
                    acronym=repositorio["acronym"],
                )
            )
        for destinatario in destinatarios:
            criadas.append(Notification.objects.create(**comum, recipient=destinatario))

        for notificacao in criadas:
            record(
                action=AuditLog.Action.CREATE,
                resource=RESOURCE,
                resource_id=notificacao.pk,
                request=request,
            )

        return Response({"createdCount": len(criadas)})

    def perform_destroy(self, instance: Notification) -> None:
        """Tira do ar o aviso mandado por engano.

        O `pk` é capturado antes do delete, como faz o `RepositoryAccessViewSet`:
        depois dele o objeto já não tem identificador para a trilha.
        """
        pk = instance.pk
        instance.delete()
        record(
            action=AuditLog.Action.DELETE,
            resource=RESOURCE,
            resource_id=pk,
            request=self.request,
        )

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


class _CadastroViewSet(viewsets.ModelViewSet):
    """Base dos dois cadastros: todos leem, só o ADMIN escreve.

    Leitura aberta a qualquer autenticado porque o gestor precisa do nome da
    categoria para ler o selo da própria notificação — sem isso a tela dele
    mostraria um identificador numérico.
    """

    permission_classes = [permissions.IsAuthenticated]
    recurso = ""

    def get_permissions(self):
        if self.request.method in permissions.SAFE_METHODS:
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated(), IsAdminProfile()]

    def perform_create(self, serializer) -> None:
        objeto = serializer.save()
        record(
            action=AuditLog.Action.CREATE,
            resource=self.recurso,
            resource_id=objeto.pk,
            request=self.request,
        )

    def perform_update(self, serializer) -> None:
        objeto = serializer.save()
        record(
            action=AuditLog.Action.UPDATE,
            resource=self.recurso,
            resource_id=objeto.pk,
            request=self.request,
        )

    def perform_destroy(self, instance) -> None:
        pk = instance.pk
        instance.delete()
        record(
            action=AuditLog.Action.DELETE,
            resource=self.recurso,
            resource_id=pk,
            request=self.request,
        )


@extend_schema(tags=["notifications"])
class NotificationCategoryViewSet(_CadastroViewSet):
    """Catálogo de categorias.

    Devolve **todas**, ativas ou não: a tela precisa do nome para desenhar o
    selo de uma notificação antiga cuja categoria saiu de circulação. Quem
    filtra por `active` é o formulário de envio.

    A exclusão é possível só enquanto a categoria não tiver sido usada — o
    `PROTECT` do modelo recusa o resto, e a saída para o catálogo que envelheceu
    é desativar.
    """

    queryset = NotificationCategory.objects.all()
    serializer_class = NotificationCategorySerializer
    recurso = "notification_category"
    pagination_class = None


@extend_schema(tags=["notifications"])
class NotificationTemplateViewSet(_CadastroViewSet):
    """Textos padrão, filtráveis por categoria."""

    serializer_class = NotificationTemplateSerializer
    recurso = "notification_template"
    pagination_class = None

    def get_queryset(self):
        queryset = NotificationTemplate.objects.select_related("category")
        categoria = self.request.query_params.get("category")
        if categoria:
            # Um `?category=null` vindo de um cliente distraído virava
            # `ValueError` no ORM e subia como 500. Parâmetro malformado é erro
            # de quem pede.
            try:
                queryset = queryset.filter(category_id=int(categoria))
            except ValueError as exc:
                raise DRFValidationError(
                    {"category": "Informe o identificador numérico da categoria."}
                ) from exc
        return queryset
