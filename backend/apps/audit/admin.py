from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    """Somente leitura: a trilha de auditoria não deve ser editada pela interface."""

    list_display = ("created_at", "user", "action", "resource", "resource_id", "ip_address")
    list_filter = ("action", "resource", "created_at")
    search_fields = ("user__username", "resource", "resource_id", "ip_address")
    date_hierarchy = "created_at"

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False
