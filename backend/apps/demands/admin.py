from django.contrib import admin

from .models import HarvestRequest


@admin.register(HarvestRequest)
class HarvestRequestAdmin(admin.ModelAdmin):
    list_display = ("acronym", "harvester_repository_id", "status", "requester", "created_at")
    list_filter = ("status",)
    search_fields = ("acronym", "harvester_repository_id", "requester__username", "snapshot_id")
    autocomplete_fields = ("requester", "resolved_by")
    readonly_fields = ("created_at",)
