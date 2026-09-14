from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import User


class UserSerializer(serializers.ModelSerializer):
    profileDisplay = serializers.CharField(source="get_profile_display", read_only=True)
    mustChangePassword = serializers.BooleanField(source="must_change_password", read_only=True)
    lastLogin = serializers.DateTimeField(source="last_login", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "profile",
            "profileDisplay",
            "mustChangePassword",
            "lastLogin",
        ]
        read_only_fields = fields


class MonitorTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Acrescenta perfil ao token e o estado da conta à resposta do login."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["profile"] = user.profile
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data


class ChangePasswordSerializer(serializers.Serializer):
    currentPassword = serializers.CharField(write_only=True)
    newPassword = serializers.CharField(write_only=True)

    def validate_currentPassword(self, value: str) -> str:
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Senha atual incorreta.")
        return value

    def validate_newPassword(self, value: str) -> str:
        user = self.context["request"].user
        try:
            validate_password(value, user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def save(self, **kwargs) -> User:
        user = self.context["request"].user
        user.set_password(self.validated_data["newPassword"])
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password"])
        return user
