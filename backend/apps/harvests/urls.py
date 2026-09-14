from django.urls import path

from .views import (
    HarvestDetailView,
    HarvestDiagnosisView,
    HarvestRecordDetailView,
    HarvestRecordXmlView,
    HarvestRecordsView,
    HarvestRuleOccurrencesView,
    HarvestRulesView,
)

app_name = "harvests"

# Identificadores OAI contêm "/" (ex.: oai:host:article/1), por isso o conversor
# `path`. A rota terminada em /xml precisa vir antes, senão o conversor engole
# o sufixo como parte do identificador.
urlpatterns = [
    path("<str:snapshot_id>/diagnosis", HarvestDiagnosisView.as_view(), name="diagnosis"),
    path("<str:snapshot_id>/rules", HarvestRulesView.as_view(), name="rules"),
    path(
        "<str:snapshot_id>/rules/<str:rule_id>/occurrences",
        HarvestRuleOccurrencesView.as_view(),
        name="rule-occurrences",
    ),
    path("<str:snapshot_id>/records", HarvestRecordsView.as_view(), name="records"),
    path(
        "<str:snapshot_id>/records/<path:identifier>/xml",
        HarvestRecordXmlView.as_view(),
        name="record-xml",
    ),
    path(
        "<str:snapshot_id>/records/<path:identifier>",
        HarvestRecordDetailView.as_view(),
        name="record-detail",
    ),
    path("<str:snapshot_id>", HarvestDetailView.as_view(), name="detail"),
]
