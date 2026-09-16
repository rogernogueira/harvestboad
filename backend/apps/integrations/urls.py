from django.urls import path

from .views import RecordLinkView

app_name = "integrations"

urlpatterns = [
    path("record-link", RecordLinkView.as_view(), name="record-link"),
]
