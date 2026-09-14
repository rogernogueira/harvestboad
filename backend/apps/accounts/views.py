from drf_spectacular.utils import extend_schema
from rest_framework import permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.audit.models import AuditLog
from apps.audit.services import record

from .models import User
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
