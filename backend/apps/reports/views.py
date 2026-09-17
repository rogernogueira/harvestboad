from django.http import StreamingHttpResponse
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.request import Request

from apps.audit.models import AuditLog
from apps.audit.services import record as audit_record
from apps.harvests.filters import RecordFilters
from apps.harvests.permissions import assert_can_read_snapshot
from apps.harvests.views import FILTER_PARAMS, SNAPSHOT_PARAM
from apps.integrations.views import HarvesterBackedAPIView
from apps.repositories.permissions import assert_can_read_repository
from apps.repositories.views import REPOSITORY_PARAM

from . import services

MAX_ROWS = 50_000


class RecordsCsvExportView(HarvesterBackedAPIView):
    """Exporta os registros de uma coleta em CSV.

    A autorização é exatamente a da tela: a mesma `assert_can_read_snapshot` que
    as rotas de /harvests/ usam. Um gestor não exporta o que não pode ver, e não
    há caminho alternativo por aqui.

    Os filtros também são os mesmos da listagem, então o que estiver na tela é o
    que sai no arquivo.
    """

    @extend_schema(
        parameters=[
            SNAPSHOT_PARAM,
            *FILTER_PARAMS,
            OpenApiParameter(
                "maxRows", int, description=f"Limite de linhas (máx. {MAX_ROWS})."
            ),
        ],
        description="Exportação CSV dos registros da coleta, respeitando os filtros.",
        responses={(200, "text/csv"): str},
    )
    def get(self, request: Request, snapshot_id: str) -> StreamingHttpResponse:
        assert_can_read_snapshot(request.user, snapshot_id)
        filters = RecordFilters.from_query(request.query_params)

        try:
            max_rows = min(MAX_ROWS, max(1, int(request.query_params.get("maxRows", MAX_ROWS))))
        except ValueError:
            max_rows = MAX_ROWS

        audit_record(
            action=AuditLog.Action.EXPORT,
            resource="harvest_records_csv",
            resource_id=snapshot_id,
            request=request,
        )

        response = StreamingHttpResponse(
            services.csv_rows(snapshot_id, filters, max_rows),
            content_type="text/csv; charset=utf-8",
        )
        nome = services.filename(snapshot_id, filters)
        response["Content-Disposition"] = f'attachment; filename="{nome}"'
        return response


class HarvestsCsvExportView(HarvesterBackedAPIView):
    """Exporta o histórico de coletas de um repositório em CSV.

    A autorização é a do repositório, não a da coleta: aqui não há snapshot
    escolhido, e a lista é justamente o que diz quais existem. Vale a mesma
    `assert_can_read_repository` da tela de histórico.
    """

    @extend_schema(
        parameters=[REPOSITORY_PARAM],
        description="Exportação CSV do histórico de coletas do repositório.",
        responses={(200, "text/csv"): str},
    )
    def get(self, request: Request, repository_id: int) -> StreamingHttpResponse:
        assert_can_read_repository(request.user, repository_id)

        audit_record(
            action=AuditLog.Action.EXPORT,
            resource="repository_harvests_csv",
            resource_id=str(repository_id),
            request=request,
        )

        response = StreamingHttpResponse(
            services.harvest_csv_rows(str(repository_id)),
            content_type="text/csv; charset=utf-8",
        )
        nome = services.harvest_filename(str(repository_id))
        response["Content-Disposition"] = f'attachment; filename="{nome}"'
        return response
