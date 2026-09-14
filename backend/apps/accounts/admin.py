from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from apps.repositories.models import RepositoryAccess

from .models import User


class RepositoryAccessInline(admin.TabularInline):
    """Associa gestores a repositórios direto na tela do usuário."""

    model = RepositoryAccess
    extra = 1
    fields = ("harvester_repository_id", "acronym", "granted_at")
    readonly_fields = ("granted_at",)


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    inlines = [RepositoryAccessInline]
    list_display = ("username", "email", "profile", "is_active", "must_change_password", "last_login")
    list_filter = ("profile", "is_active", "is_staff")
    search_fields = ("username", "email", "first_name", "last_name")
    actions = ["bloquear_usuarios", "desbloquear_usuarios", "exigir_troca_de_senha"]

    fieldsets = (
        (None, {"fields": ("username", "password")}),
        ("Dados pessoais", {"fields": ("first_name", "last_name", "email")}),
        ("Perfil e acesso", {"fields": ("profile", "must_change_password", "is_active")}),
        ("Permissões do Django", {"fields": ("is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Datas", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("username", "email", "profile", "password1", "password2"),
            },
        ),
    )

    @admin.action(description="Bloquear usuários selecionados")
    def bloquear_usuarios(self, request, queryset):
        updated = queryset.update(is_active=False)
        self.message_user(request, f"{updated} usuário(s) bloqueado(s).")

    @admin.action(description="Desbloquear usuários selecionados")
    def desbloquear_usuarios(self, request, queryset):
        updated = queryset.update(is_active=True)
        self.message_user(request, f"{updated} usuário(s) desbloqueado(s).")

    @admin.action(description="Exigir troca de senha no próximo acesso")
    def exigir_troca_de_senha(self, request, queryset):
        updated = queryset.update(must_change_password=True)
        self.message_user(request, f"{updated} usuário(s) deverão trocar a senha.")
