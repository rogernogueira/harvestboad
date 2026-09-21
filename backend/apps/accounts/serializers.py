from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import User


class UserSerializer(serializers.ModelSerializer):
    departmentEmail = serializers.EmailField(source="department_email", read_only=True)
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
            "phone",
            "institution",
            "departmentEmail",
            "profile",
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


class UserCreateSerializer(serializers.ModelSerializer):
    """Criação de conta pelo ADMIN.

    A senha é definida por quem cria e validada pelos validadores do Django. A
    conta nasce com `must_change_password=True`: quem entrar pela primeira vez é
    obrigado a trocar, então a senha provisória não continua valendo.

    Telefone e instituição são opcionais aqui: quem cadastra nem sempre tem o
    contato da pessoa à mão, e o dono da conta completa o que faltar no próprio
    perfil (`ProfileUpdateSerializer`).
    """

    password = serializers.CharField(write_only=True, style={"input_type": "password"})
    departmentEmail = serializers.EmailField(
        source="department_email", required=False, allow_blank=True
    )

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "phone",
            "institution",
            "departmentEmail",
            "profile",
            "password",
        ]

    def validate_email(self, value: str) -> str:
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Já existe uma conta com este e-mail.")
        return value

    def validate_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def create(self, validated_data: dict) -> User:
        senha = validated_data.pop("password")
        user = User(**validated_data, must_change_password=True)
        user.set_password(senha)
        user.save()
        return user


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """Atualização do próprio cadastro, pelo dono da conta.

    `username`, `profile` e `is_active` ficam de fora de propósito: o usuário
    identifica a si mesmo no login e não decide o próprio nível de acesso —
    isso é da administração, em `UserListCreateView`.
    """

    # `validators=[]` desliga o UniqueValidator que o ModelSerializer montaria
    # a partir do `unique=True`: ele compara caixa a caixa, então deixaria
    # passar "MARIA@" contra "maria@" e ainda daria duas mensagens diferentes
    # para o mesmo engano. A checagem abaixo resolve os dois casos com uma só.
    email = serializers.EmailField(validators=[])
    # `allow_blank` porque o setor é opcional: apagar o que está lá é uma
    # resposta legítima, e um `EmailField` recusaria a string vazia.
    departmentEmail = serializers.EmailField(
        source="department_email", required=False, allow_blank=True
    )

    class Meta:
        model = User
        fields = [
            "first_name",
            "last_name",
            "email",
            "phone",
            "institution",
            "departmentEmail",
        ]

    def validate_email(self, value: str) -> str:
        # Exclui a própria conta: salvar o cadastro sem mexer no e-mail é o
        # caso comum, e ele não pode colidir consigo mesmo.
        if User.objects.filter(email__iexact=value).exclude(pk=self.instance.pk).exists():
            raise serializers.ValidationError("Já existe uma conta com este e-mail.")
        return value


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
