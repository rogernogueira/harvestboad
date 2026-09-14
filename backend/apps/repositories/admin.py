from django.contrib import admin

from .models import RepositoryAccess


@admin.register(RepositoryAccess)
class RepositoryAccessAdmin(admin.ModelAdmin):
    list_display = ("user", "acronym", "harvester_repository_id", "granted_at")
    list_filter = ("acronym",)
    search_fields = ("user__username", "user__email", "acronym", "harvester_repository_id")
    autocomplete_fields = ("user",)
