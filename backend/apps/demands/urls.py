from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import HarvestRequestViewSet

app_name = "demands"

router = DefaultRouter()
router.register("", HarvestRequestViewSet, basename="harvest-request")

urlpatterns = [path("", include(router.urls))]
