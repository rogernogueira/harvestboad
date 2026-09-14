from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

# Toda a API vive sob /api/v1/. Uma futura v2 entra ao lado, sem quebrar a v1.
api_v1 = [
    path("auth/", include("apps.accounts.urls")),
    path("repositories/", include("apps.repositories.urls")),
    path("harvests/", include("apps.harvests.urls")),
    path("reports/", include("apps.reports.urls")),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    # url_name precisa do namespace: as rotas vivem sob o namespace "v1".
    path("docs/", SpectacularSwaggerView.as_view(url_name="v1:schema"), name="swagger-ui"),
    path("redoc/", SpectacularRedocView.as_view(url_name="v1:schema"), name="redoc"),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include((api_v1, "v1"), namespace="v1")),
]
