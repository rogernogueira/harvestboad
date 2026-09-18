from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.accounts.models import Profile

from .models import Notification

User = get_user_model()

# Espelha o limite do formulário. O `TextField` do modelo não impõe nada, e um
# recado de 60 KB estouraria o painel de quem o recebesse.
MENSAGEM_MAXIMA = 2000


class NotificationSerializer(serializers.ModelSerializer):
    """Notificação como o frontend a consome.

    camelCase declarado à mão, com `source` apontando para o atributo Python —
    não há middleware de conversão no projeto.
    """

    harvesterRepositoryId = serializers.CharField(
        source="harvester_repository_id", read_only=True
    )
    categoryDisplay = serializers.CharField(source="get_category_display", read_only=True)
    recipientUsername = serializers.CharField(source="recipient.username", read_only=True)
    authorUsername = serializers.CharField(source="author.username", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    readAt = serializers.DateTimeField(source="read_at", read_only=True)
    readByUsername = serializers.CharField(source="read_by.username", read_only=True)
    read = serializers.BooleanField(source="is_read", read_only=True)

    class Meta:
        model = Notification
        fields = [
            "id",
            "title",
            "message",
            "category",
            "categoryDisplay",
            "harvesterRepositoryId",
            "acronym",
            "recipient",
            "recipientUsername",
            "authorUsername",
            "createdAt",
            "read",
            "readAt",
            "readByUsername",
        ]
        read_only_fields = fields


class NotificationWriteSerializer(serializers.ModelSerializer):
    """Entrada da criação. Separado do de leitura, como no resto do projeto."""

    harvesterRepositoryId = serializers.CharField(
        source="harvester_repository_id",
        required=False,
        allow_blank=True,
        max_length=64,
    )
    acronym = serializers.CharField(required=False, allow_blank=True, max_length=32)
    # Recado direto é para gestor: o ADMIN já enxerga tudo e não precisa de
    # caixa de entrada. Conta inativa também sai — ninguém leria.
    recipient = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(profile=Profile.GESTOR, is_active=True),
        required=False,
        allow_null=True,
    )
    message = serializers.CharField(max_length=MENSAGEM_MAXIMA)

    class Meta:
        model = Notification
        fields = [
            "title",
            "message",
            "category",
            "harvesterRepositoryId",
            "acronym",
            "recipient",
        ]

    def validate(self, attrs: dict) -> dict:
        """Exatamente um destino.

        A mesma regra está no banco, como `notification_destino_unico`. Aqui ela
        se repete para o erro chegar legível ao formulário, em vez de subir como
        `IntegrityError` e virar 500.
        """
        repositorio = (attrs.get("harvester_repository_id") or "").strip()
        destinatario = attrs.get("recipient")

        if repositorio and destinatario:
            raise serializers.ValidationError(
                "Informe o repositório ou o destinatário, não os dois."
            )
        if not repositorio and not destinatario:
            raise serializers.ValidationError(
                "Informe o repositório ou o destinatário."
            )

        attrs["harvester_repository_id"] = repositorio
        if not repositorio:
            attrs["acronym"] = ""
        return attrs
