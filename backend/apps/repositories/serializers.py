from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.integrations.harvester import HarvesterClient, HarvesterError

from .models import RepositoryAccess
from .services import repository_summary

User = get_user_model()


class RepositoryAccessSerializer(serializers.ModelSerializer):
    """Leitura do vínculo, no formato camelCase consumido pelo frontend.

    Sigla, nome e instituição vêm do Harvester, que é a fonte da verdade: a
    coluna `acronym` guarda o valor do momento da associação e envelhece quando
    o repositório é renomeado na origem.

    O dado é cacheado e o enriquecimento é tolerante a falha. Com o Harvester
    fora, `name` e `institutionName` vêm nulos e a sigla cai para o valor
    gravado — pior que o atual, melhor que nada.
    """

    harvesterRepositoryId = serializers.CharField(
        source="harvester_repository_id", read_only=True
    )
    grantedAt = serializers.DateTimeField(source="granted_at", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    acronym = serializers.SerializerMethodField()
    name = serializers.SerializerMethodField()
    institutionName = serializers.SerializerMethodField()
    acronymIsStale = serializers.SerializerMethodField()

    class Meta:
        model = RepositoryAccess
        fields = [
            "id",
            "user",
            "username",
            "harvesterRepositoryId",
            "acronym",
            "acronymIsStale",
            "name",
            "institutionName",
            "grantedAt",
        ]
        read_only_fields = fields

    def _summary(self, obj: RepositoryAccess) -> dict:
        # Memoriza por instância para não repetir a consulta entre os dois campos.
        if not hasattr(obj, "_cached_summary"):
            obj._cached_summary = repository_summary(obj.harvester_repository_id) or {}
        return obj._cached_summary

    def get_acronym(self, obj: RepositoryAccess) -> str:
        return self._summary(obj).get("acronym") or obj.acronym

    def get_acronymIsStale(self, obj: RepositoryAccess) -> bool:
        """Sinaliza que o valor gravado divergiu da origem.

        Permite ao frontend e ao administrador perceberem que uma
        ressincronização está pendente, sem escrever no banco durante um GET.
        """
        live = self._summary(obj).get("acronym")
        return bool(live and live != obj.acronym)

    def get_name(self, obj: RepositoryAccess) -> str | None:
        return self._summary(obj).get("name")

    def get_institutionName(self, obj: RepositoryAccess) -> str | None:
        return self._summary(obj).get("institutionName")


class RepositoryManagerSerializer(serializers.ModelSerializer):
    """Gestor vinculado a um repositório, para quem já tem acesso a ele.

    Expõe menos que `RepositoryAccessSerializer`: um gestor pode ver **quem** mais
    cuida do repositório, mas o e-mail dos colegas é dado pessoal e só vai para o
    ADMIN — ver `to_representation`.
    """

    username = serializers.CharField(source="user.username", read_only=True)
    fullName = serializers.SerializerMethodField()
    profile = serializers.CharField(source="user.profile", read_only=True)
    profileDisplay = serializers.CharField(
        source="user.get_profile_display", read_only=True
    )
    isActive = serializers.BooleanField(source="user.is_active", read_only=True)
    grantedAt = serializers.DateTimeField(source="granted_at", read_only=True)
    email = serializers.SerializerMethodField()

    class Meta:
        model = RepositoryAccess
        fields = [
            "id",
            "user",
            "username",
            "fullName",
            "email",
            "profile",
            "profileDisplay",
            "isActive",
            "grantedAt",
        ]
        read_only_fields = fields

    def get_fullName(self, obj: RepositoryAccess) -> str:
        return obj.user.get_full_name()

    def get_email(self, obj: RepositoryAccess) -> str | None:
        solicitante = self.context["request"].user
        return obj.user.email if solicitante.is_admin else None


class RepositoryAccessWriteSerializer(serializers.ModelSerializer):
    """Criação do vínculo.

    A sigla é opcional: quando omitida, é buscada no Harvester a partir do
    identificador. Como a rede até o Harvester é intermitente, a validação é
    tolerante — ver `_resolve_acronym`.
    """

    harvesterRepositoryId = serializers.CharField(
        source="harvester_repository_id", max_length=64
    )
    acronym = serializers.CharField(max_length=32, required=False, allow_blank=True)
    user = serializers.PrimaryKeyRelatedField(queryset=User.objects.all())

    class Meta:
        model = RepositoryAccess
        fields = ["id", "user", "harvesterRepositoryId", "acronym"]

    def validate(self, attrs: dict) -> dict:
        # A duplicidade (user, repositório) já é barrada pelo UniqueTogetherValidator
        # que o DRF deriva da UniqueConstraint do modelo — roda antes daqui.
        attrs["acronym"] = self._resolve_acronym(
            attrs["harvester_repository_id"], attrs.get("acronym")
        )
        return attrs

    def _resolve_acronym(self, repository_id: str, informed: str | None) -> str:
        """Confirma o repositório no Harvester e devolve a sigla.

        - Resposta com status HTTP (404/500): o identificador é inválido → erro.
        - Falha de rede (o Harvester cai com frequência): aceita a sigla
          informada; se nenhuma foi informada, não há como prosseguir.
        """
        try:
            network = HarvesterClient().get_network(repository_id)
        except HarvesterError as exc:
            if exc.status_code is not None:
                raise serializers.ValidationError(
                    {
                        "harvesterRepositoryId": (
                            f"Repositório não encontrado no Harvester "
                            f"(resposta {exc.status_code})."
                        )
                    }
                ) from exc
            if informed:
                return informed
            raise serializers.ValidationError(
                {
                    "acronym": (
                        "Harvester inacessível no momento; informe a sigla "
                        "manualmente para prosseguir."
                    )
                }
            ) from exc

        acronym = (network or {}).get("acronym") or informed
        if not acronym:
            raise serializers.ValidationError(
                {"acronym": "O Harvester não informou a sigla; preencha manualmente."}
            )
        return acronym
