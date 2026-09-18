from django.contrib import admin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("title", "category", "destino", "created_at", "read_at", "read_by")
    list_filter = ("category", "read_at")
    search_fields = ("title", "message", "harvester_repository_id", "recipient__username")
    autocomplete_fields = ("recipient", "author", "read_by")
    readonly_fields = ("created_at",)

    @admin.display(description="destino")
    def destino(self, obj: Notification) -> str:
        return obj.recipient and str(obj.recipient) or obj.harvester_repository_id
