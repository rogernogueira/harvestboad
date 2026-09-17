from django.urls import path

from .views import HarvestsCsvExportView, RecordsCsvExportView

app_name = "reports"

urlpatterns = [
    path(
        "harvests/<str:snapshot_id>/records.csv",
        RecordsCsvExportView.as_view(),
        name="records-csv",
    ),
    # `int` no conversor pelo mesmo motivo do app repositories: o identificador
    # de repositório no Harvester é sempre numérico, e o tipo evita que a rota
    # engula qualquer outro caminho.
    path(
        "repositories/<int:repository_id>/harvests.csv",
        HarvestsCsvExportView.as_view(),
        name="harvests-csv",
    ),
]
