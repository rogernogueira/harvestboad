from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.accounts.models import Profile

from .models import Notification, NotificationCategory, NotificationTemplate

User = get_user_model()

# Espelha o limite do formulário. O `TextField` do modelo não impõe nada, e um
# recado de 60 KB estouraria o painel de quem o recebesse.
MENSAGEM_MAXIMA = 2000


class NotificationCategorySerializer(serializers.ModelSerializer):
    """Categoria com os três nomes.

    Manda os três de uma vez, em vez de o backend escolher por
    `Accept-Language`: quem sabe o idioma da tela é o i18next, e resolver aqui
    obrigaria a propagar o cabeçalho por toda chamada. São ~60 bytes por
    categoria.
    """

    namePtBr = serializers.CharField(source="name_pt_br", max_length=48)
    nameEs = serializers.CharField(
        source="name_es", max_length=48, required=False, allow_blank=True
    )
    nameEn = serializers.CharField(
        source="name_en", max_length=48, required=False, allow_blank=True
    )

    class Meta:
        model = NotificationCategory
        fields = ["id", "slug", "namePtBr", "nameEs", "nameEn", "active"]


class NotificationTemplateSerializer(serializers.ModelSerializer):
    """Texto padrão. Um idioma só, como o título e a mensagem que ele preenche."""

    class Meta:
        model = NotificationTemplate
        fields = ["id", "category", "label", "title", "message", "active"]


class NotificationSerializer(serializers.ModelSerializer):
    """Notificação como o frontend a consome.

    camelCase declarado à mão, com `source` apontando para o atributo Python —
    não há middleware de conversão no projeto.
    """

    harvesterRepositoryId = serializers.CharField(
        source="harvester_repository_id", read_only=True
    )
    category = NotificationCategorySerializer(read_only=True)
    recipientUsername = serializers.CharField(source="recipient.username", read_only=True)
    authorUsername = serializers.CharField(source="author.username", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    readAt = serializers.DateTimeField(source="read_at", read_only=True)
    readByUsername = serializers.CharField(source="read_by.username", read_only=True)
    read = serializers.BooleanField(source="is_read", read_only=True)
    requiresAcknowledgement = serializers.BooleanField(
        source="requires_acknowledgement", read_only=True
    )
    pendingManagers = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = [
            "id",
            "title",
            "message",
            "category",
            "harvesterRepositoryId",
            "acronym",
            "recipient",
            "recipientUsername",
            "authorUsername",
            "createdAt",
            "read",
            "readAt",
            "readByUsername",
            "requiresAcknowledgement",
            "pendingManagers",
        ]
        read_only_fields = fields

    def get_pendingManagers(self, obj: Notification) -> list[str] | None:
        """Quem ainda não deu o visto.

        Como a leitura é compartilhada, não há pendência por pessoa: ou ninguém
        leu — e aí todos os gestores do repositório estão pendentes — ou alguém
        leu e não sobra pendência para ninguém. É o máximo que este modelo
        permite dizer, e a tela do administrador o apresenta assim.

        O mapa vem pronto no contexto, montado em uma consulta para a página
        inteira; sem ele a lista custaria uma consulta por linha.
        """
        if obj.read_at is not None or not obj.harvester_repository_id:
            return []
        por_repositorio = self.context.get("pendentes")
        if por_repositorio is None:
            return None
        return por_repositorio.get(obj.harvester_repository_id, [])


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
    # Só categoria ativa: a desativada continua existindo para o histórico, mas
    # não deve aparecer como escolha em aviso novo.
    category = serializers.PrimaryKeyRelatedField(
        queryset=NotificationCategory.objects.filter(active=True)
    )
    requiresAcknowledgement = serializers.BooleanField(
        source="requires_acknowledgement", required=False, default=False
    )

    class Meta:
        model = Notification
        fields = [
            "title",
            "message",
            "category",
            "harvesterRepositoryId",
            "acronym",
            "recipient",
            "requiresAcknowledgement",
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


class NotificationBulkSerializer(serializers.Serializer):
    """Um mesmo aviso para vários destinos de uma vez.

    Molde do `RepositoryAccessBulkSerializer`: listas de destino, deduplicadas
    em silêncio — repetir uma seleção não é erro do usuário, é a tela.

    Aqui os dois tipos de destino **podem** conviver na mesma requisição, ao
    contrário da criação unitária: cada um vira uma notificação própria, e a
    regra de destino único continua valendo linha a linha.
    """

    title = serializers.CharField(max_length=120)
    message = serializers.CharField(max_length=MENSAGEM_MAXIMA)
    category = serializers.PrimaryKeyRelatedField(
        queryset=NotificationCategory.objects.filter(active=True)
    )
    requiresAcknowledgement = serializers.BooleanField(required=False, default=False)
    # Alcance resolvido no servidor, em vez de a tela mandar centenas de ids:
    # ela não teria como montar a lista sem paginar o acervo inteiro, e o teto
    # de 200 das listas abaixo a barraria.
    scope = serializers.ChoiceField(
        choices=["ALL_MANAGERS", "ALL_REPOSITORIES"], required=False, allow_blank=True
    )
    repositories = serializers.ListField(
        child=serializers.DictField(), required=False, max_length=200
    )
    recipients = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(
            queryset=User.objects.filter(profile=Profile.GESTOR, is_active=True)
        ),
        required=False,
        max_length=200,
    )

    def validate_repositories(self, value: list[dict]) -> list[dict]:
        vistos: set[str] = set()
        limpos = []
        for indice, item in enumerate(value, start=1):
            identificador = str(item.get("harvesterRepositoryId") or "").strip()
            if not identificador:
                raise serializers.ValidationError(
                    f"Item {indice}: harvesterRepositoryId é obrigatório."
                )
            if identificador in vistos:
                continue
            vistos.add(identificador)
            limpos.append(
                {
                    "harvesterRepositoryId": identificador,
                    "acronym": str(item.get("acronym") or "").strip()[:32],
                }
            )
        return limpos

    def validate(self, attrs: dict) -> dict:
        if (
            not attrs.get("repositories")
            and not attrs.get("recipients")
            and not attrs.get("scope")
        ):
            raise serializers.ValidationError("Escolha ao menos um destino.")
        # Deduplica destinatários repetidos, como se faz com os repositórios.
        if attrs.get("recipients"):
            attrs["recipients"] = list(dict.fromkeys(attrs["recipients"]))
        return attrs
