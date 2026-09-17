from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.request import Request
from rest_framework.response import Response

from apps.integrations.views import HarvesterBackedAPIView

from . import services
from .filters import RecordFilters
from .permissions import assert_can_read_snapshot

SNAPSHOT_PARAM = OpenApiParameter(
    "snapshot_id", str, OpenApiParameter.PATH, description="ID da coleta no Harvester."
)


FILTER_PARAMS = [
    OpenApiParameter("valid", bool, description="Filtra por registros válidos ou inválidos."),
    OpenApiParameter("transformed", bool, description="Filtra por registros transformados."),
    OpenApiParameter(
        "invalidRule",
        str,
        description="ID de regra violada. Repetível ou separado por vírgula; combina em E.",
    ),
    OpenApiParameter(
        "validRule",
        str,
        description="ID de regra atendida. Repetível ou separado por vírgula; combina em E.",
    ),
]


class BaseHarvestView(HarvesterBackedAPIView):
    """Base das rotas de coleta: acrescenta o controle de acesso por snapshot."""

    def authorize(self, request: Request, snapshot_id: str) -> dict:
        return assert_can_read_snapshot(request.user, snapshot_id)


class HarvestDetailView(BaseHarvestView):
    @extend_schema(
        parameters=[SNAPSHOT_PARAM],
        description="Dados da coleta e o repositório a que pertence.",
    )
    def get(self, request: Request, snapshot_id: str) -> Response:
        self.authorize(request, snapshot_id)
        return Response(services.snapshot_detail(snapshot_id))


class HarvestDiagnosisView(BaseHarvestView):
    @extend_schema(
        parameters=[SNAPSHOT_PARAM],
        description="Resumo do diagnóstico: totais, facetas e quantidade de regras.",
    )
    def get(self, request: Request, snapshot_id: str) -> Response:
        self.authorize(request, snapshot_id)
        return Response(services.diagnosis(snapshot_id))


class HarvestRulesView(BaseHarvestView):
    @extend_schema(
        parameters=[SNAPSHOT_PARAM],
        description="Regras de validação aplicadas, com contagens de válidos e inválidos.",
    )
    def get(self, request: Request, snapshot_id: str) -> Response:
        self.authorize(request, snapshot_id)
        return Response(services.rules(snapshot_id))


class HarvestRuleOccurrencesView(BaseHarvestView):
    @extend_schema(
        parameters=[
            SNAPSHOT_PARAM,
            OpenApiParameter(
                "rule_id", str, OpenApiParameter.PATH, description="ID da regra no diagnóstico."
            ),
            *FILTER_PARAMS,
        ],
        description=(
            "Ocorrências de uma regra na coleta, agrupadas por valor. Aceita o mesmo "
            "vocabulário de filtros dos registros, que recorta as contagens do mesmo "
            "jeito, e os devolve ecoados em `filters`."
        ),
    )
    def get(self, request: Request, snapshot_id: str, rule_id: str) -> Response:
        self.authorize(request, snapshot_id)
        filters = RecordFilters.from_query(request.query_params)
        return Response(services.rule_occurrences(snapshot_id, rule_id, filters=filters))


def parse_pagination(request: Request) -> tuple[int, int]:
    """Lê page/count, limitando o tamanho da página."""
    try:
        page = max(1, int(request.query_params.get("page", 1)))
        count = min(200, max(1, int(request.query_params.get("count", 20))))
    except ValueError as exc:
        raise DRFValidationError(
            {"detail": "Os parâmetros page e count devem ser inteiros."}
        ) from exc
    return page, count


class HarvestRecordsView(BaseHarvestView):
    @extend_schema(
        parameters=[
            SNAPSHOT_PARAM,
            OpenApiParameter("page", int, description="Página, começando em 1."),
            OpenApiParameter("count", int, description="Registros por página (máx. 200)."),
            *FILTER_PARAMS,
        ],
        description=(
            "Registros da coleta, paginados e filtráveis. Os filtros usam o mesmo "
            "vocabulário das regras e facetas do diagnóstico, e voltam ecoados em "
            "`filters` para que o cliente os preserve ao navegar."
        ),
    )
    def get(self, request: Request, snapshot_id: str) -> Response:
        self.authorize(request, snapshot_id)
        page, count = parse_pagination(request)
        filters = RecordFilters.from_query(request.query_params)
        return Response(
            services.records(snapshot_id, page=page, count=count, filters=filters)
        )


class HarvestRecordDetailView(BaseHarvestView):
    @extend_schema(
        parameters=[SNAPSHOT_PARAM, *FILTER_PARAMS],
        description=(
            "Registro individual pelo identificador OAI. Passar os mesmos filtros "
            "da listagem reduz o espaço de busca quando o id não é derivável."
        ),
    )
    def get(self, request: Request, snapshot_id: str, identifier: str) -> Response:
        self.authorize(request, snapshot_id)
        filters = RecordFilters.from_query(request.query_params)
        record = services.find_record(snapshot_id, identifier, filters=filters)
        if record is None:
            return Response(
                {"detail": "Registro não encontrado na coleta."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(record)


class HarvestRecordXmlView(BaseHarvestView):
    @extend_schema(
        parameters=[SNAPSHOT_PARAM],
        description="XML transformado do registro. Responde text/xml.",
        responses={200: str, 404: None},
    )
    def get(self, request: Request, snapshot_id: str, identifier: str) -> Response:
        self.authorize(request, snapshot_id)
        xml = services.record_xml(snapshot_id, identifier)
        if xml is None:
            return Response(
                {
                    "detail": (
                        "O Harvester não devolveu o XML deste registro "
                        "(relatório de diagnóstico desatualizado na origem)."
                    )
                },
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(xml, content_type="application/xml; charset=utf-8")
