"""Rotas de administração de contas.

Separadas de `urls.py` de propósito: aquele módulo cuida de autenticação
(`/auth/`), enquanto estas são operações administrativas sobre contas
(`/accounts/`), restritas ao perfil ADMIN.
"""

from django.urls import path

from .views import UserListView

app_name = "accounts-management"

urlpatterns = [
    path("users/", UserListView.as_view(), name="user-list"),
]
