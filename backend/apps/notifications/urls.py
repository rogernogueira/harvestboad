from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    NotificationCategoryViewSet,
    NotificationTemplateViewSet,
    NotificationViewSet,
)

app_name = "notifications"

router = DefaultRouter()
# Os cadastros vêm antes do viewset raiz de propósito: aquele está registrado em
# `""`, e a rota de detalhe dele (`<pk>/`) engoliria `categories/` se viesse
# primeiro — o router resolve na ordem de registro.
router.register("categories", NotificationCategoryViewSet, basename="notification-category")
router.register("templates", NotificationTemplateViewSet, basename="notification-template")
router.register("", NotificationViewSet, basename="notification")

urlpatterns = [
    path("", include(router.urls)),
]
