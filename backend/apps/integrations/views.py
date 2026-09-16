"""Base das views que leem do Harvester."""

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .harvester import HarvesterError
from .oai import suggested_link
from .serializers import RecordLinkQuerySerializer, RecordLinkSerializer


class HarvesterBackedAPIView(APIView):
    """Traduz falhas do Harvester em status HTTP significativos.

    A distinção importa para o frontend: 503 convida a tentar de novo, 502 diz
    que a origem respondeu algo que não dá para usar, e 404 é resposta final.
    """

    permission_classes = [permissions.IsAuthenticated]

    def handle_exception(self, exc):
        if isinstance(exc, HarvesterError):
            if exc.status_code is None:
                return Response(
                    {"detail": f"Harvester inacessível: {exc}"},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            if exc.status_code == 404:
                return Response(
                    {"detail": "Recurso não encontrado no Harvester."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return super().handle_exception(exc)


class RecordLinkView(APIView):
    """Endereço público de um registro, resolvido no OAI-PMH da origem.

    Não passa pelo Harvester, então não herda `HarvesterBackedAPIView`: a
    origem aqui é o repositório do cliente, e a indisponibilidade dela não é
    erro da nossa API — vem como `link: null` com o motivo, para a tela decidir
    entre esconder o botão e exibir o aviso.
    """

    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "baseUrl",
                str,
                required=True,
                description="baseURL OAI-PMH do repositório. Alias: `base_url`.",
            ),
            OpenApiParameter(
                "oaiId",
                str,
                required=True,
                description="Identificador OAI do registro. Alias: `oai_id`.",
            ),
            OpenApiParameter(
                "prefix",
                str,
                description="metadataPrefix do GetRecord. Padrão `oai_dc`.",
            ),
        ],
        description=(
            "Resolve o endereço público do registro a partir do identificador "
            "OAI. Responde sempre 200: `link` vem nulo quando não há endereço "
            "utilizável, e `reason` diz por quê (`unreachable`, `no-usable-url` "
            "ou `oai-error:<código>`). `source` distingue o link derivado do "
            "próprio identificador (`identifier`) do extraído do metadado "
            "(`record:<regra>`), e `candidates` lista as URLs consideradas."
        ),
        responses={200: RecordLinkSerializer},
    )
    def get(self, request: Request) -> Response:
        dados = RecordLinkQuerySerializer.from_query(request.query_params).validated_data
        resultado = suggested_link(
            oai_id=dados["oai_id"],
            base_url=dados["base_url"],
            prefix=dados["prefix"],
        )
        return Response({"oaiId": dados["oai_id"], **resultado})
