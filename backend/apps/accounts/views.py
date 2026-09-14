from django.db.models import Q
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.audit.models import AuditLog
from apps.audit.services import record
from apps.repositories.permissions import IsAdminProfile

from .models import Profile, User
from .serializers import (
    ChangePasswordSerializer,
    MonitorTokenObtainPairSerializer,
    UserSerializer,
)


class LoginView(TokenObtainPairView):
    """Emite o par de tokens JWT e registra o acesso na auditoria."""

    serializer_class = MonitorTokenObtainPairSerializer

    def post(self, request: Request, *args, **kwargs) -> Response:
        response = super().post(request, *args, **kwargs)
        if response.status_code == status.HTTP_200_OK:
            user_id = (response.data.get("user") or {}).get("id")
            record(
                action=AuditLog.Action.LOGIN,
                resource="user",
                resource_id=user_id or "",
                user=User.objects.filter(pk=user_id).first(),
                request=request,
            )
        return response


class MeView(APIView):
    """Dados do usuário autenticado, usados pelo frontend após o login."""

    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=UserSerializer)
    def get(self, request: Request) -> Response:
        return Response(UserSerializer(request.user).data)


class UserListView(generics.ListAPIView):
    """Contas da aplicação, para o ADMIN escolher a quem conceder acesso.

    Restrita ao perfil ADMIN: a lista de usuários não interessa ao gestor e
    expor quem mais usa o sistema seria vazamento desnecessário.
    """

    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminProfile]

    @extend_schema(
        parameters=[
            OpenApiParameter("profile", str, description="Filtra por perfil (ADMIN ou GESTOR)."),
            OpenApiParameter("search", str, description="Busca por usuário, nome ou e-mail."),
            OpenApiParameter("active", bool, description="Filtra por contas ativas."),
        ],
        description="Lista as contas da aplicação. Exclusivo do perfil ADMIN.",
    )
    def get(self, request: Request, *args, **kwargs) -> Response:
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        queryset = User.objects.all()
        params = self.request.query_params

        perfil = (params.get("profile") or "").upper()
        if perfil in Profile.values:
            queryset = queryset.filter(profile=perfil)

        ativo = params.get("active")
        if ativo in {"true", "false"}:
            queryset = queryset.filter(is_active=ativo == "true")

        busca = (params.get("search") or "").strip()
        if busca:
            queryset = queryset.filter(
                Q(username__icontains=busca)
                | Q(email__icontains=busca)
                | Q(first_name__icontains=busca)
                | Q(last_name__icontains=busca)
            )

        return queryset


class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=ChangePasswordSerializer, responses={204: None})
    def post(self, request: Request) -> Response:
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        record(
            action=AuditLog.Action.UPDATE,
            resource="user.password",
            resource_id=request.user.pk,
            request=request,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
