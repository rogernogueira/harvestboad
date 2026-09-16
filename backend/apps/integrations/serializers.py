from django.core.validators import URLValidator
from rest_framework import serializers


class RecordLinkQuerySerializer(serializers.Serializer):
    """Entrada da resolução de link: identificador, origem e formato.

    Aceita os nomes em camelCase (padrão das demais rotas) e em snake_case,
    porque é assim que os parâmetros aparecem no OAI-PMH e nos scripts que
    fazem a mesma consulta na mão.
    """

    # `http`/`https` apenas: o `baseURL` vem do cliente e vira requisição de
    # saída do servidor. Nenhum outro esquema faz sentido para OAI-PMH.
    base_url = serializers.CharField(
        max_length=2048, validators=[URLValidator(schemes=["http", "https"])]
    )
    oai_id = serializers.CharField(max_length=512, trim_whitespace=True)
    prefix = serializers.CharField(max_length=64, required=False, default="oai_dc")

    ALIASES = {"oaiId": "oai_id", "baseUrl": "base_url"}

    @classmethod
    def from_query(cls, query_params) -> "RecordLinkQuerySerializer":
        dados = {chave: query_params[chave] for chave in query_params}
        for camel, snake in cls.ALIASES.items():
            if camel in dados:
                dados.setdefault(snake, dados.pop(camel))
        serializer = cls(data=dados)
        serializer.is_valid(raise_exception=True)
        return serializer


class RecordLinkSerializer(serializers.Serializer):
    """Saída da resolução de link — existe para o schema, não para validar.

    A rota responde 200 mesmo sem link: descrever os campos no OpenAPI é o que
    permite ao frontend distinguir "não há endereço" de "a origem não
    respondeu" sem ler o código do servidor.
    """

    oaiId = serializers.CharField()
    link = serializers.CharField(allow_null=True)
    source = serializers.CharField(
        allow_null=True,
        help_text="`identifier` quando o link sai do próprio id; `record:<regra>` quando sai do metadado.",
    )
    reason = serializers.CharField(
        allow_null=True,
        help_text="Preenchido só quando `link` é nulo: `unreachable`, `no-usable-url` ou `oai-error:<código>`.",
    )
    candidates = serializers.ListField(
        child=serializers.CharField(),
        help_text="URLs consideradas no metadado, em ordem de documento.",
    )
