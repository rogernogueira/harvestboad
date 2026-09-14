from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    MyRepositoriesSummaryView,
    RepositoryAccessViewSet,
    RepositoryDetailView,
    RepositoryHarvestsView,
)

app_name = "repositories"

router = DefaultRouter()
router.register("accesses", RepositoryAccessViewSet, basename="repository-access")

# `int` no conversor evita colisão com o prefixo "accesses/" do router: um
# identificador de repositório no Harvester é sempre numérico.
urlpatterns = [
    path("", include(router.urls)),
    path("summary/", MyRepositoriesSummaryView.as_view(), name="summary"),
    path("<int:repository_id>", RepositoryDetailView.as_view(), name="detail"),
    path("<int:repository_id>/harvests", RepositoryHarvestsView.as_view(), name="harvests"),
]
