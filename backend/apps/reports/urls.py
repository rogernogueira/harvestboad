from django.urls import path

from .views import RecordsCsvExportView

app_name = "reports"

urlpatterns = [
    path(
        "harvests/<str:snapshot_id>/records.csv",
        RecordsCsvExportView.as_view(),
        name="records-csv",
    ),
]
